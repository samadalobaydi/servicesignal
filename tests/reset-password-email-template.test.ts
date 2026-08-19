import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * The Supabase password-recovery email template.
 *
 * ── WHAT THIS FILE CAN AND CANNOT PROVE ───────────────────────────────────
 *
 * Supabase Auth renders and sends this email itself; nothing in this
 * application is called. What the repository DOES own is the source of the
 * HTML — emails/supabase-templates/render-static-templates.tsx generates
 * reset-password.html, which is then pasted into
 * Supabase Dashboard → Authentication → Email Templates by hand.
 *
 * So these tests assert the artefact and its generator, which are real. They
 * assert NOTHING about whether the template is installed, about the sender
 * name or address, or about deliverability — all of which are Dashboard state
 * and must be checked by sending a real reset on Preview. Inventing coverage
 * for those would be worse than having none, because it would look like proof.
 *
 * ── WHY THE TOKEN ASSERTIONS ARE THE IMPORTANT ONES ───────────────────────
 *
 * {{ .ConfirmationURL }} is the entire security mechanism of this email. It
 * must survive rendering byte-for-byte, appear exactly once, and be the
 * button's href — nothing may parse it, rebuild it, append to it, or re-encode
 * it. A cosmetic pass on this file is precisely when that could break
 * unnoticed, because the visual result would look perfect.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

const HTML = read("emails/supabase-templates/reset-password.html");
const CONFIRM_HTML = read("emails/supabase-templates/confirm-signup.html");
const GENERATOR = read("emails/supabase-templates/render-static-templates.tsx")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/** The generated body with every tag removed, for copy assertions. */
const TEXT = HTML
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x27;/g, "'")
  .replace(/&amp;/g, "&")
  .replace(/[​-‏⁠﻿͏\s]+/g, " ")
  .trim();

const TOKEN = "{{ .ConfirmationURL }}";

// ── The token is authoritative and untouched ───────────────────────────────

test("the Supabase recovery URL survives rendering, exactly once", () => {
  assert.equal((HTML.match(/\{\{ \.ConfirmationURL \}\}/g) ?? []).length, 1,
    "the placeholder must appear once — twice would mean two links to reason about");

  // Unescaped. React escapes `{`, `}` and `.` in some contexts; if it had, the
  // Dashboard would substitute nothing and every reset link would be dead.
  assert.equal(HTML.includes("&#123;"), false);
  assert.equal(HTML.includes("&lbrace;"), false);
  assert.equal(HTML.includes("%7B"), false, "the placeholder must not be URL-encoded");

  // It is the BUTTON's href, and the only href carrying it.
  assert.match(HTML, new RegExp(`<a href="\\{\\{ \\.ConfirmationURL \\}\\}"[^>]*>`),
    "the placeholder must be an href value, not body text");
});

test("nothing reconstructs, transforms or supplements the recovery URL", () => {
  // A hand-built link is how a reset email starts pointing at the wrong
  // environment, or drops the PKCE ?code= Supabase appends.
  for (const forged of [
    /\?token=/, /&token=/, /access_token/, /refresh_token/, /token_hash/,
    /type=recovery/, /\{\{ \.Token \}\}/, /\{\{ \.TokenHash \}\}/,
    /\{\{ \.SiteURL \}\}/, /\{\{ \.RedirectTo \}\}/,
  ]) {
    assert.equal(forged.test(HTML), false,
      `the template must not build its own recovery URL (${forged})`);
  }

  // Only ONE link in the whole email, and it is the CTA. A security email
  // gives the recipient exactly one thing to act on.
  const hrefs = Array.from(HTML.matchAll(/href="([^"]+)"/g)).map((m) => m[1]);
  assert.deepEqual(hrefs, [TOKEN],
    `expected only the CTA link, found ${JSON.stringify(hrefs)}`);
});

