process.env.REVIEW_TOKEN_SECRET ??= "test-review-token-secret";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

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
import { normaliseUkMobile } from "@/lib/phone";
import { classifyTwilioError, isAcceptedTwilioStatus, isDefinitelyRejectedTwilioCode } from "@/lib/twilio-send-state";
import {
  aggregateChannelOutcomes,
  partiallySentFromStatuses,
  partialSendSummary,
  channelRetryable,
  failedChannels,
} from "@/lib/reminder-aggregate";
import { channelAttemptKey, isChannelClaimable } from "@/lib/reminder-channel-state";
import { isClaimable as isClaimableParent } from "@/lib/reminder-send-state";

/**
 * SMS as an EQUAL channel.
 *
 * ── THE TWO UNSAFE ANSWERS THIS SUITE EXISTS TO PREVENT ───────────────────
 *
 * `parent = failed` when one channel succeeded. Migration 011's
 * reminder_logs_allowance_sync trigger releases the unit on failed, and failed
 * is claimable — so an accepted email would be refunded AND retried, emailing a
 * real customer twice.
 *
 * `parent = sent`, read as the whole truth. Ten consumers treat sent as clean
 * success, including Needs Attention, which is the surface that exists to catch
 * broken sends.
 *
 * So the parent stays coarse and durable, and `partiallySent` is derived from
 * the child rows. Nothing here writes a status the database CHECK constraint
 * does not already contain.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const code = (f: string) =>
  read(f)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Runs one approval with independently-controlled channels. */
async function approve(opts: {
  email?: "accept" | "reject" | "ambiguous";
  sms?: "accept" | "reject" | "ambiguous";
  phone?: string | null;
  channelDb?: FakeChannelDb;
  allowance?: FakeAllowanceStore;
}) {
  const db = new FakeApprovalDb([
    makeStoredReminder(
      opts.phone === undefined ? {} : { invoice: { customerPhone: opts.phone } as never }
    ),
  ]);

  const mailer = new FakeMailer();
  if (opts.email === "reject") {
    mailer.behaviour = () => ({ ok: false, code: "validation_error", message: "bad address" });
  } else if (opts.email === "ambiguous") {
    mailer.behaviour = () => ({ ok: false, code: "internal_server_error", message: "timeout" });
  }

  const texter = new FakeTexter();
  if (opts.sms === "reject") {
    texter.behaviour = () => ({ ok: false, outcome: "rejected", message: "21211: invalid To" });
  } else if (opts.sms === "ambiguous") {
    texter.behaviour = () => ({ ok: false, outcome: "unknown", message: "socket hang up" });
  }

  const channelDb = opts.channelDb ?? new FakeChannelDb();
  const allowance = opts.allowance ?? new FakeAllowanceStore();

  const deps = makeDeps(db, mailer, { texter, channelDb, allowance });
  const result = await approveAndSendReminder(deps, {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });

  return { result, db, mailer, texter, channelDb, allowance };
}

// ── The four outcome combinations ──────────────────────────────────────────

test("both channels accepted → clean success, one unit spent", async () => {
  const { result, db, mailer, texter, allowance } = await approve({});

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.outcome, "sent");
  assert.equal(result.body.partiallySent, undefined);
  assert.equal(db.get().status, "sent");

  // One message per channel. Never two of either.
  assert.equal(mailer.calls.length, 1);
  assert.equal(texter.calls.length, 1);

  // ONE unit for the PAIR — never one per channel.
  assert.equal(allowance.slots.size, 1);
  assert.equal(allowance.calls.filter((c) => c === "released").length, 0);
});

test("email accepted, SMS definitely rejected → partial, unit NOT released", async () => {
  const { result, db, channelDb, allowance } = await approve({ sms: "reject" });

  // 207, and success:false — no surface may render this as a clean send.
  assert.equal(result.status, 207);
  assert.equal(result.body.success, false);
  assert.equal(result.outcome, "partially_sent");
  assert.equal(result.body.partiallySent, true);
  assert.equal(result.body.summary, "Email sent · SMS failed");

  // The PARENT is `sent`. Not `failed` — that would let the allowance trigger
  // refund a reminder the customer received, and make it retryable.
  assert.equal(db.get().status, "sent");
  assert.equal(allowance.slots.size, 1, "the unit stays spent");
  assert.equal(allowance.calls.filter((c) => c === "released").length, 0);

  // Per-channel truth is on the children.
  assert.equal(channelDb.rows.get("email")!.status, "sent");
  assert.equal(channelDb.rows.get("sms")!.status, "failed");
});

