import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReminderEmail } from "@/lib/email-templates";
import { formatDate, formatCurrency } from "@/lib/invoices";

/** Relative to the real system clock, so an exact-wording test never goes stale as time passes. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * The customer-facing identity audit: a real customer received a reminder
 * whose subject, sign-off and footer all read the account's own login email
 * ("Overdue invoice reminder from musao...@gmail.com"). That happened
 * because the caller resolved senderName by falling back to the account
 * email before this composer ever saw it — buildReminderEmail() itself has
 * always just printed whatever string it was given. These tests lock down
 * the OUTPUT shape (subject/sign-off/footer all use the given identity
 * verbatim, in the right places) so a future caller-side regression is
 * caught here even if the resolver itself is later bypassed by mistake.
 */

function base(overrides: Partial<Parameters<typeof buildReminderEmail>[0]> = {}) {
  return buildReminderEmail({
    tone: "firm",
    schedule: "overdue_7_days",
    customerName: "Dave Morrison",
    senderName: "Buildscape Ltd",
    amount: 1500,
    dueDate: "2026-07-26",
    paymentLink: undefined,
    invoiceReference: "INV003",
    jobDescription: null,
    ...overrides,
  });
}

test("subject uses the resolved identity, not a placeholder", () => {
  const { subject } = base();
  assert.match(subject, /Buildscape Ltd/);
});

test("subject includes the invoice reference when one exists", () => {
  const { subject } = base({ invoiceReference: "INV003" });
  assert.match(subject, /INV003/);
  assert.match(subject, /Buildscape Ltd — INV003/);
});

test("subject omits a dangling separator when there is no invoice reference", () => {
  const { subject } = base({ invoiceReference: null });
  assert.equal(/—\s*$/.test(subject), false, "must not end with a trailing dash");
  assert.equal(/— undefined| — null/.test(subject), false);
});

test("subject never contains an email address", () => {
  // Guards the exact regression: a resolved identity should never look like
  // an email address in the first place, but the subject template itself
  // must not be the thing that would print one if it somehow did.
  const { subject } = base({ senderName: "Buildscape Ltd" });
  assert.equal(/@/.test(subject), false);
});

test("subject wording differs by due status without losing the identity", () => {
  const upcoming = base({ dueDate: "2099-01-01" }).subject;
  const overdue = base({ dueDate: "2020-01-01" }).subject;
  assert.match(upcoming, /Upcoming/);
  assert.match(upcoming, /Buildscape Ltd/);
  assert.match(overdue, /Buildscape Ltd/);
  assert.notEqual(upcoming, overdue);
});

test("final tone overdue subject is distinct and still carries the identity", () => {
  const { subject } = base({ tone: "final", dueDate: "2020-01-01" });
  assert.match(subject, /Final/);
  assert.match(subject, /Buildscape Ltd/);
});

// ── Date rule: explicit due date, never a calculated day-count ─────────────

test("final-tone overdue body states the explicit due date, never a calculated day-count", () => {
  const dueDate = isoDaysAgo(12);
  const dueStr = formatDate(dueDate);
  const { text } = base({ tone: "final", dueDate });
  assert.match(text, new RegExp(`which was due on ${dueStr}\\.`), "must name the explicit due date");
  assert.equal(/\d+ days? overdue/i.test(text), false, "must not append a calculated day-count");
  assert.equal(/is now/i.test(text), false, "the old 'and is now N days overdue' clause must be gone");
});

test("every tone states the same explicit due date for the same overdue invoice", () => {
  const dueDate = isoDaysAgo(5);
  const dueStr = formatDate(dueDate);
  for (const tone of ["friendly", "firm", "final"] as const) {
    const { text } = base({ tone, dueDate });
    assert.match(text, new RegExp(`due on ${dueStr}`), `${tone} must name the explicit due date`);
    assert.equal(/\d+ days? (overdue|ago)/i.test(text), false, `${tone} must not use relative day-count wording`);
  }
});

test("subject avoids spammy/aggressive wording", () => {
  const { subject } = base({ tone: "final", dueDate: "2020-01-01" });
  assert.equal(/urgent|act now|final notice!!!|warning/i.test(subject), false);
});

// ── Sign-off ─────────────────────────────────────────────────────────────

test("sign-off uses the resolved identity for every tone", () => {
  for (const tone of ["friendly", "firm", "final"] as const) {
    const { text } = base({ tone });
    assert.match(text, /Buildscape Ltd\s*$/, `${tone} sign-off must end with the identity`);
  }
});

test("sign-off never uses the account email", () => {
  const { text } = base();
  assert.equal(/@/.test(text.split("\n").slice(-2).join("\n")), false);
});

// ── Footer ───────────────────────────────────────────────────────────────

