process.env.REVIEW_TOKEN_SECRET ??= "test-review-token-secret";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { approveAndSendReminder, retryReminderChannel } from "@/lib/reminder-approval";
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
import { reviewAvailability, SEND_STATE_COPY } from "@/lib/reminder-send-state";
import { decideSmsReconcile } from "@/lib/sms-reconcile";
import { classifyTwilioDelivery, channelStatusForTwilioDelivery } from "@/lib/twilio-send-state";
import { buildAttentionItems } from "@/lib/overview-attention";

/**
 * The partial-send RECOVERY journey.
 *
 * Pass 1 made the dispatcher correct. It did not make the journey visible or
 * reachable: Active Chasing read the parent status alone, Reminder Review said
 * "It was approved and sent to your customer. It can't be sent again", and
 * nothing could invoke the single-channel retry the dispatcher supported.
 *
 * These tests drive the recovery end to end at the service layer and pin the
 * consumer surfaces that were lying.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const code = (f: string) =>
  read(f)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** A reminder whose email landed and whose SMS did not. */
function partialState(failed: "email" | "sms" = "sms") {
  return new FakeChannelDb([
    { channel: "email", status: failed === "email" ? "failed" : "sent", sendAttemptCount: 1 },
    { channel: "sms", status: failed === "sms" ? "failed" : "sent", sendAttemptCount: 1 },
  ]);
}

function deps(channelDb: FakeChannelDb, over: Parameters<typeof makeDeps>[2] = {}) {
  const db = new FakeApprovalDb([makeStoredReminder({ status: "sent" })]);
  const mailer = new FakeMailer();
  const texter = new FakeTexter();
  const allowance = new FakeAllowanceStore();
  return {
    db,
    mailer,
    texter,
    allowance,
    channelDb,
    d: makeDeps(db, mailer, { texter, channelDb, allowance, ...over }),
  };
}

// ── The API contract for a partial send ────────────────────────────────────

test("a partial send answers `partially_sent`, never `sent`", async () => {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  const texter = new FakeTexter();
  texter.behaviour = () => ({ ok: false, outcome: "rejected", message: "21211" });
  const channelDb = new FakeChannelDb();

  const d = makeDeps(db, mailer, { texter, channelDb });
  const result = await approveAndSendReminder(d, {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });

  // THE PASS-1 BUG. `state: "sent"` put this in ReminderReviewPanel's
  // unsafeToRetry list, which disabled the action permanently — a partial send
  // appeared as a red error with no way out.
  assert.equal(result.body.state, "partially_sent");
  assert.notEqual(result.body.state, "sent");
  assert.equal(result.body.success, false);
  assert.equal(result.body.retryableChannel, "sms");

  // The DATABASE status is still `sent` — the coarse lifecycle both live
  // triggers act on. Only the API's `state` differs.
  assert.equal(db.get().status, "sent");
});

test("no caller can read a 207 as success", () => {
  const client = code("lib/reminders.ts");

  // approveReminder and retryReminderChannel both return the parsed body
  // unconditionally. A `res.ok` branch would render a 207 partial as a clean
  // send, because 207 IS a 2xx.
  assert.equal(/res\.ok|response\.ok/.test(client), false,
    "the JSON `success` field is the contract, not the HTTP status");
  assert.match(client, /return await res\.json\(\);/);

  // And the one component that consumes it branches on `success`.
  const panel = code("components/dashboard/ReminderReviewPanel.tsx");
  assert.match(panel, /if \(!result\.success\)/);
  assert.equal(/\.ok\b/.test(panel), false);

  // The panel must no longer treat a partial as unsafe-to-retry: `sent` is in
  // that list, which is exactly why the API state had to stop being "sent".
  const unsafe = panel.slice(panel.indexOf("const unsafeToRetry"), panel.indexOf("if (result.state === \"stale_review\")"));
  assert.equal(/"partially_sent"/.test(unsafe), false,
    "a partial send must not disable recovery");
});

// ── Reminder Review tells the truth ────────────────────────────────────────

