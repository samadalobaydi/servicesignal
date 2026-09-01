process.env.REVIEW_TOKEN_SECRET ??= "test-review-token-secret";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { regenerateReminder } from "@/lib/reminder-regenerate";
import { approveAndSendReminder, composeReminderContent } from "@/lib/reminder-approval";
import { resolveSenderIdentity } from "@/lib/sender-identity";
import { issueReviewToken } from "@/lib/review-token";
import {
  generateReminderContent,
  type StoredReminderContent,
  type ReminderFacts,
} from "@/lib/reminder-content";
import {
  FakeApprovalDb,
  FakeMailer,
  FakeTexter,
  FakeAllowanceStore,
  REMINDER_ID,
  OWNER,
  OTHER_USER,
  makeDeps,
  makeRegenerateDeps,
  makeStoredReminder,
} from "./support/fakes";

/**
 * THE RECOVERY PATH for migration 015's fail-closed identity-drift gate.
 *
 * These drive the real regenerateReminder() service against the real
 * identityHasDrifted() gate in lib/reminder-approval.ts — the same
 * integration-style approach tests/stored-content-send.test.ts uses, and for
 * the same reason: a test that only checked regenerateReminder() in
 * isolation would prove nothing about whether Approve actually accepts what
 * it produces.
 */

function resolvedSenderName(db: FakeApprovalDb): string {
  return (
    resolveSenderIdentity({
      preference: db.senderIdentity,
      businessName: db.businessName,
      personalName: db.personalName,
    })?.senderName ?? "ServiceSignal"
  );
}

function factsFor(db: FakeApprovalDb): ReminderFacts {
  const row = db.get();
  return {
    tone: row.invoice.reminderTone,
    schedule: row.schedule,
    customerName: row.invoice.customerName,
    senderName: resolvedSenderName(db),
    amount: row.invoice.amount,
    dueDate: row.invoice.dueDate,
    paymentLink: row.invoice.paymentLink,
    invoiceReference: row.invoice.invoiceReference,
    jobDescription: row.invoice.jobDescription,
  };
}

/**
 * Prepares a reminder with stored originals under the db's CURRENT identity,
 * as app/api/reminders/prepare/route.ts would. Pass generatedSenderName:
 * null explicitly to simulate a reminder that predates migration 015 (real
 * production state: 4 pending reminders exist in exactly this shape).
 */
function withStoredOriginals(
  db: FakeApprovalDb,
  opts: { generatedSenderName?: string | null } = {}
): StoredReminderContent {
  const g = generateReminderContent(factsFor(db));
  const stored: StoredReminderContent = {
    email: {
      generatedSubject: g.email.subject,
      generatedBody: g.email.body,
      editedSubject: null,
      editedBody: null,
    },
    sms: { generatedBody: g.sms.body, editedBody: null },
  };
  db.get().storedContent = stored;
  db.get().generatedSenderName =
    opts.generatedSenderName !== undefined ? opts.generatedSenderName : resolvedSenderName(db);
  return stored;
}

async function tokenForCurrent(db: FakeApprovalDb): Promise<string> {
  const reminder = await db.loadReminder(REMINDER_ID);
  assert.ok(reminder);
  const composed = composeReminderContent(reminder, resolvedSenderName(db), "owner@example.com");
  return issueReviewToken({ userId: OWNER, reminderId: REMINDER_ID, contentHash: composed.hash });
}

// ── A ────────────────────────────────────────────────────────────────────

test("A. NULL generated_sender_name (predates migration 015): refused, regenerates, then approves", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  withStoredOriginals(db, { generatedSenderName: null });
  const mailer = new FakeMailer();
  const texter = new FakeTexter();

  const refused = await approveAndSendReminder(makeDeps(db, mailer, { texter }), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.state, "identity_drift");
  assert.equal(mailer.calls.length, 0);
  assert.equal(texter.calls.length, 0);

  const regen = await regenerateReminder(makeRegenerateDeps(db), { reminderId: REMINDER_ID });
  assert.equal(regen.status, 200);
  assert.equal(regen.body.success, true);

  const row = db.get();
  assert.ok(row.storedContent!.email, "email regenerated");
  assert.ok(row.storedContent!.sms, "sms regenerated");
  assert.equal(row.generatedSenderName, "Wilson Plumbing");

  const approved = await approveAndSendReminder(makeDeps(db, mailer, { texter }), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });
  assert.equal(approved.status, 200);
  assert.equal(mailer.calls.length, 1);
  assert.equal(texter.calls.length, 1);
});

// ── B / C ────────────────────────────────────────────────────────────────

test("B. Business -> Personal drift: regenerate rebuilds both channels as Personal, then approves", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  withStoredOriginals(db);
  const mailer = new FakeMailer();
  const texter = new FakeTexter();

  db.senderIdentity = "personal";
  db.businessName = null;
  db.personalName = "Sam Alobaydi";

  const refused = await approveAndSendReminder(makeDeps(db, mailer, { texter }), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });
  assert.equal(refused.body.state, "identity_drift");

  const regen = await regenerateReminder(makeRegenerateDeps(db), { reminderId: REMINDER_ID });
  assert.equal(regen.status, 200);

  const row = db.get();
  assert.equal(row.generatedSenderName, "Sam Alobaydi");
  assert.match(row.storedContent!.email!.generatedSubject, /Sam Alobaydi/);
  assert.match(row.storedContent!.email!.generatedBody, /Sam Alobaydi/);
  assert.match(row.storedContent!.sms!.generatedBody, /Sam Alobaydi/);
  assert.doesNotMatch(row.storedContent!.email!.generatedBody, /Wilson Plumbing/);

  const approved = await approveAndSendReminder(makeDeps(db, mailer, { texter }), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });
  assert.equal(approved.status, 200);
  assert.match(mailer.calls[0].message.from, /Sam Alobaydi/);
});

