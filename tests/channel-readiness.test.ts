process.env.REVIEW_TOKEN_SECRET ??= "test-review-token-secret";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyChannelReadiness,
  assessApproveReadiness,
  assessChannelStructure,
  type ChannelStatusRow,
} from "@/lib/reminder-channel-state";
import { channelRetryable, partiallySentFromStatuses } from "@/lib/reminder-aggregate";
import { reviewAvailability } from "@/lib/reminder-send-state";
import { approveAndSendReminder } from "@/lib/reminder-approval";
import {
  FakeApprovalDb,
  FakeMailer,
  FakeTexter,
  FakeChannelDb,
  FakeAllowanceStore,
  makeDeps,
  makeStoredReminder,
  freshToken,
  REMINDER_ID,
} from "./support/fakes";

/**
 * Phase 1 — the state-aware channel readiness pre-flight.
 *
 * THIS IS NOT THE CONCURRENCY GUARD. Every test in the first section below
 * exercises the pure classification function in isolation. The integration
 * tests further down prove it is wired in BEFORE the allowance claim and
 * BEFORE any provider is contacted — and the final section proves the
 * atomic per-channel claim (claimChannel's CAS) remains the actual
 * enforcement point, unweakened, for anything that changes after this
 * read.
 */

// ── Pure classification: classifyChannelReadiness / assessApproveReadiness ──

test("both expected channel rows pending → ready", () => {
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: "pending" },
    { channel: "sms", status: "pending" },
  ];
  const readiness = assessApproveReadiness(rows);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.email, { kind: "ready" });
  assert.deepEqual(readiness.sms, { kind: "ready" });
});

test("both expected channel rows failed → ready (a definite pre-acceptance rejection is safe to attempt again)", () => {
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: "failed" },
    { channel: "sms", status: "failed" },
  ];
  assert.equal(assessApproveReadiness(rows).ready, true);
});

test("email row missing → not ready, classified as missing, never synthesized as pending", () => {
  const rows: ChannelStatusRow[] = [{ channel: "sms", status: "pending" }];
  const readiness = assessApproveReadiness(rows);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.email, { kind: "missing" });
  assert.deepEqual(readiness.sms, { kind: "ready" });
});

test("SMS row missing → not ready, classified as missing", () => {
  const rows: ChannelStatusRow[] = [{ channel: "email", status: "pending" }];
  const readiness = assessApproveReadiness(rows);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.sms, { kind: "missing" });
});

test("both channel rows missing → not ready, both classified as missing", () => {
  const readiness = assessApproveReadiness([]);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.email, { kind: "missing" });
  assert.deepEqual(readiness.sms, { kind: "missing" });
});

test("duplicate channel rows (structurally impossible in production — unique(reminder_log_id, channel) — tested defensively) → not ready, classified as duplicate, never silently picks one row", () => {
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: "pending" },
    { channel: "email", status: "sent" },
    { channel: "sms", status: "pending" },
  ];
  const readiness = assessApproveReadiness(rows);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.email, { kind: "duplicate" });
});

for (const status of ["sending", "delivery_unknown", "sent", "undelivered", "dismissed"] as const) {
  test(`email ${status} → not ready`, () => {
    const rows: ChannelStatusRow[] = [
      { channel: "email", status },
      { channel: "sms", status: "pending" },
    ];
    const readiness = assessApproveReadiness(rows);
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.email, { kind: "not_ready", status });
  });

  test(`SMS ${status} → not ready`, () => {
    const rows: ChannelStatusRow[] = [
      { channel: "email", status: "pending" },
      { channel: "sms", status },
    ];
    const readiness = assessApproveReadiness(rows);
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.sms, { kind: "not_ready", status });
  });
}

test("classifyChannelReadiness never returns ready for a status outside pending/failed", () => {
  for (const status of ["sending", "sent", "dismissed", "delivery_unknown", "undelivered"] as const) {
    const readiness = classifyChannelReadiness([{ channel: "email", status }], "email");
    assert.notEqual(readiness.kind, "ready");
  }
});

// ── channelRetryable: the undelivered-eligibility fix ───────────────────────

test("channelRetryable: a failed channel beside a sent sibling is retryable", () => {
  assert.equal(channelRetryable({ email: "sent", sms: "failed" }, "sms"), true);
});