test("SMS accepted, email definitely rejected → partial, the mirror case", async () => {
  const { result, db, channelDb, allowance } = await approve({ email: "reject" });

  assert.equal(result.status, 207);
  assert.equal(result.outcome, "partially_sent");
  assert.equal(result.body.summary, "Email failed · SMS sent");
  assert.equal(db.get().status, "sent");
  assert.equal(allowance.slots.size, 1);
  assert.equal(channelDb.rows.get("email")!.status, "failed");
  assert.equal(channelDb.rows.get("sms")!.status, "sent");
});

test("both definitely rejected → parent failed, unit released, retryable", async () => {
  const { result, db, channelDb, allowance } = await approve({ email: "reject", sms: "reject" });

  assert.equal(result.outcome, "rejected");
  assert.equal(db.get().status, "failed");
  // Nothing reached anyone, so the credit comes back. This is the ONLY branch
  // that releases.
  assert.ok(allowance.calls.includes("released"));
  assert.equal(channelDb.rows.get("email")!.status, "failed");
  assert.equal(channelDb.rows.get("sms")!.status, "failed");
  // No channel is named: nothing partial happened.
  assert.equal(result.body.partiallySent, undefined);
});

// ── Ambiguity is never treated as failure ──────────────────────────────────

test("an ambiguous SMS parks the reminder, and never releases the unit", async () => {
  const { result, db, allowance } = await approve({ sms: "ambiguous" });

  assert.equal(result.outcome, "delivery_unknown");
  assert.equal(db.get().status, "delivery_unknown");
  // Refunding ambiguity would make a flaky provider an unlimited tier.
  assert.equal(allowance.calls.filter((c) => c === "released").length, 0);
  // delivery_unknown is not claimable, so nothing can retry and duplicate.
  assert.equal(isChannelClaimable("delivery_unknown"), false);
});

test("an ambiguous email does the same", async () => {
  const { result, db, allowance } = await approve({ email: "ambiguous" });
  assert.equal(result.outcome, "delivery_unknown");
  assert.equal(db.get().status, "delivery_unknown");
  assert.equal(allowance.calls.filter((c) => c === "released").length, 0);
});

test("ambiguity outranks acceptance in the fold", () => {
  // One accepted + one unknown must NOT become `sent`: sent is terminal and
  // would hide an unresolved channel behind a success.
  const folded = aggregateChannelOutcomes([
    { channel: "email", outcome: "accepted" },
    { channel: "sms", outcome: "unknown" },
  ]);
  assert.equal(folded.parentStatus, "delivery_unknown");
  assert.equal(folded.partiallySent, true);
  assert.equal(folded.releaseAllowance, false);
});

// ── Single-channel retry never resends the channel that worked ─────────────

test("a channel already `sent` is skipped, not resubmitted", async () => {
  // The state after "email sent, SMS failed": the retry must touch SMS only.
  const channelDb = new FakeChannelDb([
    { channel: "email", status: "sent", sendAttemptCount: 1 },
    { channel: "sms", status: "failed", sendAttemptCount: 1 },
  ]);

  const { mailer, texter, result } = await approve({ channelDb });

  assert.equal(mailer.calls.length, 0, "the successful email must NEVER be sent again");
  assert.equal(texter.calls.length, 1, "only the failed channel is retried");
  assert.equal(result.outcome, "sent");
  assert.equal(channelDb.rows.get("email")!.status, "sent");
  assert.equal(channelDb.rows.get("sms")!.status, "sent");
});

test("the retry rule is the row's own state, not a caller-supplied flag", () => {
  assert.equal(isChannelClaimable("sent"), false);
  assert.equal(isChannelClaimable("delivery_unknown"), false);
  assert.equal(isChannelClaimable("undelivered"), false);
  assert.equal(isChannelClaimable("dismissed"), false);
  assert.equal(isChannelClaimable("sending"), false);
  assert.equal(isChannelClaimable("pending"), true);
  assert.equal(isChannelClaimable("failed"), true);
});

test("only the channel that failed is offered a retry", () => {
  const partial = { email: "sent", sms: "failed" } as const;
  assert.equal(channelRetryable(partial, "sms"), true);
  assert.equal(channelRetryable(partial, "email"), false, "a delivered channel is never retryable");

  // An unresolved channel may already have been delivered — never a "retry".
  assert.equal(channelRetryable({ email: "sent", sms: "delivery_unknown" }, "sms"), false);
  // Both failed is the ordinary approve path, not a single-channel retry.
  assert.equal(channelRetryable({ email: "failed", sms: "failed" }, "sms"), false);
});

