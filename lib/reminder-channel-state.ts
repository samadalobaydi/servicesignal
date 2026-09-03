import { createHash } from "crypto";
import type { ReminderChannel } from "./reminder-content";
import type { ReminderSendStatus } from "./reminder-send-state";

/**
 * Per-channel send lifecycle, on reminder_channel_messages (migration 010).
 *
 * The nine lifecycle columns that table already carries — status,
 * send_started_at, send_attempt_key, send_attempt_count, provider_message_id,
 * provider_last_event, last_send_error, last_reconciled_at, sent_at — are the
 * same vocabulary migration 009 established for the parent, one row per
 * channel. Nothing wrote them before this pass. NO MIGRATION IS NEEDED.
 *
 * ── IS THE PER-CHANNEL CLAIM GENUINELY ATOMIC? YES, AND HERE IS WHY ───────
 *
 * The brief asked me to stop rather than pretend an ordinary update is atomic.
 * It is not an ordinary update. The claim is ONE statement:
 *
 *   UPDATE reminder_channel_messages
 *      SET status = 'sending', send_attempt_count = $next, …
 *    WHERE reminder_log_id = $id
 *      AND channel          = $channel
 *      AND status           IN ('pending','failed')
 *      AND send_attempt_count = $expected
 *  RETURNING id
 *
 * Postgres takes a row lock for the duration of the statement and re-evaluates
 * the predicate against the committed row, so of two concurrent callers exactly
 * one matches and the other sees zero rows. The compare-and-set on
 * send_attempt_count is what closes the ABA window — a row that was claimed and
 * released between our read and our write no longer carries the count we read.
 *
 * This is the identical primitive the parent claim already uses
 * (ApprovalDb.claim, app/api/reminders/[id]/approve/route.ts), and the unique
 * (reminder_log_id, channel) constraint guarantees there is exactly one row to
 * contend for. No database helper function is required.
 *
 * ── WHAT IT DOES NOT GIVE US ─────────────────────────────────────────────
 *
 * At-most-once SUBMISSION to Twilio. Resend accepts an Idempotency-Key; the
 * Twilio Message-create API has no equivalent. So if a request dies between the
 * successful claim and the provider's response, that attempt is ambiguous and
 * the channel is parked in delivery_unknown — never retried automatically. The
 * claim prevents concurrent submission; it cannot make a lost response safe.
 */

/** Channel statuses a fresh attempt may claim from — same rule as the parent. */
export const CHANNEL_CLAIMABLE_STATUSES: readonly ReminderSendStatus[] = ["pending", "failed"];

export function isChannelClaimable(status: ReminderSendStatus): boolean {
  return CHANNEL_CLAIMABLE_STATUSES.includes(status);
}

// ── Readiness pre-flight ─────────────────────────────────────────────────────
//
// THIS IS NOT THE CONCURRENCY GUARD. It is an early, informative read used to
// refuse BEFORE any allowance is claimed and before any provider is
// contacted — the exact gap that let a reminder with zero
// reminder_channel_messages rows reach dispatch, fail both per-channel
// claims uninformatively ("already claimed" — misleading, since nothing was
// ever claimed), and still consume a Founding Beta allowance slot.
//
// The actual enforcement remains, unchanged, claimChannel()'s atomic
// UPDATE ... WHERE status IN (...) AND send_attempt_count = $expected
// (lib/approval-wiring.ts). If state changes between this read and that
// claim — a concurrent request, a double-click — the CAS is what makes that
// safe, exactly as it always has. This module never weakens or replaces it;
// it only gives a truthful, early answer for the case the CAS was never
// designed to explain: a channel that does not exist to claim at all.

/** Minimal shape this module needs — ChannelRowState satisfies it structurally. */
export interface ChannelStatusRow {
  channel: ReminderChannel;
  status: ReminderSendStatus;
}

/**
 * One channel's readiness for a FRESH dispatch, classified from its row (or
 * absence). Never synthesizes a fake `pending` for a missing row — "missing"
 * is its own, honest, distinct case.
 */
export type ChannelReadiness =
  | { kind: "ready" }
  | { kind: "missing" }
  /** Structurally impossible today (unique(reminder_log_id, channel)) — kept
   *  as its own case defensively rather than silently picking one row. */
  | { kind: "duplicate" }
  | { kind: "not_ready"; status: ReminderSendStatus };

export function classifyChannelReadiness(
  rows: readonly ChannelStatusRow[],
  channel: ReminderChannel
): ChannelReadiness {
  const matches = rows.filter((r) => r.channel === channel);
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "duplicate" };
  const status = matches[0].status;
  return isChannelClaimable(status) ? { kind: "ready" } : { kind: "not_ready", status };
}

export interface ApproveReadiness {
  /** True only when BOTH channels are `ready` — never when either is merely present. */
  ready: boolean;
  email: ChannelReadiness;
  sms: ChannelReadiness;
}

/**
 * Whether BOTH channel rows are currently admissible for a FRESH, full
 * Approve — each required row must exist exactly once, AND each must
 * currently be channel-claimable (status pending or failed).
 *
 * A `false` result does NOT by itself imply structural corruption or a
 * failed preparation. It also occurs, entirely legitimately, when each row
 * exists exactly once but one or both channels are in a valid non-claimable
 * lifecycle state — e.g. sent, sending, delivery_unknown, undelivered, or
 * dismissed. This function answers Fresh-Approve admissibility only; it
 * does not distinguish that case from a missing/duplicated row. Callers
 * that need that distinction — e.g. to decide what a refusal should say —
 * must call assessChannelStructure() separately.
 *
 * This function itself is a pure classification helper — it has no
 * request/refusal behaviour of its own. Its result is used differently by
 * each caller:
 *
 *   - lib/reminder-approval.ts's approveAndSendReminder uses it as Gate 2,
 *     called BEFORE the allowance claim, BEFORE the parent row claim, and
 *     BEFORE any provider is contacted. There, a `false` result means THAT
 *     REQUEST refuses immediately, writing nothing to either reminder_logs
 *     or reminder_channel_messages — the reminder is left exactly as it was.
 *   - lib/reminder-review.ts uses the same result to compute
 *     `freshApproveReady`, which feeds reviewAvailability() to decide the
 *     Review page's displayed blockedReason/approvability — a read, not a
 *     refusal.
 */
