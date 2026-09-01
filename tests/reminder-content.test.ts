import { test } from "node:test";
import assert from "node:assert/strict";

import {
  generateReminderContent,
  currentContent,
  originalContent,
  contentVersionHash,
  withEmailEdit,
  withSmsEdit,
  withEmailRestored,
  withSmsRestored,
  validateEmailEdit,
  type ReminderFacts,
  type StoredReminderContent,
  type ReminderIdentity,
} from "@/lib/reminder-content";
import { buildReminderSms, validateSmsBody, SMS_MAX_LENGTH } from "@/lib/reminder-sms";

const NOW = new Date("2026-08-07T12:00:00Z");

const FACTS: ReminderFacts = {
  tone: "firm",
  schedule: "overdue_7_days",
  customerName: "Dave Morrison",
  senderName: "Oakfield Plumbing",
  amount: 1240,
  dueDate: "2026-07-26", // 12 days before NOW
  paymentLink: null,
  invoiceReference: "INV-1042",
  jobDescription: "bathroom leak repair",
};

const IDENTITY: ReminderIdentity = {
  recipientEmail: "dave@example.co.uk",
  recipientPhone: "07700 900000",
  senderName: "Oakfield Plumbing",
  replyTo: "owner@oakfield.co.uk",
};

function storedFrom(facts: ReminderFacts = FACTS): StoredReminderContent {
  const g = generateReminderContent(facts, NOW);
  return {
    email: {
      generatedSubject: g.email.subject,
      generatedBody: g.email.body,
      editedSubject: null,
      editedBody: null,
    },
    sms: { generatedBody: g.sms.body, editedBody: null },
  };
}

// ── SMS generation ──────────────────────────────────────────────────────────

test("the SMS carries the invoice facts and identifies the business", () => {
  const body = buildReminderSms(FACTS, NOW);
  assert.match(body, /Dave/, "greets the customer");
  assert.match(body, /Oakfield Plumbing/, "names the sender — SMS has no From header");
  assert.match(body, /INV-1042/);
  assert.match(body, /bathroom leak repair/);
  assert.match(body, /£1,240(?!\.)/, "FACTS' £1,240 is a whole-pound amount — SMS drops the .00");
  assert.match(body, /12 days overdue/);
  assert.ok(body.length <= SMS_MAX_LENGTH, `length ${body.length} within bound`);
});

test("the no-payment-link SMS matches the reviewed structure exactly", () => {
  const body = buildReminderSms(FACTS, NOW);
  assert.equal(
    body,
    "Hi Dave, this is Oakfield Plumbing. INV-1042 for bathroom leak repair, " +
      "£1,240 is 12 days overdue. Please pay at your earliest convenience. " +
      "Reply if you need payment details."
  );
});

test("the payment-link SMS is concise and does not duplicate the email's extra sentences", () => {
  const body = buildReminderSms({ ...FACTS, paymentLink: "https://pay.example.com/inv-1042" }, NOW);
  assert.equal(
    body,
    "Hi Dave, this is Oakfield Plumbing. INV-1042 for bathroom leak repair, " +
      "£1,240 is 12 days overdue. Please pay here: https://pay.example.com/inv-1042"
  );
  // No reply-for-details offer once a link exists — that sentence exists
  // only for the no-link case, and repeating it here would be exactly the
  // "duplicate sentence just because the email has one" the direction warns against.
  assert.equal(/reply if you need/i.test(body), false);
});

// ── SMS-only amount formatting: no unnecessary ".00" pence ──────────────

test("a whole-pound amount drops the .00 pence in SMS, but not in the email", () => {
  const wholePound = { ...FACTS, amount: 1500 };
  const sms = buildReminderSms(wholePound, NOW);
  assert.match(sms, /£1,500(?!\.)/, "SMS must show £1,500, not £1,500.00");
  assert.equal(/£1,500\.00/.test(sms), false);

  const email = generateReminderContent(wholePound, NOW);
  assert.match(email.email.body, /£1,500\.00/, "the email keeps full formatCurrency() precision, unchanged");
});

test("real pence are never dropped in SMS", () => {
  const withPence = { ...FACTS, amount: 1500.5 };
  const sms = buildReminderSms(withPence, NOW);
  assert.match(sms, /£1,500\.50/);
});

// ── GSM/SMS length audit (representative Stage B example) ───────────────
//
// Segment thresholds: GSM-7 single segment ≤160 chars, concatenated
// (multi-part) segments are 153 chars each once over that. Every character
// used in generated reminder copy (letters, digits, £, standard punctuation)
// is in the GSM 03.38 basic character set, so no message here forces UCS-2
// (which would drop the caps to 70/67).