test("each channel gets its OWN idempotency key", () => {
  const a = channelAttemptKey("rem-1", "email", "hash", 1);
  const b = channelAttemptKey("rem-1", "sms", "hash", 1);
  assert.notEqual(a, b, "a shared key would let a retry recompute the other channel's");
  assert.match(a, /^ss-email-/);
  assert.match(b, /^ss-sms-/);

  // The DIGEST must differ too, not merely the prefix. A mutant that dropped
  // `channel` from the hashed material left the prefixes different while both
  // channels hashed identical bytes — so the keys looked distinct and were not.
  const digest = (k: string) => k.replace(/^ss-(email|sms)-/, "");
  assert.notEqual(digest(a), digest(b), "the channel must be part of the hashed material");
  // Stable for the same logical attempt, so a double-click dedupes.
  assert.equal(channelAttemptKey("rem-1", "sms", "hash", 1), b);
  // A new attempt, or changed content, is a different message.
  assert.notEqual(channelAttemptKey("rem-1", "sms", "hash", 2), b);
  assert.notEqual(channelAttemptKey("rem-1", "sms", "other", 1), b);
});

// ── Missing / invalid phone: refused BEFORE anything is spent ──────────────

test("a historical invoice with no mobile is refused before the allowance claim", async () => {
  const { result, db, mailer, texter, allowance } = await approve({ phone: null });

  assert.equal(result.status, 409);
  assert.equal(result.body.state, "missing_phone");
  assert.equal(
    result.body.message,
    "This invoice has no mobile number. Add one to send this reminder."
  );

  // NOTHING was spent and NOTHING was sent — including the email. Sending the
  // email alone would be the "email-only reminder" the product does not have.
  assert.equal(allowance.slots.size, 0, "no unit may be claimed");
  assert.equal(allowance.calls.length, 0, "the allowance is never even consulted");
  assert.equal(mailer.calls.length, 0, "the email must not go out alone");
  assert.equal(texter.calls.length, 0);

  // Recoverable: still pending, still reviewable, sendable once a number exists.
  assert.equal(db.get().status, "pending");
});

test("an invalid or non-UK number is refused before the provider call", async () => {
  for (const [phone, fragment] of [
    ["+1 415 555 0100", "isn't a UK number"],
    ["020 7946 0958", "isn't a mobile"],
    ["07700 9000", "doesn't look complete"],
    ["not a number", "can't be read"],
  ] as const) {
    const { result, mailer, texter, allowance } = await approve({ phone });
    assert.equal(result.body.state, "missing_phone", `${phone} must be refused`);
    assert.match(String(result.body.message), new RegExp(fragment));
    assert.equal(mailer.calls.length, 0);
    assert.equal(texter.calls.length, 0);
    assert.equal(allowance.slots.size, 0);
  }
});

test("the refusal never names a provider or an error code", async () => {
  const { result } = await approve({ phone: null });
  const message = String(result.body.message);
  for (const jargon of [/twilio/i, /\b\d{5}\b/, /E\.?164/i, /SID/i]) {
    assert.equal(jargon.test(message), false, `customer copy must not contain ${jargon}`);
  }
});

// ── UK phone normalisation ─────────────────────────────────────────────────

test("every accepted UK mobile form normalises to one E.164 string", () => {
  for (const input of [
    "07700 900000",
    "07700900000",
    "+44 7700 900000",
    "+447700900000",
    "00447700900000",
    "(07700) 900-000",
    "  07700900000  ",
  ]) {
    const r = normaliseUkMobile(input);
    assert.equal(r.ok, true, `${input} must normalise`);
    assert.equal(r.ok && r.e164, "+447700900000", `${input} → +447700900000`);
  }
});

test("nothing is invented, and no prefix is stripped to make a number work", () => {
  const cases: [string | null, string][] = [
    [null, "missing"],
    ["", "missing"],
    ["   ", "missing"],
    ["+1 415 555 0100", "not_uk"],       // never coerced to +44
    ["+33 6 12 34 56 78", "not_uk"],
    ["020 7946 0958", "not_mobile"],     // UK landline
    ["0800 123 4567", "not_mobile"],
    ["+442079460958", "not_mobile"],
    ["07700 9000", "wrong_length"],
    ["077009000001", "wrong_length"],
    ["07700 900000 ext 12", "malformed"],
    ["447700900000", "not_uk"],          // bare 44 is NOT read as a country code
  ];
  for (const [input, problem] of cases) {
    const r = normaliseUkMobile(input);
    assert.equal(r.ok, false, `${input} must be refused`);
    assert.equal(!r.ok && r.problem, problem, `${input} → ${problem}`);
  }
});

