import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { requireAppBaseUrl, getAppBaseUrl } from "@/lib/app-urls";
import { VERIFICATION_TTL_HOURS } from "@/lib/beta-verification";

/**
 * Environment-aware origins for account-journey emails.
 *
 * ── THE BLOCKER ───────────────────────────────────────────────────────────
 *
 * NEXT_PUBLIC_APP_URL is one project-wide value. Set to production so
 * production is right, it also applied on every Vercel Preview — so a beta
 * signup made on a Preview was emailed
 * `https://servicesignal.app/api/beta/verify?token=...`, and production does
 * not contain that route, so it 404'd. The entry journey could not be tested
 * end to end before release.
 *
 * These tests drive the REAL resolver with the environment set the way each
 * deployment sets it.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

/** Runs `fn` with a temporary process.env, always restored. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const PROD = "https://servicesignal.app";

// ── Production ─────────────────────────────────────────────────────────────

test("production resolves verification links to servicesignal.app", () => {
  withEnv(
    { VERCEL_ENV: "production", VERCEL_URL: "servicesignal-xyz.vercel.app", NEXT_PUBLIC_APP_URL: PROD },
    () => {
      // Even though VERCEL_URL exists on a production deployment too, it must
      // NOT win: production links must use the real domain, not the immutable
      // per-deployment host.
      assert.equal(requireAppBaseUrl(), PROD);
      assert.equal(getAppBaseUrl(), PROD);
    }
  );
});

// ── Preview ────────────────────────────────────────────────────────────────

test("a Preview resolves links to that same Preview deployment", () => {
  withEnv(
    {
      VERCEL_ENV: "preview",
      VERCEL_URL: "servicesignal-kgif5dn5c-samadalobaydi.vercel.app",
      // Deliberately the production value, exactly as the project-wide setting
      // supplies it. This is the whole bug: it must NOT win on a Preview.
      NEXT_PUBLIC_APP_URL: PROD,
    },
    () => {
      const base = requireAppBaseUrl();
      assert.equal(base, "https://servicesignal-kgif5dn5c-samadalobaydi.vercel.app");
      assert.notEqual(base, PROD, "a Preview must not email production links");

      // The full link the email actually builds.
      assert.equal(
        `${base}/api/beta/verify?token=abc`,
        "https://servicesignal-kgif5dn5c-samadalobaydi.vercel.app/api/beta/verify?token=abc"
      );
    }
  );
});

test("local development is unaffected", () => {
  withEnv(
    { VERCEL_ENV: undefined, VERCEL_URL: undefined, PREVIEW_APP_URL: undefined,
      NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://localhost:3000" },
    () => {
      assert.equal(requireAppBaseUrl(), "http://localhost:3000");
      assert.equal(getAppBaseUrl(), "http://localhost:3000");
    }
  );
});

// ── Security ───────────────────────────────────────────────────────────────

test("a spoofed request origin cannot determine the verification URL", () => {
  // The resolver reads ONLY platform-injected variables and explicit config.
  // Nothing a caller sends can reach it, which matters because these links
  // carry one-time tokens: a spoofable origin would have a real token mailed
  // to a host the attacker controls.
  const src = read("lib/app-urls.ts");
  for (const requestDerived of [
    /\bheaders\(\)/, /request\.headers/, /req\.headers/,
    /["']host["']/i, /["']x-forwarded-host["']/i,
    /["']origin["']/i, /["']referer["']/i,
    /searchParams/, /request\.url/,
  ]) {
    assert.equal(requestDerived.test(src), false,
      `app-urls must not read ${requestDerived} — it is caller-controlled`);
  }

  // ALLOW-LIST, not a ban-list. Enumerating forbidden spellings is a losing
  // game — a mutant reading `process.env.headers` slipped straight through
  // one. Instead: every environment value this module reads must be one of
  // exactly three, all deployment configuration, none request-derived.
  const envReads = Array.from(src.matchAll(/process\.env\.(\w+)/g)).map((m) => m[1]);
  // PREVIEW_APP_URL is deployment configuration like the others, and is
  // deliberately server-only (no NEXT_PUBLIC_ prefix) because it builds token
  // links during server-side email rendering.
  // NODE_ENV joins the allow-list: it is set by the framework/build, never by
  // a request, and is what positively identifies local development.
  const ALLOWED = new Set([
    "NEXT_PUBLIC_APP_URL", "VERCEL_ENV", "VERCEL_URL", "PREVIEW_APP_URL", "NODE_ENV",
  ]);
  for (const name of envReads) {
    assert.ok(ALLOWED.has(name),
      `app-urls reads process.env.${name}; only trusted deployment config is permitted`);
  }
  assert.ok(envReads.includes("VERCEL_ENV") && envReads.includes("VERCEL_URL"),
    "the preview correction must read both platform variables");
  // The preview branch is keyed on VERCEL_ENV, and production is never
  // overridable. (Comments are irrelevant here: these match executable code.)
  assert.match(src, /const env = process\.env\.VERCEL_ENV;/);
  assert.match(src, /if \(env === "preview"\) \{/);
  // Server-only by design: a NEXT_PUBLIC_ copy would be inlined into the
  // client bundle and lose its trust guarantee.
  assert.equal(/NEXT_PUBLIC_VERCEL_URL/.test(src), false,
    "the preview host must stay a server-only variable");
});

test("a malformed VERCEL_URL SUPPRESSES the email, never falls back to production", () => {
  // CHANGED DELIBERATELY. This previously allowed a fallback to
  // NEXT_PUBLIC_APP_URL. On a Preview that value is the production origin, so
  // the fallback quietly rebuilt the exact 404 link the preview fix removed.
  for (const bad of [
    "https://evil.example.com",   // carries a scheme
    "good.vercel.app/../../evil", // carries a path
    "user:pass@evil.example.com", // carries credentials
  ]) {
    withEnv(
      { VERCEL_ENV: "preview", VERCEL_URL: bad, PREVIEW_APP_URL: undefined, NEXT_PUBLIC_APP_URL: PROD },
      () => {
        assert.equal(requireAppBaseUrl(), null,
          `VERCEL_URL ${JSON.stringify(bad)} must suppress the email, not fall back`);
      }
    );
  }
});

test("a Preview with NO VERCEL_URL cannot emit a production verification link", () => {
  // THE CONFIGURATION THAT CAUSES THIS: "Automatically expose System
  // Environment Variables" switched off in the Vercel project, so VERCEL_URL
  // never reaches the runtime. The deployment cannot know its own origin.
  //
  // Falling through would reach the project-wide NEXT_PUBLIC_APP_URL —
  // production — and mail a token to a route that does not exist there.
  withEnv(
    { VERCEL_ENV: "preview", VERCEL_URL: undefined, PREVIEW_APP_URL: undefined, NEXT_PUBLIC_APP_URL: PROD },
    () => {
      const base = requireAppBaseUrl();
      assert.equal(base, null, "a Preview that cannot identify itself must send nothing");
      assert.notEqual(base, PROD, "and must never silently use the production origin");
    }
  );

  // Empty and whitespace-only are the same condition.
  for (const blank of ["", "   "]) {
    withEnv(
      { VERCEL_ENV: "preview", VERCEL_URL: blank, PREVIEW_APP_URL: undefined, NEXT_PUBLIC_APP_URL: PROD },
      () => { assert.equal(requireAppBaseUrl(), null); }
    );
  }
});

test("PREVIEW_APP_URL is the ONLY supported explicit Preview override", () => {
  const PREVIEW = "https://ss-my-branch.vercel.app";

  // 1. Used when the trusted system variable is unavailable.
  withEnv(
    { VERCEL_ENV: "preview", VERCEL_URL: undefined, PREVIEW_APP_URL: PREVIEW, NEXT_PUBLIC_APP_URL: PROD },
    () => assert.equal(requireAppBaseUrl(), PREVIEW)
  );

  // 2. Used when VERCEL_URL is present but unusable.
  withEnv(
    { VERCEL_ENV: "preview", VERCEL_URL: "https://not-a-bare-host", PREVIEW_APP_URL: PREVIEW, NEXT_PUBLIC_APP_URL: PROD },
    () => assert.equal(requireAppBaseUrl(), PREVIEW)
  );

  // 3. The trusted system variable still WINS when it is valid — the override
  //    is a fallback, not a way to redirect a working deployment's tokens.
  withEnv(
    { VERCEL_ENV: "preview", VERCEL_URL: "ss-real.vercel.app", PREVIEW_APP_URL: PREVIEW, NEXT_PUBLIC_APP_URL: PROD },
    () => assert.equal(requireAppBaseUrl(), "https://ss-real.vercel.app")
  );

  // 4. NEXT_PUBLIC_APP_URL is NOT a Preview override. Even scoped to the
  //    Preview environment in Vercel, it is never consulted on a preview.
  //    Documented because the opposite was previously reported as an option.
  withEnv(
    { VERCEL_ENV: "preview", VERCEL_URL: undefined, PREVIEW_APP_URL: undefined, NEXT_PUBLIC_APP_URL: PREVIEW },
    () => assert.equal(requireAppBaseUrl(), null,
      "NEXT_PUBLIC_APP_URL must not act as a Preview override")
  );

  // 5. Pointing the override at production is refused — that is a copy-paste
  //    of NEXT_PUBLIC_APP_URL and would rebuild the 404.
  withEnv(
    { VERCEL_ENV: "preview", VERCEL_URL: undefined, PREVIEW_APP_URL: PROD, NEXT_PUBLIC_APP_URL: PROD },
    () => assert.equal(requireAppBaseUrl(), null,
      "a Preview override naming production must be ignored, not honoured")
  );

  // 6. Malformed override is refused rather than interpolated.
  for (const bad of ["not-a-url", "ftp://x.example", "   "]) {
    withEnv(
      { VERCEL_ENV: "preview", VERCEL_URL: undefined, PREVIEW_APP_URL: bad, NEXT_PUBLIC_APP_URL: PROD },
      () => assert.equal(requireAppBaseUrl(), null, `PREVIEW_APP_URL ${JSON.stringify(bad)}`)
    );
  }

  // 7. It has no effect off a Preview: production stays production.
  withEnv(
    { VERCEL_ENV: "production", VERCEL_URL: "x.vercel.app", PREVIEW_APP_URL: PREVIEW, NEXT_PUBLIC_APP_URL: PROD },
    () => assert.equal(requireAppBaseUrl(), PROD,
      "a stray PREVIEW_APP_URL must never affect production")
  );
});

test("the in-app resolver stays lenient — only EMAIL fails closed", () => {
  // getAppBaseUrl builds in-app links, where a wrong origin is visible at once
  // and harmless. It must not start suppressing navigation because a preview
  // variable is missing.
  withEnv(
    { VERCEL_ENV: "preview", VERCEL_URL: undefined, PREVIEW_APP_URL: undefined, NEXT_PUBLIC_APP_URL: PROD },
    () => {
    assert.equal(getAppBaseUrl(), PROD, "in-app links still resolve");
    assert.equal(requireAppBaseUrl(), null, "but the email does not send");
    }
  );
});

test("an unset origin still SUPPRESSES the email rather than guessing", () => {
  // The fail-closed guarantee predates this fix and must survive it.
  withEnv({ VERCEL_ENV: undefined, VERCEL_URL: undefined, NEXT_PUBLIC_APP_URL: undefined }, () => {
    assert.equal(requireAppBaseUrl(), null,
      "an account-journey email must not be sent with a guessed origin");
  });
  withEnv({ VERCEL_ENV: undefined, VERCEL_URL: undefined, NEXT_PUBLIC_APP_URL: "not-a-url" }, () => {
    assert.equal(requireAppBaseUrl(), null);
  });
});

// ── The route, and the journey it feeds ────────────────────────────────────

test("[static] /api/beta/verify exists and redirects into the signup journey", () => {
  assert.ok(existsSync(join(ROOT, "app/api/beta/verify/route.ts")),
    "the verification route must exist in the app");

  const route = read("app/api/beta/verify/route.ts");
  // Same-origin redirect built from request.url, so whichever deployment the
  // user actually reached is the one that continues the journey.
  assert.match(route, /NextResponse\.redirect\(new URL\(`\/verify\?state=\$\{state\}`, request\.url\)\)/,
    "verification must hand off to /verify on the same origin");
  assert.ok(existsSync(join(ROOT, "app/verify/page.tsx")), "/verify must exist");

  // The email builds its link against the resolver, not a hardcoded origin.
  const email = read("lib/beta-access-email.ts");
  assert.match(email, /requireAppBaseUrl\(\)/);
  assert.match(email, /\$\{baseUrl\}\/api\/beta\/verify\?token=/);
  assert.equal(/https:\/\/servicesignal\.app/.test(email), false,
    "the email must not hardcode the production origin");
});

test("[static] the other email/link flows share the fixed resolver", () => {
  // Same resolver, so the fix reaches them; none is rewritten here.
  assert.match(read("lib/welcome-email.ts"), /requireAppBaseUrl\(\)/);
  assert.match(read("app/forgot-password/page.tsx"), /getResetPasswordRedirectUrl\(\)/);
  assert.match(read("components/auth/AuthShell.tsx"), /getAuthCallbackUrl\(/);

  // No flow may bypass the resolver with its own hardcoded origin.
  for (const f of [
    "lib/welcome-email.ts", "lib/beta-access-email.ts",
    "app/forgot-password/page.tsx", "components/auth/AuthShell.tsx",
  ]) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.equal(/["']https:\/\/servicesignal\.app/.test(code), false,
      `${f} must resolve its origin, not hardcode one`);
  }
});

// ── The signup outcome contract ────────────────────────────────────────────

test("[static] every no-email path reports emailSent: false", () => {
  // The invariant: the UI may only say "Check your inbox" when the server
  // genuinely got a send accepted. Proven by checking that no branch returns
  // emailSent true without the provider having said so.
  const route = read("app/api/signup/route.ts");
  const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // The ONLY assignment that can make it true is the provider call itself.
  // Only the FIRST token of each assignment — the value spans several lines.
  const assignments = Array.from(code.matchAll(/emailSent\s*=\s*([^;\n]+)/g))
    .map((m) => m[1].trim())
    .filter((a) => a !== "false");
  assert.equal(assignments.length, 1,
    `exactly one assignment may make emailSent true, found ${assignments.length}`);
  assert.match(assignments[0], /^await sendBetaAccessEmail\(/,
    "emailSent may only become true from the provider result");

  // Duplicate signup: saved, not resent, and honestly reported.
  const dup = code.slice(code.indexOf('error.code === "23505"'));
  const dupBody = dup.slice(0, dup.indexOf("}\n"));
  assert.match(dupBody, /outcome: "already_listed"/);
  assert.match(dupBody, /emailSent: false/,
    "a duplicate must never claim an email was sent");
  assert.equal(/sendBetaAccessEmail/.test(dupBody), false,
    "duplicates are deliberately NOT resent — no per-address cooldown exists yet");

  // Three distinguishable outcomes, as required.
  for (const outcome of ["already_listed", "saved_and_sent", "saved_no_email", "rate_limited"]) {
    assert.ok(code.includes(`"${outcome}"`), `outcome ${outcome} must be reachable`);
  }
});

test("[static] the provider result is what decides the success copy", () => {
  const email = read("lib/beta-access-email.ts");
  const code = email.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // COUNTING, not pattern-matching each block. An earlier version used
  // `if (!baseUrl) { [\s\S]*? return false; }`, which is non-greedy and
  // happily matched a `return false` further down the file — so flipping an
  // individual guard to `return true` slipped straight through.
  //
  // The invariant that actually matters: there is exactly ONE `return true`
  // in this module, and it sits after the provider accepted the send.
  const trues = code.match(/return true;/g) ?? [];
  assert.equal(trues.length, 1,
    `exactly one path may report success, found ${trues.length}`);
  assert.match(code, /console\.log\(`\[beta-access\] sent[^`]*`\);\s*\n\s*return true;/,
    "the only success return must follow an accepted provider send");

  // ...and every guard still refuses rather than proceeding.
  for (const guard of [
    /if \(!baseUrl\) \{/,      // no configured origin
    /if \(!resend\) \{/,       // no provider key
    /if \(error\) \{/,         // provider rejected
    /catch \(err\) \{/,        // unexpected throw
  ]) {
    assert.match(code, guard, `the ${guard} guard must exist`);
  }
  // Four guards + the happy path: five exits, four of them false.
  const falses = code.match(/return false;/g) ?? [];
  assert.equal(falses.length, 4,
    `each of the four failure modes must return false, found ${falses.length}`);

  // Nothing sensitive is logged.
  for (const secret of [/\btoken\b\s*[,)]/, /verifyUrl\)/, /RESEND_API_KEY:/, /\bhtml\b\s*\)/]) {
    assert.equal(new RegExp(`console\\.(log|error|warn)\\([^)]*${secret.source}`).test(code), false,
      `logs must not include ${secret}`);
  }
});

test("[static] the three signup outcomes render three distinct states", () => {
  const section = read("components/v2/FoundingBetaSection.tsx");

  // Driven by the server's own two signals, not by HTTP status.
  assert.match(section, /setEmailSent\(Boolean\(data\.emailSent\)\)/);
  assert.match(section, /setAlreadyListed\(data\.outcome === "already_listed"\)/);
  // Reset between submissions, or a second attempt inherits the first verdict.
  assert.match(section, /setEmailSent\(false\);\s*\n\s*setAlreadyListed\(false\);/);

  // Three arms: sent → already-listed → genuine failure.
  const branch = section.slice(section.indexOf("{emailSent ? ("));
  assert.match(branch, /\{emailSent \? \([\s\S]*?\) : alreadyListed \? \([\s\S]*?\) : \(/,
    "the duplicate case must sit between 'sent' and 'failed'");

  // Bounded FORWARD from the duplicate arm, not with lastIndexOf. The
  // component contains further ternaries after this block, so lastIndexOf
  // found one of those and the duplicate slice swallowed the failure arm —
  // which made the "no failure copy here" assertion fail for the wrong reason.
  const dupStart = branch.indexOf(") : alreadyListed ? (");
  assert.ok(dupStart > -1, "the already-listed arm must exist");
  const failStart = branch.indexOf(") : (", dupStart + 5);
  assert.ok(failStart > dupStart, "the failure arm must follow it");

  const sent = branch.slice(0, dupStart);
  const dup = branch.slice(dupStart, failStart);
  const failed = branch.slice(failStart, branch.indexOf(")}", failStart));

  // 1. Fresh + sent.
  assert.match(sent, /Check your inbox/);
  assert.match(sent, /We&rsquo;ve sent a verification link/);

  // 2. Duplicate — truthful, and NOT described as a failure.
  assert.match(dup, /already on the list/i);
  assert.match(dup, /already registered for the founding beta/i);
  // Conditional on the email still being valid — see the expiry test below.
  assert.match(dup, /If you still have our/i);
  assert.match(dup, /open the link in it/i);
  assert.equal(/couldn&rsquo;t send/i.test(dup), false,
    "a deliberate no-resend must not be reported as an infrastructure failure");
  assert.equal(/Check your inbox<\/p>/.test(dup), false);

  // 3. Genuine failure keeps its failure copy.
  assert.match(failed, /We couldn&rsquo;t send a verification link/);
  assert.match(failed, /support@servicesignal\.app/);
  assert.equal(/already on the list/i.test(failed), false);

  // No arm other than the first may promise an inbox delivery.
  assert.equal(/We&rsquo;ve sent a verification link/.test(dup + failed), false,
    "only a confirmed send may claim a verification link was sent");
});

test("an UNCLASSIFIABLE deployed runtime fails closed, never production", () => {
  // ── THE INVARIANT ─────────────────────────────────────────────────────
  //
  // A Vercel Preview with system variables switched off exposes no VERCEL_ENV
  // and no VERCEL_URL — so it is indistinguishable from local development by
  // absence alone. Treating "no VERCEL_ENV" as "must be local" and falling
  // through to NEXT_PUBLIC_APP_URL emitted the PRODUCTION origin from a
  // Preview: the original 404 bug, reached by a second route.
  //
  // Executed before the fix, all three of these returned the production
  // origin. A security-sensitive resolver in an ambiguous deployed
  // environment must send nothing.
  for (const nodeEnv of [undefined, "production", "test"]) {
    withEnv(
      {
        VERCEL_ENV: undefined, VERCEL_URL: undefined, PREVIEW_APP_URL: undefined,
        NODE_ENV: nodeEnv, NEXT_PUBLIC_APP_URL: PROD,
      },
      () => {
        const base = requireAppBaseUrl();
        assert.equal(base, null,
          `NODE_ENV=${String(nodeEnv)}: an unclassifiable runtime must send nothing`);
        assert.notEqual(base, PROD, "and must never silently return production");
      }
    );
  }
});

test("local development is established POSITIVELY, not by absence", () => {
  // Signal 1: NODE_ENV=development, set by `next dev`. Vercel builds and runs
  // with NODE_ENV=production, so this is never true on a deployment.
  withEnv(
    { VERCEL_ENV: undefined, VERCEL_URL: undefined, PREVIEW_APP_URL: undefined,
      NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://localhost:3000" },
    () => assert.equal(requireAppBaseUrl(), "http://localhost:3000")
  );

  // Signal 2: a loopback origin — local by construction. Covers `next start`
  // locally, where NODE_ENV is production.
  for (const loopback of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
    withEnv(
      { VERCEL_ENV: undefined, VERCEL_URL: undefined, PREVIEW_APP_URL: undefined,
        NODE_ENV: "production", NEXT_PUBLIC_APP_URL: loopback },
      () => assert.equal(requireAppBaseUrl(), loopback, `${loopback} is positively local`)
    );
  }

  // NOT local: NODE_ENV=development is enough on its own, even with a non
  // loopback origin (a dev server behind a tunnel is still local).
  withEnv(
    { VERCEL_ENV: undefined, VERCEL_URL: undefined, PREVIEW_APP_URL: undefined,
      NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "https://my-tunnel.ngrok.io" },
    () => assert.equal(requireAppBaseUrl(), "https://my-tunnel.ngrok.io")
  );
});

test("production classification still resolves to the production origin", () => {
  withEnv(
    { VERCEL_ENV: "production", VERCEL_URL: "ss.vercel.app", PREVIEW_APP_URL: undefined,
      NODE_ENV: "production", NEXT_PUBLIC_APP_URL: PROD },
    () => assert.equal(requireAppBaseUrl(), PROD)
  );
});

test("PREVIEW_APP_URL works WITHOUT VERCEL_ENV, and never overrides production", () => {
  const PREVIEW = "https://example-preview.vercel.app";

  // ── THE CONTRADICTION THIS RESOLVES ───────────────────────────────────
  //
  // PREVIEW_APP_URL was documented as the answer to missing Vercel system
  // variables, but was gated behind VERCEL_ENV — itself one of those
  // variables. Executed, that combination returned the PRODUCTION origin:
  // exactly the silent fallback the contract forbids.
  withEnv(
    { VERCEL_ENV: undefined, VERCEL_URL: undefined, PREVIEW_APP_URL: PREVIEW, NEXT_PUBLIC_APP_URL: PROD },
    () => {
      const base = requireAppBaseUrl();
      assert.equal(base, PREVIEW,
        "an explicit Preview origin must work when VERCEL_ENV is absent");
      assert.notEqual(base, PROD, "and must never resolve to production");
    }
  );

  // An empty VERCEL_ENV is the same condition as an absent one.
  withEnv(
    { VERCEL_ENV: "", VERCEL_URL: undefined, PREVIEW_APP_URL: PREVIEW, NEXT_PUBLIC_APP_URL: PROD },
    () => assert.equal(requireAppBaseUrl(), PREVIEW)
  );

  // PRODUCTION IS NEVER OVERRIDABLE. A stray PREVIEW_APP_URL set at project
  // scope must not redirect production's token links.
  withEnv(
    { VERCEL_ENV: "production", VERCEL_URL: "ss.vercel.app", PREVIEW_APP_URL: PREVIEW, NEXT_PUBLIC_APP_URL: PROD },
    () => assert.equal(requireAppBaseUrl(), PROD,
      "VERCEL_ENV=production must ignore PREVIEW_APP_URL entirely")
  );

  // Local development, with no override set, is unchanged.
  withEnv(
    { VERCEL_ENV: undefined, VERCEL_URL: undefined, PREVIEW_APP_URL: undefined, NEXT_PUBLIC_APP_URL: "http://localhost:3000" },
    () => assert.equal(requireAppBaseUrl(), "http://localhost:3000")
  );
});

test("the duplicate state cannot promise that an expired link will work", () => {
  // Tokens expire after VERIFICATION_TTL_HOURS (48). A duplicate submission
  // issues NO replacement and sends nothing, so "check your inbox" alone would
  // become an instruction that cannot work two days later.
  const section = read("components/v2/FoundingBetaSection.tsx")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");   // comments cannot satisfy this
  const branch = section.slice(section.indexOf("{emailSent ? ("));
  const dupStart = branch.indexOf(") : alreadyListed ? (");
  const dup = branch.slice(dupStart, branch.indexOf(") : (", dupStart + 5));

  // States the expiry, and offers a route that still exists once it has passed.
  assert.match(dup, /expire 48 hours/i, "the duplicate state must state the expiry");
  assert.match(dup, /support@servicesignal\.app/,
    "an expired-link route must be offered");
  // MUST NOT promise a new link. issueVerification has one caller (the signup
  // route, which duplicates never reach) and there is no admin route, script
  // or task that can mint and send a replacement token — so "we'll send you a
  // new one" was a promise the product cannot keep.
  assert.equal(/send you a new one/i.test(dup), false,
    "no reissue mechanism exists; the copy must not promise one");
  assert.match(dup, /help you get set up/i, "it may only promise human help");

  // The number must agree with the real TTL and with /verify's own copy.
  assert.equal(VERIFICATION_TTL_HOURS, 48);

  // Comments stripped FIRST. app/verify/page.tsx explains in a comment WHY it
  // no longer says "send you a new one", and asserting on the raw file would
  // let that explanation trip the very check it documents.
  const verifyPage = read("app/verify/page.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(verifyPage, /valid for 48 hours/,
    "the two surfaces must quote the same lifetime");

  // Still no claim that a new email was just sent.
  assert.equal(/We&rsquo;ve sent a verification link/.test(dup), false);
  assert.equal(/couldn&rsquo;t send/i.test(dup), false,
    "a deliberate no-resend is not an infrastructure failure");
});

test("no surface promises a resend that the product cannot perform", () => {
  // PROVEN: issueVerification has exactly ONE caller — app/api/signup/route.ts
  // — which duplicates never reach. There is no admin route, no scripts/
  // directory and no npm task capable of minting and sending a replacement
  // token. Support can help a person; nothing can automatically reissue.
  //
  // Both customer-facing surfaces that mention an expired or missing link must
  // therefore promise help, not a new email.
  for (const f of ["app/verify/page.tsx", "components/v2/FoundingBetaSection.tsx"]) {
    const code = read(f)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.equal(/send you a new one/i.test(code), false,
      `${f} promises a reissue that no code path can deliver`);
    assert.equal(/we.?ll resend/i.test(code), false, `${f} must not promise a resend`);
    assert.match(code, /help you get set up/i,
      `${f} must offer the support route it can actually honour`);
  }

  // And the mechanism really is absent — if a reissue path is ever added, this
  // fails and the copy can honestly be upgraded.
  const callers = ["app/api/signup/route.ts"];
  const issueCallers = ["app", "lib"].flatMap((dir) => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.name === "node_modules" || e.name.startsWith(".")
          ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
    return walk(join(ROOT, dir));
  })
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith("lib/beta-verification.ts"))
    .filter((f) => /issueVerification\(/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length))
    .sort();
  assert.deepEqual(issueCallers, callers,
    "a new issueVerification caller may mean a reissue path now exists — revisit the copy");
});

test("[static] the duplicate outcome still reports emailSent: false", () => {
  // The copy change must not have quietly re-enabled resend or flipped the
  // flag to make the new arm reachable.
  const route = read("app/api/signup/route.ts");
  const dup = route.slice(route.indexOf('error.code === "23505"'));
  const body = dup.slice(0, dup.indexOf("}\n"));
  assert.match(body, /outcome: "already_listed"/);
  assert.match(body, /emailSent: false/);
  assert.equal(/sendBetaAccessEmail/.test(body), false,
    "duplicates must still not resend");
});

test("[static] the success state cannot claim a send that did not happen", () => {
  const section = read("components/v2/FoundingBetaSection.tsx");

  // The confirmation is gated on the server's own flag, not on HTTP success.
  assert.match(section, /setEmailSent\(Boolean\(data\.emailSent\)\)/);
  assert.match(section, /\{emailSent \? \(/,
    "the two confirmations must branch on emailSent");

  // "Check your inbox" must live ONLY inside the emailSent === true arm.
  const branch = section.slice(section.indexOf("{emailSent ? ("));
  const truthy = branch.slice(0, branch.indexOf(") : ("));
  assert.match(truthy, /Check your inbox/);
  assert.match(truthy, /We&rsquo;ve sent a verification link/);

  const falsy = branch.slice(branch.indexOf(") : ("));
  assert.equal(/Check your inbox/.test(falsy), false,
    "the no-send state must never claim an inbox delivery");
  assert.equal(/We&rsquo;ve sent a verification link/.test(falsy), false);
});