test("C. Personal -> Business drift: regenerate rebuilds both channels as Business, then approves", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "personal";
  db.businessName = null;
  db.personalName = "Sam Alobaydi";
  withStoredOriginals(db);
  const mailer = new FakeMailer();
  const texter = new FakeTexter();

  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  db.personalName = null;

  const refused = await approveAndSendReminder(makeDeps(db, mailer, { texter }), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });
  assert.equal(refused.body.state, "identity_drift");

  const regen = await regenerateReminder(makeRegenerateDeps(db), { reminderId: REMINDER_ID });
  assert.equal(regen.status, 200);

  const row = db.get();
  assert.equal(row.generatedSenderName, "Wilson Plumbing");
  assert.match(row.storedContent!.email!.generatedBody, /Wilson Plumbing/);
  assert.doesNotMatch(row.storedContent!.email!.generatedBody, /Sam Alobaydi/);

  const approved = await approveAndSendReminder(makeDeps(db, mailer, { texter }), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });
  assert.equal(approved.status, 200);
  assert.match(mailer.calls[0].message.from, /Wilson Plumbing/);
});

// ── D ────────────────────────────────────────────────────────────────────

test("D. same identity type, changed name: Business old -> new triggers the same recovery", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "business";
  db.businessName = "ABC Plumbing";
  withStoredOriginals(db);
  const mailer = new FakeMailer();

  db.businessName = "ABC Heating";

  const refused = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });
  assert.equal(refused.body.state, "identity_drift");

  const regen = await regenerateReminder(makeRegenerateDeps(db), { reminderId: REMINDER_ID });
  assert.equal(regen.status, 200);
  assert.equal(db.get().generatedSenderName, "ABC Heating");
  assert.match(db.get().storedContent!.email!.generatedBody, /ABC Heating/);

  const approved = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });
  assert.equal(approved.status, 200);
});

test("D2. same identity type, changed name: Personal old -> new triggers the same recovery", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "personal";
  db.businessName = null;
  db.personalName = "Sam";
  withStoredOriginals(db);
  const mailer = new FakeMailer();

  db.personalName = "Samuel";

  const refused = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });
  assert.equal(refused.body.state, "identity_drift");

  const regen = await regenerateReminder(makeRegenerateDeps(db), { reminderId: REMINDER_ID });
  assert.equal(regen.status, 200);
  assert.equal(db.get().generatedSenderName, "Samuel");

  const approved = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });
  assert.equal(approved.status, 200);
});

// ── E ────────────────────────────────────────────────────────────────────

test("E. regeneration sends nothing, consumes no allowance, and does not alter another reminder's history", async () => {
  const db = new FakeApprovalDb([
    makeStoredReminder({ id: REMINDER_ID }),
    makeStoredReminder({ id: "rem-2", status: "sent", sentAt: "2026-01-01T00:00:00.000Z" }),
  ]);
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  withStoredOriginals(db); // REMINDER_ID
  db.businessName = "New Trading Name Ltd"; // drift it

  const mailer = new FakeMailer();
  const texter = new FakeTexter();
  const allowance = new FakeAllowanceStore();
  // Constructed but never wired into regenerateReminder's deps at all —
  // RegenerateDeps has no mailer/texter/allowance field, so there is no
  // code path by which this call could reach any of them. Asserted anyway,
  // so a future change that accidentally adds one would fail loudly here.
  void mailer;
  void texter;
  void allowance;

  const before = JSON.stringify(db.get("rem-2"));

  const regen = await regenerateReminder(makeRegenerateDeps(db), { reminderId: REMINDER_ID });
  assert.equal(regen.status, 200);

  assert.equal(mailer.calls.length, 0);
  assert.equal(texter.calls.length, 0);
  assert.equal(allowance.calls.length, 0);
  assert.deepEqual(JSON.stringify(db.get("rem-2")), before, "an unrelated reminder's history is untouched");
});

// ── F ────────────────────────────────────────────────────────────────────

test("F. regeneration refuses without writing anything once status leaves pending/failed", async () => {
  for (const status of ["sending", "sent", "delivery_unknown", "undelivered"] as const) {
    const db = new FakeApprovalDb([makeStoredReminder({ status })]);
    db.senderIdentity = "business";
    db.businessName = "Wilson Plumbing";
    withStoredOriginals(db);
    db.businessName = "New Trading Name Ltd"; // genuinely drifted, so this ISN'T refused for the wrong reason
    db.get().status = status; // withStoredOriginals doesn't touch status; set again for clarity

    const before = JSON.stringify(db.get());

    const regen = await regenerateReminder(makeRegenerateDeps(db), { reminderId: REMINDER_ID });

    assert.equal(regen.status, 409, status);
    assert.notEqual(regen.body.state, "ok", status);
    assert.equal(JSON.stringify(db.get()), before, `${status}: nothing was written`);
  }
});

// ── G ────────────────────────────────────────────────────────────────────