// ── Twilio-specific classification ─────────────────────────────────────────

test("Twilio failures are classified by Twilio's own semantics", () => {
  // Definite pre-acceptance rejections — safe to attempt again.
  for (const c of [21211, 21610, 21614, 20003, 21408]) {
    assert.equal(classifyTwilioError(c, 400), "rejected", `${c} is a definite rejection`);
    assert.equal(isDefinitelyRejectedTwilioCode(c), true);
  }

  // Unknown code, 5xx, or no response at all → ambiguous. NEVER "rejected",
  // because a retry there could text the customer twice.
  assert.equal(classifyTwilioError(99999, 500), "unknown");
  assert.equal(classifyTwilioError(null, 503), "unknown");
  assert.equal(classifyTwilioError(null, null), "unknown");
  assert.equal(classifyTwilioError(undefined, undefined), "unknown");
  // 429 is enumerated as a definite rejection; the generic 4xx rule must not
  // swallow it into something coarser.
  assert.equal(classifyTwilioError(20429, 429), "rejected");
});

test("only genuine acceptance statuses count as accepted", () => {
  for (const s of ["queued", "accepted", "scheduled", "sending", "sent"]) {
    assert.equal(isAcceptedTwilioStatus(s), true);
  }
  // These describe DELIVERY, not submission, and must not be read as success.
  for (const s of ["failed", "undelivered", "", null, undefined, "unknown"]) {
    assert.equal(isAcceptedTwilioStatus(s), false);
  }
});

test("the email classifier is never applied to a Twilio result", () => {
  // classifyTwilioError now runs where the TwilioSendResult is produced, not
  // in the adapter that consumes it — the adapter only narrows on `r.kind`.
  const transport = code("lib/twilio.ts");
  assert.match(transport, /classifyTwilioError\(code, response\.status\)/);
  assert.equal(/classifyProviderError/.test(transport), false,
    "Resend's string codes and Twilio's numeric codes share no namespace");

  const route = code("lib/approval-wiring.ts");
  const texterBlock = route.slice(route.indexOf("const texter:"), route.indexOf("const resend ="));
  assert.equal(/classifyProviderError/.test(texterBlock), false,
    "Resend's string codes and Twilio's numeric codes share no namespace");
});

// ── SMS body validation happens before dispatch ────────────────────────────

test("an invalid SMS body is refused before any provider is called", async () => {
  const service = code("lib/reminder-approval.ts");
  const validateAt = service.indexOf("validateSmsBody(smsBody)");
  const dispatchAt = service.indexOf("await dispatchChannels(");
  assert.ok(validateAt > -1 && dispatchAt > validateAt,
    "the body is validated before anything is submitted");
  // And before the allowance is claimed, so a bad body costs nothing.
  assert.ok(validateAt < service.indexOf("deps.allowance.claim("));
});

// ── Credentials stay server-only ───────────────────────────────────────────

test("Twilio credentials can never reach a browser bundle", () => {
  const twilio = read("lib/twilio.ts");
  // The structural guarantee: importing this from a client component fails the
  // BUILD, rather than relying on nobody doing it.
  assert.match(twilio, /^import "server-only";/m);

  for (const name of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_MESSAGING_SERVICE_SID"]) {
    assert.ok(twilio.includes(`process.env.${name}`), `${name} is read server-side`);
    assert.equal(twilio.includes(`NEXT_PUBLIC_${name}`), false);
  }
  assert.equal(/NEXT_PUBLIC_TWILIO/.test(twilio), false);

  // No credential, and no account identifier, anywhere in the repository.
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.name.startsWith(".") || e.name === "node_modules"
        ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);

  const sources = ["app", "components", "lib", "tests", "emails"]
    .flatMap((dir) => walk(join(ROOT, dir)))
    .filter((f) => /\.tsx?$/.test(f));

  // Assembled at runtime so this assertion does not itself become the literal
  // it is looking for — a check that fails on its own source proves nothing.
  const senderNumber = ["+44", "7576", "584431"].join("");

  for (const f of sources) {
    const src = readFileSync(f, "utf8");
    // A real Account SID (AC + 32 hex) or Messaging Service SID (MG + 32 hex).
    assert.equal(/\bAC[0-9a-f]{32}\b/.test(src), false, `${f} contains an Account SID`);
    assert.equal(/\bMG[0-9a-f]{32}\b/.test(src), false, `${f} contains a Messaging Service SID`);
    assert.equal(src.includes(senderNumber), false, `${f} hardcodes the sender number`);
  }
});

