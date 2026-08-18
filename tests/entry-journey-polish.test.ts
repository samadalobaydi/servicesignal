import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  PASSWORD_RULES, PASSWORD_MIN_LENGTH, isPasswordAcceptable,
  passwordProblems, confirmationState,
} from "@/lib/password-policy";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const code = (f: string) =>
  read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── Password policy: ONE source, and the copy must count it ────────────────

test("the authoritative policy is what the shared module defines", () => {
  // AUDITED, NOT ASSUMED. The brief expected 8 chars + uppercase. The module
  // actually defines four rules, and both the form and the server import it —
  // so the Preview screenshot was CORRECT and there is no drift to undo.
  // Weakening this on a stale memory would be a real security regression.
  assert.equal(PASSWORD_MIN_LENGTH, 10);
  assert.deepEqual(PASSWORD_RULES.map((r) => r.id),
    ["length", "uppercase", "number", "special"]);
});

test("the policy accepts and rejects exactly what it says", () => {
  // Executable, not a reading of the labels.
  assert.equal(isPasswordAcceptable("Abcdefgh1!"), true, "10 chars, upper, number, special");
  assert.equal(isPasswordAcceptable("Abcdefg1!"), false, "9 chars is short");
  assert.deepEqual(passwordProblems("Abcdefg1!"), ["length"]);
  assert.deepEqual(passwordProblems("abcdefghij1!"), ["uppercase"]);
  assert.deepEqual(passwordProblems("Abcdefghij!"), ["number"]);
  assert.deepEqual(passwordProblems("Abcdefghij1"), ["special"]);
  assert.deepEqual(passwordProblems("abcdefghij"), ["uppercase", "number", "special"]);
});

test("client and server enforce the SAME module", () => {
  const form = code("components/auth/SignupForm.tsx");
  const route = code("app/api/beta/account/route.ts");
  const reset = code("app/reset-password/page.tsx");

  for (const [name, src] of [["form", form], ["server", route], ["reset", reset]] as const) {
    assert.match(src, /from "@\/lib\/password-policy"/, `${name} must import the shared policy`);
  }
  // The server is the enforcement point, and it uses the whole policy.
  assert.match(route, /firstPasswordError\(password\)/);

  // No second copy of the rules anywhere.
  for (const [name, src] of [["form", form], ["server", route]] as const) {
    assert.equal(/[0-9]\}?\s*characters/.test(src.replace(/PASSWORD_MIN_LENGTH/g, "")), false,
      `${name} must not hardcode a length`);
    assert.equal(/\/\[A-Z\]\/|\/\[0-9\]\//.test(src), false,
      `${name} must not re-implement a rule regex`);
  }
});

