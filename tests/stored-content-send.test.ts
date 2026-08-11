process.env.REVIEW_TOKEN_SECRET ??= "test-review-token-secret";

import { test } from "node:test";
import assert from "node:assert/strict";

import { approveAndSendReminder, composeReminderContent, resolveBusinessName } from "@/lib/reminder-approval";
import { issueReviewToken } from "@/lib/review-token";
import {
  generateReminderContent,
  withEmailEdit,
  withSmsEdit,
  withEmailRestored,
  type StoredReminderContent,
  type ReminderFacts,
} from "@/lib/reminder-content";
import { storedContentFromRows, type ChannelRow } from "@/lib/reminder-channel-store";
import {
  FakeApprovalDb,
  FakeMailer,
  OWNER,
  REMINDER_ID,
  makeDeps,
  makeStoredReminder,
} from "./support/fakes";

/**
 * THE INTEGRATION PROPERTY THIS WHOLE REFACTOR EXISTS FOR:
 *
 *   the exact bytes the owner approved are the exact bytes handed to Resend.
 *
 * These drive the real send service against the real content model. A test that
 * only checked currentContent() in isolation would have passed just as happily
 * while the send path recomposed over the top of the edit — which is precisely
 * the bug being fixed.
 */

function factsFor(db: FakeApprovalDb): ReminderFacts {
  const row = db.get();
  return {
    tone: row.invoice.reminderTone,
    schedule: row.schedule,
    customerName: row.invoice.customerName,
    businessName: resolveBusinessName(db.businessName, "owner@example.com"),
    amount: row.invoice.amount,
    dueDate: row.invoice.dueDate,
    paymentLink: row.invoice.paymentLink,
    invoiceReference: row.invoice.invoiceReference,
    jobDescription: row.invoice.jobDescription,
  };
}

/** Prepares a reminder with stored originals, as preparation would. */
function withStoredOriginals(db: FakeApprovalDb): StoredReminderContent {
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
  return stored;
}

async function tokenForCurrent(db: FakeApprovalDb): Promise<string> {
  const reminder = await db.loadReminder(REMINDER_ID);
  assert.ok(reminder);
  const composed = composeReminderContent(
    reminder,
    resolveBusinessName(db.businessName, "owner@example.com"),
    "owner@example.com"
  );
  return issueReviewToken({ userId: OWNER, reminderId: REMINDER_ID, contentHash: composed.hash });
}

test("an edited email body is what reaches the provider, verbatim", async () => {
  const db = new FakeApprovalDb();
  const stored = withStoredOriginals(db);
  const mailer = new FakeMailer();

  const CUSTOM = "Dave — quick one about the invoice. Can you settle it this week? Thanks.";
  db.get().storedContent = {
    ...stored,
    email: withEmailEdit(stored.email!, { subject: "About your invoice", body: CUSTOM }),
  };

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });

  assert.equal(result.status, 200);
  assert.equal(mailer.calls.length, 1);
  assert.equal(mailer.calls[0].message.text, CUSTOM, "the owner's text, not the generated text");
  assert.equal(mailer.calls[0].message.subject, "About your invoice");
  assert.equal(
    mailer.calls[0].message.text.includes(stored.email!.generatedBody),
    false,
    "the generated body must not be sent alongside or instead"
  );
  // The edited body must also be what the HTML part carries.
  assert.match(mailer.calls[0].message.html, /settle it this week/);
});

test("an UNEDITED reminder sends the stored original and the designed HTML template", async () => {
  const db = new FakeApprovalDb();
  const stored = withStoredOriginals(db);
  const mailer = new FakeMailer();

  await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });

  assert.equal(mailer.calls[0].message.text, stored.email!.generatedBody);
  assert.equal(mailer.calls[0].message.subject, stored.email!.generatedSubject);
  // The rich template, not the plain edited-body wrapper.
  assert.match(mailer.calls[0].message.html, /<html|<table|<body/i);
});

test("editing the SMS invalidates an approval taken over the pair", async () => {
  const db = new FakeApprovalDb();
  const stored = withStoredOriginals(db);
  const mailer = new FakeMailer();

  // Owner reviews and takes a token over the current pair.
  const token = await tokenForCurrent(db);

  // Then edits the SMS — the email is untouched, but the pair has changed.
  db.get().storedContent = { ...stored, sms: withSmsEdit(stored.sms!, "New text message.") };

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: token,
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.state, "stale_review");
  assert.equal(mailer.calls.length, 0, "nothing may be sent under a stale approval");
});