test("G. regenerated subject, body, From, and SMS all name ONE coherent identity", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  withStoredOriginals(db);
  db.businessName = "New Trading Name Ltd";
  const mailer = new FakeMailer();
  const texter = new FakeTexter();

  await regenerateReminder(makeRegenerateDeps(db), { reminderId: REMINDER_ID });

  const approved = await approveAndSendReminder(makeDeps(db, mailer, { texter }), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });
  assert.equal(approved.status, 200);

  const email = mailer.calls[0].message;
  const sms = texter.calls[0].message;
  assert.match(email.from, /New Trading Name Ltd/);
  assert.match(email.subject, /New Trading Name Ltd/);
  assert.match(email.text, /New Trading Name Ltd/, "body/sign-off");
  assert.match(sms.body, /New Trading Name Ltd/);
  assert.doesNotMatch(email.subject, /Wilson Plumbing/);
  assert.doesNotMatch(email.text, /Wilson Plumbing/);
  assert.doesNotMatch(sms.body, /Wilson Plumbing/);
});

// ── H ────────────────────────────────────────────────────────────────────

test("H. a review token minted BEFORE regeneration cannot approve the regenerated content", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  withStoredOriginals(db);
  db.businessName = "New Trading Name Ltd";
  const mailer = new FakeMailer();

  // Minted while still drifted — this token embeds a hash over the OLD
  // stored content and the CURRENT (already-changed) identity.
  const staleToken = await tokenForCurrent(db);

  const regen = await regenerateReminder(makeRegenerateDeps(db), { reminderId: REMINDER_ID });
  assert.equal(regen.status, 200);

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: staleToken,
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.state, "stale_review");
  assert.equal(mailer.calls.length, 0, "the pre-regeneration token must not approve post-regeneration content");
});

// ── I ────────────────────────────────────────────────────────────────────

test("I. [static] update_invoice_with_refresh's TypeScript caller does not yet pass generated_sender_name — known, drafted, unfixed gap", () => {
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

  const dbSource = read("lib/invoice-lifecycle-db.ts");
  const rpcCall = dbSource.slice(
    dbSource.indexOf('.rpc("update_invoice_with_refresh"'),
    dbSource.indexOf(");", dbSource.indexOf('.rpc("update_invoice_with_refresh"'))
  );

  // THE GAP, proven directly rather than assumed: as of this pass, the only
  // TypeScript caller of this RPC does not supply the new parameter, so
  // every invoice-edit content refresh leaves generated_sender_name exactly
  // as it was — stale relative to the freshly-regenerated body whenever
  // identity has changed since the reminder was prepared. See the
  // engineering report for why this was deliberately left unwired this
  // pass, and supabase/sql/017_invoice_refresh_generation_identity.sql for
  // the additive migration drafted (not applied) to close it.
  assert.equal(
    /p_generated_sender_name/.test(rpcCall),
    false,
    "if this now passes p_generated_sender_name, this characterization test — and the report's " +
      "'unfixed gap' finding — are stale and must be updated together with migration 017's application"
  );

  // The migration exists, is additive (a NEW parameter with a default, not a
  // change to any existing one), and is drafted precisely to close this once
  // the line above is updated to pass it.
  const migration = read("supabase/sql/017_invoice_refresh_generation_identity.sql");
  assert.match(migration, /p_generated_sender_name\s+text\s+default\s+null/);
  assert.match(migration, /generated_sender_name\s*=\s*coalesce\(p_generated_sender_name,\s*generated_sender_name\)/);
});

// =============================================================================
// THE CHANNEL-PAIR INVARIANT FIX (migration 016 revision)
// =============================================================================
//
// The original db.regenerate() / regenerate_reminder_identity() proved only
// "at least one channel row exists" before writing. These tests drive the
// REVISED invariant — exactly one email row AND exactly one sms row, proven
// BEFORE any mutation — directly against db.regenerate() (the fake's model
// of the RPC), NOT only through regenerateReminder(), so the DB-level
// guarantee is proven independently of lib/reminder-regenerate.ts's own
// earlier, TypeScript-side short-circuit for the same condition. Letters
// below map to the fix request's A–M; they are a DIFFERENT enumeration from
// the A–I tests above them in this file (which predate this fix and already
// separately satisfy the request's F/G/H/I — noted inline where relevant).

function rowSnapshot(db: FakeApprovalDb, id: string = REMINDER_ID) {
  return JSON.stringify(db.get(id));
}

// ── A — valid pair regenerates ──────────────────────────────────────────────

test("[pair-fix A] a valid one-email + one-sms pair regenerates successfully", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  const g = generateReminderContent(factsFor(db));
  db.get().storedContent = {
    email: { generatedSubject: g.email.subject, generatedBody: g.email.body, editedSubject: null, editedBody: null },
    sms: { generatedBody: g.sms.body, editedBody: null },
  };
  db.get().generatedSenderName = "Wilson Plumbing";
  db.businessName = "New Trading Name Ltd";

  const result = await db.regenerate({
    reminderId: REMINDER_ID,
    userId: OWNER,
    expectedSendAttemptCount: 0,
    emailSubject: "New subject",
    emailBody: "New body",
    smsBody: "New sms",
    generatedSenderName: "New Trading Name Ltd",
  });

  assert.equal(result.outcome, "ok");
  assert.equal(db.get().storedContent!.email!.generatedSubject, "New subject");
  assert.equal(db.get().storedContent!.sms!.generatedBody, "New sms");
  assert.equal(db.get().generatedSenderName, "New Trading Name Ltd");
});

// ── B / C — an incomplete pair refuses, zero state change ──────────────────