test("the Messaging Service SID is used, never a raw `from` number", () => {
  const twilio = read("lib/twilio.ts");
  assert.match(twilio, /MessagingServiceSid: config\.messagingServiceSid/);
  // A `From` parameter would move the sender pool, the UK regulatory bundle and
  // opt-out handling out of Twilio and into application config.
  assert.equal(/\bFrom:\s/.test(twilio), false, "no raw From parameter");
  assert.match(twilio, /process\.env\.TWILIO_MESSAGING_SERVICE_SID/,
    "the SID comes from the environment, never from source");
});

// ── Aggregation, in isolation ──────────────────────────────────────────────

test("the fold covers every combination", () => {
  const cases: Array<[string, Parameters<typeof aggregateChannelOutcomes>[0], string, boolean, boolean]> = [
    ["both accepted", [{ channel: "email", outcome: "accepted" }, { channel: "sms", outcome: "accepted" }], "sent", false, false],
    ["one rejected", [{ channel: "email", outcome: "accepted" }, { channel: "sms", outcome: "rejected" }], "sent", true, false],
    ["both rejected", [{ channel: "email", outcome: "rejected" }, { channel: "sms", outcome: "rejected" }], "failed", false, true],
    ["one unknown", [{ channel: "email", outcome: "accepted" }, { channel: "sms", outcome: "unknown" }], "delivery_unknown", true, false],
    ["both unknown", [{ channel: "email", outcome: "unknown" }, { channel: "sms", outcome: "unknown" }], "delivery_unknown", false, false],
    ["rejected + unknown", [{ channel: "email", outcome: "rejected" }, { channel: "sms", outcome: "unknown" }], "delivery_unknown", false, false],
    ["skipped counts as accepted", [{ channel: "email", outcome: "skipped_already_sent" }, { channel: "sms", outcome: "accepted" }], "sent", false, false],
    ["nothing attempted", [], "failed", false, true],
  ];
  for (const [name, outcomes, parent, partial, release] of cases) {
    const r = aggregateChannelOutcomes(outcomes);
    assert.equal(r.parentStatus, parent, `${name}: parent`);
    assert.equal(r.partiallySent, partial, `${name}: partial`);
    assert.equal(r.releaseAllowance, release, `${name}: release`);
  }
});

test("the allowance is released ONLY when nothing reached anyone", () => {
  const releasing = [
    [{ channel: "email", outcome: "rejected" }, { channel: "sms", outcome: "rejected" }],
  ] as const;
  const notReleasing = [
    [{ channel: "email", outcome: "accepted" }, { channel: "sms", outcome: "rejected" }],
    [{ channel: "email", outcome: "rejected" }, { channel: "sms", outcome: "accepted" }],
    [{ channel: "email", outcome: "accepted" }, { channel: "sms", outcome: "unknown" }],
    [{ channel: "email", outcome: "unknown" }, { channel: "sms", outcome: "rejected" }],
  ] as const;

  for (const o of releasing) assert.equal(aggregateChannelOutcomes(o).releaseAllowance, true);
  for (const o of notReleasing) assert.equal(aggregateChannelOutcomes(o).releaseAllowance, false);
});

// ── The read side: legacy data is never retro-flagged ──────────────────────

test("a legacy reminder with no channel rows is never called partial", () => {
  assert.equal(partiallySentFromStatuses({}), false);
  assert.equal(partiallySentFromStatuses({ email: "sent" }), false);
  assert.equal(partialSendSummary({ email: "sent" }), null);
});

test("the summary names channels in plain words", () => {
  assert.equal(partialSendSummary({ email: "sent", sms: "failed" }), "Email sent · SMS failed");
  assert.equal(partialSendSummary({ email: "failed", sms: "sent" }), "Email failed · SMS sent");
  assert.equal(partialSendSummary({ email: "sent", sms: "sent" }), null);
  assert.deepEqual(failedChannels({ email: "sent", sms: "failed" }), ["sms"]);
});