test("channelRetryable: an undelivered channel is NEVER retryable — the provider already accepted it and confirmed non-delivery", () => {
  // Previously this returned true via DID_NOT_REACH (which also matches
  // `undelivered`) even though claimChannel()'s actual CAS predicate
  // (CHANNEL_CLAIMABLE_STATUSES = ["pending","failed"]) can never match an
  // `undelivered` row — offering a Retry action guaranteed to fail.
  assert.equal(channelRetryable({ email: "sent", sms: "undelivered" }, "sms"), false);
});

test("channelRetryable: a delivery_unknown channel is never retryable — genuine ambiguity is never auto-resolved into a retry", () => {
  assert.equal(channelRetryable({ email: "sent", sms: "delivery_unknown" }, "sms"), false);
});

test("channelRetryable: a missing channel (undefined) is never retryable", () => {
  assert.equal(channelRetryable({ email: "sent" }, "sms"), false);
});

// ── assessChannelStructure: the Review page's DIFFERENT question ───────────
//
// Deliberately NOT assessApproveReadiness(). Structural validity means
// "exactly one row per channel" — it does not care what that row's status
// is. A `sent`/`sending`/`delivery_unknown`/`undelivered` row is just as
// structurally valid as a `pending` one; only a missing or duplicate row is
// a real structural problem. This is the exact conflation the file-4 audit
// caught: assessApproveReadiness().ready was being reused here and made
// every legitimate non-claimable status look identical to a genuinely
// broken reminder.

test("assessChannelStructure: pending + pending → structurally valid", () => {
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: "pending" },
    { channel: "sms", status: "pending" },
  ];
  const s = assessChannelStructure(rows);
  assert.equal(s.valid, true);
  assert.equal(s.email, "present");
  assert.equal(s.sms, "present");
});

for (const status of ["failed", "sent", "sending", "delivery_unknown", "undelivered", "dismissed"] as const) {
  test(`assessChannelStructure: a lone ${status} row is still "present" — status never affects structural validity`, () => {
    const rows: ChannelStatusRow[] = [
      { channel: "email", status },
      { channel: "sms", status: "pending" },
    ];
    const s = assessChannelStructure(rows);
    assert.equal(s.email, "present");
    assert.equal(s.valid, true);
  });
}

test("assessChannelStructure: zero rows → both missing, invalid", () => {
  const s = assessChannelStructure([]);
  assert.equal(s.valid, false);
  assert.equal(s.email, "missing");
  assert.equal(s.sms, "missing");
});

test("assessChannelStructure: email-only (SMS row missing) → invalid", () => {
  const s = assessChannelStructure([{ channel: "email", status: "pending" }]);
  assert.equal(s.valid, false);
  assert.equal(s.email, "present");
  assert.equal(s.sms, "missing");
});

test("assessChannelStructure: SMS-only (email row missing) → invalid", () => {
  const s = assessChannelStructure([{ channel: "sms", status: "pending" }]);
  assert.equal(s.valid, false);
  assert.equal(s.sms, "present");
  assert.equal(s.email, "missing");
});

test("assessChannelStructure: duplicate email row → invalid, classified as duplicate, not silently collapsed", () => {
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: "pending" },
    { channel: "email", status: "sent" },
    { channel: "sms", status: "pending" },
  ];
  const s = assessChannelStructure(rows);
  assert.equal(s.valid, false);
  assert.equal(s.email, "duplicate");
});

test("assessChannelStructure: duplicate SMS row → invalid, classified as duplicate", () => {
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: "pending" },
    { channel: "sms", status: "pending" },
    { channel: "sms", status: "failed" },
  ];
  const s = assessChannelStructure(rows);
  assert.equal(s.valid, false);
  assert.equal(s.sms, "duplicate");
});

// ── Review-page approvability matches the server's STRUCTURAL model ────────
//
// reviewAvailability()'s `channelStructureReady` is wired from
// assessChannelStructure().valid (lib/reminder-review.ts), NOT from
// assessApproveReadiness().ready. These tests exercise the pure function
// directly with that distinction in mind.

test("reviewAvailability: channelStructureReady=false blocks approval regardless of an otherwise-claimable status", () => {
  const { blockedReason, approvable } = reviewAvailability({
    status: "pending",
    eligible: true,
    channelStructureReady: false,
    freshApproveReady: true,
  });
  assert.equal(approvable, false);
  assert.equal(blockedReason, "channel_state_not_ready");
});

