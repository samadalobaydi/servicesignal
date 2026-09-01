import type { ProviderOutcome, ReminderSendStatus } from "./reminder-send-state";
import type { ReminderChannel } from "./reminder-content";

/**
 * Folding two channel outcomes into one durable parent status.
 *
 * Pure, and this is the most safety-critical function added by the SMS pass:
 * its output is written to reminder_logs.status, which two LIVE database
 * triggers act on.
 *
 * ── WHY THE OBVIOUS ANSWERS ARE BOTH WRONG ────────────────────────────────
 *
 * "parent = failed when a channel fails" is unsafe. Migration 011's
 * reminder_logs_allowance_sync trigger releases the allowance unit on
 * pending/dismissed/failed, and `failed` is in CLAIMABLE_STATUSES — so a
 * reminder whose EMAIL was accepted would refund a credit and become
 * retryable, and the retry would email the customer a second time.
 *
 * "parent = sent, and read it as the whole truth" is also unsafe: ten
 * consumers treat `sent` as complete success, including Needs Attention, which
 * is the surface that exists to catch broken sends.
 *
 * So the parent answers ONE narrow question — did anything reach the customer,
 * and is a unit consumed — and `partiallySent` carries the rest. That derived
 * flag is never written to the database: migration 010's CHECK constraint does
 * not contain it, and adding a status would mean a migration.
 */

export interface ChannelOutcome {
  channel: ReminderChannel;
  /** Absent when the channel was never attempted — e.g. already sent. */
  outcome: ProviderOutcome | "skipped_already_sent";
}

export interface AggregateResult {
  /** What reminder_logs.status must become. */
  parentStatus: ReminderSendStatus;
  /**
   * True when at least one channel reached the provider and at least one did
   * not. DERIVED — never persisted. See partiallySentFromStatuses for the
   * read-side equivalent used by the dashboard.
   */
  partiallySent: boolean;
  /**
   * Whether the allowance unit may be handed back.
   *
   * ONLY when every channel was DEFINITELY rejected. One acceptance means the
   * customer was contacted and the unit is spent; one ambiguity means they may
   * have been, and refunding ambiguity turns a flaky provider into an unlimited
   * tier.
   */
  releaseAllowance: boolean;
}

/**
 * The fold.
 *
 * Precedence is unknown > accepted > rejected, and the order is the design:
 *
 *   any unknown   → delivery_unknown. Not claimable, so nothing retries and no
 *                   second copy can be produced. Consumes the unit, because a
 *                   message may well have gone.
 *   any accepted  → sent. Something reached the customer; the unit is spent;
 *                   the parent is terminal and the dispatched-final trigger
 *                   will refuse to move it later.
 *   all rejected  → failed. Nothing reached anyone, the unit comes back, and
 *                   the reminder is claimable again — which is safe precisely
 *                   because both providers refused before accepting.
 *
 * `skipped_already_sent` is a channel that succeeded on an earlier attempt. It
 * counts as accepted: the customer has it.
 */
export function aggregateChannelOutcomes(
  outcomes: readonly ChannelOutcome[]
): AggregateResult {
  if (outcomes.length === 0) {
    // No channel was even attempted. Treated as a definite non-send so the
    // unit is returned — a reminder that reached nobody must not cost a credit.
    return { parentStatus: "failed", partiallySent: false, releaseAllowance: true };
  }

  const effective = outcomes.map((o) =>
    o.outcome === "skipped_already_sent" ? "accepted" : o.outcome
  );

  const anyUnknown = effective.includes("unknown");
  const anyAccepted = effective.includes("accepted");
  const anyRejected = effective.includes("rejected");

  // Partial means the customer got SOME of what was approved. True whenever an
  // acceptance sits beside anything that is not an acceptance — a rejection or
  // an unresolved outcome both leave the pair incomplete.
  const partiallySent = anyAccepted && (anyRejected || anyUnknown);

  if (anyUnknown) {
    return { parentStatus: "delivery_unknown", partiallySent, releaseAllowance: false };
  }
  if (anyAccepted) {
    return { parentStatus: "sent", partiallySent, releaseAllowance: false };
  }
  return { parentStatus: "failed", partiallySent: false, releaseAllowance: true };
}

