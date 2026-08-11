process.env.REVIEW_TOKEN_SECRET ??= "test-review-token-secret";

import { test } from "node:test";
import assert from "node:assert/strict";

import { approveAndSendReminder } from "@/lib/reminder-approval";
import { idempotencyKeyFor } from "@/lib/reminder-send-state";
import type { ReminderSendStatus } from "@/lib/reminder-send-state";
import {
  FakeApprovalDb,
  FakeMailer,
  OTHER_USER,
  OWNER,
  REMINDER_ID,
  freshToken,
  ineligibleDueDate,
  makeDeps,
  makeStoredReminder,
} from "./support/fakes";

/**
 * SCENARIOS 9–29 — ownership, atomic send behaviour, provider outcome handling.
 *
 * Every one of these drives the real service against working in-memory fakes.
 * No email is sent: FakeMailer is the only thing on the other side of the port,
 * and each test asserts how many times it was called.
 */


// ── Ownership (9–11) ────────────────────────────────────────────────────────

test("9. user A cannot load user B's reminder for review", async () => {
  const db = new FakeApprovalDb([makeStoredReminder({ userId: OTHER_USER })]);
  db.scopeUserId = OWNER;
  assert.equal(await db.loadReminder(REMINDER_ID), null);
});

test("10. user A cannot approve user B's reminder", async () => {
  // Token minted with the OWNER's own id — the attacker controls their session,
  // not the row. The reminder still belongs to somebody else.
  const ownedDb = new FakeApprovalDb();
  const token = await freshToken(ownedDb);

  const db = new FakeApprovalDb([makeStoredReminder({ userId: OTHER_USER })]);
  db.scopeUserId = OWNER;
  const mailer = new FakeMailer();

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: token,
  });

  assert.equal(result.status, 404);
  assert.equal(mailer.calls.length, 0);
  assert.equal(db.get().status, "pending", "another user's row is untouched");
});

test("11. an inaccessible reminder is indistinguishable from a missing one", async () => {
  const mailer = new FakeMailer();

  const notMine = new FakeApprovalDb([makeStoredReminder({ userId: OTHER_USER })]);
  notMine.scopeUserId = OWNER;
  const a = await approveAndSendReminder(makeDeps(notMine, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: "irrelevant",
  });

  const missing = new FakeApprovalDb([]);
  const b = await approveAndSendReminder(makeDeps(missing, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: "irrelevant",
  });

  assert.equal(a.status, b.status);
  assert.deepEqual(a.body, b.body);
  assert.equal(mailer.calls.length, 0);
});

// ── Atomic send behaviour (12–19) ───────────────────────────────────────────

test("12–14. two concurrent approvals: one claim, one submission, one conflict", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  const token = await freshToken(db);
  const deps = makeDeps(db, mailer);

  const [first, second] = await Promise.all([
    approveAndSendReminder(deps, { reminderId: REMINDER_ID, reviewToken: token }),
    approveAndSendReminder(deps, { reminderId: REMINDER_ID, reviewToken: token }),
  ]);

  const outcomes = [first, second];
  const winners = outcomes.filter((r) => r.status === 200);
  const losers = outcomes.filter((r) => r.status !== 200);

  assert.equal(winners.length, 1, "exactly one approval may succeed");
  assert.equal(losers.length, 1);
  assert.equal(losers[0].status, 409);
  assert.equal(losers[0].body.state, "sending");

  assert.equal(db.claimAttempts.length, 2, "both requests attempted the claim");
  assert.equal(db.claimsWon, 1, "only one claim can win");
  assert.equal(mailer.calls.length, 1, "only the claimant may call the provider");
});

test("12b. an interleaved claim (true race) still yields exactly one submission", async () => {
  // Forces the worst ordering: both requests read the row, then both attempt
  // the compare-and-set. Without the CAS both would proceed.
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  const token = await freshToken(db);
  const deps = makeDeps(db, mailer);

  let gate: (() => void) | null = null;
  const bothRead = new Promise<void>((resolve) => {
    gate = resolve;
  });
  let arrivals = 0;
  db.beforeClaim = async () => {
    arrivals++;
    if (arrivals === 2) gate?.();
    if (arrivals < 2) await bothRead;
  };

  const results = await Promise.all([
    approveAndSendReminder(deps, { reminderId: REMINDER_ID, reviewToken: token }),
    approveAndSendReminder(deps, { reminderId: REMINDER_ID, reviewToken: token }),
  ]);

  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(db.claimsWon, 1);
  assert.equal(mailer.calls.length, 1);
});

