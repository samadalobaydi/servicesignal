import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { requireAppBaseUrl, getAppBaseUrl } from "@/lib/app-urls";

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
    { VERCEL_ENV: undefined, VERCEL_URL: undefined, NEXT_PUBLIC_APP_URL: "http://localhost:3000" },
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
  const ALLOWED = new Set(["NEXT_PUBLIC_APP_URL", "VERCEL_ENV", "VERCEL_URL"]);
  for (const name of envReads) {
    assert.ok(ALLOWED.has(name),
      `app-urls reads process.env.${name}; only trusted deployment config is permitted`);
  }
  assert.ok(envReads.includes("VERCEL_ENV") && envReads.includes("VERCEL_URL"),
    "the preview correction must read both platform variables");
  assert.match(src, /process\.env\.VERCEL_ENV !== "preview"/);
  // Server-only by design: a NEXT_PUBLIC_ copy would be inlined into the
  // client bundle and lose its trust guarantee.
  assert.equal(/NEXT_PUBLIC_VERCEL_URL/.test(src), false,
    "the preview host must stay a server-only variable");
});

test("a malformed VERCEL_URL is rejected, not interpolated", () => {
  for (const bad of [
    "https://evil.example.com",      // carries a scheme
    "good.vercel.app/../../evil",    // carries a path
    "user:pass@evil.example.com",    // carries credentials
    "evil.example.com ",             // trailing space… trimmed, so this one is fine
  ]) {
    withEnv({ VERCEL_ENV: "preview", VERCEL_URL: bad, NEXT_PUBLIC_APP_URL: PROD }, () => {
      const base = requireAppBaseUrl();
      // Either it fell back to the explicit config, or it built a clean https
      // origin from a bare host. It must never produce a URL containing a
      // path, a scheme twice, or credentials.
      assert.ok(base !== null);
      assert.equal(/https:\/\/[^/]*(:\/\/|@|\/)/.test(base!), false,
        `VERCEL_URL ${JSON.stringify(bad)} produced ${base}`);
    });
  }
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