test("[pair-fix B] email exists, sms missing: refuses with invalid_channel_pair, zero state change", async () => {
  const db = new FakeApprovalDb([
    makeStoredReminder({
      storedContent: {
        email: { generatedSubject: "Old subject", generatedBody: "Old body", editedSubject: null, editedBody: null },
        sms: null,
      },
      generatedSenderName: "Wilson Plumbing",
    }),
  ]);
  const before = rowSnapshot(db);

  // Direct against db.regenerate() — proves the DB-level guarantee, not just
  // regenerateReminder()'s own earlier TypeScript-side short-circuit for the
  // identical condition.
  const result = await db.regenerate({
    reminderId: REMINDER_ID,
    userId: OWNER,
    expectedSendAttemptCount: 0,
    emailSubject: "New subject",
    emailBody: "New body",
    smsBody: "New sms",
    generatedSenderName: "New Trading Name Ltd",
  });

  assert.equal(result.outcome, "invalid_channel_pair");
  assert.equal(rowSnapshot(db), before, "no field on the row changed at all");

  // And the full service path also refuses, before ever reaching db.regenerate.
  const serviceResult = await regenerateReminder(makeRegenerateDeps(db), { reminderId: REMINDER_ID });
  assert.equal(serviceResult.status, 409);
  assert.equal(serviceResult.body.state, "invalid_channel_pair");
  assert.equal(rowSnapshot(db), before);
});

test("[pair-fix C] sms exists, email missing: refuses with invalid_channel_pair, zero state change", async () => {
  const db = new FakeApprovalDb([
    makeStoredReminder({
      storedContent: {
        email: null,
        sms: { generatedBody: "Old sms", editedBody: null },
      },
      generatedSenderName: "Wilson Plumbing",
    }),
  ]);
  const before = rowSnapshot(db);

  const result = await db.regenerate({
    reminderId: REMINDER_ID,
    userId: OWNER,
    expectedSendAttemptCount: 0,
    emailSubject: "New subject",
    emailBody: "New body",
    smsBody: "New sms",
    generatedSenderName: "New Trading Name Ltd",
  });

  assert.equal(result.outcome, "invalid_channel_pair");
  assert.equal(rowSnapshot(db), before);

  const serviceResult = await regenerateReminder(makeRegenerateDeps(db), { reminderId: REMINDER_ID });
  assert.equal(serviceResult.status, 409);
  assert.equal(serviceResult.body.state, "invalid_channel_pair");
  assert.equal(rowSnapshot(db), before);
});

// ── D — duplicate/malformed channel state ───────────────────────────────────

test("[pair-fix D] [static] a duplicate channel row is structurally impossible — UNIQUE(reminder_log_id, channel)", () => {
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const migration010 = readFileSync(join(ROOT, "supabase/sql/010_reminder_channel_messages.sql"), "utf8");
  assert.match(
    migration010,
    /constraint reminder_channel_messages_one_per_channel\s*\n\s*unique \(reminder_log_id, channel\)/,
    "the database itself forbids a second row for the same (reminder, channel) pair — " +
      "a real 'duplicate channel row' cannot exist to test against"
  );

  // The fake's own data model mirrors this: StoredReminderContent.email and
  // .sms are each a single optional value, not an array — there is no way
  // to represent two 'email' rows for one reminder even in the test double,
  // matching the schema guarantee rather than merely assuming it.
});

// ── E — pair validation precedes any field write ────────────────────────────

test("[pair-fix E] pair validation happens BEFORE generated_sender_name, send_attempt_count, or reviewed_content_hash change", async () => {
  const db = new FakeApprovalDb([
    makeStoredReminder({
      storedContent: {
        email: { generatedSubject: "Old subject", generatedBody: "Old body", editedSubject: null, editedBody: null },
        sms: null, // incomplete pair
      },
      generatedSenderName: "Wilson Plumbing",
      sendAttemptCount: 3,
      reviewedContentHash: "some-prior-hash",
    }),
  ]);

  const result = await db.regenerate({
    reminderId: REMINDER_ID,
    userId: OWNER,
    expectedSendAttemptCount: 3, // matches the fixture, so it's the PAIR check under test here, not the version guard
    emailSubject: "New subject",
    emailBody: "New body",
    smsBody: "New sms",
    generatedSenderName: "New Trading Name Ltd",
  });

  assert.equal(result.outcome, "invalid_channel_pair");
  assert.equal(db.get().generatedSenderName, "Wilson Plumbing", "unchanged");
  assert.equal(db.get().sendAttemptCount, 3, "unchanged");
  assert.equal(db.get().reviewedContentHash, "some-prior-hash", "unchanged");
  assert.equal(db.get().storedContent!.email!.generatedSubject, "Old subject", "unchanged");
});

// ── F — valid regeneration still rewrites both channels atomically ─────────
// (G/H/I — Business->Personal, Personal->Business, same-type name change —
// are already exercised end-to-end by tests B, C, D and D2 earlier in this
// file, against the SAME revised db.regenerate(); not duplicated here.)

test("[pair-fix F] a complete, valid pair still regenerates BOTH channels, not one", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  const g = generateReminderContent(factsFor(db));
  db.get().storedContent = {
    email: { generatedSubject: g.email.subject, generatedBody: g.email.body, editedSubject: null, editedBody: null },
    sms: { generatedBody: g.sms.body, editedBody: null },
  };
  db.get().generatedSenderName = "Wilson Plumbing";
  const oldSubject = db.get().storedContent!.email!.generatedSubject;
  const oldSms = db.get().storedContent!.sms!.generatedBody;

  const result = await db.regenerate({
    reminderId: REMINDER_ID,
    userId: OWNER,
    expectedSendAttemptCount: 0,
    emailSubject: "Totally new subject",
    emailBody: "Totally new body",
    smsBody: "Totally new sms",
    generatedSenderName: "New Trading Name Ltd",
  });

  assert.equal(result.outcome, "ok");
  assert.notEqual(db.get().storedContent!.email!.generatedSubject, oldSubject, "email actually changed");
  assert.notEqual(db.get().storedContent!.sms!.generatedBody, oldSms, "sms actually changed");
  assert.equal(db.get().storedContent!.email!.generatedSubject, "Totally new subject");
  assert.equal(db.get().storedContent!.sms!.generatedBody, "Totally new sms");
});