test("12c. a stale reader cannot claim after a competing attempt has completed", async () => {
  // The case the status predicate ALONE does not cover, and the reason the
  // claim also compares send_attempt_count.
  //
  // Request A reads the row at (pending, attempt 0). Before A's claim lands, a
  // whole competing attempt runs and definitely fails, leaving the row at
  // (failed, attempt 1) — which is still claimable. Without the count guard A
  // would now claim attempt 1 a second time and submit under the key attempt 1
  // has already used.
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  mailer.behaviour = () => ({ ok: false, code: "validation_error", message: "rejected" });
  const staleToken = await freshToken(db);

  db.beforeClaim = async () => {
    db.beforeClaim = null; // the interleaved attempt must not re-enter
    await approveAndSendReminder(makeDeps(db, mailer), {
      reminderId: REMINDER_ID,
      reviewToken: await freshToken(db),
    });
  };

  const stale = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: staleToken,
  });

  assert.equal(stale.status, 409, "the stale claim must be refused");
  assert.equal(db.get().status, "failed");
  assert.equal(db.get().sendAttemptCount, 1, "no second allocation of attempt 1");
  assert.equal(mailer.calls.length, 1, "attempt 1 must be submitted exactly once");
});

test("12d. the claim may only ever take a row from a genuinely retryable state", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });

  const attempted = db.claimAttempts[0].fromStatuses;
  assert.deepEqual(Array.from(attempted), ["pending", "failed"]);
  for (const forbidden of ["sending", "sent", "dismissed", "delivery_unknown", "undelivered"]) {
    assert.equal(
      attempted.includes(forbidden as ReminderSendStatus),
      false,
      `${forbidden} must never be claimable`
    );
  }
});

test("15. a double client submission produces one provider call", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  const token = await freshToken(db);
  const deps = makeDeps(db, mailer);

  const first = await approveAndSendReminder(deps, { reminderId: REMINDER_ID, reviewToken: token });
  // The impatient second click, arriving after the first completed.
  const second = await approveAndSendReminder(deps, { reminderId: REMINDER_ID, reviewToken: token });

  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(second.body.state, "sent");
  assert.equal(mailer.calls.length, 1);
});

test("16–19. non-claimable statuses are each refused distinctly and never send", async () => {
  const cases: Array<[ReminderSendStatus, string]> = [
    ["sent", "sent"],
    ["dismissed", "dismissed"],
    ["sending", "sending"],
    ["delivery_unknown", "delivery_unknown"],
    ["undelivered", "undelivered"],
  ];

  const messages = new Set<string>();

  for (const [status, expectedState] of cases) {
    const db = new FakeApprovalDb([makeStoredReminder({ status })]);
    const mailer = new FakeMailer();
    const token = await freshToken(db);

    const result = await approveAndSendReminder(makeDeps(db, mailer), {
      reminderId: REMINDER_ID,
      reviewToken: token,
    });

    assert.equal(result.status, 409, status);
    assert.equal(result.body.state, expectedState, status);
    assert.equal(mailer.calls.length, 0, `${status} must not send`);
    assert.equal(db.claimAttempts.length, 0, `${status} must not even attempt a claim`);
    messages.add(String(result.body.message));
  }

  assert.equal(messages.size, cases.length, "each blocked state needs its own wording");
});

test("19b. an ineligible reminder cannot send", async () => {
  const db = new FakeApprovalDb([
    makeStoredReminder({
      invoice: { ...makeStoredReminder().invoice, dueDate: ineligibleDueDate() },
    }),
  ]);
  const mailer = new FakeMailer();
  const token = await freshToken(db);

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: token,
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.state, "not_eligible");
  assert.equal(mailer.calls.length, 0);
});

test("19c. a paid invoice stops the send and dismisses the stale reminder", async () => {
  const base = makeStoredReminder();
  const db = new FakeApprovalDb([
    makeStoredReminder({ invoice: { ...base.invoice, status: "paid" } }),
  ]);
  const mailer = new FakeMailer();
  const token = await freshToken(db);

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: token,
  });

  assert.equal(result.status, 409);
  assert.match(String(result.body.message), /marked paid/i);
  assert.equal(mailer.calls.length, 0);
  assert.deepEqual(db.dismissed, [REMINDER_ID]);
});

// ── Provider outcome handling (20–29) ───────────────────────────────────────

test("20. confirmed acceptance persists sent, provider id and timestamp", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  mailer.behaviour = () => ({ ok: true, id: "resend-abc-123" });
  const token = await freshToken(db);
  const fixedNow = new Date("2026-07-29T09:15:00Z");

  const result = await approveAndSendReminder(
    makeDeps(db, mailer, { now: () => fixedNow }),
    { reminderId: REMINDER_ID, reviewToken: token }
  );

  assert.equal(result.status, 200);
  const row = db.get();
  assert.equal(row.status, "sent");
  assert.equal(row.providerMessageId, "resend-abc-123");
  assert.equal(row.sentAt, fixedNow.toISOString());
  assert.deepEqual(db.scheduleAppends, [
    { invoiceId: row.invoiceId, schedule: row.schedule },
  ]);
});

test("21. a definite pre-acceptance rejection becomes safe `failed`", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  mailer.behaviour = () => ({
    ok: false,
    code: "validation_error",
    message: "The from address is not verified.",
  });
  const token = await freshToken(db);

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: token,
  });

  assert.equal(result.status, 500);
  assert.equal(result.body.state, "failed");
  assert.equal(result.outcome, "rejected");
  assert.equal(db.get().status, "failed");
});