test("editing the email body invalidates an approval taken before it", async () => {
  const db = new FakeApprovalDb();
  const stored = withStoredOriginals(db);
  const mailer = new FakeMailer();
  const token = await tokenForCurrent(db);

  db.get().storedContent = {
    ...stored,
    email: withEmailEdit(stored.email!, {
      subject: stored.email!.generatedSubject,
      body: "Completely different wording.",
    }),
  };

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: token,
  });
  assert.equal(result.body.state, "stale_review");
  assert.equal(mailer.calls.length, 0);
});

test("restoring the original also invalidates an approval taken over the edit", async () => {
  const db = new FakeApprovalDb();
  const stored = withStoredOriginals(db);
  const mailer = new FakeMailer();

  const edited = {
    ...stored,
    email: withEmailEdit(stored.email!, { subject: "Edited", body: "Edited body" }),
  };
  db.get().storedContent = edited;
  const tokenOverEdit = await tokenForCurrent(db);

  // Restore, then try to approve with the token taken over the edited version.
  db.get().storedContent = { ...edited, email: withEmailRestored(edited.email!) };

  const stale = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: tokenOverEdit,
  });
  assert.equal(stale.body.state, "stale_review");
  assert.equal(mailer.calls.length, 0);

  // A fresh review of the restored content sends the ORIGINAL.
  const ok = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });
  assert.equal(ok.status, 200);
  assert.equal(mailer.calls[0].message.text, stored.email!.generatedBody);
});

test("an invoice change still invalidates a review, exactly as before", async () => {
  // The old guarantee came from recomposition. It must survive the move to
  // stored content: the hash covers recipient identity, so a changed recipient
  // is caught even though the stored body is byte-identical.
  const db = new FakeApprovalDb();
  withStoredOriginals(db);
  const mailer = new FakeMailer();
  const token = await tokenForCurrent(db);

  db.get().emailTo = "someone.else@example.com";

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: token,
  });
  assert.equal(result.body.state, "stale_review");
  assert.equal(mailer.calls.length, 0);
});

test("a changed customer phone invalidates the review", async () => {
  const db = new FakeApprovalDb();
  withStoredOriginals(db);
  const mailer = new FakeMailer();
  const token = await tokenForCurrent(db);

  db.get().invoice.customerPhone = "07700 900999";

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: token,
  });
  assert.equal(result.body.state, "stale_review", "the SMS destination is part of the review");
  assert.equal(mailer.calls.length, 0);
});

test("a LEGACY reminder with no stored content still sends, composed live", async () => {
  // Backward compatibility: rows prepared before migration 010 have no
  // children. They must keep working exactly as they did.
  const db = new FakeApprovalDb([makeStoredReminder({ storedContent: null })]);
  const mailer = new FakeMailer();

  const reminder = await db.loadReminder(REMINDER_ID);
  assert.ok(reminder);
  const composed = composeReminderContent(reminder, "Wilson Plumbing", "owner@example.com");
  assert.equal(composed.legacy, true);
  assert.equal(composed.edited.email, false);
  assert.equal(composed.edited.sms, false);

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });

  assert.equal(result.status, 200);
  assert.equal(mailer.calls.length, 1);
  assert.ok(mailer.calls[0].message.text.length > 0);
});

test("the idempotency key follows the approved version, not the generator", async () => {
  const db = new FakeApprovalDb();
  const stored = withStoredOriginals(db);
  const mailer = new FakeMailer();
  mailer.behaviour = () => ({ ok: false, code: "validation_error", message: "rejected" });

  await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });
  const keyForOriginal = mailer.keys[0];

  // Edit, re-review, retry: different content must not reuse the key.
  db.get().storedContent = { ...stored, sms: withSmsEdit(stored.sms!, "Different SMS entirely.") };
  mailer.behaviour = () => ({ ok: true, id: "ok" });

  await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await tokenForCurrent(db),
  });

  assert.equal(mailer.keys.length, 2);
  assert.notEqual(mailer.keys[1], keyForOriginal, "an edited pair is a different message");
});

test("the channel-row folder maps Supabase rows into the content model", () => {
  const rows: ChannelRow[] = [
    {
      channel: "email",
      generated_subject: "Gen subject",
      generated_body: "Gen body",
      edited_subject: "My subject",
      edited_body: null,
    },
    {
      channel: "sms",
      generated_subject: null,
      generated_body: "Gen sms",
      edited_subject: null,
      edited_body: "My sms",
    },
  ];

  const stored = storedContentFromRows(rows);
  assert.equal(stored.email!.generatedSubject, "Gen subject");
  assert.equal(stored.email!.editedSubject, "My subject");
  assert.equal(stored.email!.editedBody, null, "an unedited body stays null");
  assert.equal(stored.sms!.editedBody, "My sms");

  // No rows at all is the legacy shape, not an empty message.
  assert.deepEqual(storedContentFromRows([]), { email: null, sms: null });
  assert.deepEqual(storedContentFromRows(null), { email: null, sms: null });
});