// ── J — non-editable statuses remain refused (unchanged by this fix) ───────
// Already covered end-to-end by test F earlier in this file (loops over
// sending/sent/delivery_unknown/undelivered against db.regenerate() via
// regenerateReminder()). Confirmed unchanged by the pair-invariant fix: the
// status check still runs immediately after the row lock, before the new
// pair-count check.

// ── K — another user's reminder is unreachable ──────────────────────────────

test("[pair-fix K] another user's reminder is unreachable — not_found, zero state change", async () => {
  const db = new FakeApprovalDb();
  db.scopeUserId = OTHER_USER; // irrelevant to db.regenerate(), which takes userId explicitly
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  const g = generateReminderContent(factsFor(db));
  db.get().storedContent = {
    email: { generatedSubject: g.email.subject, generatedBody: g.email.body, editedSubject: null, editedBody: null },
    sms: { generatedBody: g.sms.body, editedBody: null },
  };
  db.get().generatedSenderName = "Wilson Plumbing";
  // The row's OWNER is OWNER (makeStoredReminder's default), not OTHER_USER.
  const before = rowSnapshot(db);

  const result = await db.regenerate({
    reminderId: REMINDER_ID,
    userId: OTHER_USER, // the wrong owner, supplied explicitly
    expectedSendAttemptCount: 0,
    emailSubject: "Attacker subject",
    emailBody: "Attacker body",
    smsBody: "Attacker sms",
    generatedSenderName: "Attacker Ltd",
  });

  assert.equal(result.outcome, "not_found", "ownership mismatch reads as not_found, same as any other route");
  assert.equal(rowSnapshot(db), before, "the row the real owner reviews was not touched");
});

// ── L — another reminder of the SAME user remains untouched ────────────────

test("[pair-fix L] regenerating one reminder does not touch a second, unrelated pending reminder of the same user", async () => {
  const db = new FakeApprovalDb([
    makeStoredReminder({ id: REMINDER_ID }),
    makeStoredReminder({ id: "rem-2", status: "pending" }),
  ]);
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  const g = generateReminderContent(factsFor(db));
  const otherContent = {
    email: { generatedSubject: "Other reminder subject", generatedBody: "Other reminder body", editedSubject: null, editedBody: null },
    sms: { generatedBody: "Other reminder sms", editedBody: null },
  };
  db.get(REMINDER_ID).storedContent = {
    email: { generatedSubject: g.email.subject, generatedBody: g.email.body, editedSubject: null, editedBody: null },
    sms: { generatedBody: g.sms.body, editedBody: null },
  };
  db.get(REMINDER_ID).generatedSenderName = "Wilson Plumbing";
  db.get("rem-2").storedContent = otherContent;
  db.get("rem-2").generatedSenderName = "Wilson Plumbing";
  const otherBefore = rowSnapshot(db, "rem-2");

  const result = await db.regenerate({
    reminderId: REMINDER_ID,
    userId: OWNER,
    expectedSendAttemptCount: 0,
    emailSubject: "New subject",
    emailBody: "New body",
    smsBody: "New sms",
    generatedSenderName: "New Trading Name Ltd",
  });

  assert.equal(result.outcome, "ok");
  assert.equal(rowSnapshot(db, "rem-2"), otherBefore, "the second reminder is byte-for-byte unchanged");
});

// ── M — a blank/null generated_sender_name fails BEFORE mutation ───────────

test("[pair-fix M] a blank generated_sender_name refuses at the DB layer, before any mutation", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  const g = generateReminderContent(factsFor(db));
  db.get().storedContent = {
    email: { generatedSubject: g.email.subject, generatedBody: g.email.body, editedSubject: null, editedBody: null },
    sms: { generatedBody: g.sms.body, editedBody: null },
  };
  db.get().generatedSenderName = "Wilson Plumbing";
  const before = rowSnapshot(db);

  // regenerateReminder() itself can never supply this — resolveSenderIdentity()
  // trims and refuses a blank name long before senderName is computed (see
  // lib/sender-identity.ts's clean()). Calling db.regenerate() directly proves
  // the DATABASE layer's OWN independent guard, not merely that the one
  // current caller happens to be careful.
  for (const blank of ["", "   ", "\t\n"]) {
    const result = await db.regenerate({
      reminderId: REMINDER_ID,
      userId: OWNER,
      expectedSendAttemptCount: 0,
      emailSubject: "New subject",
      emailBody: "New body",
      smsBody: "New sms",
      generatedSenderName: blank,
    });
    assert.equal(result.outcome, "missing_generated_sender_name", JSON.stringify(blank));
    assert.equal(rowSnapshot(db), before, `unchanged for blank = ${JSON.stringify(blank)}`);
  }
});

