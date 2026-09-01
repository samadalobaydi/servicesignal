import {
  resolveSenderIdentity,
  senderIdentityMissingReason,
  missingSenderIdentityMessage,
  type SenderIdentityPreference,
} from "./sender-identity";
import {
  generateReminderContent,
  identityHasDrifted,
  type ReminderFacts,
} from "./reminder-content";
import type { ApprovalReminder } from "./reminder-approval";

/**
 * The recovery path for migration 015's fail-closed identity-drift gate.
 *
 * THE PROBLEM THIS SOLVES
 *
 * A PENDING (or FAILED) reminder can be refused at Approve/Retry because its
 * stored content — frozen at preparation — was generated under a sender
 * identity that no longer matches the account's current one, or because it
 * predates generated_sender_name entirely (NULL, unprovable). Neither
 * Approve nor Retry can fix that: they only ever read stored content, never
 * rewrite it (see lib/reminder-content.ts's "written once, never rewritten"
 * model). Without this module, a drifted reminder was permanently stuck.
 *
 * WHAT THIS DOES
 *
 * Rebuilds BOTH channels together, from CURRENT invoice facts and the
 * CURRENT strictly-resolved sender identity — the exact same
 * generateReminderContent() call Prepare makes — and commits them atomically
 * via db.regenerate(), which any customer edit is deliberately NOT carried
 * across (see the migration 016 comment on why). The token/hash the review
 * page issues is derived from stored content, so regenerating it
 * automatically invalidates any review token minted before this ran —
 * nothing here needs to touch that separately.
 *
 * WHAT THIS DOES NOT DO
 *
 *   - No provider call. No Mailer/Texter dependency exists in RegenerateDeps
 *     at all — regeneration cannot send anything even by mistake.
 *   - No allowance claim. No AllowanceStore dependency exists here either.
 *   - No new reminder_logs row. The existing row is rewritten in place.
 *   - No fallback identity. Uses resolveSenderIdentity() — the same strict,
 *     no-cross-fallback, no-login-email resolver Prepare/Approve/Retry use —
 *     never resolveSenderIdentityForDisplay().
 *
 * THE SOURCE-STATE VERSION GUARD
 *
 * The invoice/profile facts used to compose the replacement content are read
 * HERE, in TypeScript, before the atomic write. If update_invoice_with_refresh
 * (migration 012) commits an invoice edit in the gap between that read and
 * the write — a real, reachable interleaving, not hypothetical — this
 * request's composed content would be stale relative to the invoice, and
 * writing it would silently discard the fresher content the edit just wrote.
 * generated_sender_name would still read as coherent afterwards (both were
 * computed from a real, current identity), so identityHasDrifted() would
 * NOT catch this — it has no opinion on invoice fields at all. reminder.
 * sendAttemptCount, read at the same moment as the facts, is passed through
 * to db.regenerate() as the expected version; the RPC compares it, under its
 * own row lock, against the current value before writing anything, and
 * refuses with 'stale_regeneration' if it has moved — exactly the same
 * mechanism (and the same counter) that already protects a stale Approve
 * claim from the same class of race.
 */

export interface RegenerateDb {
  loadReminder(id: string): Promise<ApprovalReminder | null>;
  loadSenderIdentityInputs(userId: string): Promise<{
    preference: SenderIdentityPreference;
    businessName: string | null;
    personalName: string | null;
  }>;
  /**
   * Atomically rewrites stored content for BOTH channels and the
   * fingerprint, or refuses without writing anything. See migration 016 for
   * why this must be one atomic operation rather than separate writes.
   */
  regenerate(input: {
    reminderId: string;
    userId: string;
    /**
     * send_attempt_count as read at the SAME moment the invoice/profile
     * facts below were read, to compose emailSubject/emailBody/smsBody.
     * Every source-state change this codebase makes to a reminder while it
     * is pending/failed — update_invoice_with_refresh's invoice edit, and
     * this function's own successful write — bumps this counter. Comparing
     * it, locked, inside the RPC is what proves the composed content is
     * still built from the CURRENT state and not a stale snapshot read
     * before a concurrent invoice edit committed. See migration 016.
     */
    expectedSendAttemptCount: number;
    emailSubject: string;
    emailBody: string;
    smsBody: string;
    generatedSenderName: string;
  }): Promise<{
    outcome:
      | "ok"
      | "not_found"
      | "not_editable"
      | "stale_regeneration"
      | "no_stored_content"
      | "invalid_channel_pair"
      | "missing_generated_sender_name"
      | "error";
    error?: string;
  }>;
}