test("the helper sentence counts the real rules and cannot go stale", () => {
  // THE CONTRADICTION: it said "both requirements" while the checklist above
  // rendered four. The number is now derived from PASSWORD_RULES.
  const form = code("components/auth/SignupForm.tsx");
  assert.equal(/meets both requirements above/.test(form), false,
    "a hardcoded count contradicts a four-rule policy");
  assert.match(form, /PASSWORD_RULES\.length === 2 \? "both" : `all \$\{PASSWORD_RULES\.length\}`/,
    "the count must be derived from the policy");
  assert.match(form, /\{PASSWORD_RULES\.map\(/, "and the checklist renders the same source");
});

test("the approved password UX is preserved", () => {
  // Match/mismatch behaviour is untouched.
  assert.equal(confirmationState("Abcdefgh1!", ""), "idle");
  assert.equal(confirmationState("Abcdefgh1!", "Abc"), "idle", "partial typing is not a mismatch");
  assert.equal(confirmationState("Abcdefgh1!", "Abcdefgh1!"), "match");
  assert.equal(confirmationState("Abcdefgh1!", "Xyz"), "mismatch");

  const form = code("components/auth/SignupForm.tsx");
  assert.match(form, /aria-live="polite"/, "live-region feedback must remain");
  assert.match(form, /shouldSuggestLongerPassword/,
    "the optional stronger-password hint stays advisory, not a checklist rule");
  assert.equal(/strength/i.test(form.replace(/PASSWORD_\w+/g, "")), false,
    "no strength meter is reintroduced");
});

// ── Approval / Auto-mode contradiction ─────────────────────────────────────

test("the signup subtitle no longer contradicts Auto mode", () => {
  const form = code("components/auth/SignupForm.tsx");

  // The same screen advertises "Auto mode — COMING SOON", so a permanent
  // always-approval claim contradicted it and would become false on the day
  // Auto shipped.
  assert.equal(/always with your approval/i.test(form), false,
    "no permanent product-wide approval claim");
  assert.match(form, /every reminder ready for your review during the founding beta/,
    "scoped to the beta, which stays true later");

  // The aside still advertises Auto mode; the two must coexist.
  assert.match(code("components/auth/SignupAside.tsx"), /Auto mode/);
});

// ── Routing: one gate decides ──────────────────────────────────────────────

test("account creation navigates hard, and never re-renders /signup", () => {
  // ── THE /#access REGRESSION ────────────────────────────────────────────
  //
  // /api/beta/account clears the beta continuation cookie on SUCCESS. A
  // router.refresh() after router.push() re-rendered the still-current
  // /signup route on the server, resolveContinuation() found no cookie, and
  // app/signup/page.tsx rendered <BetaAccessRequired /> — whose only CTA is
  // href="/#access". A brand-new account was told it needed beta access.
  const form = code("components/auth/SignupForm.tsx");
  // Anchored on EXECUTABLE code: code() strips comments, so a comment-based
  // anchor returns -1 and slices the whole file.
  const gateStart = form.indexOf('fetch("/api/profile"');
  assert.ok(gateStart > -1, "the profile call must exist");
  const success = form.slice(gateStart);

  // REPLACE, not assign: account creation is terminal. The invitation behind
  // /signup has been spent, so leaving it in history means Back returns to a
  // continuation route with no cookie — which renders BetaAccessRequired, the
  // exact screen this whole fix exists to keep away from a new customer.
  // DESTINATION CHANGED DELIBERATELY, mechanism unchanged. See
  // tests/fresh-account-onboarding-routing.test.ts: routing a brand-new
  // account through the dashboard made its first screen depend on
  // profiles.onboarding_status being readable, and when it is not the gate
  // fails open to an empty Overview. This test owns the MECHANISM.
  assert.match(success, /window\.location\.replace\("\/onboarding"\)/,
    "success must be a full document navigation that replaces the consumed page");
  assert.equal(/window\.location\.assign\(/.test(success), false,
    "assign leaves the spent /signup entry directly behind /dashboard");
  assert.equal(/window\.location\.href\s*=/.test(success), false,
    "href assignment also stacks history");
  assert.equal(/router\.refresh\(\)/.test(success), false,
    "refresh re-renders the abandoned /signup route into BetaAccessRequired");
  assert.equal(/router\.push\(/.test(success), false,
    "a soft push can race the auth cookies @supabase/ssr is still writing");

  // A fresh account must not pass through the dashboard on the way. Scoped to
  // the code AFTER the reconciled branch — an Auth user that already existed
  // does go to /dashboard, deliberately, so "/dashboard" now appears in this
  // handler and an unscoped check would prove nothing.
  const fresh = success.slice(success.indexOf('window.location.replace("/onboarding")'));
  assert.equal(/replace\("\/dashboard"\)/.test(fresh), false,
    "landing on Overview before onboarding is the regression this restores");

  // The profile still exists before onboarding reads it.
  const profileIdx = form.indexOf('fetch("/api/profile"');
  const navIdx = form.indexOf('window.location.replace("/onboarding")');
  assert.ok(profileIdx > -1 && navIdx > profileIdx);
});

test("a successful signup can never land on the public beta form", () => {
  const form = code("components/auth/SignupForm.tsx");
  const success = form.slice(form.indexOf('fetch("/api/profile"'));

  // /#access is the public access journey. It is not a success destination.
  assert.equal(/#access/.test(success), false,
    "success must never route to the public founding-beta form");

  // BetaAccessRequired is reachable only from the signup PAGE's own guard,
  // never from the form's success path.
  assert.equal(/BetaAccessRequired/.test(success), false);
  assert.match(code("app/signup/page.tsx"), /if \(!continuation\) return <BetaAccessRequired \/>;/,
    "that guard is correct for a genuine visit without an invitation");
});

test("a failed sign-in is handled explicitly and cannot look like success", () => {
  // Identity is proven twice before any navigation: the sign-in result AND a
  // fresh getUser(), because "no error" is not the same as "the browser is
  // now this user". A mismatch signs out and stays on the form.
  const form = code("components/auth/SignupForm.tsx");
  assert.match(form, /const \{ data: confirmed \} = await supabase\.auth\.getUser\(\);/);
  assert.match(form, /if \(!signedInAs \|\| signedInAs !== expected \|\| activeAs !== expected\)/);

  const mismatch = form.slice(form.indexOf("if (!signedInAs"));
  const branch = mismatch.slice(0, mismatch.indexOf("\n        }"));
  assert.match(branch, /await supabase\.auth\.signOut\(\);/);
  assert.match(branch, /setError\(/, "the failure must be shown, not navigated past");
  assert.match(branch, /return;/);
  assert.equal(/window\.location\.(replace|assign|href)|router\.push/.test(branch), false,
    "a mismatch must never navigate");
});

test("the gate sends only genuinely-incomplete accounts to onboarding", () => {
  // Asserted from source rather than executed: lib/onboarding.ts imports
  // lib/supabase-server, which pulls in next/headers — unavailable in this
  // runner. Both functions are two lines, so the predicate IS the behaviour.
  const lib = code("lib/onboarding.ts");

  // Incomplete → onboarding. This is REAL work: the flow collects the first
  // invoice, and the business name when it is blank — so it must be preserved.
  assert.match(lib, /return context\.status === "required";/,
    "only 'required' may be dragged into onboarding");

  // The flow is reachable for required AND skipped; all_set covers the rest.
  assert.match(lib, /return context\.status === "required" \|\| context\.status === "skipped" \? "flow" : "all_set";/);

  // "completed" and "exempt" are terminal — nothing a client sends moves them
  // back, so a finished account can never be re-routed into setup.
  assert.match(lib, /completed: \[\],/);

  const page = code("app/onboarding/page.tsx");
  assert.match(page, /<OnboardingFlow/, "the flow must still exist for those who need it");
});

test("a direct /onboarding visit by a complete account stays a page", () => {
  // DELIBERATELY NOT a redirect. Someone who typed this URL asked "is my setup
  // finished?", and a silent bounce answers only by implication. This is a
  // documented product decision, not an oversight, so the routing fix above
  // does not touch it.
  const page = code("app/onboarding/page.tsx");
  assert.match(page, /view === "all_set"/);
  assert.match(page, /<OnboardingAllSet/);
  assert.equal(/all_set[\s\S]{0,80}redirect\("\/dashboard"\)/.test(page), false,
    "the all-set state must remain a page");

  // And it never redirects back to the dashboard, so there is no loop with the
  // dashboard gate.
  assert.equal(/redirect\("\/dashboard"\)/.test(page), false,
    "no /onboarding → /dashboard redirect: that would risk a loop");
});