test("reviewAvailability: channelStructureReady outranks every other blocked reason when structure is genuinely broken", () => {
  const { blockedReason } = reviewAvailability({
    status: "failed",
    eligible: true,
    partiallySent: true,
    channelStructureReady: false,
    freshApproveReady: false,
  });
  assert.equal(blockedReason, "channel_state_not_ready", "structural validity must be checked before partiallySent/retryable/fresh_approve_not_ready");
});

// The old "omitting channelStructureReady defaults to true" test is gone:
// that default no longer exists. channelStructureReady is now a REQUIRED
// argument — every caller must state explicitly whether the channel rows
// are structurally intact, so a future caller cannot silently bypass this
// check merely by forgetting the field. (Omitting it is now a TypeScript
// compile error, not a runtime fallback — nothing here can exercise a
// "default" that has been removed.)

test("reviewAvailability: a normal claimable reminder with structurally valid, fresh-approve-ready channels is still approvable", () => {
  const { approvable, blockedReason } = reviewAvailability({
    status: "pending",
    eligible: true,
    channelStructureReady: true,
    freshApproveReady: true,
  });
  assert.equal(approvable, true);
  assert.equal(blockedReason, null);
});

// ── THE FILE-4 AUDIT FIX: legitimate lifecycle states reach their OWN branch ─
//
// Each case: structurally valid (exactly one row per channel — the status
// values below are irrelevant to that), so channelStructureReady=true, and
// the pre-existing, specific blockedReason for that status/flag must be the
// one reported — never masked behind channel_state_not_ready.

test("reviewAvailability: sent + failed with partiallySent=true, structurally valid → partially_sent, not channel_state_not_ready or fresh_approve_not_ready", () => {
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: "sent" },
    { channel: "sms", status: "failed" },
  ];
  const s = assessChannelStructure(rows);
  const r = assessApproveReadiness(rows);
  assert.equal(s.valid, true);
  assert.equal(r.ready, false, "sent is not Fresh-Approve claimable — this case exercises partiallySent outranking the new fallback too");
  const { blockedReason, approvable } = reviewAvailability({
    status: "sent",
    eligible: true,
    partiallySent: true,
    channelStructureReady: s.valid,
    freshApproveReady: r.ready,
  });
  assert.equal(blockedReason, "partially_sent");
  assert.equal(approvable, false);
});

test("reviewAvailability: sent + sent, structurally valid → sent, not channel_state_not_ready or fresh_approve_not_ready", () => {
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: "sent" },
    { channel: "sms", status: "sent" },
  ];
  const s = assessChannelStructure(rows);
  const r = assessApproveReadiness(rows);
  assert.equal(s.valid, true);
  assert.equal(r.ready, false);
  const { blockedReason, approvable } = reviewAvailability({
    status: "sent",
    eligible: true,
    channelStructureReady: s.valid,
    freshApproveReady: r.ready,
  });
  assert.equal(blockedReason, "sent");
  assert.equal(approvable, false);
});

test("reviewAvailability: sending + pending, structurally valid → sending, not channel_state_not_ready or fresh_approve_not_ready", () => {
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: "sending" },
    { channel: "sms", status: "pending" },
  ];
  const s = assessChannelStructure(rows);
  const r = assessApproveReadiness(rows);
  assert.equal(s.valid, true);
  assert.equal(r.ready, false);
  const { blockedReason, approvable } = reviewAvailability({
    status: "sending",
    eligible: true,
    channelStructureReady: s.valid,
    freshApproveReady: r.ready,
  });
  assert.equal(blockedReason, "sending");
  assert.equal(approvable, false);
});

test("reviewAvailability: delivery_unknown + pending, structurally valid → delivery_unknown, not channel_state_not_ready or fresh_approve_not_ready", () => {
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: "delivery_unknown" },
    { channel: "sms", status: "pending" },
  ];
  const s = assessChannelStructure(rows);
  const r = assessApproveReadiness(rows);
  assert.equal(s.valid, true);
  assert.equal(r.ready, false);
  const { blockedReason, approvable } = reviewAvailability({
    status: "delivery_unknown",
    eligible: true,
    channelStructureReady: s.valid,
    freshApproveReady: r.ready,
  });
  assert.equal(blockedReason, "delivery_unknown");
  assert.equal(approvable, false);
});

