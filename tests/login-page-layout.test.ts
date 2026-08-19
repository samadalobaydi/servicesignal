import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * /login is a focused, single-column sign-in page.
 *
 * ── WHAT CHANGED ──────────────────────────────────────────────────────────
 *
 * It shared the split layout with /signup: a form column beside a navy panel
 * carrying three reassurance bullets and an example approval queue. That panel
 * exists to explain the product to someone deciding whether to start. A
 * returning customer has already decided, so on /login it was re-pitching a
 * product they already pay attention to — and pushing the one thing they came
 * for into half the screen.
 *
 * It is REMOVED, not rewritten, and nothing promotional replaces it.
 *
 * These tests pin the structure and the reuse. They deliberately assert
 * nothing about copy beyond the elements the page must contain, and nothing
 * about authentication, which this pass did not touch.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
/** Comments must never satisfy a contract assertion. */
const code = (f: string) =>
  read(f)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const LOGIN = code("app/login/page.tsx");
const SHELL = code("components/auth/AuthShell.tsx");
const CSS = read("components/auth/auth-split.module.css").replace(/\/\*[\s\S]*?\*\//g, "");

// ── The panel is gone ──────────────────────────────────────────────────────

test("the marketing panel is removed from /login entirely", () => {
  assert.equal(existsSync(join(ROOT, "components/auth/LoginAside.tsx")), false,
    "LoginAside must be deleted, not left unused");
  assert.equal(/LoginAside/.test(LOGIN), false);
  assert.equal(/aside=/.test(LOGIN), false, "/login must pass no aside");

  // Nothing promotional took its place. The subtitle is excluded — it is the
  // page's own one-line orientation, not a pitch — and so is the email
  // placeholder, which legitimately reads "you@example.com".
  const prose = LOGIN.replace(/subtitle="[^"]*"/, "").replace(/placeholder="[^"]*"/g, "");
  for (const pitch of [
    /approval queue/i, /chase/i, /reminder/i, /invoice/i, /overdue/i,
    /founding beta member/i, /how it works/i, /why ServiceSignal/i,
  ]) {
    assert.equal(pitch.test(prose), false,
      `/login must not re-explain the product (${pitch})`);
  }

  // And its login-only styles went with it.
  for (const dead of [".points", ".point ", ".tick", ".pointTitle", ".pointLine"]) {
    assert.equal(CSS.includes(`\n${dead}`), false, `${dead} has no consumer left`);
  }
});

test("/signup keeps its panel — this pass touched login only", () => {
  const signup = code("components/auth/SignupForm.tsx");
  // The RENDER, not the import. A mutant that changed this to
  // `aside={undefined}` left the import in place and passed a bare
  // /SignupAside/ match while silently stripping the panel from signup.
  assert.match(signup, /aside=\{<SignupAside \/>\}/);
  assert.ok(existsSync(join(ROOT, "components/auth/SignupAside.tsx")));
  // The shared styles the signup panel still needs.
  for (const kept of [".aside", ".asideInner", ".journey", ".card", ".assure"]) {
    assert.ok(CSS.includes(`\n${kept} {`), `${kept} is still used by SignupAside`);
  }
});

// ── One focused column ─────────────────────────────────────────────────────

test("/login renders the focused single column, not the boxed card", () => {
  assert.match(LOGIN, /<AuthShell\s+focused/);
  assert.match(SHELL, /if \(aside \|\| focused\) \{/);
  assert.match(SHELL, /aside \? split\.root : `\$\{split\.root\} \$\{split\.rootSingle\}`/);

  // The card layout is what a generic admin login looks like. /login must not
  // reach it — no border, no shadow, no fill, no rounding.
  //
  // Collected RULE BY RULE. An earlier version sliced from `.rootSingle {` to
  // the next `.aside`, which swept in .lockup and .footer and failed on their
  // border-radius — a slice that broad proves nothing about this layout.
  const singleRules = Array.from(CSS.matchAll(/(\.rootSingle[^{]*)\{([^}]*)\}/g));
  assert.ok(singleRules.length >= 3, `expected the focused rules, found ${singleRules.length}`);
  for (const [, selector, body] of singleRules) {
    for (const boxed of [/box-shadow/, /\bborder\s*:/, /background/, /border-radius/]) {
      assert.equal(boxed.test(body), false,
        `${selector.trim()} must not become a card (${boxed})`);
    }
  }

  assert.match(CSS, /\.rootSingle \{\s*grid-template-columns: 1fr;/);
  assert.match(CSS, /\.rootSingle \.formInner \{\s*max-width: 460px;/,
    "a comfortable 440-480px measure");
});

test("it is one column at every width, including the desktop split breakpoint", () => {
  // .root becomes `52fr 48fr` from 1024px. Without an override the single
  // layout would keep half the viewport empty.
  const desktop = CSS.slice(CSS.indexOf("@media (min-width: 1024px)"));
  const scope = desktop.slice(0, desktop.indexOf("@media (min-width: 1280px)"));
  assert.match(scope, /\.rootSingle \{\s*grid-template-columns: 1fr;\s*\}/);
  // …and no lift: that margin exists only to align with a panel headline.
  assert.match(scope, /\.rootSingle \.formInner \{\s*margin-bottom: 0;\s*\}/);

  // Mobile is naturally single-column and keeps its own padding.
  const mobile = CSS.slice(CSS.indexOf("@media (max-width: 480px)"));
  assert.match(mobile, /\.rootSingle \.formCol \{/);
  // A FIXED width, not a max-width. The negative lookbehind matters: without
  // it this matched `max-width: 460px`, which is a constraint and is exactly
  // what the layout is supposed to have.
  assert.equal(/\.rootSingle[^{]*\{[^}]*(?<!-)width: \d{3,}px/.test(CSS), false,
    "no fixed pixel width can overflow a narrow screen");
  assert.match(CSS, /\.rootSingle \.formInner \{[^}]*max-width: 460px/);
});

// ── Everything the page must still contain ─────────────────────────────────

test("the page keeps exactly the elements a returning customer needs", () => {
  assert.match(LOGIN, /<AuthHeading title="Welcome back"/);
  assert.match(LOGIN, /subtitle="Sign in to review your reminders and manage your invoices\."/);
  assert.match(LOGIN, /<AuthInput id="email"/);
  assert.match(LOGIN, /<PasswordInput\s+id="password"/);
  assert.match(LOGIN, /href="\/forgot-password"[\s\S]{0,120}Forgot your password\?/);
  assert.match(LOGIN, /Keep me signed in/);
  assert.match(LOGIN, /<SubmitButton loading=\{loading\} idleText="Sign In"/);
  assert.match(LOGIN, /New to ServiceSignal\?/);
  assert.match(LOGIN, /href="\/#access"[\s\S]{0,80}Join the founding beta/);
  assert.match(LOGIN, /← Back to landing page/);

  // The lockup comes from the shared form column, so it is present by
  // construction rather than duplicated here.
  assert.match(SHELL, /className=\{split\.lockup\}/);
  assert.match(SHELL, /Service<span className=\{split\.lockupWord/);
});

test("the shared visual language is reused, not reimplemented", () => {
  // No bespoke inputs, buttons or type scales on this page.
  for (const bespoke of [/<input(?![^>]*type="checkbox")/, /<button/, /fontSize:/, /className="dash-input"/]) {
    assert.equal(bespoke.test(LOGIN), false,
      `/login must use the shared primitives (${bespoke})`);
  }
  assert.match(LOGIN, /AuthShell, AuthHeading, AuthError, AuthInput, PasswordInput,\s*SubmitButton, BRAND_BLUE,/);
});

// ── Nothing behavioural moved ──────────────────────────────────────────────

test("authentication, routing and session handling are untouched", () => {
  assert.match(LOGIN, /supabase\.auth\.signInWithPassword\(\{\s*email: email\.trim\(\)\.toLowerCase\(\),\s*password,/);
  assert.match(LOGIN, /const next = searchParams\.get\("next"\) \?\? "\/dashboard";/);
  assert.match(LOGIN, /router\.push\(next\);\s*router\.refresh\(\);/);
  // The prerender-safe prefill, which a layout change must not turn back into
  // a lazy useState initialiser — /login is prerendered.
  assert.match(LOGIN, /const \[email, setEmail\]\s*= useState\(""\);/);
  assert.match(LOGIN, /useEffect\(\(\) => \{\s*const stored = readSignupPrefill\(\)\?\.email;/);
});

test("the focused mode is shared, and /login is not special-cased", () => {
  // /forgot-password and /reset-password now use the SAME mode — see
  // tests/auth-layout-consistency.test.ts. What matters here is that /login
  // gained nothing bespoke in the process: no per-page class, no override.
  // No bespoke LAYOUT hook. splitStyles is used for the shared footer classes,
  // which /signup uses identically — that is reuse, not a special case.
  assert.equal(/rootSingle|loginOnly|formInner|formCol/.test(LOGIN), false,
    "/login must reach the layout through AuthShell alone");
  const splitUses = Array.from(LOGIN.matchAll(/splitStyles\.(\w+)/g)).map((m) => m[1]);
  assert.deepEqual(Array.from(new Set(splitUses)).sort(), ["footerPrimary", "footerSecondary"]);
  assert.match(SHELL, /focused = false/,
    "focused must stay opt-in, so a new page cannot acquire it by accident");
});

test("no orphaned auth component is left behind", () => {
  const dir = join(ROOT, "components/auth");
  const components = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
  const all = readdirSync(join(ROOT, "app"), { recursive: true } as never) as string[];
  void all;
  for (const file of components) {
    const name = file.replace(/\.tsx$/, "");
    const referenced = ["app", "components"].some((root) => {
      const walk = (d: string): string[] =>
        readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.name.startsWith(".") || e.name === "node_modules"
            ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
      return walk(join(ROOT, root))
        .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(`auth/${file}`))
        .some((f) => readFileSync(f, "utf8").includes(name));
    });
    assert.ok(referenced, `components/auth/${file} is imported by nothing — delete it`);
  }
});
