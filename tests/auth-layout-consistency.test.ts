import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * One visual system across the account pages.
 *
 * ── WHAT CHANGED ──────────────────────────────────────────────────────────
 *
 * /login moved to a focused single column. /forgot-password and
 * /reset-password still fell through to AuthShell's centred-card branch, which
 * renders servicesignal-auth-logo.png — a stacked lockup carrying the retired
 * "AUTOMATED INVOICE CHASING FOR UK BUSINESSES" tagline — above a bordered,
 * shadowed box. Two presentations for one journey.
 *
 * They now pass `focused`, reusing the mode built for /login rather than
 * adding a third layout. Nothing about the reset itself moved.
 *
 * These tests pin the LAYOUT and, just as importantly, pin the auth behaviour
 * that a visual pass must not disturb.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
/** Comments must never satisfy a contract assertion. */
const code = (f: string) =>
  read(f)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const FORGOT = code("app/forgot-password/page.tsx");
const RESET = code("app/reset-password/page.tsx");
const LOGIN = code("app/login/page.tsx");
const SHELL = code("components/auth/AuthShell.tsx");

// ── One layout, three pages ────────────────────────────────────────────────

test("all three account pages use the focused single column", () => {
  for (const [name, src] of [["/login", LOGIN], ["/forgot-password", FORGOT], ["/reset-password", RESET]] as const) {
    const shells = src.match(/<AuthShell/g) ?? [];
    const focused = src.match(/focused\b/g) ?? [];
    assert.ok(shells.length > 0, `${name} must render AuthShell`);
    assert.equal(focused.length, shells.length,
      `${name}: every AuthShell must be focused (${shells.length} shells, ${focused.length} focused)`);
    // No panel: the product is not re-explained on any of these.
    assert.equal(/aside=/.test(src), false, `${name} must pass no aside`);
  }
});

test("the success and error states share the focused layout too", () => {
  // Both pages have an alternate state. Each renders its OWN AuthShell, so
  // each has to opt in — a page can be half-converted, and that is the defect
  // this catches.
  assert.equal((FORGOT.match(/<AuthShell/g) ?? []).length, 2, "form state and sent state");
  assert.equal((RESET.match(/<AuthShell/g) ?? []).length, 2, "form state and done state");

  // Left-aligned, matching the lockup above them. They were `text-center`,
  // which sat a centred block under a left-aligned mark.
  for (const [name, src] of [["/forgot-password", FORGOT], ["/reset-password", RESET]] as const) {
    assert.equal(/text-center/.test(src), false, `${name}: the focused column is left-aligned`);
    assert.equal(/mx-auto/.test(src), false, `${name}: nothing may centre itself inside it`);
  }

  // Heading scale matches AuthHeading, so a page's two states are the same
  // size. AuthHeading is not reused directly on the sent state because its
  // subtitle carries the address as markup and the prop is a string.
  assert.match(SHELL, /fontSize: "1\.55rem", fontWeight: 700, color: "#0f172a", letterSpacing: "-0\.02em"/);
  for (const src of [FORGOT, RESET]) {
    assert.match(src, /fontSize: "1\.55rem", fontWeight: 700, color: "#0f172a", letterSpacing: "-0\.02em"/);
    assert.equal(/fontSize: "1\.35rem"/.test(src), false, "the old success heading scale is gone");
  }
});