export interface RegenerateDeps {
  db: RegenerateDb;
  userId: string;
  now?: () => Date;
  log?: (level: "warn" | "error", message: string) => void;
}

export interface RegenerateRequest {
  reminderId: string;
}

export interface RegenerateResult {
  status: number;
  body: Record<string, unknown> & { success: boolean; message: string };
}

function refuse(status: number, body: Record<string, unknown> & { success: boolean; message: string }): RegenerateResult {
  return { status, body };
}

export async function regenerateReminder(
  deps: RegenerateDeps,
  request: RegenerateRequest
): Promise<RegenerateResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});

  const reminder = await deps.db.loadReminder(request.reminderId);

  // Not found and not-yours are the same answer, matching every other
  // reminder-scoped route — the adapter reads under the caller's own
  // session, so another user's reminder returns null here.
  if (!reminder) {
    return refuse(404, { success: false, message: "Reminder not found." });
  }

  // ── Status: the SAME editable set app/api/reminders/[id]/content/route.ts
  // already uses for saving an edit. A reminder that has left the approval
  // queue — sending, sent, delivery_unknown, undelivered, dismissed — must
  // never have its stored content rewritten. This is a cheap, early check;
  // the atomic guarantee that actually matters lives in db.regenerate()
  // (migration 016's row lock), which re-checks status itself at write
  // time so a status change landing AFTER this check and BEFORE the write
  // still refuses.
  if (reminder.status !== "pending" && reminder.status !== "failed") {
    log(
      "warn",
      `[regenerate] Reminder ${reminder.id} refused: status is '${reminder.status}', not pending/failed.`
    );
    return refuse(409, {
      success: false,
      state: reminder.status,
      message: "This reminder can no longer be regenerated.",
    });
  }

  const stored = reminder.storedContent ?? { email: null, sms: null };
  const legacy = !stored.email && !stored.sms;
  if (legacy) {
    // A genuine legacy reminder composes live on every read and is never
    // reported as drifted (identityHasDrifted) — there is nothing frozen
    // here to regenerate, and offering to would misrepresent what this
    // action does.
    return refuse(409, {
      success: false,
      state: "legacy",
      message: "This reminder has no stored content to regenerate.",
    });
  }

  // ── THE CHANNEL PAIR MUST BE COMPLETE ────────────────────────────────────
  //
  // One logical reminder is BOTH channels, never one alone (see
  // lib/reminder-content.ts's generateReminderContent, called exactly once
  // per reminder for exactly this reason). A reminder with only one stored
  // channel is not a smaller version of a valid reminder to regenerate — it
  // is inconsistent data, and regenerating just the channel that happens to
  // exist would leave the other permanently unaddressed. Refused here, as
  // an early, cheap check using data already loaded; db.regenerate()
  // (migration 016) re-proves the SAME invariant structurally, inside its
  // own transaction, as the authoritative gate — this check exists to give
  // a faster, clearer refusal in the common case, not to replace it.
  if (!stored.email || !stored.sms) {
    log(
      "error",
      `[regenerate] Reminder ${reminder.id} refused: incomplete channel pair ` +
        `(email=${stored.email ? "present" : "MISSING"}, sms=${stored.sms ? "present" : "MISSING"}).`
    );
    return refuse(409, {
      success: false,
      state: "invalid_channel_pair",
      message: "This reminder's stored content is incomplete and can't be safely regenerated.",
    });
  }

  // ── SENDER IDENTITY, resolved FRESH and STRICTLY ─────────────────────────
  // Same resolver, same no-cross-fallback, no-login-email contract as
  // Prepare/Approve/Retry. Never the display resolver — this is about to
  // become the content a customer may receive.
  const senderInputs = await deps.db.loadSenderIdentityInputs(deps.userId);
  const identity = resolveSenderIdentity(senderInputs);

  if (!identity) {
    const reason = senderIdentityMissingReason(senderInputs);
    log("warn", `[regenerate] Reminder ${reminder.id} refused: sender identity unresolved (${reason}).`);
    return refuse(409, {
      success: false,
      state: "missing_sender_identity",
      reason,
      message: missingSenderIdentityMessage(reason, "regenerating this reminder"),
    });
  }
  const senderName = identity.senderName;

  // Regeneration exists to repair a PROVEN mismatch, not to be a generic
  // "rebuild my reminder" button. Refusing when nothing has actually
  // drifted stops a caller from believing this fixed something it never
  // needed to touch, and keeps this action's blast radius exactly as
  // narrow as the problem it exists to solve.
  if (!identityHasDrifted(stored, reminder.generatedSenderName, senderName)) {
    return refuse(409, {
      success: false,
      state: "not_drifted",
      message: "This reminder's sender identity already matches your current settings.",
    });
  }

  // The SAME generator Prepare calls, fed CURRENT invoice facts and the
  // CURRENT resolved identity — one call, both channels, so they cannot
  // disagree about who this is from (see generateReminderContent's own
  // "called exactly once per reminder" contract).
  const facts: ReminderFacts = {
    tone: reminder.invoice.reminderTone,
    schedule: reminder.schedule,
    customerName: reminder.invoice.customerName,
    senderName,
    amount: reminder.invoice.amount,
    dueDate: reminder.invoice.dueDate,
    paymentLink: reminder.invoice.paymentLink,
    invoiceReference: reminder.invoice.invoiceReference,
    jobDescription: reminder.invoice.jobDescription,
  };
  const generated = generateReminderContent(facts, now());

  const result = await deps.db.regenerate({
    reminderId: reminder.id,
    userId: deps.userId,
    // The attempt count as it stood WHEN the facts above were read — the
    // SAME `reminder` snapshot the invoice values in `facts` came from, not
    // a fresh read. The RPC re-reads the current value under its own row
    // lock and refuses if it has moved, which is exactly what an
    // update_invoice_with_refresh commit landing between our read and this
    // call would do.
    expectedSendAttemptCount: reminder.sendAttemptCount,
    emailSubject: generated.email.subject,
    emailBody: generated.email.body,
    smsBody: generated.sms.body,
    generatedSenderName: senderName,
  });

  if (result.outcome === "ok") {
    return {
      status: 200,
      body: {
        success: true,
        message: "Reminder regenerated under your current sender identity. Review it again before approving.",
      },
    };
  }

  if (result.outcome === "not_found") {
    return refuse(404, { success: false, message: "Reminder not found." });
  }

  if (result.outcome === "not_editable") {
    // Lost the race: the reminder moved to sending/sent/etc. between our
    // status check above and the atomic write. Nothing was touched.
    log("warn", `[regenerate] Reminder ${reminder.id} refused at the atomic gate: no longer editable.`);
    return refuse(409, {
      success: false,
      state: "sending",
      message: "This reminder is already being sent and can no longer be regenerated.",
    });
  }

  if (result.outcome === "stale_regeneration") {
    // The invoice (or a prior regeneration) changed between our read above
    // and the atomic write — most commonly a concurrent invoice edit
    // (update_invoice_with_refresh) committing in that gap, which already
    // refreshed this reminder's stored content correctly. Writing our
    // OLDER snapshot on top would silently discard that fresher content.
    // Refusing and asking the caller to reload is the only honest answer;
    // nothing was touched.
    log("warn", `[regenerate] Reminder ${reminder.id} refused: source state changed since it was read.`);
    return refuse(409, {
      success: false,
      state: "stale_regeneration",
      message: "This reminder's details changed while regenerating it. Reload and try again.",
    });
  }

  if (result.outcome === "no_stored_content") {
    return refuse(409, {
      success: false,
      state: "legacy",
      message: "This reminder has no stored content to regenerate.",
    });
  }

  if (result.outcome === "invalid_channel_pair") {
    // Lost a DIFFERENT race than "not_editable": the row was still
    // pending/failed, but the channel pair the TypeScript-side check above
    // saw is no longer what the database's own re-check (inside the locked
    // transaction) found. Nothing was written either way.
    log("error", `[regenerate] Reminder ${reminder.id} refused at the atomic gate: incomplete channel pair.`);
    return refuse(409, {
      success: false,
      state: "invalid_channel_pair",
      message: "This reminder's stored content is incomplete and can't be safely regenerated.",
    });
  }

  if (result.outcome === "missing_generated_sender_name") {
    // Structurally unreachable via this module today — resolveSenderIdentity()
    // (lib/sender-identity.ts) trims and refuses blank names before senderName
    // is ever computed, so `identity.senderName` here is always a non-blank
    // string. Handled anyway because the RPC is a service_role-only boundary
    // any future caller could reach differently — this module must not
    // assume it is the only one that ever will.
    log("error", `[regenerate] Reminder ${reminder.id}: RPC refused a blank generated_sender_name.`);
    return {
      status: 500,
      body: { success: false, message: "Could not regenerate this reminder. Please try again." },
    };
  }

  log("error", `[regenerate] Reminder ${reminder.id}: ${result.error ?? "unknown error"}`);
  return {
    status: 500,
    body: { success: false, message: "Could not regenerate this reminder. Please try again." },
  };
}