test("[audit] representative Stage B example: character/segment count, no-payment-link", () => {
  const stageB = {
    tone: "firm" as const,
    schedule: "overdue_7_days" as const,
    customerName: "Sam Alobaydi",
    senderName: "Buildscape Ltd", // representative — see the identity report for why the real value could not be read
    amount: 1500,
    dueDate: "2026-08-18",
    paymentLink: null,
    invoiceReference: "INV003",
    jobDescription: null,
  };
  const body = buildReminderSms(stageB, new Date("2026-08-27T12:00:00Z"));
  assert.equal(body.length, 144, `expected 144 chars, got ${body.length}: ${body}`);
  // ≤160 GSM-7 chars → exactly 1 segment (the single-segment cap, not the
  // 153/segment concatenated rate — that only applies once this is exceeded).
  assert.ok(body.length <= 160, "target: this representative example fits a single GSM-7 segment");
});

test("[audit] representative Stage B example: character/segment count, with payment link", () => {
  const stageB = {
    tone: "firm" as const,
    schedule: "overdue_7_days" as const,
    customerName: "Sam Alobaydi",
    senderName: "Buildscape Ltd",
    amount: 1500,
    dueDate: "2026-08-18",
    paymentLink: "https://pay.example.com/inv003",
    invoiceReference: "INV003",
    jobDescription: null,
  };
  const body = buildReminderSms(stageB, new Date("2026-08-27T12:00:00Z"));
  assert.equal(body.length, 116, `expected 116 chars, got ${body.length}: ${body}`);
  assert.ok(body.length <= 160, "this example fits a single GSM-7 segment");
});

test("SMS identity always matches the email identity — one generation call, one senderName, both channels", () => {
  // Deliberately NOT "Oakfield Plumbing" (the module-level default) — a
  // second, distinct identity proves the agreement is structural (both
  // channels reading facts.senderName) rather than two hardcoded strings
  // that happen to be equal.
  const identityFacts = { ...FACTS, senderName: "Riverside Electrical" };
  const generated = generateReminderContent(identityFacts, NOW);

  assert.match(generated.email.subject, /Riverside Electrical/);
  assert.match(generated.email.body, /Riverside Electrical/);
  assert.match(generated.sms.body, /Riverside Electrical/);

  // And never disagree: whatever the email says, the SMS says the same name.
  const emailHasOld = generated.email.subject.includes("Oakfield Plumbing");
  const smsHasOld = generated.sms.body.includes("Oakfield Plumbing");
  assert.equal(emailHasOld, false);
  assert.equal(smsHasOld, false);
});

test("the SMS is written for SMS, not derived from the email", () => {
  const g = generateReminderContent(FACTS, NOW);

  assert.notEqual(g.sms.body, g.email.body);
  // Not a prefix, not a suffix, not a truncation of the email.
  assert.equal(g.sms.body.startsWith(g.email.body.slice(0, 40)), false);
  assert.equal(g.email.body.includes(g.sms.body), false);

  // Structural differences that matter on a lock screen: one paragraph, no
  // sign-off block, and the sender named inline because SMS has no From header.
  assert.equal(g.sms.body.includes("\n"), false, "SMS is a single run of text");
  assert.match(g.email.body, /\n/, "the email keeps its paragraphs");
  assert.equal(/Thank you,|Thanks so much,|Regards,/.test(g.sms.body), false, "no email sign-off");
});

test("SMS timing is computed live, not from the schedule label", () => {
  const yesterday = new Date(NOW);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const body = buildReminderSms(
    { ...FACTS, dueDate: yesterday.toISOString().slice(0, 10) },
    NOW
  );
  assert.match(body, /was due yesterday/, "1 day overdue is not '1 days overdue'");
});

test("every tone produces a usable SMS in both payment states", () => {
  for (const tone of ["friendly", "firm", "final"] as const) {
    for (const paymentLink of [null, "https://pay.example.com/oakfield"]) {
      const body = buildReminderSms({ ...FACTS, tone, paymentLink }, NOW);
      assert.equal(validateSmsBody(body), null, `${tone}/${paymentLink ? "link" : "no link"}`);
      assert.match(body, /Oakfield Plumbing/);
    }
  }
});

// ── Payment link truthfulness, both channels ────────────────────────────────

