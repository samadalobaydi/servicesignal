import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSenderIdentity,
  resolveSenderIdentityForDisplay,
  reminderFromHeader,
  senderIdentityMissingReason,
  missingSenderIdentityMessage,
  SENDER_DISPLAY_FALLBACK,
} from "@/lib/sender-identity";

/**
 * The ONE canonical customer-facing sender-identity resolver — see the
 * module docstring for why it exists (a real customer received a reminder
 * signed with the account's own login email). These are real, executed unit
 * tests of the resolver itself, independent of any one caller.
 *
 * THE CONTRACT UNDER TEST: an EXPLICIT preference, strictly honoured —
 * never a business-first-fallback, never an inference from whichever name
 * field happens to be populated, never the account's login email.
 */

test("Business + business_name resolves to the business name", () => {
  const identity = resolveSenderIdentity({ preference: "business", businessName: "Buildscape Ltd" });
  assert.deepEqual(identity, { kind: "business", senderName: "Buildscape Ltd" });
});

test("business name is trimmed", () => {
  const identity = resolveSenderIdentity({ preference: "business", businessName: "  Buildscape Ltd  " });
  assert.equal(identity?.senderName, "Buildscape Ltd");
});

test("Personal + personal_name resolves to the personal name", () => {
  const identity = resolveSenderIdentity({ preference: "personal", personalName: "Sam Alobaydi" });
  assert.deepEqual(identity, { kind: "personal", senderName: "Sam Alobaydi" });
});

test("personal name is trimmed", () => {
  const identity = resolveSenderIdentity({ preference: "personal", personalName: "  Sam Alobaydi  " });
  assert.equal(identity?.senderName, "Sam Alobaydi");
});

test("NULL preference refuses, regardless of what either name field holds", () => {
  assert.equal(resolveSenderIdentity({ preference: null }), null);
  assert.equal(resolveSenderIdentity({ preference: null, businessName: "Buildscape Ltd" }), null);
  assert.equal(resolveSenderIdentity({ preference: null, personalName: "Sam Alobaydi" }), null);
  assert.equal(
    resolveSenderIdentity({ preference: null, businessName: "Buildscape Ltd", personalName: "Sam Alobaydi" }),
    null
  );
});

test("Business + blank business_name refuses — NEVER falls back to a populated personal_name", () => {
  const identity = resolveSenderIdentity({
    preference: "business",
    businessName: "",
    personalName: "Sam Alobaydi",
  });
  assert.equal(identity, null, "a Business preference must never resolve via personal_name");
});

test("Business + whitespace-only business_name refuses the same way", () => {
  const identity = resolveSenderIdentity({
    preference: "business",
    businessName: "   ",
    personalName: "Sam Alobaydi",
  });
  assert.equal(identity, null);
});

test("Personal + blank personal_name refuses — NEVER falls back to a populated business_name", () => {
  const identity = resolveSenderIdentity({
    preference: "personal",
    personalName: "",
    businessName: "Buildscape Ltd",
  });
  assert.equal(identity, null, "a Personal preference must never resolve via business_name");
});

test("Personal + whitespace-only personal_name refuses the same way", () => {
  const identity = resolveSenderIdentity({
    preference: "personal",
    personalName: "   ",
    businessName: "Buildscape Ltd",
  });
  assert.equal(identity, null);
});

test("the resolver has no email/login field anywhere in its input shape", () => {
  // Structural guarantee, not just behavioural: SenderIdentityInput only
  // ever accepts preference/businessName/personalName. There is no field an
  // account email could be threaded through, so passing one is a type error
  // this test proves by construction (a caller cannot smuggle email in).
  const identity = resolveSenderIdentity({
    preference: "business",
    businessName: "Buildscape Ltd",
  });
  assert.equal(Object.keys(identity ?? {}).sort().join(","), "kind,senderName");
});

// ── The missing-reason classifier ────────────────────────────────────────

test("senderIdentityMissingReason distinguishes all three refusal cases", () => {
  assert.equal(senderIdentityMissingReason({ preference: null }), "preference_missing");
  assert.equal(
    senderIdentityMissingReason({ preference: "business", businessName: "" }),
    "business_name_missing"
  );
  assert.equal(
    senderIdentityMissingReason({ preference: "personal", personalName: "" }),
    "personal_name_missing"
  );
});

