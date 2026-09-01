import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Static structural proofs for the sender-identity onboarding/Settings pass,
 * for the surfaces this repository does not have a runtime-mocking harness
 * for (Next.js route handlers reading cookies via next/headers, and React
 * components node:test cannot mount) — matching the established convention
 * elsewhere in this suite (e.g. tests/allowance-preparation.test.ts's own
 * static assertions against app/api/reminders/prepare/route.ts).
 *
 * Comments must never satisfy an assertion — every regex here is anchored
 * against `strip`ped source.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const strip = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// ── Prepare: the three-way fail-closed gate ─────────────────────────────────

test("[static] Prepare loads sender_identity, business_name and personal_name, and refuses via the strict resolver before any write", () => {
  const code = strip(read("app/api/reminders/prepare/route.ts"));

  assert.match(code, /select\("sender_identity, business_name, personal_name"\)/,
    "must read all three columns, not business_name alone");
  assert.match(code, /resolveSenderIdentity\(senderInputs\)/);
  assert.match(code, /if \(!identity\) \{/);
  assert.match(code, /state: "missing_sender_identity"/);
  assert.match(code, /reason,/, "the specific reason (preference_missing/business_name_missing/personal_name_missing) must be reported, not just the generic state");

  // ORDERING: the gate must sit before the reminder_logs insert, before
  // persistGeneratedContent, and before the row is ever created.
  const gateIdx = code.indexOf('state: "missing_sender_identity"');
  const insertIdx = code.indexOf('.from("reminder_logs")\n    .insert({');
  const persistIdx = code.indexOf("persistGeneratedContent(");
  assert.ok(gateIdx > -1 && insertIdx > -1 && persistIdx > -1);
  assert.ok(gateIdx < insertIdx, "the identity refusal must be reachable BEFORE the reminder_logs row is created");
  assert.ok(gateIdx < persistIdx, "the identity refusal must be reachable BEFORE channel content is persisted");
});

test("[static] Prepare never falls back across identities and never reads an email field for identity", () => {
  const code = strip(read("app/api/reminders/prepare/route.ts"));
  assert.equal(/resolveBusinessName/.test(code), false, "the retired business-only resolver must not reappear here");
  assert.equal(/senderInputs[\s\S]{0,120}user\.email/.test(code), false,
    "the resolver input must never be built from the account's own email");
});

// ── Approve / Retry: fresh reads, no stale identity ─────────────────────────

test("[static] approveAndSendReminder and retryReminderChannel both call loadSenderIdentityInputs independently", () => {
  const code = strip(read("lib/reminder-approval.ts"));
  const occurrences = code.match(/await deps\.db\.loadSenderIdentityInputs\(deps\.userId\)/g) ?? [];
  assert.equal(occurrences.length, 2, "exactly two independent fresh reads — one per gate, never shared");
});

// ── Onboarding: explicit choice, nothing pre-selected ───────────────────────

test("[static] onboarding gates step 1 on sender_identity being unset, never on business_name being populated", () => {
  const page = strip(read("app/onboarding/page.tsx"));
  assert.match(page, /const needsSenderIdentity = senderIdentity === null/);
  assert.equal(/needsSenderIdentity[\s\S]{0,60}businessName/.test(page), false,
    "the gate must not be derived from businessName at all");
});

test("[static] the choice starts unselected for a genuinely unconfigured account — no pre-selected radio", () => {
  const flow = strip(read("components/onboarding/OnboardingFlow.tsx"));
  // Seeded from initialSenderIdentity, which page.tsx only ever supplies as
  // null when needsSenderIdentity is true (that is the definition of
  // "needed") — so whenever step 1 is genuinely shown, this is null.
  assert.match(flow, /useState<"business" \| "personal" \| null>\(initialSenderIdentity\)/);
  // No unconditional `useState(...)("business")` or similar default exists.
  assert.equal(/useState<"business" \| "personal" \| null>\("business"\)/.test(flow), false);
  assert.equal(/useState<"business" \| "personal" \| null>\("personal"\)/.test(flow), false);
});

test("[static] Business selected shows and requires the business-name field; Personal shows and requires its own", () => {
  const flow = strip(read("components/onboarding/OnboardingFlow.tsx"));
  assert.match(flow, /senderIdentityChoice === "business" && \(/);
  assert.match(flow, /id="ob-business-name"/);
  assert.match(flow, /senderIdentityChoice === "personal" && \(/);
  assert.match(flow, /id="ob-personal-name"/);
  // Validation: cannot submit without a choice, and each choice validates
  // its OWN field only.
  assert.match(flow, /if \(!senderIdentityChoice\) \{/);
  assert.match(flow, /cleanBusinessName\(businessName\)/);
  assert.match(flow, /cleanPersonalName\(personalName\)/);
});

test("[static] onboarding never offers the account email as a sender-name option", () => {
  const flow = strip(read("components/onboarding/OnboardingFlow.tsx"));
  const step1 = flow.slice(flow.indexOf('step === 1 ? ('), flow.indexOf('step === 4 && added'));
  assert.equal(/value=\{email\}/.test(step1), false, "step 1 must not bind any input to the account email");
});

test("[static] an existing business_name does not silently choose Business — the choice and the name are separate props", () => {
  const page = strip(read("app/onboarding/page.tsx"));
  // businessName is passed as a PREFILL value only; senderIdentity (which
  // gates the step and seeds the choice) is read from a SEPARATE column.
  assert.match(page, /const senderIdentity = context\.kind === "ready" \? context\.senderIdentity : null/);
  assert.match(page, /initialSenderIdentity=\{senderIdentity\}/);
  assert.match(page, /initialBusinessName=\{businessName\}/);
});

test("[static] personal_name persists via the profile PUT, same call shape as business_name", () => {
  const flow = strip(read("components/onboarding/OnboardingFlow.tsx"));
  assert.match(flow, /body\.personal_name = cleaned\.value!/);
  assert.match(flow, /body\.business_name = cleaned\.value!/);
  assert.match(flow, /\{ sender_identity: senderIdentityChoice \}/);
});

// ── Settings: honest unset state, no email-fallback copy ───────────────────

test("[static] Settings never claims a resolved identity for an unconfigured account", () => {
  const page = strip(read("app/dashboard/settings/page.tsx"));
  const card = strip(read("components/dashboard/SettingsCard.tsx"));

  for (const source of [page, card]) {
    assert.equal(/Falls back to/.test(source), false, "the flagged fallback-to-email copy must be gone");
    assert.equal(/uses your address/.test(source), false, "the flagged 'emails use your address' copy must be gone");
    assert.equal(/Not set — emails use your address/.test(source), false);
  }

  assert.match(page, /resolveSenderIdentity\(\{/);
  assert.match(page, /"Not chosen yet"/);
  assert.match(card, /You haven&rsquo;t chosen how customers see you in reminders yet\./);
});

test("[static] Settings shows the Business/Personal control with a neutral, non-preselecting seed", () => {
  const card = strip(read("components/dashboard/SettingsCard.tsx"));
  assert.match(card, /useState<"business" \| "personal" \| null>\(profile\.sender_identity\)/,
    "seeded from the ALREADY-SAVED preference — null for a genuinely unset account, never a default");
  assert.match(card, /My business/);
  assert.match(card, /My name/);
});

test("[static] Settings save writes sender_identity together with the matching name, one call", () => {
  const card = strip(read("components/dashboard/SettingsCard.tsx"));
  assert.match(card, /sender_identity: "business" as const, business_name: businessName\.trim\(\)/);
  assert.match(card, /sender_identity: "personal" as const, personal_name: personalName\.trim\(\)/);
});

test("[static] Settings explains that changes do not rewrite already-sent reminders", () => {
  const card = strip(read("components/dashboard/SettingsCard.tsx"));
  assert.match(card, /already sent or waiting for your review keep the wording they were prepared with/);
});

// ── Profile API: validation rejects an unresolvable saved preference ───────

test("[static] PUT /api/profile rejects saving sender_identity: 'business' with a blank resulting business_name", () => {
  const code = strip(read("app/api/profile/route.ts"));
  assert.match(code, /if \(body\.sender_identity === "business" && !resultingBusinessName\?\.trim\(\)\)/);
  assert.match(code, /if \(body\.sender_identity === "personal" && !resultingPersonalName\?\.trim\(\)\)/);
  assert.match(code, /status: 400/);
});

test("[static] PUT /api/profile validates the RESULTING name, reading the existing stored value when this request doesn't supply one", () => {
  const code = strip(read("app/api/profile/route.ts"));
  assert.match(code, /needsExistingBusinessName/);
  assert.match(code, /needsExistingPersonalName/);
  assert.match(code, /select\("business_name, personal_name"\)/);
});

test("[static] PUT /api/profile rejects a sender_identity value outside the two-value vocabulary", () => {
  const code = strip(read("app/api/profile/route.ts"));
  assert.match(code, /VALID_SENDER_IDENTITIES[^=]*= \["business", "personal"\]/);
  assert.match(code, /VALID_SENDER_IDENTITIES\.includes\(body\.sender_identity\)/);
});

// ── Semantic regression: senderName vs business_name ────────────────────────

test("[static] the content-generation pipeline uses senderName, never a generic businessName field", () => {
  for (const file of ["lib/reminder-content.ts", "lib/email-templates.ts", "lib/reminder-sms.ts"]) {
    const code = strip(read(file));
    assert.equal(/businessName/.test(code), false, `${file} must use senderName, not businessName, for the resolved identity`);
    assert.match(code, /senderName/, `${file} must still reference senderName somewhere`);
  }
});

test("[static] Profile.business_name keeps its genuine, unrenamed meaning in the type layer", () => {
  const types = strip(read("types/index.ts"));
  assert.match(types, /business_name: string \| null;/, "the real business-name field must remain business_name");
  assert.match(types, /personal_name: string \| null;/);
  assert.match(types, /sender_identity: SenderIdentityPreference;/);
});