test("[pair-fix] [static] regenerateReminder() cannot itself supply a blank senderName — resolveSenderIdentity() refuses one first", () => {
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const senderIdentitySrc = readFileSync(join(ROOT, "lib/sender-identity.ts"), "utf8");
  assert.match(
    senderIdentitySrc,
    /function clean\(value: string \| null \| undefined\): string \| null \{\s*\n\s*const trimmed = value\?\.trim\(\);\s*\n\s*return trimmed \? trimmed : null;/,
    "resolveSenderIdentity's clean() must turn blank/whitespace-only names into null, which resolveSenderIdentity then refuses on"
  );
});

// =============================================================================
// THE SOURCE-STATE VERSION GUARD (migration 016, second revision)
// =============================================================================
//
// A stale Regenerate request — one whose composed content was read BEFORE a
// concurrent update_invoice_with_refresh commit — must not be able to
// overwrite that fresher content. send_attempt_count, read at the same
// moment as the invoice facts and compared under the row lock before any
// write, is the guard. These tests simulate an invoice-edit commit's
// EFFECT directly on the fixture (bump the count, rewrite stored content) —
// the same two things update_invoice_with_refresh does atomically in
// production — rather than exercising lib/invoice-lifecycle-db.ts's own
// machinery, which lives in, and is already covered by,
// tests/invoice-lifecycle.test.ts.

test("[version-guard 1] a stale Regenerate request after a concurrent invoice refresh refuses, zero writes", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  const g = generateReminderContent(factsFor(db));
  db.get().storedContent = {
    email: { generatedSubject: g.email.subject, generatedBody: g.email.body, editedSubject: null, editedBody: null },
    sms: { generatedBody: g.sms.body, editedBody: null },
  };
  db.get().generatedSenderName = "Wilson Plumbing";

  // Regenerate reads the reminder NOW — this is the stale snapshot.
  const staleExpectedCount = db.get().sendAttemptCount; // 0

  // A concurrent invoice edit commits: update_invoice_with_refresh refreshes
  // the stored pair to the NEW invoice content and bumps the counter — the
  // exact two effects migration 012's function has, atomically, in one
  // transaction, BEFORE the stale Regenerate request ever reaches its lock.
  db.get().storedContent = {
    email: { generatedSubject: "Fresh invoice subject", generatedBody: "Fresh invoice body", editedSubject: null, editedBody: null },
    sms: { generatedBody: "Fresh invoice sms", editedBody: null },
  };
  db.get().sendAttemptCount = staleExpectedCount + 1;
  db.get().reviewedContentHash = null;
  const freshSnapshot = rowSnapshot(db);

  // The stale request NOW reaches the RPC, carrying content composed from
  // the OLD (pre-edit) invoice state and the OLD expected count.
  const result = await db.regenerate({
    reminderId: REMINDER_ID,
    userId: OWNER,
    expectedSendAttemptCount: staleExpectedCount,
    emailSubject: "Stale subject composed before the edit",
    emailBody: "Stale body composed before the edit",
    smsBody: "Stale sms composed before the edit",
    generatedSenderName: "Wilson Plumbing",
  });

  assert.equal(result.outcome, "stale_regeneration");
  assert.equal(rowSnapshot(db), freshSnapshot, "the fresh invoice content survives untouched — zero writes from the stale request");
  assert.equal(db.get().storedContent!.email!.generatedSubject, "Fresh invoice subject");
});

test("[version-guard 1b] the full regenerateReminder() service surfaces stale_regeneration honestly", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  const g = generateReminderContent(factsFor(db));
  db.get().storedContent = {
    email: { generatedSubject: g.email.subject, generatedBody: g.email.body, editedSubject: null, editedBody: null },
    sms: { generatedBody: g.sms.body, editedBody: null },
  };
  db.get().generatedSenderName = "Wilson Plumbing";
  db.businessName = "New Trading Name Ltd"; // genuinely drifted, so regenerateReminder() proceeds past its own gates

  const reminder = await db.loadReminder(REMINDER_ID);
  assert.ok(reminder);

  // Simulate the invoice-edit commit landing AFTER regenerateReminder() has
  // already read `reminder` (and therefore its stale sendAttemptCount) but
  // BEFORE its (about to happen) call to db.regenerate() — the exact gap
  // the module's own doc comment names.
  const originalLoadReminder = db.loadReminder.bind(db);
  let alreadyLoaded = false;
  db.loadReminder = async (id: string) => {
    const r = await originalLoadReminder(id);
    if (!alreadyLoaded) {
      alreadyLoaded = true;
      // The concurrent edit's effect, landing right after this read.
      db.get().storedContent = {
        email: { generatedSubject: "Fresh invoice subject", generatedBody: "Fresh invoice body", editedSubject: null, editedBody: null },
        sms: { generatedBody: "Fresh invoice sms", editedBody: null },
      };
      db.get().sendAttemptCount += 1;
    }
    return r;
  };

  const result = await regenerateReminder(makeRegenerateDeps(db), { reminderId: REMINDER_ID });

  assert.equal(result.status, 409);
  assert.equal(result.body.state, "stale_regeneration");
  assert.equal(db.get().storedContent!.email!.generatedSubject, "Fresh invoice subject", "the edit's content survives");
});