test("with a payment link, both channels point at it and neither claims to process it", () => {
  const link = "https://pay.example.com/oakfield";
  const g = generateReminderContent({ ...FACTS, paymentLink: link }, NOW);

  assert.ok(g.sms.body.includes(link), "SMS carries the bare URL so clients linkify it");
  assert.ok(g.email.body.includes(link), "email carries the link");

  for (const text of [g.sms.body, g.email.body]) {
    assert.equal(/ServiceSignal (processes|holds|receives)/i.test(text), false);
    assert.equal(/we('ve| have) (received|detected)/i.test(text), false);
  }
});

test("with NO payment link, neither channel invents one or guesses a method", () => {
  const g = generateReminderContent({ ...FACTS, paymentLink: null }, NOW);

  for (const [label, text] of [["sms", g.sms.body], ["email", g.email.body]] as const) {
    assert.equal(/https?:\/\//.test(text), false, `${label} must not invent a URL`);
    assert.equal(/usual payment method/i.test(text), false, `${label} must not guess a method`);
    assert.equal(/bank|sort code|account number/i.test(text), false, `${label}`);
  }
  // The SMS offers to resend details instead of assuming.
  assert.match(g.sms.body, /reply/i);
});

// ── Current version resolution ──────────────────────────────────────────────

test("unedited content resolves to the generated original, marked unedited", () => {
  const stored = storedFrom();
  const current = currentContent(stored, FACTS, NOW);

  assert.equal(current.email.subject, stored.email!.generatedSubject);
  assert.equal(current.email.body, stored.email!.generatedBody);
  assert.equal(current.sms.body, stored.sms!.generatedBody);
  assert.equal(current.email.edited, false);
  assert.equal(current.sms.edited, false);
  assert.equal(current.legacy, false);
});

test("channel edits are completely independent", () => {
  const stored = storedFrom();

  // Edit SMS only.
  const smsEdited: StoredReminderContent = {
    ...stored,
    sms: withSmsEdit(stored.sms!, "Custom text from the owner."),
  };
  let current = currentContent(smsEdited, FACTS, NOW);
  assert.equal(current.sms.body, "Custom text from the owner.");
  assert.equal(current.sms.edited, true);
  assert.equal(current.email.body, stored.email!.generatedBody, "email untouched");
  assert.equal(current.email.edited, false);

  // Now edit email only, on top.
  const bothEdited: StoredReminderContent = {
    ...smsEdited,
    email: withEmailEdit(stored.email!, { subject: "My subject", body: "My body" }),
  };
  current = currentContent(bothEdited, FACTS, NOW);
  assert.equal(current.email.subject, "My subject");
  assert.equal(current.email.body, "My body");
  assert.equal(current.sms.body, "Custom text from the owner.", "SMS edit survived");
});

test("the generated original survives every edit and is returned verbatim", () => {
  const stored = storedFrom();
  const originals = originalContent(stored);

  const edited: StoredReminderContent = {
    email: withEmailEdit(stored.email!, { subject: "X", body: "Y" }),
    sms: withSmsEdit(stored.sms!, "Z"),
  };

  assert.deepEqual(originalContent(edited), originals, "originals are immutable");

  // Restore returns EXACTLY the stored original — not a regenerated one.
  const restored: StoredReminderContent = {
    email: withEmailRestored(edited.email!),
    sms: withSmsRestored(edited.sms!),
  };
  const current = currentContent(restored, FACTS, NOW);
  assert.equal(current.email.subject, originals.email!.subject);
  assert.equal(current.email.body, originals.email!.body);
  assert.equal(current.sms.body, originals.sms!.body);
  assert.equal(current.email.edited, false);
  assert.equal(current.sms.edited, false);
});

test("restore does not regenerate — a rolled-over due date cannot change it", () => {
  const stored = storedFrom();
  const edited: StoredReminderContent = { ...stored, sms: withSmsEdit(stored.sms!, "custom") };

  // Ten days pass. A regenerating restore would now say "22 days overdue".
  const later = new Date(NOW);
  later.setUTCDate(later.getUTCDate() + 10);

  const restored = currentContent({ ...edited, sms: withSmsRestored(edited.sms!) }, FACTS, later);
  assert.equal(restored.sms.body, stored.sms!.generatedBody);
  assert.match(restored.sms.body, /12 days overdue/, "the original wording is preserved");
});

test("typing back to the original clears the edited flag", () => {
  const stored = storedFrom();
  const same = withSmsEdit(stored.sms!, stored.sms!.generatedBody);
  assert.equal(same.editedBody, null);
  assert.equal(currentContent({ ...stored, sms: same }, FACTS, NOW).sms.edited, false);
});

// ── Version hashing / stale review ──────────────────────────────────────────

test("any content change mints a new version hash", () => {
  const stored = storedFrom();
  const base = contentVersionHash(currentContent(stored, FACTS, NOW), IDENTITY);

  const mutations: Array<[string, StoredReminderContent]> = [
    ["sms edit", { ...stored, sms: withSmsEdit(stored.sms!, "different") }],
    ["email subject edit", { ...stored, email: withEmailEdit(stored.email!, { subject: "New", body: stored.email!.generatedBody }) }],
    ["email body edit", { ...stored, email: withEmailEdit(stored.email!, { subject: stored.email!.generatedSubject, body: "New body" }) }],
  ];

  for (const [label, mutated] of mutations) {
    const next = contentVersionHash(currentContent(mutated, FACTS, NOW), IDENTITY);
    assert.notEqual(next, base, `${label} must invalidate a prior approval`);
  }
});

test("an SMS edit invalidates an approval taken over the pair", () => {
  // This is the property that makes ONE approval for TWO channels safe: the
  // hash spans both, so approving the pair and then editing either one is
  // detected.
  const stored = storedFrom();
  const approved = contentVersionHash(currentContent(stored, FACTS, NOW), IDENTITY);
  const afterSmsEdit = contentVersionHash(
    currentContent({ ...stored, sms: withSmsEdit(stored.sms!, "sneaky") }, FACTS, NOW),
    IDENTITY
  );
  assert.notEqual(approved, afterSmsEdit);
});

test("restoring returns to the pre-edit hash exactly", () => {
  const stored = storedFrom();
  const base = contentVersionHash(currentContent(stored, FACTS, NOW), IDENTITY);
  const edited = { ...stored, sms: withSmsEdit(stored.sms!, "temp") };
  const restored = { ...edited, sms: withSmsRestored(edited.sms!) };
  assert.equal(contentVersionHash(currentContent(restored, FACTS, NOW), IDENTITY), base);
});

test("identity changes invalidate a review even when the text is identical", () => {
  const stored = storedFrom();
  const current = currentContent(stored, FACTS, NOW);
  const base = contentVersionHash(current, IDENTITY);

  for (const identity of [
    { ...IDENTITY, recipientEmail: "someone.else@example.com" },
    { ...IDENTITY, recipientPhone: "07700 900999" },
    { ...IDENTITY, senderName: "Different Trading Name" },
    { ...IDENTITY, replyTo: "other@example.com" },
  ]) {
    assert.notEqual(contentVersionHash(current, identity), base);
  }
});

test("text cannot be shuffled across the channel boundary to collide", () => {
  const a = contentVersionHash(
    { email: { subject: "AB", body: "C", edited: false }, sms: { body: "D", edited: false }, legacy: false },
    IDENTITY
  );
  const b = contentVersionHash(
    { email: { subject: "A", body: "BC", edited: false }, sms: { body: "D", edited: false }, legacy: false },
    IDENTITY
  );
  assert.notEqual(a, b);
});

// ── Legacy compatibility ────────────────────────────────────────────────────

test("a legacy reminder with no stored content composes live and says so", () => {
  const current = currentContent({ email: null, sms: null }, FACTS, NOW);
  assert.equal(current.legacy, true);
  assert.equal(current.email.edited, false);
  assert.equal(current.sms.edited, false);
  // It still produces a real, usable pair.
  assert.match(current.email.subject, /Oakfield Plumbing/);
  assert.match(current.sms.body, /Oakfield Plumbing/);
});

test("a half-migrated reminder fills only the missing channel", () => {
  const stored = storedFrom();
  const emailOnly: StoredReminderContent = { email: stored.email, sms: null };
  const current = currentContent(emailOnly, FACTS, NOW);

  assert.equal(current.legacy, false, "stored email means this is not a legacy row");
  assert.equal(current.email.body, stored.email!.generatedBody, "stored email is used");
  assert.match(current.sms.body, /Oakfield Plumbing/, "SMS composed live");
});

// ── Validation ──────────────────────────────────────────────────────────────

test("edited content is validated before it can be stored", () => {
  assert.equal(validateSmsBody(""), "empty");
  assert.equal(validateSmsBody("   "), "empty");
  assert.equal(validateSmsBody("x".repeat(SMS_MAX_LENGTH + 1)), "too_long");
  assert.equal(validateSmsBody("A normal reminder."), null);

  assert.equal(validateEmailEdit({ subject: "", body: "b" }), "subject_empty");
  assert.equal(validateEmailEdit({ subject: "s", body: "  " }), "body_empty");
  assert.equal(validateEmailEdit({ subject: "x".repeat(201), body: "b" }), "subject_too_long");
  assert.equal(validateEmailEdit({ subject: "s", body: "b" }), null);
});
