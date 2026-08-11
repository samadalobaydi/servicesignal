import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { firstNameFrom, welcomeGreeting } from "@/lib/person-name";

/**
 * The Welcome email.
 *
 * Two kinds of coverage, labelled honestly:
 *
 *   - UNIT tests over the greeting logic, which is where the reported bug
 *     actually lived.
 *   - STATIC checks over the template and the sender. The template is JSX and
 *     the repo's test runner strips types but does not transpile JSX, so these
 *     read source rather than rendered output. They cannot prove the email
 *     renders — `npm run build` compiles it — but they do prove the copy,
 *     the CTA target and the Reply-To are what was agreed, and they fail if
 *     any of it silently reverts.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TEMPLATE = readFileSync(join(ROOT, "emails/templates/WelcomeEmail.tsx"), "utf8");
const SENDER = readFileSync(join(ROOT, "lib/welcome-email.ts"), "utf8");
const FOOTER = readFileSync(join(ROOT, "emails/components/EmailFooter.tsx"), "utf8");

/** Comments explain intent; they cannot send anything. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── Greeting ───────────────────────────────────────────────────────────────

test("the greeting uses the person's first name", () => {
  assert.equal(welcomeGreeting("Sam Alobaydi"), "Welcome, Sam!");
  assert.equal(firstNameFrom("Sam Alobaydi"), "Sam");
});

test("a single-word name is used whole, not mangled", () => {
  assert.equal(welcomeGreeting("Sam"), "Welcome, Sam!");
  assert.equal(firstNameFrom("Sam"), "Sam");
});

test("names are whitespace-trimmed and internal spacing is tolerated", () => {
  assert.equal(welcomeGreeting("   Sam   "), "Welcome, Sam!");
  assert.equal(welcomeGreeting("\tSam\tAlobaydi\n"), "Welcome, Sam!");
  assert.equal(welcomeGreeting("Sam    Alobaydi"), "Welcome, Sam!");
});

test("an unusable name falls back to a complete sentence, never 'Welcome, !'", () => {
  for (const value of [null, undefined, "", "   ", "\n\t "]) {
    const greeting = welcomeGreeting(value);
    assert.equal(greeting, "Welcome to ServiceSignal", `input ${JSON.stringify(value)}`);
    assert.equal(/Welcome,\s*!/.test(greeting), false);
  }
});

test("the business name can never become the greeting", () => {
  // The exact reported defect: the account's trading name was "test1" and the
  // email said "Welcome, test1!". With no person name, the fallback must win.
  assert.equal(welcomeGreeting(null), "Welcome to ServiceSignal");
  assert.notEqual(welcomeGreeting(null), "Welcome, test1!");

  const code = strip(TEMPLATE);
  assert.equal(
    /businessName/.test(code),
    false,
    "the template must not reference businessName at all"
  );
  assert.match(code, /personName/);
  assert.match(code, /welcomeGreeting\(personName\)/);
});

test("[static] the sender resolves the person name from where it is already stored", () => {
  const code = strip(SENDER);
  // beta_signups.name is collected on the founding-beta form. Nothing else in
  // the journey carries a personal name forward.
  assert.match(code, /from\("beta_signups"\)/);
  assert.match(code, /select\("name"\)/);
  assert.match(code, /personName/);
  // And it must not quietly pass the business name in its place.
  assert.equal(
    /WelcomeEmail\(\{\s*businessName/.test(code),
    false,
    "businessName must not be handed to the template"
  );
});

// ── Copy ───────────────────────────────────────────────────────────────────

test("[static] account-state wording does not claim setup is finished", () => {
  const code = strip(TEMPLATE);
  assert.match(code, /Your ServiceSignal account has been created\./);
  assert.equal(
    /Your account is ready\./.test(code),
    false,
    "'ready' contradicts the two-step checklist directly beneath it"
  );
});

test("[static] SMS and email are named together and equally", () => {
  const code = strip(TEMPLATE);
  assert.match(code, /SMS and email reminders/);

  // None of the ranking language, in either direction.
  for (const banned of [
    /supporting email/i,
    /SMS-first/i,
    /primary channel/i,
    /richer/i,
    /email is the current channel/i,
  ]) {
    assert.equal(banned.test(code), false, `banned wording: ${banned}`);
  }

  // The old email-only sentence must be gone.
  assert.equal(
    /prepare professional invoice\s+reminders, with every message/.test(code),
    false,
    "the pre-SMS paragraph must not survive"
  );
});

test("[static] the approval claim is scoped to these reminders, not made permanent", () => {
  const code = strip(TEMPLATE);
  assert.match(code, /each\s+reminder ready for your review before it is sent/);
  // Auto mode is planned, so an absolute product-wide promise would age badly.
  assert.equal(/nothing (is )?ever sent/i.test(code), false);
  assert.equal(/always require your approval/i.test(code), false);
});

test("[static] the steps box describes the COMPLETE first-reminder journey", () => {
  const code = strip(TEMPLATE);
  assert.match(code, /Three quick steps to get started/);

  // Exactly these three, in this order.
  assert.match(code, /<li>Add your first overdue invoice<\/li>/);
  assert.match(code, /<li>Review your SMS and email reminders<\/li>/);
  assert.match(code, /<li>Send your invoice reminders<\/li>/);

  const steps = code.match(/<li>[^<]*<\/li>/g) ?? [];
  assert.equal(steps.length, 3, "three steps — no more, the flow has no fourth");
  assert.deepEqual(steps, [
    "<li>Add your first overdue invoice</li>",
    "<li>Review your SMS and email reminders</li>",
    "<li>Send your invoice reminders</li>",
  ]);
});

test("[static] the superseded two-step copy is gone", () => {
  const code = strip(TEMPLATE);
  // Stopping at "review" left the customer believing their first chase had
  // gone out when it was still sitting in Active Chasing.
  assert.equal(/Two quick steps to get started/.test(code), false);
  assert.equal(/Review your reminder before anything sends/.test(code), false);
});

test("[static] step 3 names the outcome the owner came for", () => {
  const code = strip(TEMPLATE);
  assert.match(code, /<li>Send your invoice reminders<\/li>/);
  // The superseded wording named an internal surface rather than the job.
  assert.equal(/Approve your reminders in Active Chasing/.test(code), false);
});

test("[static] the preheader complements the subject rather than repeating it", () => {
  const code = strip(TEMPLATE);
  const preview = code.match(/previewText="([^"]+)"/);
  assert.ok(preview, "a preheader exists");

  const text = preview![1];
  assert.equal(/^Welcome to ServiceSignal/i.test(text), false, "must not restate the subject");
  assert.equal(/ready/i.test(text), false, "must not claim setup is complete either");
  assert.match(text, /created/);
  // The preheader counts the same number of steps as the panel below it.
  assert.match(text, /three quick steps/i);
  assert.equal(/two quick steps/i.test(text), false);
  // No spam signals.
  assert.equal(/!{2,}|NOW|urgent|hurry/i.test(text), false);
});

test("[static] the subject is plain and trustworthy", () => {
  const code = strip(SENDER);
  assert.match(code, /subject: "Welcome to ServiceSignal"/);
  assert.equal(/You'?re in!!/i.test(code), false);
  assert.equal(/collecting money/i.test(code), false);
});

// ── CTA, environment safety, reply behaviour ───────────────────────────────

test("[static] the CTA goes through /continue, never straight to onboarding", () => {
  const code = strip(SENDER);
  assert.match(code, /\$\{baseUrl\}\/continue/);
  assert.equal(
    /\$\{baseUrl\}\/onboarding/.test(code),
    false,
    "a hardcoded /onboarding would restart a user who has already finished"
  );
  // The button itself lives in the template and must use the prop, not build
  // its own URL — a template that resolved its own origin would defeat the
  // sender's ability to refuse to send when the environment is unconfigured.
  assert.match(
    strip(TEMPLATE),
    /<PrimaryButton href=\{continueUrl\}>Open ServiceSignal<\/PrimaryButton>/
  );
});

test("[static] the CTA origin fails closed and cannot leak localhost to production", () => {
  const code = strip(SENDER);
  // requireAppBaseUrl() returns null rather than guessing, and the send is
  // abandoned — an unsent email is recoverable, a wrong-environment link is not.
  assert.match(code, /requireAppBaseUrl\(\)/);
  assert.match(code, /if \(!baseUrl\)/);
  assert.equal(/localhost/.test(code), false, "no localhost fallback in the sender");
  assert.equal(/localhost/.test(strip(TEMPLATE)), false, "no localhost in the template");
});

test("[static] 'just reply to this email' is truthful", () => {
  const code = strip(SENDER);
  // From AND an explicit Reply-To, both the monitored support mailbox.
  assert.match(code, /const WELCOME_FROM = SUPPORT_FROM/);
  assert.match(code, /replyTo: SUPPORT_ADDRESS/);

  // The claim is only allowed to appear because of the two assertions above.
  assert.match(strip(TEMPLATE), /Questions\? Just reply to this email\./);

  // And it must NOT reuse the reminder pattern, where Reply-To is the trade.
  assert.equal(/replyTo: user\.email|replyTo: recipient/.test(code), false);
});

test("[static] the footer links are live and production-safe", () => {
  const code = strip(FOOTER);
  assert.match(code, /href="mailto:support@servicesignal\.app"/);
  assert.match(code, /href="https:\/\/www\.servicesignal\.app"/);
  assert.equal(/localhost|http:\/\//.test(code), false);
  // Restrained: no social, no marketing banner.
  assert.equal(/twitter|facebook|linkedin|instagram/i.test(code), false);
});

// ── Send-once, and the plain-text alternative ─────────────────────────────

test("[static] the send-once mechanism is intact", () => {
  const code = strip(SENDER);
  // A database claim is the primary defence: tryClaim returns null once a row
  // is 'sent', so refresh / resume / /continue / re-login are all no-ops.
  assert.match(code, /tryClaim\(userId, "welcome"\)/);
  assert.match(code, /if \(!claim\) return;/);
  assert.match(code, /confirmSent|markFailed/);

  // Resend's Idempotency-Key is the secondary defence, and must stay keyed to
  // the stable claim id rather than the rotating claim_token.
  assert.match(code, /const idempotencyKey = claim\.id;/);
  assert.equal(/idempotencyKey = claim\.claim_token/.test(code), false);
});

test("[static] HTML and plain text cannot contradict each other", () => {
  const code = strip(SENDER);
  // Both rendered from the SAME component with the same props — there is one
  // source of wording, so drift is structurally impossible.
  assert.match(code, /render\(WelcomeEmail\(\{ personName, continueUrl \}\)\)/);
  assert.match(code, /render\(WelcomeEmail\(\{ personName, continueUrl \}\), \{ plainText: true \}\)/);
});

test("[static] the email stays conservative for mail clients", () => {
  const code = strip(TEMPLATE);
  for (const fragile of [/<script/i, /<video/i, /<svg/i, /@keyframes/i, /animation:/i, /position:\s*fixed/i]) {
    assert.equal(fragile.test(code), false, `must not introduce ${fragile}`);
  }
});
