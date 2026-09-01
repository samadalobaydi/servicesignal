process.env.REVIEW_TOKEN_SECRET ??= "test-review-token-secret";

import { test } from "node:test";
import assert from "node:assert/strict";

import { approveAndSendReminder, composeReminderContent } from "@/lib/reminder-approval";
import { issueReviewToken } from "@/lib/review-token";
import { idempotencyKeyFor } from "@/lib/reminder-send-state";
import {
  FakeApprovalDb,
  FakeMailer,
  OWNER,
  REMINDER_ID,
  freshToken,
  makeDeps,
} from "./support/fakes";

/**
 * SCENARIOS 30–36 — the idempotency-key lifecycle.
 *
 * THE RULE, stated once:
 *
 *   key = sha256(reminderId ‖ contentHash ‖ send_attempt_count)
 *
 * The key is REUSED for every repetition of the same logical attempt, and a NEW
 * key can only come into existence when a successful atomic claim allocates a
 * new send_attempt_count — which only `pending` and `failed` permit. That single
 * sentence is what these tests hold the implementation to.
 */


test("30. a double-click uses the same attempt key", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  const token = await freshToken(db);
  const deps = makeDeps(db, mailer);

  await Promise.all([
    approveAndSendReminder(deps, { reminderId: REMINDER_ID, reviewToken: token }),
    approveAndSendReminder(deps, { reminderId: REMINDER_ID, reviewToken: token }),
  ]);

  // Both requests computed a key; only the claimant submitted. The keys they
  // computed must be identical, so that if BOTH had reached Resend, Resend
  // would have suppressed the duplicate.
  const keys = db.claimAttempts.map((c) => c.attemptKey);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(mailer.calls.length, 1);
});

test("31. repeated requests for the same active attempt compute the same key", async () => {
  const db = new FakeApprovalDb();
  const reminder = await db.loadReminder(REMINDER_ID);
  assert.ok(reminder);
  const composed = composeReminderContent(reminder, "Wilson Plumbing", "business", "owner@example.com");

  const a = idempotencyKeyFor(REMINDER_ID, composed.hash, 1);
  const b = idempotencyKeyFor(REMINDER_ID, composed.hash, 1);
  assert.equal(a, b);
});

test("32. an ambiguous outcome retains the same attempt and the same key", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  mailer.behaviour = () => ({ ok: false, code: "internal_server_error", message: "??" });

  await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });

  const row = db.get();
  assert.equal(row.status, "delivery_unknown");
  assert.equal(row.sendAttemptCount, 1, "no new attempt is allocated");
  const keyAfter = row.sendAttemptKey;

  // Any number of further approvals must not touch the attempt or the key.
  for (let i = 0; i < 3; i++) {
    const again = await approveAndSendReminder(makeDeps(db, mailer), {
      reminderId: REMINDER_ID,
      reviewToken: await freshToken(db),
    });
    assert.equal(again.body.state, "delivery_unknown");
  }

  assert.equal(db.get().sendAttemptCount, 1);
  assert.equal(db.get().sendAttemptKey, keyAfter);
  assert.equal(mailer.calls.length, 1);
});

test("33. a definite safe failure allocates a new key ONLY on a fresh approval", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  mailer.behaviour = (n) =>
    n === 1
      ? { ok: false, code: "validation_error", message: "rejected outright" }
      : { ok: true, id: "resend-2" };

  await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });
  const afterFailure = { ...db.get() };
  assert.equal(afterFailure.status, "failed");
  assert.equal(afterFailure.sendAttemptCount, 1);

  // No new key exists yet. The failure alone allocated nothing.
  assert.equal(db.claimAttempts.length, 1);

  // A fresh owner approval — a new review token over revalidated content.
  await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });

  assert.equal(db.get().sendAttemptCount, 2);
  assert.notEqual(db.get().sendAttemptKey, afterFailure.sendAttemptKey);
  assert.equal(mailer.keys.length, 2);
  assert.notEqual(mailer.keys[0], mailer.keys[1]);
});

test("33b. a retry without a fresh review token allocates nothing", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  mailer.behaviour = () => ({ ok: false, code: "validation_error", message: "no" });

  await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });
  assert.equal(db.get().sendAttemptCount, 1);

  const noToken = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: null,
  });

  assert.equal(noToken.body.state, "stale_review");
  assert.equal(db.get().sendAttemptCount, 1, "no attempt without authorisation");
  assert.equal(mailer.calls.length, 1);
});

