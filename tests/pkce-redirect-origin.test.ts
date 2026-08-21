import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  getAuthCallbackUrl,
  getResetPasswordRedirectUrl,
  getAppBaseUrl,
  requireAppBaseUrl,
} from "@/lib/app-urls";

/**
 * Where a PKCE code is exchanged.
 *
 * ── THE BUG ───────────────────────────────────────────────────────────────
 *
 * A password reset requested from a Vercel Preview arrived correctly, and
 * clicking it landed on PRODUCTION with "This password reset link has expired
 * or already been used".
 *
 * The link was wrong before Supabase saw it. getAppBaseUrl() begins with
 * vercelPreviewOrigin(), which reads VERCEL_ENV / VERCEL_URL /
 * PREVIEW_APP_URL — all server-only. Next inlines only NEXT_PUBLIC_* into the
 * client bundle, so in the browser those are `undefined`, the preview
 * correction cannot fire, and resolution falls through to NEXT_PUBLIC_APP_URL:
 * one project-wide value naming production, compiled in as a literal.
 *
 * ── WHY THESE TESTS SIMULATE `window` ─────────────────────────────────────
 *
 * tests/app-urls-preview.test.ts drives the same module by setting
 * process.env, which models the SERVER. That is why it never caught this: the
 * defect only exists where those variables do not. These tests therefore
 * define globalThis.window and assert the browser path directly.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const code = (f: string) =>
  read(f)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const PROD = "https://servicesignal.app";
const PREVIEW = "https://servicesignal-kgif5dn5c-samadalobaydi.vercel.app";

/** Runs `fn` with a simulated browser origin, always cleaned up. */
function inBrowserAt(origin: string, fn: () => void): void {
  const had = "window" in globalThis;
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { location: { origin } };
  try {
    fn();
  } finally {
    if (had) (globalThis as { window?: unknown }).window = previous;
    else delete (globalThis as { window?: unknown }).window;
  }
}

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

// ── The browser path ───────────────────────────────────────────────────────

test("a Preview exchanges the code on the Preview, not on production", () => {
  // The exact conditions of the failure: a Preview browser, where the
  // server-only variables do not exist and NEXT_PUBLIC_APP_URL names
  // production because it is one project-wide value.
  withEnv(
    { VERCEL_ENV: undefined, VERCEL_URL: undefined, PREVIEW_APP_URL: undefined, NEXT_PUBLIC_APP_URL: PROD },
    () => {
      inBrowserAt(PREVIEW, () => {
        assert.equal(
          getResetPasswordRedirectUrl(),
          `${PREVIEW}/auth/callback?next=%2Freset-password`
        );
        assert.equal(getAuthCallbackUrl(), `${PREVIEW}/auth/callback`);

        // The whole defect, stated as an assertion.
        assert.equal(getResetPasswordRedirectUrl().startsWith(PROD), false,
          "a Preview must never send a customer to production to exchange its code");
      });
    }
  );
});

test("production and local each exchange on their own origin", () => {
  withEnv({ NEXT_PUBLIC_APP_URL: PROD }, () => {
    inBrowserAt(PROD, () => {
      assert.equal(getResetPasswordRedirectUrl(), `${PROD}/auth/callback?next=%2Freset-password`);
    });
  });

  // Local development, where NEXT_PUBLIC_APP_URL happens to agree anyway —
  // but the origin is still what decides.
  withEnv({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }, () => {
    inBrowserAt("http://localhost:3000", () => {
      assert.equal(getAuthCallbackUrl("/reset-password"),
        "http://localhost:3000/auth/callback?next=%2Freset-password");
    });
  });
});

test("the browser origin WINS over a disagreeing NEXT_PUBLIC_APP_URL", () => {
  // This is the case that was broken, isolated: the configured value and the
  // real origin disagree, and the real origin is the only one holding the
  // PKCE verifier cookie.
  withEnv(
    { VERCEL_ENV: undefined, VERCEL_URL: undefined, PREVIEW_APP_URL: undefined, NEXT_PUBLIC_APP_URL: PROD },
    () => {
      inBrowserAt(PREVIEW, () => {
        assert.equal(getAuthCallbackUrl().startsWith(PREVIEW), true);
        // getAppBaseUrl is deliberately NOT changed — it still answers with the
        // configured value, because in-app links and server rendering want that.
        assert.equal(getAppBaseUrl(), PROD);
      });
    }
  );
});

test("the `next` destination is preserved and encoded", () => {
  inBrowserAt(PREVIEW, () => {
    assert.equal(getAuthCallbackUrl("/reset-password"),
      `${PREVIEW}/auth/callback?next=%2Freset-password`);
    assert.equal(getAuthCallbackUrl("/dashboard?tab=chasing"),
      `${PREVIEW}/auth/callback?next=%2Fdashboard%3Ftab%3Dchasing`);
    // No `next` means no parameter at all, not an empty one.
    assert.equal(getAuthCallbackUrl(), `${PREVIEW}/auth/callback`);
  });
});

// ── The server path is untouched ───────────────────────────────────────────