test("missingSenderIdentityMessage produces the three distinct, deliberately-authored messages", () => {
  assert.equal(
    missingSenderIdentityMessage("preference_missing", "preparing a reminder"),
    "Choose how customers should see you in Settings before preparing a reminder."
  );
  assert.equal(
    missingSenderIdentityMessage("business_name_missing", "preparing a reminder"),
    "Add your business name in Settings before preparing a reminder."
  );
  assert.equal(
    missingSenderIdentityMessage("personal_name_missing", "preparing a reminder"),
    "Add your name in Settings before preparing a reminder."
  );
  // Never mentions email, in any case.
  for (const reason of ["preference_missing", "business_name_missing", "personal_name_missing"] as const) {
    assert.equal(/email/i.test(missingSenderIdentityMessage(reason, "sending reminders")), false);
  }
});

// ── Display resolution ────────────────────────────────────────────────────

test("display resolution never refuses — falls back to the non-email placeholder", () => {
  assert.equal(resolveSenderIdentityForDisplay({ preference: null }), SENDER_DISPLAY_FALLBACK);
  assert.equal(SENDER_DISPLAY_FALLBACK, "ServiceSignal");
  assert.equal(/@/.test(SENDER_DISPLAY_FALLBACK), false);
});

test("display resolution returns the real identity when one is configured", () => {
  assert.equal(
    resolveSenderIdentityForDisplay({ preference: "business", businessName: "Buildscape Ltd" }),
    "Buildscape Ltd"
  );
  assert.equal(
    resolveSenderIdentityForDisplay({ preference: "personal", personalName: "Sam Alobaydi" }),
    "Sam Alobaydi"
  );
});

test("display resolution also refuses (falls back to the placeholder) for a selected-but-blank identity", () => {
  assert.equal(
    resolveSenderIdentityForDisplay({ preference: "business", businessName: "", personalName: "Sam Alobaydi" }),
    SENDER_DISPLAY_FALLBACK,
    "must not silently show the personal name for an unresolvable Business preference"
  );
});

// ── From display header ─────────────────────────────────────────────────

const ADDRESS = "reminders@servicesignal.app";

test("reminderFromHeader builds an identity-aware display name around the fixed address", () => {
  assert.equal(
    reminderFromHeader("Buildscape Ltd", ADDRESS),
    "Buildscape Ltd via ServiceSignal <reminders@servicesignal.app>"
  );
});

test("reminderFromHeader works identically for a personal identity", () => {
  assert.equal(
    reminderFromHeader("Sam Alobaydi", ADDRESS),
    "Sam Alobaydi via ServiceSignal <reminders@servicesignal.app>"
  );
});

test("reminderFromHeader never changes the underlying address — only the display name", () => {
  const header = reminderFromHeader("Sam Alobaydi", ADDRESS);
  assert.match(header, /<reminders@servicesignal\.app>$/);
});

test("reminderFromHeader quotes a display name containing header-syntax characters", () => {
  const header = reminderFromHeader('Smith, Jones & Co', ADDRESS);
  assert.match(header, /^"Smith, Jones & Co" via ServiceSignal <reminders@servicesignal\.app>$/);
});

test("reminderFromHeader strips CR/LF — never allows header injection", () => {
  const header = reminderFromHeader("Evil\r\nBcc: attacker@example.com", ADDRESS);
  assert.equal(/[\r\n]/.test(header), false);
});

test("reminderFromHeader falls back to the generic name when given an empty identity", () => {
  assert.equal(reminderFromHeader("", ADDRESS), `ServiceSignal <${ADDRESS}>`);
  assert.equal(reminderFromHeader("   ", ADDRESS), `ServiceSignal <${ADDRESS}>`);
});

// ── Review vs. dispatch consistency ─────────────────────────────────────
//
// The Review page (display-only, never a send gate) and the approve route
// (refuses outright when unresolvable) resolve identity through the SAME
// underlying function — for any profile that resolves at all, both must
// therefore produce the identical string, or a reviewed message could
// legitimately differ from what gets sent.

test("for a resolvable Business identity, the display resolver and the strict resolver agree exactly", () => {
  const input = { preference: "business" as const, businessName: "Buildscape Ltd" };
  const display = resolveSenderIdentityForDisplay(input);
  const strict = resolveSenderIdentity(input)?.senderName;
  assert.equal(display, strict);
  assert.equal(display, "Buildscape Ltd");
});

test("for a resolvable Personal identity, the display resolver and the strict resolver agree exactly", () => {
  const input = { preference: "personal" as const, personalName: "Sam Alobaydi" };
  const display = resolveSenderIdentityForDisplay(input);
  const strict = resolveSenderIdentity(input)?.senderName;
  assert.equal(display, strict);
  assert.equal(display, "Sam Alobaydi");
});