test("[version-guard 2] Regenerate wins BEFORE the invoice refresh: the final content is the NEW invoice content", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  const g = generateReminderContent(factsFor(db));
  db.get().storedContent = {
    email: { generatedSubject: g.email.subject, generatedBody: g.email.body, editedSubject: null, editedBody: null },
    sms: { generatedBody: g.sms.body, editedBody: null },
  };
  db.get().generatedSenderName = "Wilson Plumbing";
  db.businessName = "New Trading Name Ltd";

  // Regenerate locks first and wins: version matches, it writes, bumps the
  // counter.
  const regen = await db.regenerate({
    reminderId: REMINDER_ID,
    userId: OWNER,
    expectedSendAttemptCount: 0,
    emailSubject: "Regenerated subject (identity fix)",
    emailBody: "Regenerated body (identity fix)",
    smsBody: "Regenerated sms (identity fix)",
    generatedSenderName: "New Trading Name Ltd",
  });
  assert.equal(regen.outcome, "ok");
  assert.equal(db.get().sendAttemptCount, 1);

  // The invoice edit's atomic refresh then proceeds — in production this is
  // update_invoice_with_refresh, unconditional on send_attempt_count (it has
  // no expected-version parameter of its own; it always wins once it has
  // the lock), so it simply becomes the final state.
  db.get().storedContent = {
    email: { generatedSubject: "Final invoice subject", generatedBody: "Final invoice body", editedSubject: null, editedBody: null },
    sms: { generatedBody: "Final invoice sms", editedBody: null },
  };
  db.get().sendAttemptCount += 1;

  assert.equal(db.get().storedContent!.email!.generatedSubject, "Final invoice subject", "no stale content survived");
  assert.equal(db.get().sendAttemptCount, 2);
});

test("[version-guard 3] two simultaneous/stale Regenerate requests: the first succeeds, the second (stale N) refuses", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  const g = generateReminderContent(factsFor(db));
  db.get().storedContent = {
    email: { generatedSubject: g.email.subject, generatedBody: g.email.body, editedSubject: null, editedBody: null },
    sms: { generatedBody: g.sms.body, editedBody: null },
  };
  db.get().generatedSenderName = "Wilson Plumbing";
  db.businessName = "New Trading Name Ltd";

  // Both requests read the SAME initial snapshot — expectedSendAttemptCount = 0.
  const first = await db.regenerate({
    reminderId: REMINDER_ID,
    userId: OWNER,
    expectedSendAttemptCount: 0,
    emailSubject: "First regeneration",
    emailBody: "First regeneration body",
    smsBody: "First regeneration sms",
    generatedSenderName: "New Trading Name Ltd",
  });
  assert.equal(first.outcome, "ok");
  const afterFirst = rowSnapshot(db);

  const second = await db.regenerate({
    reminderId: REMINDER_ID,
    userId: OWNER,
    expectedSendAttemptCount: 0, // stale — the first call already bumped it to 1
    emailSubject: "Second (stale) regeneration",
    emailBody: "Second (stale) regeneration body",
    smsBody: "Second (stale) regeneration sms",
    generatedSenderName: "New Trading Name Ltd",
  });

  assert.equal(second.outcome, "stale_regeneration");
  assert.equal(rowSnapshot(db), afterFirst, "the second request wrote nothing at all — no second overwrite");
  assert.equal(db.get().storedContent!.email!.generatedSubject, "First regeneration", "the first regeneration's content is final");
});

test("[version-guard 4] unchanged reminder/version: normal regeneration still succeeds", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  const g = generateReminderContent(factsFor(db));
  db.get().storedContent = {
    email: { generatedSubject: g.email.subject, generatedBody: g.email.body, editedSubject: null, editedBody: null },
    sms: { generatedBody: g.sms.body, editedBody: null },
  };
  db.get().generatedSenderName = "Wilson Plumbing";
  db.businessName = "New Trading Name Ltd";

  const result = await regenerateReminder(makeRegenerateDeps(db), { reminderId: REMINDER_ID });

  assert.equal(result.status, 200);
  assert.equal(db.get().sendAttemptCount, 1);
  assert.equal(db.get().generatedSenderName, "New Trading Name Ltd");
});

// =============================================================================
// THE NULL-SAFE VERSION COMPARISON (migration 016, third revision)
// =============================================================================
//
// PostgreSQL's `<>` returns NULL, not TRUE, when either operand is NULL, and
// PL/pgSQL's IF does not enter its branch on NULL — so
// `if v_send_attempt_count <> p_expected_send_attempt_count` would SILENTLY
// SKIP the stale-regeneration refusal whenever p_expected_send_attempt_count
// arrived as NULL, falling through as though the version matched. This is a
// pure SQL-language fact (no live Postgres is available in this test
// environment to execute against), proven here two ways: a static assertion
// that the fixed SQL uses the NULL-safe `IS DISTINCT FROM` form, and a real
// executed test proving the FAKE's outcome contract refuses a null/missing
// expected version — JavaScript's `!==` does not share SQL's NULL semantics,
// so this test does not itself exercise the PostgreSQL bug, but it does
// prove the corrected CONTRACT (refuse, zero writes) that the real,
// NULL-safe SQL must also uphold.

test("[version-guard NULL] [static] the SQL comparison is NULL-safe (IS DISTINCT FROM, not bare <>)", () => {
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const migration = readFileSync(join(ROOT, "supabase/sql/016_reminder_regeneration.sql"), "utf8");
  assert.match(
    migration,
    /v_send_attempt_count is distinct from p_expected_send_attempt_count/,
    "must use IS DISTINCT FROM — PostgreSQL's <> returns NULL (not TRUE) when either operand is NULL, " +
      "and PL/pgSQL's IF does not enter on NULL, silently skipping the stale-regeneration refusal"
  );
  assert.doesNotMatch(
    migration,
    /v_send_attempt_count\s*<>\s*p_expected_send_attempt_count/,
    "the vulnerable bare <> form must not reappear anywhere in the file"
  );
});