test("22. a safe `failed` reminder can start a genuine new logical attempt", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  mailer.behaviour = (n) =>
    n === 1
      ? { ok: false, code: "validation_error", message: "rejected" }
      : { ok: true, id: "resend-second" };

  const first = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });
  assert.equal(first.body.state, "failed");
  assert.equal(db.get().status, "failed");
  assert.equal(db.get().sendAttemptCount, 1);

  // The owner reloads the review page (fresh token) and retries.
  const second = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });

  assert.equal(second.status, 200, "a definitely-rejected reminder must be retryable");
  assert.equal(db.get().status, "sent");
  assert.equal(db.get().sendAttemptCount, 2);
  assert.equal(mailer.calls.length, 2);
  assert.notEqual(mailer.keys[0], mailer.keys[1], "a new attempt needs a new key");
});

test("23–24. an ambiguous provider outcome becomes delivery_unknown and blocks retry", async () => {
  const ambiguous: Array<string | null> = [
    "internal_server_error",
    "concurrent_idempotent_requests",
    "invalid_idempotent_request",
    "some_code_we_have_never_seen",
    null,
  ];

  for (const code of ambiguous) {
    const db = new FakeApprovalDb();
    const mailer = new FakeMailer();
    mailer.behaviour = () => ({ ok: false, code, message: "no confirmation" });

    const result = await approveAndSendReminder(makeDeps(db, mailer), {
      reminderId: REMINDER_ID,
      reviewToken: await freshToken(db),
    });

    assert.equal(result.body.state, "delivery_unknown", String(code));
    assert.equal(db.get().status, "delivery_unknown", String(code));
    assert.match(String(result.body.message), /Don't resend yet/);

    // 24: a second approval is refused rather than offered as a retry.
    const retry = await approveAndSendReminder(makeDeps(db, mailer), {
      reminderId: REMINDER_ID,
      reviewToken: await freshToken(db),
    });
    assert.equal(retry.status, 409);
    assert.equal(retry.body.state, "delivery_unknown");
    assert.equal(mailer.calls.length, 1, "no second submission");
  }
});

test("23b. a thrown provider call is ambiguous, never a failure", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  mailer.throws = new Error("socket hang up");

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });

  assert.equal(result.body.state, "delivery_unknown");
  assert.equal(db.get().status, "delivery_unknown");
});

test("25–26. a database failure after acceptance shows no success and leaves a reconciliation path", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  mailer.behaviour = () => ({ ok: true, id: "resend-accepted-999" });
  db.recordAcceptedError = "connection terminated";

  const logged: string[] = [];
  const result = await approveAndSendReminder(
    makeDeps(db, mailer, { log: (_l, m) => logged.push(m) }),
    { reminderId: REMINDER_ID, reviewToken: await freshToken(db) }
  );

  // 25: never reported as success.
  assert.equal(result.body.success, false);
  assert.notEqual(result.status, 200);
  assert.equal(result.body.state, "delivery_unknown");

  // 26: the provider id is recoverable. It could not reach the row (that write
  // is exactly what failed), so it MUST be in the log.
  assert.equal(db.get().status, "delivery_unknown");
  assert.ok(
    logged.some((m) => m.includes("resend-accepted-999")),
    "the provider message id must survive a persistence failure"
  );
  assert.ok(logged.some((m) => /Do not resend without reconciliation/i.test(m)));
});

test("27–29. a provider-recorded delivery failure is not an ordinary retryable failure", async () => {
  // `undelivered` is only ever reached via reconciliation; what is asserted
  // here is that the send path treats it as non-retryable and never resends.
  for (const event of ["bounced", "complained", "suppressed"]) {
    const db = new FakeApprovalDb([
      makeStoredReminder({
        status: "undelivered",
        providerLastEvent: event,
        providerMessageId: "resend-x",
        sendAttemptCount: 1,
      }),
    ]);
    const mailer = new FakeMailer();

    const result = await approveAndSendReminder(makeDeps(db, mailer), {
      reminderId: REMINDER_ID,
      reviewToken: await freshToken(db),
    });

    assert.equal(result.status, 409, event);
    assert.equal(result.body.state, "undelivered", event);
    assert.match(String(result.body.message), /accepted this reminder/i);
    assert.match(String(result.body.message), /Review the recipient details/i);
    assert.equal(mailer.calls.length, 0, `${event} must never resend`);
    assert.equal(db.get().sendAttemptCount, 1, "no new attempt may be allocated");
  }
});

test("29b. a missing email provider fails closed without claiming an attempt", async () => {
  const db = new FakeApprovalDb();
  const result = await approveAndSendReminder(makeDeps(db, null), {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });

  assert.equal(result.status, 503);
  assert.equal(db.get().status, "failed");
  assert.equal(db.get().sendAttemptCount, 0);
});

test("29c. a claim database error is reported as an error, never as success", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  db.claimError = "deadlock detected";

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });

  assert.equal(result.status, 500);
  assert.equal(result.body.success, false);
  assert.equal(mailer.calls.length, 0);
  assert.equal(idempotencyKeyFor(REMINDER_ID, "h", 1).startsWith("ss-reminder-"), true);
});