// ── The read side ───────────────────────────────────────────────────────────

/**
 * The per-channel statuses the dashboard reads back, keyed by channel.
 * Undefined for a channel with no row (a legacy reminder prepared before
 * migration 010).
 */
export type ChannelStatuses = Partial<Record<ReminderChannel, ReminderSendStatus>>;

/** A channel state meaning the provider took it. */
const REACHED_PROVIDER: readonly ReminderSendStatus[] = ["sent"];

/** A channel state meaning it did not, and the owner can see why. */
const DID_NOT_REACH: readonly ReminderSendStatus[] = ["failed", "undelivered"];

/**
 * Derives "partially sent" from stored channel rows — the read-side twin of
 * aggregateChannelOutcomes, used by Active Chasing, Needs Attention and the
 * review page.
 *
 * Deliberately conservative about legacy data: a reminder with fewer than two
 * channel rows predates migration 010 and cannot be assessed per channel, so it
 * is never labelled partial. Inventing a failure for a reminder that has no
 * SMS row would put a red flag on every reminder sent before this feature.
 */
export function partiallySentFromStatuses(statuses: ChannelStatuses): boolean {
  const values = Object.values(statuses).filter(Boolean) as ReminderSendStatus[];
  if (values.length < 2) return false;

  const reached = values.some((s) => REACHED_PROVIDER.includes(s));
  const missed = values.some((s) => DID_NOT_REACH.includes(s));
  return reached && missed;
}

/** Which channels did not reach the provider. Drives "Email sent · SMS failed". */
export function failedChannels(statuses: ChannelStatuses): ReminderChannel[] {
  return (Object.keys(statuses) as ReminderChannel[]).filter((c) => {
    const s = statuses[c];
    return !!s && DID_NOT_REACH.includes(s);
  });
}

/** Human label for one channel. No provider names, no codes. */
export const CHANNEL_LABEL: Record<ReminderChannel, string> = {
  email: "Email",
  sms: "SMS",
};

/**
 * The compact line shown on a partially-sent reminder, e.g.
 * "Email sent · SMS failed". Built from the same statuses the retry path reads,
 * so what the owner is told and what the button will do cannot disagree.
 */
export function partialSendSummary(statuses: ChannelStatuses): string | null {
  if (!partiallySentFromStatuses(statuses)) return null;

  const order: ReminderChannel[] = ["email", "sms"];
  return order
    .filter((c) => statuses[c])
    .map((c) => {
      const s = statuses[c]!;
      const verb = REACHED_PROVIDER.includes(s) ? "sent" : "failed";
      return `${CHANNEL_LABEL[c]} ${verb}`;
    })
    .join(" · ");
}

/**
 * Whether ONE channel may be attempted again on its own.
 *
 * The rule that stops a partial recovery from duplicating the channel that
 * worked: retry is offered only for a channel that did NOT reach the provider,
 * and only when another channel did. Both-failed is the ordinary approve path,
 * where the parent is `failed` and claimable.
 *
 * `delivery_unknown` is excluded on purpose. An unresolved channel may already
 * have been delivered, and a "retry" there is a second message.
 */
export function channelRetryable(
  statuses: ChannelStatuses,
  channel: ReminderChannel
): boolean {
  const own = statuses[channel];
  if (!own || !DID_NOT_REACH.includes(own)) return false;
  return (Object.keys(statuses) as ReminderChannel[]).some(
    (c) => c !== channel && REACHED_PROVIDER.includes(statuses[c] ?? ("pending" as ReminderSendStatus))
  );
}
