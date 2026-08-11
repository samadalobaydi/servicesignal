process.env.REVIEW_TOKEN_SECRET ??= "test-review-token-secret";

import { test } from "node:test";
import assert from "node:assert/strict";

import { approveAndSendReminder } from "@/lib/reminder-approval";
import { issueReviewToken, verifyReviewToken, REVIEW_TOKEN_TTL_SECONDS } from "@/lib/review-token";
import {
  FakeApprovalDb,
  FakeMailer,
  OWNER,
  OTHER_USER,
  REMINDER_ID,
  freshToken,
  makeDeps,
} from "./support/fakes";

/**
 * SCENARIOS 1–8 — review authorisation.
 *
 * Driven through the service, not through the token helper alone: the property
 * that matters is "no email leaves the building without a valid authorisation",
 * and that is only true if the send path itself refuses. Every test here
 * therefore asserts on the MAILER as well as on the response.
 */


test("1. a valid review token is accepted and the reminder is submitted", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  const token = await freshToken(db);

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: token,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.outcome, "sent");
  assert.equal(mailer.calls.length, 1);
});

test("2. a forged token is refused and nothing is submitted", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  const real = await freshToken(db);
  // Same payload, attacker-chosen signature.
  const forged = `${real.split(".")[0]}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: forged,
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.state, "stale_review");
  assert.equal(mailer.calls.length, 0);
  assert.equal(db.get().status, "pending", "row must be untouched");
});

test("3. an expired token is refused", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  const issuedAt = new Date("2026-01-01T10:00:00Z");
  const token = await freshToken(db, { now: issuedAt });

  const wellAfterExpiry = new Date(
    issuedAt.getTime() + (REVIEW_TOKEN_TTL_SECONDS + 60) * 1000
  );

  const result = await approveAndSendReminder(
    makeDeps(db, mailer, { now: () => wellAfterExpiry }),
    { reminderId: REMINDER_ID, reviewToken: token }
  );

  assert.equal(result.status, 409);
  assert.equal(result.body.reason, "expired");
  assert.equal(mailer.calls.length, 0);
});

test("4. a token issued to another user cannot approve this reminder", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  const token = await freshToken(db, { userId: OTHER_USER });

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: token,
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.reason, "wrong_user");
  assert.equal(mailer.calls.length, 0);
});

test("5. a token issued for another reminder cannot approve this one", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  const token = await freshToken(db, { reminderId: "rem-somewhere-else" });

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: token,
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.reason, "wrong_reminder");
  assert.equal(mailer.calls.length, 0);
});

test("6. content changed since review invalidates the token", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  const token = await freshToken(db);

  // The owner edits the invoice after reading the message.
  db.get().invoice.amount = 999.99;

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: token,
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.reason, "content_changed");
  assert.equal(mailer.calls.length, 0);
});

test("6b. every material field invalidates the token, not just the amount", async () => {
  const mutations: Array<[string, (db: FakeApprovalDb) => void]> = [
    ["recipient", (db) => { db.get().emailTo = "someone.else@example.com"; }],
    ["sender name", (db) => { db.businessName = "A Different Trading Name"; }],
    ["invoice reference", (db) => { db.get().invoice.invoiceReference = "INV-9999"; }],
    ["job description", (db) => { db.get().invoice.jobDescription = "Different job"; }],
    ["payment link", (db) => { db.get().invoice.paymentLink = "https://pay.example/x"; }],
    ["tone", (db) => { db.get().invoice.reminderTone = "final"; }],
    ["due date", (db) => { db.get().invoice.dueDate = "2020-01-01"; }],
  ];

  for (const [label, mutate] of mutations) {
    const db = new FakeApprovalDb();
    const mailer = new FakeMailer();
    const token = await freshToken(db);
    mutate(db);

    const result = await approveAndSendReminder(makeDeps(db, mailer), {
      reminderId: REMINDER_ID,
      reviewToken: token,
    });

    assert.equal(result.body.state, "stale_review", `${label} should invalidate review`);
    assert.equal(mailer.calls.length, 0, `${label} must not send`);
  }
});

test("7. a stale review returns 409 with actionable wording", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  const token = await freshToken(db);
  db.get().invoice.amount = 12;

  const result = await approveAndSendReminder(makeDeps(db, mailer), {
    reminderId: REMINDER_ID,
    reviewToken: token,
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.state, "stale_review");
  assert.match(String(result.body.message), /changed since you reviewed it/i);
  // A forged token must NOT get the same helpful wording.
  const forged = await approveAndSendReminder(makeDeps(new FakeApprovalDb(), new FakeMailer()), {
    reminderId: REMINDER_ID,
    reviewToken: "not-even-a-token",
  });
  assert.match(String(forged.body.message), /no longer valid/i);
});

test("8. approval with no review token at all is refused", async () => {
  for (const token of [null, "", "garbage", "a.b"]) {
    const db = new FakeApprovalDb();
    const mailer = new FakeMailer();
    const result = await approveAndSendReminder(makeDeps(db, mailer), {
      reminderId: REMINDER_ID,
      reviewToken: token as string | null,
    });
    assert.equal(result.status, 409, `token ${JSON.stringify(token)}`);
    assert.equal(result.body.state, "stale_review");
    assert.equal(mailer.calls.length, 0);
    assert.equal(db.get().status, "pending");
  }
});

test("8b. token verification fails closed on every failure mode (pure)", () => {
  const expected = { userId: OWNER, reminderId: REMINDER_ID, contentHash: "hash-a" };
  const good = issueReviewToken(expected);

  assert.equal(verifyReviewToken(good, expected).ok, true);
  assert.equal(verifyReviewToken(null, expected).ok, false);
  assert.equal(verifyReviewToken("", expected).ok, false);
  assert.equal(verifyReviewToken("no-dot", expected).ok, false);
  assert.equal(
    verifyReviewToken(good, { ...expected, contentHash: "hash-b" }).ok,
    false
  );

  // A single flipped character in the signature must fail.
  const [payload, sig] = good.split(".");
  const flipped = sig[0] === "A" ? "B" : "A";
  const tampered = `${payload}.${flipped}${sig.slice(1)}`;
  const result = verifyReviewToken(tampered, expected);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "bad_signature");
});