export function assessApproveReadiness(rows: readonly ChannelStatusRow[]): ApproveReadiness {
  const email = classifyChannelReadiness(rows, "email");
  const sms = classifyChannelReadiness(rows, "sms");
  return { ready: email.kind === "ready" && sms.kind === "ready", email, sms };
}

// ── Structural validity ──────────────────────────────────────────────────────
//
// A DIFFERENT QUESTION FROM assessApproveReadiness(), on purpose. This
// function answers the STRUCTURAL question only: does exactly one email row
// and exactly one SMS row exist? Lifecycle status is deliberately ignored —
// a `sent` row and a `pending` row are equally "structurally valid" here;
// only row *count* (zero or more than one) is a structural problem.
// assessApproveReadiness() answers the separate question — whether those
// rows are additionally admissible for a FRESH, full Approve right now.
//
// BOTH the Review page (lib/reminder-review.ts) and the send route
// (lib/reminder-approval.ts's approveAndSendReminder, as Gate 1, ahead of
// assessApproveReadiness() as Gate 2) use this function. Reusing
// assessApproveReadiness().ready alone for either purpose previously made
// every legitimate non-claimable lifecycle status look identical to a
// genuinely missing/duplicated row, masking real, already-correct
// blockedReason/copy and response wording behind "wasn't fully prepared".

export type ChannelRowPresence = "present" | "missing" | "duplicate";

export interface ChannelStructure {
  /** True only when BOTH channels are `present` — exactly one row each. */
  valid: boolean;
  email: ChannelRowPresence;
  sms: ChannelRowPresence;
}

function classifyChannelPresence(
  rows: readonly ChannelStatusRow[],
  channel: ReminderChannel
): ChannelRowPresence {
  const count = rows.filter((r) => r.channel === channel).length;
  if (count === 0) return "missing";
  if (count > 1) return "duplicate";
  return "present";
}

/**
 * Whether a reminder's channel DATA is structurally intact — exactly one
 * email row and exactly one SMS row, regardless of their lifecycle status.
 *
 * Inspects the RAW row array (not a status-keyed map) so a duplicate row is
 * detected rather than silently collapsed by an object key overwrite.
 *
 * Used by BOTH the Review page and the send route's Gate 1 — see the module
 * comment above. It does not say anything about whether either channel is
 * currently claimable for a fresh attempt; use assessApproveReadiness() for
 * that.
 */
export function assessChannelStructure(rows: readonly ChannelStatusRow[]): ChannelStructure {
  const email = classifyChannelPresence(rows, "email");
  const sms = classifyChannelPresence(rows, "sms");
  return { valid: email === "present" && sms === "present", email, sms };
}

/**
 * The idempotency key for one channel attempt.
 *
 * SCOPED BY CHANNEL, and that is the whole point. A single key shared across
 * email and SMS would mean a retry of a failed SMS recomputing the key the
 * successful email already used — relying on Resend's dedupe window to avoid a
 * second email, which is accidental safety rather than designed safety.
 */
export function channelAttemptKey(
  reminderId: string,
  channel: ReminderChannel,
  contentHash: string,
  attemptNumber: number
): string {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error(`[channel-attempt] attemptNumber must be a positive integer, got ${attemptNumber}`);
  }
  const digest = createHash("sha256")
    .update(`ss-channel::${reminderId}::${channel}::${contentHash}::${attemptNumber}`)
    .digest("hex");
  return `ss-${channel}-${digest.slice(0, 44)}`;
}

// ── Ports ───────────────────────────────────────────────────────────────────

export interface ChannelRowState {
  channel: ReminderChannel;
  status: ReminderSendStatus;
  sendAttemptCount: number;
}

export interface ChannelClaimInput {
  reminderId: string;
  channel: ReminderChannel;
  expectAttemptCount: number;
  nextAttemptCount: number;
  attemptKey: string;
  startedAt: string;
}

export interface ChannelDb {
  /** Current lifecycle state of every channel row for one reminder. */
  loadChannelStates(reminderId: string): Promise<ChannelRowState[]>;
  /** The atomic conditional UPDATE described above. */
  claimChannel(input: ChannelClaimInput): Promise<{ claimed: boolean; error?: string }>;
  recordChannelAccepted(input: {
    reminderId: string;
    channel: ReminderChannel;
    providerMessageId: string | null;
    providerEvent: string | null;
    sentAt: string;
  }): Promise<{ ok: boolean; error?: string }>;
  recordChannelOutcome(input: {
    reminderId: string;
    channel: ReminderChannel;
    status: ReminderSendStatus;
    error: string;
  }): Promise<{ ok: boolean; error?: string }>;
}

/** Convenience: the states keyed by channel, for the aggregate helpers. */
export function statusesByChannel(
  rows: readonly ChannelRowState[]
): Partial<Record<ReminderChannel, ReminderSendStatus>> {
  const out: Partial<Record<ReminderChannel, ReminderSendStatus>> = {};
  for (const row of rows) out[row.channel] = row.status;
  return out;
}