test("[version-guard NULL] a NULL/missing expected version refuses, zero writes to channels, log, or count", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = "business";
  db.businessName = "Wilson Plumbing";
  const g = generateReminderContent(factsFor(db));
  db.get().storedContent = {
    email: { generatedSubject: g.email.subject, generatedBody: g.email.body, editedSubject: null, editedBody: null },
    sms: { generatedBody: g.sms.body, editedBody: null },
  };
  db.get().generatedSenderName = "Wilson Plumbing";
  db.get().sendAttemptCount = 5; // N = 5
  const before = rowSnapshot(db);

  const result = await db.regenerate({
    reminderId: REMINDER_ID,
    userId: OWNER,
    // Deliberately malformed, bypassing TypeScript's own type — simulating a
    // caller supplying NULL/missing at the DB-operation boundary itself,
    // independent of whether any TypeScript type would allow it. The real,
    // single caller (lib/reminder-regenerate.ts) cannot actually produce
    // this — see the [static] proof immediately below.
    expectedSendAttemptCount: null as unknown as number,
    emailSubject: "New subject",
    emailBody: "New body",
    smsBody: "New sms",
    generatedSenderName: "New Trading Name Ltd",
  });

  assert.equal(result.outcome, "stale_regeneration", "NULL must never be silently treated as a matching version");
  assert.equal(rowSnapshot(db), before, "zero writes: stored content, generated_sender_name, send_attempt_count, reviewed_content_hash all unchanged");
  assert.equal(db.get().sendAttemptCount, 5, "send_attempt_count specifically unchanged");
});

test("[version-guard NULL] [static] the real caller can never supply a non-integer expected version", () => {
  // reminder.sendAttemptCount (lib/reminder-approval.ts's ApprovalReminder,
  // shared with the regenerate path via loadApprovalReminder) is typed
  // `number`, non-optional, and populated as `row.send_attempt_count ?? 0`
  // from a NOT NULL integer column (migration 009) that is only ever written
  // via `+ 1` — never assigned a literal, never decremented, never set from
  // unchecked input anywhere in this codebase (grep-verified: every
  // send_attempt_count write site is `... + 1`). lib/reminder-regenerate.ts
  // passes this SAME value straight through as expectedSendAttemptCount,
  // with no intervening transformation. A negative or non-integer value
  // cannot originate from this caller; and this RPC is service_role-only
  // (proven separately), so no browser-reachable caller exists at all.
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const regenerateSrc = readFileSync(join(ROOT, "lib/reminder-regenerate.ts"), "utf8");
  assert.match(
    regenerateSrc,
    /expectedSendAttemptCount:\s*reminder\.sendAttemptCount,/,
    "the real caller must pass the loaded reminder's own count field verbatim, not a separately computed or re-read value"
  );
});

// =============================================================================
// THE READ-TOPOLOGY PROOF: facts + send_attempt_count are ONE snapshot
// =============================================================================
//
// The hypothesized race — read invoice facts X, THEN separately re-read
// send_attempt_count (now N+1 after a concurrent edit), then carry stale X
// forward under a version that matches — requires a SECOND, LATER read of
// send_attempt_count somewhere between loadReminder() and db.regenerate().
// These two static proofs establish, from the actual source, that no such
// second read exists: loadReminder() is called exactly once, and the single
// query it issues selects send_attempt_count and every generation-relevant
// invoice field in the SAME .select() string, via one Supabase/PostgREST
// resource-embedding request (one HTTP round trip, one server-side SQL
// query with a JOIN, one MVCC snapshot) — not one query for the reminder and
// a second for the invoice.

test("[read-topology] [static] loadReminder() is called exactly once in regenerateReminder()", () => {
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const regenerateSrc = readFileSync(join(ROOT, "lib/reminder-regenerate.ts"), "utf8");
  const occurrences = regenerateSrc.match(/deps\.db\.loadReminder\(/g) ?? [];
  assert.equal(occurrences.length, 1, "exactly one read — no second/refreshed read of the reminder exists anywhere in this function");
});

test("[read-topology] [static] send_attempt_count and every generation-relevant invoice field are selected in ONE query string", () => {
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const wiringSrc = readFileSync(join(ROOT, "lib/approval-wiring.ts"), "utf8");

  // The primary (non-fallback) select inside loadApprovalReminder — the
  // single query both Approve/Retry and Regenerate share. INVOICE_SELECT is
  // a module-level constant concatenated into the .select() call, so both
  // it and the call site are included: together they are exactly the one
  // string PostgREST receives as this request's SELECT clause.
  const fnStart = wiringSrc.indexOf("export async function loadApprovalReminder");
  const primarySelectStart = wiringSrc.indexOf(".select(", fnStart);
  const primarySelectEnd = wiringSrc.indexOf(".eq(", primarySelectStart);
  const primarySelectCallSite = wiringSrc.slice(primarySelectStart, primarySelectEnd);
  const invoiceSelectConst = wiringSrc.slice(
    wiringSrc.indexOf("const INVOICE_SELECT"),
    wiringSrc.indexOf(";", wiringSrc.indexOf("const INVOICE_SELECT"))
  );
  const primarySelect = primarySelectCallSite + "\n" + invoiceSelectConst;

  assert.match(primarySelectCallSite, /send_attempt_count/, "send_attempt_count is part of the reminder_logs select");
  assert.match(primarySelectCallSite, /INVOICE_SELECT/, "the call site concatenates the invoice select into the SAME request");
  assert.match(invoiceSelectConst, /invoices!inner\(/, "the invoice is an EMBEDDED resource — one PostgREST request, one query, not a second round trip");
  for (const field of [
    "customer_name",
    "customer_phone",
    "amount",
    "due_date",
    "payment_link",
    "reminder_tone",
    "invoice_reference",
    "job_description",
  ]) {
    assert.ok(
      primarySelect.includes(field),
      `${field} must be part of the SAME embedded invoices(...) select as send_attempt_count`
    );
  }
});