test("footer references the resolved identity, understated", () => {
  const { html } = base();
  assert.match(html, /Sent via ServiceSignal on behalf of Buildscape Ltd/);
});

test("footer never leaks an email address", () => {
  const { html } = base({ senderName: "Buildscape Ltd" });
  const footerLine = html.slice(html.indexOf("Sent via ServiceSignal"));
  assert.equal(/@/.test(footerLine), false);
});

// ── Personal identity flows through identically ─────────────────────────

test("a personal identity (once resolved) flows through subject, sign-off and footer the same way a business identity does", () => {
  const { subject, text, html } = base({ senderName: "Sam Alobaydi" });
  assert.match(subject, /Sam Alobaydi/);
  assert.match(text, /Sam Alobaydi\s*$/);
  assert.match(html, /Sent via ServiceSignal on behalf of Sam Alobaydi/);
});

// ── Payment wording stays conditional ───────────────────────────────────

test("with a payment link: CTA and fallback URL are present, wording is natural", () => {
  const { text, html } = base({ paymentLink: "https://pay.example.com/inv003" });
  assert.match(text, /Pay here: https:\/\/pay\.example\.com\/inv003/);
  assert.match(html, /Pay Now/);
  assert.match(html, /https:\/\/pay\.example\.com\/inv003/);
  assert.match(text, /using the link below|arrange payment/);
});

test("without a payment link: neutral wording, never 'usual payment method'", () => {
  const { text, html } = base({ paymentLink: undefined });
  assert.equal(/usual payment method/i.test(text), false);
  assert.equal(/usual payment method/i.test(html), false);
  assert.match(text, /reply to this email|payment details/i);
});

// ── Reviewed wording direction: exact body text ─────────────────────────
//
// The literal structure approved this pass, matched exactly (not just by
// pattern) so a future edit cannot drift the wording without this failing.
// dueDate is computed relative to the real clock (isoDaysAgo) rather than a
// fixed literal date, so the assertion never goes stale as time passes.

test("no-payment-link email matches the reviewed structure exactly", () => {
  const dueDate = isoDaysAgo(9);
  const { text } = base({ paymentLink: undefined, dueDate, customerName: "Sam Alobaydi" });
  const dueStr = formatDate(dueDate);
  const amountStr = formatCurrency(1500);

  const expected =
    `Hi Sam,\n\n` +
    `I'm following up on invoice INV003 for ${amountStr}, which was due on ${dueStr}. ` +
    `Please arrange payment at your earliest convenience. If you need the payment details again, just reply to this email.\n\n` +
    `Thank you,\nBuildscape Ltd`;

  assert.equal(text, expected);
});

test("payment-link email keeps the same opening, then directs to the link, exactly", () => {
  const dueDate = isoDaysAgo(9);
  const link = "https://pay.example.com/inv003";
  const { text, html } = base({ paymentLink: link, dueDate, customerName: "Sam Alobaydi" });
  const dueStr = formatDate(dueDate);
  const amountStr = formatCurrency(1500);

  const expected =
    `Hi Sam,\n\n` +
    `I'm following up on invoice INV003 for ${amountStr}, which was due on ${dueStr}. ` +
    `Please arrange payment using the link below at your earliest convenience.\n\n` +
    `Pay here: ${link}\n\n` +
    `Thank you,\nBuildscape Ltd`;

  assert.equal(text, expected);
  // The fallback raw URL is retained beneath the CTA in the HTML version.
  assert.match(html, /Pay Now/);
  assert.match(html, new RegExp(link.replace(/[.]/g, "\\.")));
});

// ── Forbidden phrases — never anywhere in generated copy ────────────────

test("the forbidden phrases never appear in any generated email, any state", () => {
  const forbidden = [/outstanding balance of/i, /payment details resent/i, /usual payment method/i];
  const states: Array<Partial<Parameters<typeof buildReminderEmail>[0]>> = [
    { paymentLink: undefined, tone: "friendly" },
    { paymentLink: undefined, tone: "firm" },
    { paymentLink: undefined, tone: "final" },
    { paymentLink: "https://pay.example.com/x", tone: "friendly" },
    { paymentLink: "https://pay.example.com/x", tone: "final" },
    { dueDate: "2099-01-01" }, // upcoming
    { dueDate: new Date().toISOString().slice(0, 10) }, // due today
  ];
  for (const state of states) {
    const { text, html, subject } = base(state);
    for (const phrase of forbidden) {
      assert.equal(phrase.test(text), false, `${phrase} must not appear in text for ${JSON.stringify(state)}`);
      assert.equal(phrase.test(html), false, `${phrase} must not appear in html for ${JSON.stringify(state)}`);
      assert.equal(phrase.test(subject), false, `${phrase} must not appear in subject for ${JSON.stringify(state)}`);
    }
  }
});