test("the oversized retired-tagline logo is unreachable from these pages", () => {
  // servicesignal-auth-logo.png is the stacked lockup with "AUTOMATED INVOICE
  // CHASING FOR UK BUSINESSES" baked in — a claim the approval-first product
  // no longer makes. It lives only in AuthShell's card branch.
  const card = SHELL.slice(SHELL.indexOf("return (", SHELL.indexOf("if (aside || focused)")));
  assert.match(card, /servicesignal-auth-logo\.png/);

  // No account page may reach that branch: each passes `focused`, asserted
  // above. Nothing references the asset directly either.
  for (const src of [LOGIN, FORGOT, RESET]) {
    assert.equal(/servicesignal-auth-logo/.test(src), false);
    assert.equal(/min\(440px/.test(src), false, "the 440px logo treatment is gone");
  }

  // And the focused branch uses the small mark-plus-wordmark lockup instead.
  const focusedBranch = SHELL.slice(SHELL.indexOf("if (aside || focused)"), SHELL.indexOf("return (", SHELL.indexOf("if (aside || focused)") + 200));
  assert.match(focusedBranch, /servicesignal-mark\.png/);
});

test("no card, border, radius or shadow wraps these pages", () => {
  for (const [name, src] of [["/forgot-password", FORGOT], ["/reset-password", RESET]] as const) {
    // The page must not reintroduce the box it just left. The green success
    // badge and the password-requirements list legitimately have their own
    // borders, so this checks the PAGE wrapper, not every element.
    assert.equal(/maxWidth: 530/.test(src), false, `${name}: no card width`);
    assert.equal(/boxShadow/.test(src), false, `${name}: no shadow`);
    assert.equal(/rounded-2xl/.test(src), false, `${name}: no card radius`);
  }
  // The requirements list is deliberately kept — it is a field affordance.
  assert.match(RESET, /aria-label="Password requirements"/);
  assert.match(RESET, /border: "1px solid #e5e7eb"/);
});

test("/signup keeps its own presentation", () => {
  const signup = code("components/auth/SignupForm.tsx");
  assert.match(signup, /aside=\{<SignupAside \/>\}/);
  assert.equal(/focused/.test(signup), false, "signup keeps the panel, not the focused column");
});

// ── The elements each page must contain ────────────────────────────────────

test("/forgot-password keeps its hierarchy", () => {
  assert.match(FORGOT, /<AuthHeading\s+title="Reset your password"/);
  assert.match(FORGOT, /subtitle="Enter the email you signed up with and we'll send you a secure link to set a new password\."/);
  assert.match(FORGOT, /<AuthInput id="email" label="Email Address" type="email"/);
  assert.match(FORGOT, /idleText="Send Reset Link"/);
  assert.match(FORGOT, /href="\/login"[\s\S]{0,140}Back to sign in/);
  assert.match(FORGOT, /Check your inbox/);
});

test("/reset-password keeps its hierarchy and its requirements list", () => {
  assert.match(RESET, /<AuthHeading title="Choose a new password"/);
  assert.match(RESET, /<PasswordInput id="password" label="New Password"/);
  assert.match(RESET, /<PasswordInput id="confirm" label="Confirm New Password"/);
  assert.match(RESET, /idleText="Update Password"/);
  assert.match(RESET, /Password updated/);
  assert.match(RESET, /href="\/forgot-password"[\s\S]{0,140}Request a new one/);
  assert.match(RESET, /href="\/login"[\s\S]{0,140}Go to sign in/);
});

// ── Nothing behavioural moved ──────────────────────────────────────────────

test("the reset REQUEST behaviour is untouched", () => {
  assert.match(FORGOT, /supabase\.auth\.resetPasswordForEmail\(email\.trim\(\)\.toLowerCase\(\), \{/);
  // The PKCE hop through /auth/callback — without it a fresh link fails as
  // "expired" because no session was ever established.
  assert.match(FORGOT, /redirectTo: getResetPasswordRedirectUrl\(\),/);

  // Enumeration protection: the sent state is shown for ANY address, and the
  // copy is conditional ("If an account exists"), never a confirmation.
  assert.match(FORGOT, /setSent\(true\);/);
  assert.match(FORGOT, /If an account exists for/);
  for (const leak of [/account (was )?found/i, /no account/i, /not registered/i, /doesn'?t exist/i]) {
    assert.equal(leak.test(FORGOT), false, `the sent state must not reveal existence (${leak})`);
  }
});

test("the password UPDATE behaviour is untouched", () => {
  assert.match(RESET, /supabase\.auth\.updateUser\(\{ password \}\)/);
  // The shared policy module, not a private copy — a reset must not be able to
  // set a weaker password than signup accepts.
  assert.match(RESET, /from "@\/lib\/password-policy"/);
  assert.match(RESET, /const allRulesPass = isPasswordAcceptable\(password\)/);
  assert.match(RESET, /firstPasswordError\(password\) \?\? "Please choose a stronger password\."/);
  assert.match(RESET, /if \(password !== confirm\)/);

  // The recovery session is a REAL session; signing it out is what makes
  // "Go to sign in" lead to an actual sign-in rather than the dashboard.
  const success = RESET.indexOf("setDone(true)");
  const signOut = RESET.indexOf("supabase.auth.signOut()");
  assert.ok(signOut > -1 && signOut < success, "the recovery session must be cleared BEFORE the done state");

  // Expired-link semantics preserved verbatim.
  assert.match(RESET, /updateError\.message\.toLowerCase\(\)\.includes\("session"\)/);
  assert.match(RESET, /This reset link has expired or already been used\. Please request a new one\./);
  assert.match(RESET, /searchParams\.get\("auth_error"\)/);
});

test("no auth page reimplements a primitive", () => {
  for (const [name, src] of [["/login", LOGIN], ["/forgot-password", FORGOT], ["/reset-password", RESET]] as const) {
    assert.equal(/<input(?![^>]*type="checkbox")/.test(src), false, `${name} must use AuthInput/PasswordInput`);
    assert.match(src, /SubmitButton/);
    assert.match(src, /from "@\/components\/auth\/AuthShell"/);
  }
});

test("every auth page is accounted for", () => {
  // A new page added under app/ that renders AuthShell must choose a mode
  // deliberately. This fails on one that quietly inherits the card.
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.name.startsWith(".") || e.name === "node_modules"
        ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);

  const users = walk(join(ROOT, "app"))
    .concat(walk(join(ROOT, "components")))
    .filter((f) => /\.tsx$/.test(f))
    .filter((f) => /<AuthShell/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length))
    .sort();

  assert.deepEqual(users, [
    "app/forgot-password/page.tsx",
    "app/login/page.tsx",
    "app/reset-password/page.tsx",
    // The "founding beta access required" refusal shown at /signup. It uses
    // the SPLIT layout with the signup panel, not the card, and is out of
    // scope for this pass.
    "components/auth/BetaAccessRequired.tsx",
    "components/auth/SignupForm.tsx",
  ], "an unlisted AuthShell consumer must pick a layout explicitly");

  const beta = code("components/auth/BetaAccessRequired.tsx");
  assert.match(beta, /aside=\{<SignupAside \/>\}/);
  assert.equal(/focused/.test(beta), false);

  // ── THE CARD BRANCH NOW HAS NO CONSUMER ────────────────────────────────
  //
  // Every AuthShell in the repository passes `aside` or `focused`, so the
  // centred card — and the retired-tagline logo above it — is unreachable.
  // Left in place deliberately: removing it means removing `focused` too and
  // editing /login, which is locked. Recorded here so the state is a decision
  // rather than an oversight, and so this fails the day something reaches it.
  for (const f of users) {
    const src = code(f);
    assert.ok(/aside=/.test(src) || /focused/.test(src),
      `${f} would fall through to the centred card`);
  }
});