test("Reminder Review never claims both channels were sent", () => {
  const partial = reviewAvailability({ status: "sent", eligible: true, partiallySent: true });
  assert.equal(partial.blockedReason, "partially_sent");
  assert.equal(partial.approvable, false, "the whole reminder must not be re-approved");

  const copy = SEND_STATE_COPY.partially_sent;
  assert.match(copy.title, /didn't send/);
  assert.match(copy.body, /retry just the channel that failed/);
  // The sentence that was false.
  assert.equal(/It was approved and sent to your customer/.test(copy.body), false);
  assert.equal(/can't be sent again/.test(copy.body), false);

  // A fully-sent reminder keeps the original, correct wording.
  const full = reviewAvailability({ status: "sent", eligible: true, partiallySent: false });
  assert.equal(full.blockedReason, "sent");
  assert.match(SEND_STATE_COPY.sent.body, /can't be sent again/);
});

test("partial outranks `sent`, so the true state cannot be masked", () => {
  const src = code("lib/reminder-send-state.ts");
  const partialAt = src.indexOf('if (partiallySent) blockedReason = "partially_sent";');
  const sentAt = src.indexOf('else if (status === "sent") blockedReason = "sent";');
  assert.ok(partialAt > -1 && sentAt > partialAt, "the partial check must come first");

  // The review loader reads the CHILD rows, not the parent alone.
  const review = code("lib/reminder-review.ts");
  assert.match(review, /from\("reminder_channel_messages"\)/);
  assert.match(review, /partiallySentFromStatuses\(channelStatuses\)/);
  assert.match(review, /partiallySent,/);
  assert.match(review, /retryableChannel/);
});

test("the review panel offers recovery for the failed channel only", () => {
  const panel = code("components/dashboard/ReminderReviewPanel.tsx");
  assert.match(panel, /data\.partiallySent &&/);
  assert.match(panel, /retryReminderChannel\(data\.reminderId, data\.retryableChannel\)/);
  assert.match(panel, /Retry \$\{CHANNEL_LABEL\[data\.retryableChannel\]\} only/);
  // The button exists ONLY when a channel is retryable.
  assert.match(panel, /\{data\.retryableChannel && \(/);

  // The old email-only claims are gone.
  assert.equal(/no SMS is sent/.test(panel), false);
  assert.equal(/This sends a real email\./.test(panel), false);
  assert.match(panel, /sends the SMS and the email/);
});

// ── Active Chasing surfaces it ─────────────────────────────────────────────

test("Active Chasing shows Partially sent, above every other state", () => {
  const list = code("components/dashboard/ActiveChasingList.tsx");
  // reminderStateLabel() itself lives in lib/reminder-state-label.ts, not in
  // this component — pulled out so it can be unit-tested directly (a .tsx
  // file with JSX cannot be imported into this project's plain
  // `node --test` runner). The label function's own logic is checked
  // against its real source; the render-site wiring below stays checked
  // against the component.
  const fnSource = code("lib/reminder-state-label.ts");

  // The partial branch must be FIRST in reminderStateLabel — it is the only
  // state describing something that went wrong on a real send.
  const fn = fnSource.slice(fnSource.indexOf("export function reminderStateLabel"), fnSource.indexOf("const eligibility ="));
  const partialAt = fn.indexOf('text: "Partially sent"');
  const pendingAt = fn.indexOf('text: "Ready for review"');
  assert.ok(partialAt > -1, "the row must have a partial state");
  assert.ok(partialAt < pendingAt, "partial outranks every other row state");

  // The GUARD, not just the string. A mutant that changed the condition to
  // `if (false)` left the branch — and every assertion about its contents —
  // intact while the row silently went back to hiding partial sends.
  assert.match(fn, /if \(partialSummary\) \{/,
    "the partial branch must be driven by the summary, not disabled");
  assert.equal(/if \(false\)/.test(fn), false);
  // And the summary must reach the label function from the caller.
  assert.match(fnSource, /partialSummary: string \| null = null/);
  // Both render sites — mobile card and desktop row — must receive it. A
  // mutant that passed `null` at one of them left the other correct and the
  // partial invisible on that breakpoint.
  const wired = list.match(/reminderStateLabel\(inv, pendingReminderInvoiceIds\.has\(inv\.id\), allowanceSpent, partialByInvoice\[inv\.id\] \?\? null\)/g) ?? [];
  assert.equal(wired.length, 2, `both render sites must pass the summary, found ${wired.length}`);

  // It names the channels in plain words, and never a provider or a code.
  assert.match(fn, /detail: partialSummary/);
  for (const jargon of [/twilio/i, /resend/i, /error[_ ]code/i, /\b21\d{3}\b/]) {
    assert.equal(jargon.test(list), false, `Active Chasing must not show ${jargon}`);
    assert.equal(jargon.test(fnSource), false, `reminderStateLabel must not show ${jargon}`);
  }

  // Derived from the CHILD rows, not the parent status.
  const page = code("app/dashboard/chasing/page.tsx");
  assert.match(page, /partialSendSummary\(/);
  assert.match(page, /channelStatuses\[r\.id\]/);
  assert.match(page, /partialByInvoice=\{partialByInvoice\}/);

  // And the dashboard actually loads them.
  const provider = code("components/dashboard/DashboardProvider.tsx");
  assert.match(provider, /fetchChannelStatuses\(supabase\)/);
  assert.match(provider, /setChannelStatuses\(channels\)/);
});

test("Needs Attention raises a partial send whose parent says `sent`", () => {
  const invoice = {
    id: "inv-1", customer_name: "Dave", invoice_reference: null, amount: 1,
    due_date: "2020-01-01", status: "unpaid",
    reminder_schedules: ["overdue_7_days"], reminders_sent: ["overdue_7_days"],
  } as never;
  const sent = { id: "rem-1", invoice_id: "inv-1", status: "sent" } as never;

  const raised = buildAttentionItems({
    invoices: [invoice], pendingReminders: [], reminderHistory: [sent],
    channelStatuses: { "rem-1": { email: "sent", sms: "failed" } },
    needsDecisionInvoiceIds: new Set(),
  });
  const item = raised.find((i) => i.kind === "send_failed");
  assert.ok(item, "a partially-sent reminder must reach Needs Attention");
  assert.equal(item!.partialSummary, "Email sent · SMS failed");

  // Both channels through stays quiet.
  const quiet = buildAttentionItems({
    invoices: [invoice], pendingReminders: [], reminderHistory: [sent],
    channelStatuses: { "rem-1": { email: "sent", sms: "sent" } },
    needsDecisionInvoiceIds: new Set(),
  });
  assert.equal(quiet.filter((i) => i.kind === "send_failed").length, 0);
});

// ── Single-channel recovery, end to end ────────────────────────────────────

test("email sent + SMS failed → SMS-only retry, email never touched", async () => {
  const { d, mailer, texter, channelDb, allowance } = deps(partialState("sms"));

  const result = await retryReminderChannel(d, { reminderId: REMINDER_ID, channel: "sms" });

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(mailer.calls.length, 0, "THE successful email must never be resent");
  assert.equal(texter.calls.length, 1);
  assert.equal(channelDb.rows.get("email")!.status, "sent");
  assert.equal(channelDb.rows.get("sms")!.status, "sent");

  // The unit was consumed by the first attempt. Recovery must not claim a
  // second one, and must not hand one back.
  assert.equal(allowance.calls.length, 0, "recovery must not touch the allowance");
});

test("SMS sent + email failed → email-only retry, symmetrical", async () => {
  const { d, mailer, texter, channelDb, allowance } = deps(partialState("email"));

  const result = await retryReminderChannel(d, { reminderId: REMINDER_ID, channel: "email" });

  assert.equal(result.body.success, true);
  assert.equal(texter.calls.length, 0, "the successful SMS must never be resent");
  assert.equal(mailer.calls.length, 1);
  assert.equal(channelDb.rows.get("sms")!.status, "sent");
  assert.equal(allowance.calls.length, 0);
});

test("the channel that SUCCEEDED can never be retried", async () => {
  const { d, mailer, texter } = deps(partialState("sms"));

  // Asking to retry the channel that worked is refused outright.
  const result = await retryReminderChannel(d, { reminderId: REMINDER_ID, channel: "email" });

  assert.equal(result.status, 409);
  assert.equal(result.body.state, "not_retryable");
  assert.equal(mailer.calls.length, 0);
  assert.equal(texter.calls.length, 0);
});

test("both-failed is NOT a single-channel retry — it goes back through approve", async () => {
  const bothFailed = new FakeChannelDb([
    { channel: "email", status: "failed", sendAttemptCount: 1 },
    { channel: "sms", status: "failed", sendAttemptCount: 1 },
  ]);
  const { d, mailer, texter } = deps(bothFailed);

  const result = await retryReminderChannel(d, { reminderId: REMINDER_ID, channel: "sms" });
  assert.equal(result.body.state, "not_retryable");
  assert.equal(mailer.calls.length + texter.calls.length, 0);
});

test("an unresolved channel is never retryable — it may already be delivered", async () => {
  const unresolved = new FakeChannelDb([
    { channel: "email", status: "sent", sendAttemptCount: 1 },
    { channel: "sms", status: "delivery_unknown", sendAttemptCount: 1 },
  ]);
  const { d, texter } = deps(unresolved);

  const result = await retryReminderChannel(d, { reminderId: REMINDER_ID, channel: "sms" });
  assert.equal(result.body.state, "not_retryable");
  assert.equal(texter.calls.length, 0, "a retry here would be a SECOND text");
});

test("a retry that fails again stays partial, and does not release the unit", async () => {
  const { d, allowance, channelDb } = deps(partialState("sms"), {});
  (d.texter as FakeTexter).behaviour = () => ({ ok: false, outcome: "rejected", message: "21211" });

  const result = await retryReminderChannel(d, { reminderId: REMINDER_ID, channel: "sms" });

  assert.equal(result.body.state, "partially_sent");
  assert.equal(result.body.retryableChannel, "sms");
  assert.equal(channelDb.rows.get("email")!.status, "sent", "the email is untouched");
  assert.equal(allowance.calls.length, 0, "one channel failing never refunds the unit");
});

test("an ambiguous retry parks the channel and refuses further attempts", async () => {
  const channelDb = partialState("sms");
  const { d } = deps(channelDb);
  (d.texter as FakeTexter).behaviour = () => ({ ok: false, outcome: "unknown", message: "hang up" });

  const result = await retryReminderChannel(d, { reminderId: REMINDER_ID, channel: "sms" });

  assert.equal(result.body.state, "delivery_unknown");
  assert.equal(channelDb.rows.get("sms")!.status, "delivery_unknown");

  // A second attempt is now refused — the customer may already have it.
  const again = await retryReminderChannel(d, { reminderId: REMINDER_ID, channel: "sms" });
  assert.equal(again.body.state, "not_retryable");
});

test("recovery is refused for a paid invoice, and for a missing mobile", async () => {
  const paid = new FakeApprovalDb([
    makeStoredReminder({ status: "sent", invoice: { status: "paid" } as never }),
  ]);
  const paidDeps = makeDeps(paid, new FakeMailer(), {
    texter: new FakeTexter(),
    channelDb: partialState("sms"),
  });
  const paidResult = await retryReminderChannel(paidDeps, { reminderId: REMINDER_ID, channel: "sms" });
  assert.equal(paidResult.status, 409);
  assert.match(String(paidResult.body.message), /marked paid/);

  // The number may have been removed since the first attempt.
  const noPhone = new FakeApprovalDb([
    makeStoredReminder({ status: "sent", invoice: { customerPhone: null } as never }),
  ]);
  const texter = new FakeTexter();
  const phoneResult = await retryReminderChannel(
    makeDeps(noPhone, new FakeMailer(), { texter, channelDb: partialState("sms") }),
    { reminderId: REMINDER_ID, channel: "sms" }
  );
  assert.equal(phoneResult.body.state, "missing_phone");
  assert.equal(texter.calls.length, 0);
});

test("the retry route verifies the session and refuses an unknown channel", () => {
  const route = code("app/api/reminders/[id]/channels/[channel]/retry/route.ts");
  assert.match(route, /await supabase\.auth\.getUser\(\)/);
  assert.match(route, /CHANNELS\.includes\(params\.channel\)/);
  assert.match(route, /status: 400/);
  assert.match(route, /makeApprovalDeps\(supabase, user\.id, user\.email \?\? null\)/);
  // It must never touch the parent status.
  assert.equal(/reminder_logs/.test(route), false);
});

test("the retry path structurally cannot dispatch the other channel", () => {
  const service = code("lib/reminder-approval.ts");
  // `only` restricts the dispatch loop to one channel, so the other's provider
  // is never called — a property of the code, not a check that can be skipped.
  assert.match(service, /only\?: ReminderChannel;/);
  assert.match(service, /const channels = input\.only \? \(\[input\.only\] as const\) : \(\["email", "sms"\] as const\);/);
  assert.match(service, /only: channel,/);
  // And no allowance call anywhere in the retry function.
  const retry = service.slice(service.indexOf("export async function retryReminderChannel"));
  assert.equal(/allowance\.(claim|release)/.test(retry), false,
    "one logical reminder is one unit — recovery must not claim or refund");
});

// ── Twilio delivery reconciliation ─────────────────────────────────────────

test("reconciliation resolves a DELIVERED message", () => {
  const action = decideSmsReconcile({
    ok: true, found: true, status: "delivered", errorCode: null, message: "ok",
  });
  assert.deepEqual(action, { kind: "resolve", status: "sent", event: "delivered" });
});

test("reconciliation resolves an UNDELIVERED message, and it is not retryable", () => {
  const action = decideSmsReconcile({
    ok: true, found: true, status: "undelivered", errorCode: 30003, message: "ok",
  });
  assert.equal(action.kind, "resolve");
  assert.equal(action.kind === "resolve" ? action.status : null, "undelivered");
  // `undelivered` is excluded from CHANNEL_CLAIMABLE_STATUSES, so this cannot
  // become a retry — Twilio definitely accepted it and another attempt at the
  // same number is a second submission.
  const state = code("lib/reminder-channel-state.ts");
  assert.match(state, /CHANNEL_CLAIMABLE_STATUSES: readonly ReminderSendStatus\[\] = \["pending", "failed"\]/);
});

test("reconciliation leaves a STILL-PENDING message alone", () => {
  for (const status of ["queued", "accepted", "sending", "sent", "scheduled"]) {
    const action = decideSmsReconcile({ ok: true, found: true, status, errorCode: null, message: "ok" });
    assert.equal(action.kind, "in_flight", `${status} is not a conclusion`);
  }
  // Twilio's `sent` is IN FLIGHT — the opposite of Resend's, where it means
  // dispatched and is treated as delivered.
  assert.equal(classifyTwilioDelivery("sent"), "in_flight");
  assert.equal(channelStatusForTwilioDelivery("sent"), null);
});

test("provider ambiguity never becomes a failure", () => {
  const cases = [
    { ok: false, found: false, status: null, errorCode: null, message: "timeout" },
    { ok: true, found: false, status: null, errorCode: null, message: "not found" },
    { ok: true, found: true, status: "something_new", errorCode: null, message: "ok" },
    { ok: true, found: true, status: null, errorCode: null, message: "ok" },
  ];
  for (const lookup of cases) {
    const action = decideSmsReconcile(lookup);
    assert.equal(action.kind, "ambiguous", `${JSON.stringify(lookup)} must not resolve`);
  }
  // Nothing ambiguous may write a status at all.
  for (const lookup of cases) {
    const action = decideSmsReconcile(lookup);
    assert.equal("status" in action, false);
  }
});

test("the SMS pass never touches the parent reminder", () => {
  const cron = code("app/api/cron/reconcile-reminders/route.ts");
  const pass = cron.slice(cron.indexOf("function makeSmsDb("), cron.indexOf("function makeDb("));
  assert.ok(pass.length > 0);
  assert.equal(/reminder_logs/.test(pass), false,
    "a carrier rejection on one channel does not change the parent lifecycle");
  assert.match(pass, /from\("reminder_channel_messages"\)/);
  assert.match(pass, /\.eq\("channel", "sms"\)/);
  // SMS_RECONCILE_STATUSES selects which rows to ASK about. It is no longer the
  // write guard — see tests/sms-reconcile-race.test.ts for what replaced it.
  assert.match(pass, /\.in\("status", SMS_RECONCILE_STATUSES as string\[\]\)/);
  // Only rows we can actually ask about.
  assert.match(pass, /\.not\("provider_message_id", "is", null\)/);
});

test("no public Twilio webhook was added", () => {
  const route = read("app/api/cron/reconcile-reminders/route.ts");
  assert.match(route, /isAuthorisedCronRequest/);
  const twilio = code("lib/twilio.ts");
  assert.match(twilio, /fetchTwilioMessage/);
  // Polling reuses the existing authorised cron; no new public surface.
  assert.equal(/validateRequest|X-Twilio-Signature/i.test(twilio), false);
});