test("the generator refuses to write output without the placeholder", () => {
  // Not advisory — it throws. This is what stops a refactor of PrimaryButton
  // silently shipping a template whose button goes nowhere.
  assert.match(GENERATOR, /const CONFIRMATION_URL_TOKEN = "\{\{ \.ConfirmationURL \}\}";/);
  assert.match(GENERATOR, /if \(!html\.includes\(CONFIRMATION_URL_TOKEN\)\) \{[\s\S]{0,400}throw new Error\(/);
  assert.match(GENERATOR, /href=\{CONFIRMATION_URL_TOKEN\}/);

  // Passed as a literal prop, never interpolated into a longer string —
  // scoped to the TEMPLATES. The generator's own error message and success
  // log legitimately interpolate the token to name it, and an unscoped check
  // failed on those while proving nothing about the rendered href.
  const templates = GENERATOR.slice(
    GENERATOR.indexOf("function ConfirmSignupTemplate"),
    GENERATOR.indexOf("async function generate")
  );
  assert.ok(templates.length > 0);
  assert.equal(/\$\{CONFIRMATION_URL_TOKEN\}/.test(templates), false,
    "the token must reach href intact, not inside a constructed string");
  assert.equal(/CONFIRMATION_URL_TOKEN\s*\+/.test(templates), false);
});

// ── The requested copy, and nothing else ───────────────────────────────────

test("the email says exactly what it was asked to say", () => {
  assert.match(TEXT, /Reset your password/);
  assert.match(TEXT,
    /We received a request to reset the password for your ServiceSignal account\./);
  assert.match(TEXT, /Use the button below to choose a new password\./);
  assert.match(TEXT, /Reset password/);
  assert.match(TEXT,
    /If you didn't request this, you can safely ignore this email\. Your password won't change unless you use the reset link\./);

  // The CTA label, on the button itself.
  assert.match(HTML, /<span[^>]*>Reset password<\/span>/);
});

test("no marketing, founding-beta or legal copy reached a security email", () => {
  for (const noise of [
    /founding beta/i, /invoice/i, /chasing/i, /reminder/i, /trade/i,
    /all rights reserved/i, /unsubscribe/i, /privacy policy/i, /terms of service/i,
    /get started/i, /upgrade/i, /free trial/i,
  ]) {
    assert.equal(noise.test(TEXT), false, `the reset email must not contain ${noise}`);
  }
});

test("the retired tagline and the oversized auth logo are gone", () => {
  // "AUTOMATED INVOICE CHASING FOR UK BUSINESSES." is a claim the
  // approval-first product no longer makes; it was removed from the auth pages
  // for the same reason. It reached this email via EmailHeader.
  assert.equal(/AUTOMATED INVOICE CHASING/i.test(HTML), false);
  assert.equal(HTML.includes("servicesignal-auth-logo"), false,
    "the 220px marketing lockup must not appear on a transactional email");
  assert.equal(/width="220"/.test(HTML), false);

  // Replaced by the small mark-plus-live-text lockup the SENDING emails use,
  // so this matches the mail ServiceSignal actually delivers.
  assert.match(GENERATOR, /<EmailBrandHeader marginBottom=\{20\} \/>/);
  assert.ok(HTML.includes("servicesignal-mark.png"));
  assert.match(HTML, /Service<\/span>/);
  assert.match(HTML, />Signal<\/span>/,
    "the wordmark is live text, so the brand still reads with images blocked");
});

test("the footer is the product name and nothing more", () => {
  assert.equal(HTML.includes("support@servicesignal.app"), false,
    "a support address is another thing to evaluate on a phishing-shaped email");
  assert.equal(HTML.includes("www.servicesignal.app"), false);
  assert.equal(/Need help\?/.test(HTML), false);
  assert.equal(/©/.test(HTML), false);

  assert.match(GENERATOR, /<BrandFooter \/>/);
  assert.equal(/ResetPasswordTemplate[\s\S]{0,900}<EmailFooter \/>/.test(GENERATOR), false,
    "the reset template must not use the linked footer");
  // The word appears as the footer's own text, after the content.
  assert.ok(TEXT.trimEnd().endsWith("ServiceSignal"));
});

// ── ServiceSignal's transactional visual language ──────────────────────────

test("it renders in the ServiceSignal palette at an email-safe width", () => {
  assert.ok(HTML.includes("#2A5FE3"), "the brand blue drives the CTA");
  assert.ok(HTML.includes("#0f172a"), "dark navy body text");
  assert.ok(HTML.includes("#fafbfd"), "light page background");
  assert.match(HTML, /max-width:600px/, "the industry-safe email width");

  // A real button, not a bare hyperlink — the defect being fixed.
  assert.match(HTML, /background-color:#2A5FE3[^"]*color:#ffffff/);
  assert.match(HTML, /border-radius:8px/);

  // Table-based and light-locked, so Outlook and dark mode do not reflow it.
  assert.match(HTML, /role="presentation"/);
  assert.match(HTML, /<meta name="color-scheme" content="light"\/>/);
  assert.match(HTML, /x-apple-disable-message-reformatting/);
  // Images are absolute — a mail client can never resolve an app-relative path.
  for (const src of HTML.match(/src="([^"]+)"/g) ?? []) {
    assert.match(src, /src="https:\/\//, `${src} must be an absolute URL`);
  }
});

test("the preview line is transactional", () => {
  assert.ok(HTML.includes("Reset your ServiceSignal password."),
    "the inbox preview text must describe the email, not sell anything");
});

// ── The artefact matches its source, and its sibling did not move ──────────

test("the checked-in HTML is what the generator produces", () => {
  // The file is pasted into a Dashboard by hand, so it is the thing that
  // actually ships. If it can drift from the generator, the generator stops
  // being the source of truth and reviewing it proves nothing.
  //
  // Structural equivalence rather than a re-render: the generator imports
  // @react-email/components and JSX, which this runner cannot execute. Every
  // element the template composes must be present, in order.
  const order = [
    "servicesignal-mark.png",
    ">Reset your password<",
    "We received a request to reset the password",
    TOKEN,
    ">Reset password<",
    "you can safely ignore this email",
    ">ServiceSignal<",
  ];
  let cursor = -1;
  for (const fragment of order) {
    const at = HTML.indexOf(fragment, cursor + 1);
    assert.ok(at > cursor, `"${fragment}" is missing or out of order in the generated HTML`);
    cursor = at;
  }
});

test("confirm-signup was left alone by this pass", () => {
  // OUT OF SCOPE, deliberately. The generator writes both files, so
  // regenerating touches it — but ConfirmSignupTemplate is unchanged, so its
  // output is byte-identical. It still carries the retired tagline and the
  // linked footer, and it is currently unreachable: beta accounts are created
  // with email_confirm: true, which suppresses Supabase's confirmation email
  // entirely. It would need this same treatment before any public signup path
  // returns.
  assert.ok(CONFIRM_HTML.includes("AUTOMATED INVOICE CHASING"),
    "confirm-signup is untouched — it still has the old header");
  assert.ok(CONFIRM_HTML.includes("servicesignal-auth-logo"));
  assert.match(GENERATOR, /function ConfirmSignupTemplate\(\)[\s\S]{0,600}<EmailHeader \/>/);
  assert.match(GENERATOR, /function ConfirmSignupTemplate\(\)[\s\S]{0,600}<EmailFooter \/>/);
  // And its own placeholder is intact.
  assert.equal((CONFIRM_HTML.match(/\{\{ \.ConfirmationURL \}\}/g) ?? []).length, 1);
});

// ── Nothing in the auth path moved ─────────────────────────────────────────

test("the recovery request and redirect are untouched", () => {
  const forgot = read("app/forgot-password/page.tsx");
  assert.match(forgot, /supabase\.auth\.resetPasswordForEmail\(email\.trim\(\)\.toLowerCase\(\), \{/);
  assert.match(forgot, /redirectTo: getResetPasswordRedirectUrl\(\),/);
  assert.match(forgot, /If an account exists for/, "enumeration protection intact");

  // This template pass must not have introduced a second sender for recovery.
  // Supabase sends it; nothing in the repo does.
  // Matched on what a SENDER would contain, not on the word "recovery" — which
  // appears in lib/welcome-email.ts as "stale-claim recovery", an unrelated
  // idea, and made an earlier version of this assertion fail for the wrong
  // reason.
  const senders = ["lib/beta-access-email.ts", "lib/welcome-email.ts", "lib/reminder-sender.ts"];
  for (const f of senders) {
    const src = read(f);
    for (const claim of [
      /resetPasswordForEmail/, /ResetPasswordEmail/, /Reset your password/,
      /ConfirmationURL/, /type=recovery/,
    ]) {
      assert.equal(claim.test(src), false,
        `${f} must not have acquired the recovery email (${claim})`);
    }
  }
});