// ── Needs Attention must not hide a failed channel ─────────────────────────

test("Needs Attention raises a partially-sent reminder, whose parent says `sent`", async () => {
  const { buildAttentionItems } = await import("@/lib/overview-attention");

  const invoice = {
    id: "inv-1",
    customer_name: "Dave Wilson",
    invoice_reference: "INV-1042",
    amount: 480.5,
    due_date: "2020-01-01",
    status: "unpaid",
    reminder_schedules: ["overdue_7_days"],
    reminders_sent: ["overdue_7_days"],
  } as never;

  const sentReminder = { id: "rem-1", invoice_id: "inv-1", status: "sent" } as never;

  // WITHOUT channel data — the pre-SMS world. A `sent` parent is a clean
  // success and raises nothing. This is the behaviour that hid the failure.
  const blind = buildAttentionItems({
    invoices: [invoice],
    pendingReminders: [],
    reminderHistory: [sentReminder],
    needsDecisionInvoiceIds: new Set(),
  });
  assert.equal(blind.filter((i) => i.kind === "send_failed").length, 0);

  // WITH channel data — the SMS failed, so it is raised even though the parent
  // status is `sent`, and the row names the channel in plain words.
  const seeing = buildAttentionItems({
    invoices: [invoice],
    pendingReminders: [],
    reminderHistory: [sentReminder],
    channelStatuses: { "rem-1": { email: "sent", sms: "failed" } },
    needsDecisionInvoiceIds: new Set(),
  });

  const item = seeing.find((i) => i.kind === "send_failed");
  assert.ok(item, "a partially-sent reminder must reach Needs Attention");
  assert.equal(item!.partialSummary, "Email sent · SMS failed");
  assert.equal(item!.actionLabel, "Resolve issue");
});

test("a fully-sent reminder is still not raised", async () => {
  const { buildAttentionItems } = await import("@/lib/overview-attention");
  const items = buildAttentionItems({
    invoices: [{ id: "inv-1", customer_name: "D", invoice_reference: null, amount: 1,
      due_date: "2020-01-01", status: "unpaid", reminder_schedules: ["overdue_7_days"],
      reminders_sent: ["overdue_7_days"] } as never],
    pendingReminders: [],
    reminderHistory: [{ id: "rem-1", invoice_id: "inv-1", status: "sent" } as never],
    channelStatuses: { "rem-1": { email: "sent", sms: "sent" } },
    needsDecisionInvoiceIds: new Set(),
  });
  assert.equal(items.filter((i) => i.kind === "send_failed").length, 0,
    "both channels through is a clean success and must stay quiet");
});

// ── Environment documentation carries no real values ───────────────────────

test(".env.local.example documents the Twilio variables without secrets", () => {
  const example = read(".env.local.example");
  for (const name of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_MESSAGING_SERVICE_SID"]) {
    assert.ok(example.includes(name), `${name} must be documented`);
  }
  // Placeholders only — never a real credential or account identifier.
  assert.equal(/\bAC[0-9a-f]{32}\b/.test(example), false);
  assert.equal(/\bMG[0-9a-f]{32}\b/.test(example), false);
  assert.equal(/NEXT_PUBLIC_TWILIO/.test(example), false);
});


test("a channel claim lost to a sibling is ambiguous, never a failure", async () => {
  // A concurrent request may be submitting this channel RIGHT NOW. Recording
  // `failed` would make it claimable again and invite a duplicate message; the
  // only safe reading is "we do not know".
  const channelDb = new FakeChannelDb();
  const original = channelDb.claimChannel.bind(channelDb);
  channelDb.claimChannel = async (input) => {
    if (input.channel === "sms") return { claimed: false, error: "already claimed" };
    return original(input);
  };

  const { result, db, texter, allowance } = await approve({ channelDb });

  // Email went; SMS was never submitted by us and may be in flight elsewhere.
  assert.equal(texter.calls.length, 0, "a lost claim must not submit");
  assert.equal(result.outcome, "delivery_unknown");
  assert.equal(db.get().status, "delivery_unknown");
  // Never released: a sibling may have sent it.
  assert.equal(allowance.calls.filter((c) => c === "released").length, 0);
});

// ── Channel-state persistence must never be assumed ────────────────────────
//
// THE FLAW THIS CLOSES. The rejected/unknown branch discarded the result of
// recordChannelOutcome(), so the aggregate folded a channel as durably `failed`
// while the row could still be sitting at `sending`. With both providers
// rejecting and both writes failing, the parent became `failed` and the
// allowance trigger handed the unit back — for a reminder whose children were
// stuck mid-send and therefore NOT claimable. The owner saw a retryable
// reminder that no retry could move.