test("server-side callers keep the existing resolution exactly", () => {
  // No window. getAuthCallbackUrl must fall back to getAppBaseUrl(), whose
  // preview correction still applies — the server is where those variables
  // exist and where they are trustworthy.
  assert.equal("window" in globalThis, false, "these run without a window");

  withEnv({ VERCEL_ENV: "preview", VERCEL_URL: "ss-branch.vercel.app", NEXT_PUBLIC_APP_URL: PROD }, () => {
    assert.equal(getAuthCallbackUrl(), "https://ss-branch.vercel.app/auth/callback");
  });
  withEnv({ VERCEL_ENV: "production", VERCEL_URL: "ss-xyz.vercel.app", NEXT_PUBLIC_APP_URL: PROD }, () => {
    assert.equal(getAuthCallbackUrl(), `${PROD}/auth/callback`);
  });
});

test("the email resolver is not touched by this change", () => {
  // requireAppBaseUrl fails CLOSED and reads only server variables. It must be
  // completely unaffected — including in a browser, where it must NOT start
  // answering with window.location.origin.
  withEnv(
    { VERCEL_ENV: "preview", VERCEL_URL: "ss-branch.vercel.app", PREVIEW_APP_URL: undefined, NEXT_PUBLIC_APP_URL: PROD },
    () => assert.equal(requireAppBaseUrl(), "https://ss-branch.vercel.app")
  );
  withEnv(
    { VERCEL_ENV: "preview", VERCEL_URL: undefined, PREVIEW_APP_URL: undefined, NEXT_PUBLIC_APP_URL: PROD },
    () => assert.equal(requireAppBaseUrl(), null, "a misconfigured Preview still suppresses the email")
  );

  const src = code("lib/app-urls.ts");
  const requireBody = src.slice(src.indexOf("export function requireAppBaseUrl"));
  assert.equal(/window/.test(requireBody.slice(0, requireBody.indexOf("\n}"))), false,
    "the email resolver must never consult the browser");
});

test("only the PKCE callback reads the browser origin", () => {
  const src = code("lib/app-urls.ts");
  assert.match(src, /function getPkceExchangeOrigin\(\): string \{\s*if \(typeof window !== "undefined"\) return window\.location\.origin;\s*return getAppBaseUrl\(\);\s*\}/);
  assert.match(src, /const base = `\$\{getPkceExchangeOrigin\(\)\}\/auth\/callback`;/);

  // getDashboardUrl builds an in-app link for the Welcome EMAIL's CTA and is
  // rendered server-side. It must keep the configured origin.
  assert.match(src, /export function getDashboardUrl\(\): string \{\s*return `\$\{getAppBaseUrl\(\)\}\/dashboard`;\s*\}/);
});

// ── Blast radius: the two callers, both browser-side PKCE ──────────────────

test("both callers of getAuthCallbackUrl are browser-side PKCE flows", () => {
  // Recovery. The one that broke.
  const forgot = code("app/forgot-password/page.tsx");
  assert.match(forgot, /^"use client";/);
  assert.match(forgot, /redirectTo: getResetPasswordRedirectUrl\(\),/);

  // OAuth. SHARED, and it had the identical latent fault — same PKCE flow,
  // same browser-held verifier — so it takes the identical fix. Dormant only
  // because no provider is enabled yet.
  const shell = code("components/auth/AuthShell.tsx");
  assert.match(shell, /^"use client";/);
  assert.match(shell, /const redirectTo = getAuthCallbackUrl\(next\);/);
  assert.match(shell, /signInWithOAuth\(\{\s*provider,\s*options: \{ redirectTo \},/);
  assert.match(shell, /export const ENABLED_OAUTH_PROVIDERS: readonly OAuthProvider\[\] = \[\];/);

  // And nothing else calls it. A server-side caller would silently take the
  // getAppBaseUrl() branch, which is correct but worth knowing about.
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.name.startsWith(".") || e.name === "node_modules"
        ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);

  const callers = ["app", "components", "lib", "emails"]
    .flatMap((dir) => walk(join(ROOT, dir)))
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith("lib/app-urls.ts"))
    .filter((f) => /getAuthCallbackUrl|getResetPasswordRedirectUrl/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length))
    .sort();

  assert.deepEqual(callers, [
    "app/forgot-password/page.tsx",
    "components/auth/AuthShell.tsx",
  ], "a new caller must be checked against the browser/server split");
});

test("the reset journey's other moving parts are unchanged", () => {
  // The callback still exchanges exactly once, and /reset-password never
  // exchanges at all — so nothing consumes the code before the password page.
  const callback = code("app/auth/callback/route.ts");
  assert.equal((callback.match(/exchangeCodeForSession/g) ?? []).length, 1);
  const reset = code("app/reset-password/page.tsx");
  assert.equal(/exchangeCodeForSession/.test(reset), false);
  assert.match(reset, /supabase\.auth\.updateUser\(\{ password \}\)/);

  // Neither route is in the middleware matcher, so no getUser() runs against
  // them mid-flow.
  const mw = code("middleware.ts");
  const matcher = mw.slice(mw.indexOf("matcher:"));
  assert.equal(/auth\/callback|reset-password/.test(matcher), false);
});