test("reviewAvailability: zero channel rows → structurally invalid → channel_state_not_ready", () => {
  const rows: ChannelStatusRow[] = [];
  const s = assessChannelStructure(rows);
  const r = assessApproveReadiness(rows);
  assert.equal(s.valid, false);
  const { blockedReason, approvable } = reviewAvailability({
    status: "pending",
    eligible: true,
    channelStructureReady: s.valid,
    freshApproveReady: r.ready,
  });
  assert.equal(blockedReason, "channel_state_not_ready");
  assert.equal(approvable, false);
});

test("reviewAvailability: failed + failed, structurally valid AND fresh-approve-ready → retryable (fresh-approve semantics unaffected)", () => {
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: "failed" },
    { channel: "sms", status: "failed" },
  ];
  const s = assessChannelStructure(rows);
  const r = assessApproveReadiness(rows);
  assert.equal(s.valid, true);
  assert.equal(r.ready, true, "failed is Fresh-Approve claimable");
  const { blockedReason, approvable } = reviewAvailability({
    status: "failed",
    eligible: true,
    channelStructureReady: s.valid,
    freshApproveReady: r.ready,
  });
  assert.equal(blockedReason, "retryable");
  assert.equal(approvable, true);
});

// ── THE FOLLOW-UP AUDIT FIX: the freshApproveReady fallback ─────────────────
//
// Before this correction, these exact combinations left reviewAvailability
// reporting `blockedReason: null` or `"retryable"` — approvable=true — even
// though a fresh Approve was never actually going to succeed, because none
// of the specific existing branches (partiallySent/sent/dismissed/sending/
// delivery_unknown/undelivered) recognized them. The Review page would have
// shown a live, clickable Approve button with no warning at all.

test("reviewAvailability: parent=pending, sent + pending → fresh_approve_not_ready (previously fell through to approvable=true)", () => {
  const statuses = { email: "sent" as const, sms: "pending" as const };
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: statuses.email },
    { channel: "sms", status: statuses.sms },
  ];
  const s = assessChannelStructure(rows);
  const r = assessApproveReadiness(rows);
  const partiallySent = partiallySentFromStatuses(statuses);
  assert.equal(s.valid, true);
  assert.equal(r.ready, false);
  assert.equal(partiallySent, false, "reached-but-not-missed: sent+pending is not partiallySent under the existing definition");
  const { blockedReason, approvable } = reviewAvailability({
    status: "pending",
    eligible: true,
    partiallySent,
    channelStructureReady: s.valid,
    freshApproveReady: r.ready,
  });
  assert.equal(blockedReason, "fresh_approve_not_ready");
  assert.equal(approvable, false);
});

test("reviewAvailability: parent=failed, sending + failed → fresh_approve_not_ready (previously reported retryable)", () => {
  const statuses = { email: "sending" as const, sms: "failed" as const };
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: statuses.email },
    { channel: "sms", status: statuses.sms },
  ];
  const s = assessChannelStructure(rows);
  const r = assessApproveReadiness(rows);
  const partiallySent = partiallySentFromStatuses(statuses);
  assert.equal(r.ready, false);
  const { blockedReason, approvable } = reviewAvailability({
    status: "failed",
    eligible: true,
    partiallySent,
    channelStructureReady: s.valid,
    freshApproveReady: r.ready,
  });
  assert.equal(blockedReason, "fresh_approve_not_ready", "a full Approve is NOT safe while the sibling channel is still sending");
  assert.equal(approvable, false);
});

test("reviewAvailability: parent=pending, delivery_unknown + pending → fresh_approve_not_ready (previously fell through to approvable=true)", () => {
  const statuses = { email: "delivery_unknown" as const, sms: "pending" as const };
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: statuses.email },
    { channel: "sms", status: statuses.sms },
  ];
  const s = assessChannelStructure(rows);
  const r = assessApproveReadiness(rows);
  const partiallySent = partiallySentFromStatuses(statuses);
  assert.equal(r.ready, false);
  const { blockedReason, approvable } = reviewAvailability({
    status: "pending",
    eligible: true,
    partiallySent,
    channelStructureReady: s.valid,
    freshApproveReady: r.ready,
  });
  assert.equal(
    blockedReason,
    "fresh_approve_not_ready",
    "a channel that may already be delivered must never be silently offered as approvable"
  );
  assert.equal(approvable, false);
});