/** Both providers reject; `failWrites` names the channels whose write fails. */
async function rejectWith(failWrites: ("email" | "sms")[], only?: "email" | "sms") {
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  const texter = new FakeTexter();

  if (!only || only === "email") {
    mailer.behaviour = () => ({ ok: false, code: "validation_error", message: "bad address" });
  }
  if (!only || only === "sms") {
    texter.behaviour = () => ({ ok: false, outcome: "rejected", message: "21211" });
  }

  const channelDb = new FakeChannelDb();
  for (const c of failWrites) channelDb.outcomeWriteError[c] = "connection reset";

  const allowance = new FakeAllowanceStore();
  const deps = makeDeps(db, mailer, { texter, channelDb, allowance });
  const result = await approveAndSendReminder(deps, {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });
  return { result, db, channelDb, allowance, mailer, texter };
}

test("1. provider rejects + child persistence SUCCEEDS → durable failed", async () => {
  // The baseline the fix must not disturb.
  const { result, db, channelDb, allowance } = await rejectWith([]);

  assert.equal(result.outcome, "rejected");
  assert.equal(db.get().status, "failed");
  assert.equal(channelDb.rows.get("email")!.status, "failed");
  assert.equal(channelDb.rows.get("sms")!.status, "failed");
  // Nothing reached anyone AND both outcomes are recorded, so the credit
  // legitimately comes back and the reminder is genuinely claimable again.
  assert.ok(allowance.calls.includes("released"));
});

test("2. provider rejects + child persistence FAILS → unresolved, not failed", async () => {
  // Only the SMS provider rejects, and only that write fails.
  const { result, db, channelDb, allowance } = await rejectWith(["sms"], "sms");

  // The PROVIDER verdict was known (rejected). The DATABASE lifecycle was not
  // recorded — so the aggregate must not claim a durable failure.
  assert.equal(result.outcome, "delivery_unknown");
  assert.equal(db.get().status, "delivery_unknown");

  // The row is where the claim left it: `sending`. Not claimable, so nothing
  // can retry it and no message can be duplicated.
  assert.equal(channelDb.rows.get("sms")!.status, "sending");
  assert.equal(isChannelClaimable("sending"), false);
  assert.ok(channelDb.writes.includes("outcome-write-failed:sms"));

  // The unit is NOT returned: an unresolved reminder must never look refunded.
  assert.equal(allowance.calls.filter((c) => c === "released").length, 0);
});

test("3. both reject + ONE child write fails → unresolved, unit retained", async () => {
  const { result, db, channelDb, allowance } = await rejectWith(["sms"]);

  assert.equal(result.outcome, "delivery_unknown");
  assert.equal(db.get().status, "delivery_unknown");

  // One recorded, one not — and the aggregate follows the WORST of the two.
  assert.equal(channelDb.rows.get("email")!.status, "failed");
  assert.equal(channelDb.rows.get("sms")!.status, "sending");

  assert.equal(allowance.calls.filter((c) => c === "released").length, 0,
    "a half-recorded reminder must never be refunded");
});

test("4. both reject + BOTH child writes fail → unresolved, unit retained", async () => {
  // The exact production scenario in the audit.
  const { result, db, channelDb, allowance } = await rejectWith(["email", "sms"]);

  // BEFORE: parent `failed`, allowance released, both rows stuck at `sending`.
  // AFTER:
  assert.equal(result.outcome, "delivery_unknown");
  assert.equal(db.get().status, "delivery_unknown");
  assert.notEqual(db.get().status, "failed");

  assert.equal(channelDb.rows.get("email")!.status, "sending");
  assert.equal(channelDb.rows.get("sms")!.status, "sending");
  assert.equal(allowance.calls.filter((c) => c === "released").length, 0);
});

test("5. the allowance is never released into an inconsistent state", async () => {
  // Every combination where ANY write failed must retain the unit, and every
  // one where all writes landed must behave exactly as before.
  for (const failures of [["email"], ["sms"], ["email", "sms"]] as const) {
    const { db, allowance, channelDb } = await rejectWith([...failures]);
    assert.equal(
      allowance.calls.filter((c) => c === "released").length, 0,
      `writes failing on ${failures.join("+")} must not refund`
    );
    // And the parent is in a state nothing can claim, so the retained unit is
    // not stranding a reminder that could otherwise be retried.
    assert.equal(db.get().status, "delivery_unknown");
    for (const c of failures) assert.equal(channelDb.rows.get(c)!.status, "sending");
  }

  // Control: all writes land, the refund happens as it always did.
  const clean = await rejectWith([]);
  assert.ok(clean.allowance.calls.includes("released"));
});

