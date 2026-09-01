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