test("reviewAvailability: parent=failed, undelivered + failed → fresh_approve_not_ready (previously reported retryable)", () => {
  const statuses = { email: "undelivered" as const, sms: "failed" as const };
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: statuses.email },
    { channel: "sms", status: statuses.sms },
  ];
  const s = assessChannelStructure(rows);
  const r = assessApproveReadiness(rows);
  const partiallySent = partiallySentFromStatuses(statuses);
  assert.equal(r.ready, false);
  const { blockedReason, approvable } = reviewAvailability({
    status: "failed",
    eligible: true,
    partiallySent,
    channelStructureReady: s.valid,
    freshApproveReady: r.ready,
  });
  assert.equal(blockedReason, "fresh_approve_not_ready");
  assert.equal(approvable, false);
});

test("reviewAvailability: parent=failed, dismissed + failed → fresh_approve_not_ready (previously reported retryable)", () => {
  const statuses = { email: "dismissed" as const, sms: "failed" as const };
  const rows: ChannelStatusRow[] = [
    { channel: "email", status: statuses.email },
    { channel: "sms", status: statuses.sms },
  ];
  const s = assessChannelStructure(rows);
  const r = assessApproveReadiness(rows);
  const partiallySent = partiallySentFromStatuses(statuses);
  assert.equal(r.ready, false);
  const { blockedReason, approvable } = reviewAvailability({
    status: "failed",
    eligible: true,
    partiallySent,
    channelStructureReady: s.valid,
    freshApproveReady: r.ready,
  });
  assert.equal(blockedReason, "fresh_approve_not_ready");
  assert.equal(approvable, false);
});

// ── Integration: approveAndSendReminder refuses BEFORE allowance/provider ──

async function approveWithChannels(channelDb: FakeChannelDb) {
  const db = new FakeApprovalDb([makeStoredReminder({})]);
  const mailer = new FakeMailer();
  const texter = new FakeTexter();
  const allowance = new FakeAllowanceStore();
  const deps = makeDeps(db, mailer, { texter, channelDb, allowance });
  const result = await approveAndSendReminder(deps, {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });
  return { result, mailer, texter, allowance };
}

test("zero-channel-row reminder: Approve refuses with channel_state_not_ready, contacts no provider, claims no allowance", async () => {
  const { result, mailer, texter, allowance } = await approveWithChannels(new FakeChannelDb([]));

  // 409, not 503 — a conflict with this reminder's own recorded state, not
  // a system-wide outage. Matches sending/sent/delivery_unknown/undelivered.
  assert.equal(result.status, 409);
  assert.equal(result.outcome, "channel_state_not_ready");
  assert.equal(result.body.success, false);
  assert.equal(mailer.calls.length, 0, "Resend must never be contacted");
  assert.equal(texter.calls.length, 0, "Twilio must never be contacted");
  assert.equal(allowance.slots.size, 0, "no Founding Beta slot may be consumed for a structurally impossible send");
});

test("email-only reminder (SMS row missing): Approve refuses before any provider call", async () => {
  const { result, mailer, texter, allowance } = await approveWithChannels(
    new FakeChannelDb([{ channel: "email", status: "pending", sendAttemptCount: 0 }])
  );
  assert.equal(result.outcome, "channel_state_not_ready");
  assert.equal(mailer.calls.length, 0);
  assert.equal(texter.calls.length, 0);
  assert.equal(allowance.slots.size, 0);
});

test("SMS-only reminder (email row missing): Approve refuses before any provider call", async () => {
  const { result, mailer, texter, allowance } = await approveWithChannels(
    new FakeChannelDb([{ channel: "sms", status: "pending", sendAttemptCount: 0 }])
  );
  assert.equal(result.outcome, "channel_state_not_ready");
  assert.equal(mailer.calls.length, 0);
  assert.equal(texter.calls.length, 0);
  assert.equal(allowance.slots.size, 0);
});

test("a normal, fresh reminder (both rows pending) is unaffected — reaches dispatch and succeeds as before", async () => {
  const { result, mailer, texter } = await approveWithChannels(new FakeChannelDb());
  assert.equal(result.outcome, "sent");
  assert.equal(mailer.calls.length, 1);
  assert.equal(texter.calls.length, 1);
});