test("6. no provider is resent because persistence was uncertain", async () => {
  const { mailer, texter, channelDb } = await rejectWith(["email", "sms"]);

  // Exactly one submission per channel, and no second pass.
  assert.equal(mailer.calls.length, 1);
  assert.equal(texter.calls.length, 1);

  // Both rows are `sending` — not claimable — so neither the approve path nor
  // the per-channel retry can produce a duplicate.
  for (const c of ["email", "sms"] as const) {
    assert.equal(isChannelClaimable(channelDb.rows.get(c)!.status), false);
  }
  // And the parent is delivery_unknown, which is likewise not claimable.
  assert.equal(isClaimableParent("delivery_unknown"), false);
});

test("the rejected branch checks its write, exactly as the accepted branch does", () => {
  const service = code("lib/reminder-approval.ts");
  const dispatch = service.slice(service.indexOf("async function dispatchChannels"));

  // The result must be BOUND and CHECKED — a bare `await` discards it.
  assert.match(dispatch, /const recorded = await deps\.channelDb\.recordChannelOutcome\(/);
  assert.match(dispatch, /if \(!recorded\.ok\) \{/);
  assert.equal(
    /await deps\.channelDb\.recordChannelOutcome\(\{[\s\S]{0,200}\}\);\s*\n\s*outcomes\.push/.test(dispatch),
    false,
    "the write result must never be discarded"
  );

  // On a failed write the aggregate takes `unknown`, never the provider verdict.
  const branch = dispatch.slice(dispatch.indexOf("if (!recorded.ok) {"));
  assert.match(branch, /outcomes\.push\(\{ channel, outcome: "unknown" \}\)/);
  assert.match(branch, /status: "delivery_unknown"/);
  assert.equal(/outcomes\.push\(\{ channel, outcome \}\)/.test(branch.slice(0, branch.indexOf("continue;"))), false);
});

test("the REPORTED channel states never claim a durable status that was not written", async () => {
  // finalStates feeds the response body's `channels` map and the partial
  // summary. A mutant that wrote "failed" there — while the row was actually
  // stuck at `sending` — was invisible to assertions that only inspected the
  // fake's rows, so the reported state is pinned separately.
  const { result, channelDb } = await rejectWith(["email", "sms"]);

  const reported = result.body.channels as Record<string, string>;
  for (const c of ["email", "sms"] as const) {
    assert.equal(reported[c], "delivery_unknown", `${c} must be reported as unresolved`);
    assert.notEqual(reported[c], "failed", `${c} must not claim a failure we did not record`);
    // And what the report says agrees with what can actually be attempted:
    // neither the reported state nor the real row is claimable.
    assert.equal(isChannelClaimable(reported[c] as never), false);
    assert.equal(isChannelClaimable(channelDb.rows.get(c)!.status), false);
  }
});

test("an ACCEPTED provider whose write fails is unresolved, never sent", async () => {
  // The branch that already had this guard, now driven rather than assumed —
  // two mutants removing it survived until this test existed.
  const db = new FakeApprovalDb();
  const mailer = new FakeMailer();
  const texter = new FakeTexter();
  const channelDb = new FakeChannelDb();
  channelDb.acceptedWriteError.sms = "connection reset";
  const allowance = new FakeAllowanceStore();

  const deps = makeDeps(db, mailer, { texter, channelDb, allowance });
  const result = await approveAndSendReminder(deps, {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });

  // Twilio ACCEPTED it — the customer may well have the text — but our record
  // failed. Reporting `sent` would claim a delivery we cannot evidence;
  // reporting `failed` would invite a duplicate.
  assert.equal(result.outcome, "delivery_unknown");
  assert.equal(db.get().status, "delivery_unknown");
  assert.equal((result.body.channels as Record<string, string>).sms, "delivery_unknown");
  assert.notEqual((result.body.channels as Record<string, string>).sms, "sent");

  // The unit stays spent: a message may have gone.
  assert.equal(allowance.calls.filter((c) => c === "released").length, 0);
  // One submission only.
  assert.equal(texter.calls.length, 1);
});
