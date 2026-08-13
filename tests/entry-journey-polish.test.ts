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

test("account creation defers routing to the single onboarding gate", () => {
  // It used to push /onboarding unconditionally, so an account with nothing to
  // do landed on "Your account is ready — there's nothing to set up".
  const form = code("components/auth/SignupForm.tsx");
  assert.equal(/router\.push\("\/onboarding"\)/.test(form), false,
    "creation must not hardcode the onboarding destination");
  assert.match(form, /router\.push\("\/dashboard"\)/,
    "it must go to the dashboard and let the gate route");

  // The profile call still precedes navigation, so the gate reads a row that
  // exists rather than racing it.
  const profileIdx = form.indexOf('fetch("/api/profile"');
  const pushIdx = form.indexOf('router.push("/dashboard")');
  assert.ok(profileIdx > -1 && pushIdx > profileIdx,
    "the profile must be created before the gate reads it");
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