// ── approveAndSendReminder still enforces FRESH APPROVE via
// assessApproveReadiness() — untouched by this correction, only now scoped
// to its own gate (2) rather than doubling as the structural gate (1). A
// reminder whose channel rows are structurally valid (exactly one each — the
// Review page would now happily show its own sent/sending/delivery_unknown
// state) is still correctly refused here, because neither status is
// claimable (pending/failed) for a fresh send — but the refusal is now
// `fresh_approve_not_ready`, not the structural `channel_state_not_ready`,
// because these rows were never "unprepared".

test("Approve still refuses a structurally valid but already-sent reminder, now as fresh_approve_not_ready — assessApproveReadiness semantics unchanged", async () => {
  const { result, mailer, texter, allowance } = await approveWithChannels(
    new FakeChannelDb([
      { channel: "email", status: "sent", sendAttemptCount: 1 },
      { channel: "sms", status: "sent", sendAttemptCount: 1 },
    ])
  );
  assert.equal(result.outcome, "fresh_approve_not_ready");
  assert.equal(result.status, 409);
  assert.doesNotMatch(result.body.message as string, /wasn't fully prepared/, "an already-sent reminder was not left unprepared");
  assert.equal(mailer.calls.length, 0);
  assert.equal(texter.calls.length, 0);
  assert.equal(allowance.slots.size, 0);
});

test("Approve still refuses a structurally valid reminder mid-send (sending), now as fresh_approve_not_ready", async () => {
  const { result, mailer, texter } = await approveWithChannels(
    new FakeChannelDb([
      { channel: "email", status: "sending", sendAttemptCount: 1 },
      { channel: "sms", status: "pending", sendAttemptCount: 0 },
    ])
  );
  assert.equal(result.outcome, "fresh_approve_not_ready");
  assert.equal(mailer.calls.length, 0);
  assert.equal(texter.calls.length, 0);
});

test("Approve still refuses a structurally valid reminder with delivery_unknown, now as fresh_approve_not_ready", async () => {
  const { result, mailer, texter } = await approveWithChannels(
    new FakeChannelDb([
      { channel: "email", status: "delivery_unknown", sendAttemptCount: 1 },
      { channel: "sms", status: "pending", sendAttemptCount: 0 },
    ])
  );
  assert.equal(result.outcome, "fresh_approve_not_ready");
  assert.equal(mailer.calls.length, 0);
  assert.equal(texter.calls.length, 0);
});

test("the two gates are genuinely separate: missing row still reports channel_state_not_ready, not fresh_approve_not_ready", async () => {
  const { result } = await approveWithChannels(
    new FakeChannelDb([{ channel: "email", status: "pending", sendAttemptCount: 0 }])
  );
  assert.equal(result.outcome, "channel_state_not_ready");
  assert.match(result.body.message as string, /wasn't fully prepared/);
});

// ── The pre-flight is NOT the concurrency guard — the CAS still is ─────────

/**
 * Simulates a concurrent request claiming the SMS channel in the exact gap
 * between this pre-flight's read (which sees `pending`, genuinely) and the
 * real claim moments later. The pre-flight has no way to know this — it
 * is a read, not a lock — and it must not need to: claimChannel()'s own
 * atomic UPDATE re-evaluates the row's CURRENT state and correctly refuses.
 */
class RaceyFakeChannelDb extends FakeChannelDb {
  async claimChannel(input: Parameters<FakeChannelDb["claimChannel"]>[0]) {
    if (input.channel === "sms") {
      this.rows.set("sms", { channel: "sms", status: "sending", sendAttemptCount: 1 });
    }
    return super.claimChannel(input);
  }
}

test("state that changes AFTER the readiness pre-flight is still rejected by the existing atomic channel claim, not by the pre-flight", async () => {
  const channelDb = new RaceyFakeChannelDb(); // starts both pending — pre-flight sees "ready"
  const { result, mailer, texter } = await approveWithChannels(channelDb);

  // The pre-flight passed (both were genuinely pending when it read them),
  // so email dispatches normally...
  assert.equal(mailer.calls.length, 1, "email's claim was never contested — it dispatches");
  // ...but SMS's claim finds the row already moved by the simulated
  // concurrent request, and correctly refuses without ever contacting Twilio.
  assert.equal(texter.calls.length, 0, "Twilio is never contacted once the CAS finds the row already claimed");
  // The outcome is the pre-existing, correct "ambiguous, don't retry"
  // handling for a lost claim race — unchanged by this phase.
  assert.equal(result.outcome, "delivery_unknown");
});