test("34. changed content produces a different key", async () => {
  const db = new FakeApprovalDb();
  const reminder = await db.loadReminder(REMINDER_ID);
  assert.ok(reminder);

  const original = composeReminderContent(reminder, "Wilson Plumbing", "business", "owner@example.com");
  const changed = composeReminderContent(
    { ...reminder, invoice: { ...reminder.invoice, amount: 999 } },
    "Wilson Plumbing",
    "business",
    "owner@example.com"
  );

  assert.notEqual(original.hash, changed.hash);
  assert.notEqual(
    idempotencyKeyFor(REMINDER_ID, original.hash, 1),
    idempotencyKeyFor(REMINDER_ID, changed.hash, 1)
  );
});

test("34b. changed content sends under a new key after a fresh review", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  mailer.behaviour = (n) =>
    n === 1 ? { ok: false, code: "validation_error", message: "no" } : { ok: true, id: "ok" };

  await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });
  const firstKey = mailer.keys[0];

  // The owner corrects the invoice, then re-reviews and approves.
  db.get().invoice.amount = 812.4;
  const staleAttempt = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(new FakeApprovalDb()), // token over the OLD content
  });
  assert.equal(staleAttempt.body.state, "stale_review", "old content cannot approve new content");

  const ok = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });
  assert.equal(ok.status, 200);
  assert.notEqual(mailer.keys[1], firstKey, "different content must never reuse the key");
});

test("35. the same key is never used for materially different payloads", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  mailer.behaviour = () => ({ ok: false, code: "validation_error", message: "no" });

  const seen = new Map<string, string>();
  const mutations: Array<(d: FakeApprovalDb) => void> = [
    () => {},
    (d) => { d.get().invoice.amount = 1; },
    (d) => { d.get().invoice.invoiceReference = "INV-OTHER"; },
    (d) => { d.get().emailTo = "elsewhere@example.com"; },
    (d) => { d.businessName = "Another Trading Name"; },
  ];

  for (const mutate of mutations) {
    const fresh = new FakeApprovalDb();
    mutate(fresh);
    const localMailer = new FakeMailer();
    localMailer.behaviour = () => ({ ok: true, id: "x" });
    await approveAndSendReminder(makeDeps(fresh, localMailer), {
      reminderId: REMINDER_ID,
      reviewToken: await freshToken(fresh),
    });

    const key = localMailer.keys[0];
    const payload = JSON.stringify(localMailer.calls[0].message);
    const previous = seen.get(key);
    if (previous !== undefined) {
      assert.equal(previous, payload, "one key must map to exactly one payload");
    }
    seen.set(key, payload);
  }

  assert.equal(seen.size, mutations.length, "each distinct payload needs its own key");
  assert.equal(mailer.calls.length, 0);
});

test("36. reconciliation never creates a key for an unresolved submission", async () => {
  // Structural, and deliberately so: the reconciliation module has no mailer
  // port and no key derivation at all, so there is nothing that COULD create
  // one. Asserted on the module's exports rather than on a behaviour, because
  // absence is the property being claimed.
  const reconcile = await import("@/lib/reminder-reconcile");
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../lib/reminder-reconcile.ts", import.meta.url), "utf8")
  );

  assert.equal(
    /idempotencyKeyFor|emails\.send|mailer/i.test(source),
    false,
    "reconciliation must not reference key derivation or sending"
  );
  assert.equal(
    Object.keys(reconcile).some((k) => /key|send\b/i.test(k) && k !== "SEND_LEASE_SECONDS"),
    false
  );
});

test("36b. the key rejects a non-positive attempt number rather than silently reusing one", () => {
  assert.throws(() => idempotencyKeyFor(REMINDER_ID, "hash", 0));
  assert.throws(() => idempotencyKeyFor(REMINDER_ID, "hash", -1));
  assert.throws(() => idempotencyKeyFor(REMINDER_ID, "hash", 1.5));
  assert.equal(idempotencyKeyFor(REMINDER_ID, "hash", 1).startsWith("ss-reminder-"), true);
  assert.notEqual(
    idempotencyKeyFor(REMINDER_ID, "hash", 1),
    idempotencyKeyFor(REMINDER_ID, "hash", 2)
  );
  assert.notEqual(
    idempotencyKeyFor("rem-a", "hash", 1),
    idempotencyKeyFor("rem-b", "hash", 1)
  );
});
