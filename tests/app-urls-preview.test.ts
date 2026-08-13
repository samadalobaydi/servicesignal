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

/** The reused-email arm of the confirmation card, whitespace-collapsed. */
function reusedArm(): string {
  const section = readFileSync(join(ROOT, "components/v2/FoundingBetaSection.tsx"), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");   // comments cannot satisfy any of this
  const branch = section.slice(section.indexOf("{emailSent ? ("));
  const dupStart = branch.indexOf(") : alreadyListed ? (");
  assert.ok(dupStart > -1, "the reused-email arm must exist");
  const failStart = branch.indexOf("\n              ) : (", dupStart);
  assert.ok(failStart > dupStart, "the failure arm must follow it");
  return branch.slice(dupStart, failStart).replace(/\s+/g, " ");
}

test("[static] the three signup outcomes render three distinct states", () => {
  const section = read("components/v2/FoundingBetaSection.tsx");

  assert.match(section, /setEmailSent\(Boolean\(data\.emailSent\)\)/);
  assert.match(section, /setAlreadyListed\(data\.outcome === "already_listed"\)/);
  assert.match(section, /setEmailSent\(false\);\s*\n\s*setAlreadyListed\(false\);/);

  const branch = section.slice(section.indexOf("{emailSent ? ("));
  const dupStart = branch.indexOf(") : alreadyListed ? (");
  const failStart = branch.indexOf("\n              ) : (", dupStart);
  const flat = (t: string) => t.replace(/\s+/g, " ");
  const sent = flat(branch.slice(0, dupStart));
  const failed = flat(branch.slice(failStart, branch.indexOf(")}", failStart)));

  // 1. Fresh + sent — unchanged.
  assert.match(sent, /Check your inbox/);
  assert.match(sent, /We&rsquo;ve sent a verification link/);

  // 3. Genuine failure — separate, and offers NO stage choice or sign-in.
  assert.match(failed, /We couldn&rsquo;t send a verification link/);
  assert.match(failed, /support@servicesignal\.app/);
  assert.equal(/v2-beta-choice/.test(failed), false,
    "a send failure is not a reused email and must not offer the stage choice");
  assert.equal(/href="\/login"/.test(failed), false);
  assert.equal(/used this email/i.test(failed), false);

  // Only the first arm may claim a delivery.
  assert.equal(/We&rsquo;ve sent a verification link/.test(reusedArm() + failed), false);
});

test("the reused-email state recommends nothing until the customer chooses", () => {
  const dup = reusedArm();

  // Neutral opening: states only that the address was used before.
  assert.match(dup, /You&rsquo;ve used this email with ServiceSignal before/);
  assert.match(dup, /already been used to start setting up ServiceSignal/);
  assert.match(dup, /What would you like to do\?/);

  // ── NEITHER ROUTE MAY LEAD ──────────────────────────────────────────
  //
  // Sign in must not be the universal next step: someone who never finished
  // setup would be sent to a form they cannot use.
  assert.match(dup, /I&rsquo;ve already set up my account/);
  assert.match(dup, /I&rsquo;m still setting up/);

  // Both choices carry the SAME class, which is what makes them equal weight.
  const choices = dup.match(/className="v2-beta-choice"/g) ?? [];
  assert.equal(choices.length, 2,
    `both stage choices must share one treatment, found ${choices.length}`);

  // The choice is gated on customer-supplied state, never on server data.
  assert.match(dup, /setupStage === null \?/);
  assert.match(dup, /setSetupStage\("still-setting-up"\)/);

  // No assertion about the account, in either direction.
  for (const asserts of [
    /You already have a ServiceSignal account/i,
    /you don&rsquo;t have an account/i,
    /your account exists/i,
    /you&rsquo;re already signed up/i,
    /already signed in/i,
  ]) {
    assert.equal(asserts.test(dup), false, `must not assert: ${asserts}`);
  }
});

test("the two stage choices lead to different, truthful places", () => {
  const dup = reusedArm();

  // A — the ONLY route to login, and only after the customer says so.
  assert.match(dup, /<Link href="\/login" className="v2-beta-choice"> I&rsquo;ve already set up my account/);

  // B — reveals guidance inline; it must NOT navigate to login.
  const still = dup.slice(dup.indexOf("v2-beta-help"));
  assert.equal(/href="\/login"/.test(still), false,
    "someone still setting up must not be sent to a form they cannot use");
  assert.match(still, /Use the verification email we sent when you first joined/);
  assert.match(still, /valid for 48 hours/);
  assert.match(still, /check your spam folder/i);
  assert.match(still, /support@servicesignal\.app/);
  assert.match(still, /Back to options/, "a way back to the two choices");

  // And it promises no reissue, because none exists.
  for (const promise of [/we&rsquo;ll resend/i, /send you another/i, /a new verification email/i, /send you a new one/i]) {
    assert.equal(promise.test(still), false, `no resend may be promised: ${promise}`);
  }
});

test("[static] the stage choice is keyboard accessible", () => {
  const dup = reusedArm();
  // A real button, not a div with a click handler.
  assert.match(dup, /<button type="button" className="v2-beta-choice" aria-expanded=\{false\} aria-controls="beta-setup-help"/);
  // The revealed region is the one the trigger names, and follows it in DOM
  // order — so focus order is correct without any focus management.
  assert.match(dup, /<div id="beta-setup-help" className="v2-beta-help">/);
  assert.match(dup, /aria-expanded aria-controls="beta-setup-help"/,
    "the collapse control must report expanded state too");
  // Meaning never carried by colour alone: both choices are worded.
  assert.match(dup, /I&rsquo;ve already set up my account/);
});

test("[static] 'Use a different email' leaves no stale state behind", () => {
  const section = read("components/v2/FoundingBetaSection.tsx");
  const fn = section.slice(section.indexOf("const useDifferentEmail ="));
  const body = fn.slice(0, fn.indexOf("\n  };"));

  // EVERY piece of per-submission state must be cleared, or the next visitor
  // to the form inherits the last one's verdict. setSetupStage is the newest
  // and the easiest to forget.
  for (const reset of [
    /setForm\(\(f\) => \(\{ \.\.\.f, email: "" \}\)\)/,  // the input itself
    /setEmailSent\(false\)/,
    /setAlreadyListed\(false\)/,
    /setSetupStage\(null\)/,
    /setSubmittedEmail\(""\)/,
    /clearSignupPrefill\(\)/,
    /setStatus\("idle"\)/,
  ]) {
    assert.match(body, reset, `useDifferentEmail must reset ${reset}`);
  }
  // And it returns focus to the field it just cleared.
  assert.match(body, /setRefocusEmail\(true\)/);
});

test("[static] the stage choices stack on narrow screens", () => {
  const css = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

  const grid = css.slice(css.indexOf(".v2-beta-choices {"));
  assert.match(grid.slice(0, grid.indexOf("}")), /grid-template-columns: 1fr 1fr;/,
    "side by side at desktop, so neither reads as the recommended answer");

  // Side by side on a phone, each label wraps to several cramped lines and the
  // two stop reading as a clean either/or.
  const mq = css.slice(css.indexOf("@media (max-width: 560px)"));
  assert.match(mq.slice(0, 200), /\.v2-beta-choices \{ grid-template-columns: 1fr; \}/,
    "the choices must stack below 560px");

  // Comfortable target size on touch.
  const choice = css.slice(css.indexOf(".v2-beta-choice {"));
  assert.match(choice.slice(0, choice.indexOf("}")), /min-height: 52px;/);
});

test("[static] no account lookup was added to the public beta endpoint", () => {
  // The merged state means B and C render identically, so distinguishing them
  // buys the customer nothing — and querying Supabase Auth from a public,
  // unauthenticated endpoint would add an attack surface and a new failure
  // mode for no UX gain. The existing unique-constraint path already covers
  // both, which also preserves the DB-authoritative race semantics.
  const route = read("app/api/signup/route.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const lookup of [
    /auth\.admin\.listUsers/, /auth\.admin\.getUserById/,
    /getUserByEmail/, /from\("profiles"\)/, /getSupabaseAdmin\(\)[\s\S]{0,80}auth/,
  ]) {
    assert.equal(lookup.test(route), false,
      `the public beta endpoint must not perform an account lookup: ${lookup}`);
  }

  // The duplicate verdict still comes from the database's unique constraint.
  assert.match(route, /error\.code === "23505"/,
    "duplicate detection must stay the DB uniqueness violation, not a pre-check");
  assert.equal(/select[\s\S]{0,60}beta_signups[\s\S]{0,60}eq\("email"/.test(route), false,
    "no check-then-insert: that would replace an atomic constraint with a race");
});

test("[static] the Sign in CTA prefills without putting the email in a URL", () => {
  const login = read("app/login/page.tsx");
  // Uses the EXISTING same-origin sessionStorage mechanism that already
  // carries this value to /signup.
  assert.match(login, /from "@\/lib\/signup-prefill"/);

  // ── NO HYDRATION MISMATCH ─────────────────────────────────────────────
  //
  // /login is PRERENDERED, so its HTML is built once with no sessionStorage in
  // scope. A lazy useState initialiser would return "" on the server and the
  // stored address on the client, so the first client render would disagree
  // with the served markup about this input's value — guaranteed, because
  // prerendered HTML can never contain it.
  //
  // Deterministic initial state, filled after mount instead.
  assert.match(login, /const \[email, setEmail\] {2,}= useState\(""\);/,
    "email must initialise deterministically on server and client");
  assert.equal(/useState\(\(\) => readSignupPrefill/.test(login), false,
    "a lazy initialiser reintroduces the hydration mismatch");
  assert.match(login, /useEffect\(\(\) => \{\s*\n\s*const stored = readSignupPrefill\(\)\?\.email;\s*\n\s*if \(stored\) setEmail\(stored\);\s*\n\s*\}, \[\]\);/,
    "the stored address must be applied after mount, once");

  // NEVER a query string: that leaks into history, referrers and access logs.
  const section = read("components/v2/FoundingBetaSection.tsx");
  assert.equal(/href="\/login\?email=/.test(section), false,
    "the address must not travel in the URL");
  assert.equal(/\/login\?[^"]*email/.test(section), false);
});

test("the reused-email state cannot promise that an expired link will work", () => {
  // Tokens expire after VERIFICATION_TTL_HOURS (48). A reused submission
  // issues NO replacement and sends nothing, so guidance that said only
  // "check your inbox" would become an instruction that cannot work two days
  // later. The expiry is stated, and the route offered after it still exists.
  const dup = reusedArm();
  const still = dup.slice(dup.indexOf("v2-beta-help"));

  assert.match(still, /valid for 48 hours/, "the guidance must state the expiry");
  assert.equal(VERIFICATION_TTL_HOURS, 48, "and it must match the real TTL");

  // /verify quotes the same lifetime. Comments stripped: that file explains in
  // a comment why it no longer promises a reissue.
  const verifyPage = read("app/verify/page.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(verifyPage, /valid for 48 hours/,
    "the two surfaces must quote the same lifetime");

  // Human help only — no automated reissue is claimed anywhere.
  assert.match(still, /help you get set up/i);
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
