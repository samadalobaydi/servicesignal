import type { ReminderSendStatus } from "./reminder-send-state";

/**
 * Founding-beta reminder allowance.
 *
 * ── WHAT ONE REMINDER IS ─────────────────────────────────────────────────
 *
 * One reminder = one CHECKPOINT the owner approved, for one invoice. The SMS
 * and the email that go out for it are two channels of the same reminder and
 * consume the allowance once between them. The owner counts reminders, not
 * credits, and never has to think about channels.
 *
 * ── THE SOURCE OF TRUTH, AND WHY IT CANNOT DOUBLE-COUNT ──────────────────
 *
 * A row in `reminder_logs` IS the logical reminder event. Three independent
 * properties of the existing architecture make it the only safe thing to
 * count, and none of them were added for this feature:
 *
 *   1. ONE ROW PER CHECKPOINT. The daily cron creates at most one
 *      reminder_logs row per (invoice_id, schedule) — it checks for an
 *      existing row before inserting, and the table carries a UNIQUE key on
 *      that pair. A second cron pass cannot produce a second row.
 *
 *   2. CHANNELS ARE CHILDREN, NOT SIBLINGS. Per-channel state lives in
 *      `reminder_channel_messages` (migration 010), keyed by
 *      reminder_log_id. SMS and email are rows in THAT table. Counting the
 *      parent therefore counts the reminder, and adding a third channel
 *      tomorrow would not change any number here.
 *
 *   3. RETRIES UPDATE, THEY DO NOT INSERT. app/api/reminders/[id]/approve
 *      only ever UPDATEs an existing row. A fresh attempt is an atomic
 *      compare-and-set on send_attempt_count — the attempt counter moves, the
 *      row does not multiply. Two concurrent approvals cannot both win the
 *      claim, so a duplicate request cannot create a duplicate charge.
 *
 * So allowance is consumed per logical reminder. Nothing counts attempts,
 * deliveries, channels or messages.
 *
 * ── WHERE THE NUMBER NOW COMES FROM ──────────────────────────────────────
 *
 * Since enforcement landed, `used` is `count(*)` over
 * `reminder_allowance_slots` — one row per logical reminder holding a unit,
 * primary-keyed by reminder_log_id. The banner and the send path read the same
 * ledger, so the number shown and the number enforced cannot drift.
 *
 * ALLOWANCE_CONSUMING_STATUSES below is no longer the live counting rule. It
 * remains the definition of "dispatched", and it still governs two things:
 * migration 011's backfill, and which failures return a unit.
 */

/** The founding beta includes ten reminders. SMS and email, per reminder. */
export const FOUNDING_BETA_ALLOWANCE = 10;

/**
 * The statuses that mean this reminder was DISPATCHED — handed to a provider
 * that accepted it.
 *
 *   sent              accepted and confirmed. Unambiguous.
 *   delivery_unknown  the provider may already have it and we never learned
 *                     the outcome. Not charging for it would make an ambiguous
 *                     result a free reminder, which is both untrue and the one
 *                     state a user could deliberately provoke.
 *   undelivered       the provider ACCEPTED it and delivery then failed
 *                     (bounce, complaint, suppression). The send happened; the
 *                     inbox rejected it afterwards.
 *
 * Deliberately excluded, each for its own reason:
 *
 *   pending           prepared, awaiting approval. Nothing has gone anywhere.
 *   dismissed         the owner declined it. Never submitted.
 *   failed            a definite PRE-ACCEPTANCE rejection — the provider
 *                     certainly never took the message. This is exactly the
 *                     "send failure before either channel was sent" case, and
 *                     it must be free.
 *   sending           an attempt is in flight. Excluded so the counter only
 *                     ever moves UP: were it included, a subsequent definite
 *                     rejection would hand a credit back and the number would
 *                     drop, which reads as a bug even when it is correct.
 */
export const ALLOWANCE_CONSUMING_STATUSES: readonly ReminderSendStatus[] = [
  "sent",
  "delivery_unknown",
  "undelivered",
];

export function consumesAllowance(status: string): boolean {
  return (ALLOWANCE_CONSUMING_STATUSES as readonly string[]).includes(status);
}

/**
 * Statuses whose ARRIVAL means the reminder is not going to consume anything.
 *
 *   pending    back in the queue, nothing submitted
 *   dismissed  the owner declined it
 *   failed     a definite pre-acceptance rejection — the provider never took it
 *
 * `sending` is deliberately absent. An in-flight attempt must KEEP its
 * reservation: releasing mid-send is precisely how a second request slips in
 * and an eleventh reminder goes out.
 */
export const ALLOWANCE_RELEASING_STATUSES: readonly ReminderSendStatus[] = [
  "pending",
  "dismissed",
  "failed",
];

/**
 * THE RELEASE RULE — one definition, shared by the application and asserted
 * against the database trigger that actually enforces it.
 *
 * A unit is returned when, and only when, a reminder that had NOT yet consumed
 * anything moves into a state that means it never will.
 *
 * Two clauses, and both matter:
 *
 *   consumed is FINAL. Once a reminder reaches sent / delivery_unknown /
 *   undelivered, no later status change refunds it. Something was handed to a
 *   provider that accepted it; a subsequent UI action cannot un-send it, and
 *   allowing one would make "dismiss after sending" an infinite free tier.
 *
 *   a non-transition releases nothing. Dismissing twice, or any repeated write
 *   of the same status, must not look like a fresh event. The database
 *   operation is a DELETE, which is idempotent anyway, but the rule says so
 *   explicitly rather than relying on that.
 */
export function releasesAllowance(previous: string, next: string): boolean {
  if (previous === next) return false;
  if (consumesAllowance(previous)) return false;
  return (ALLOWANCE_RELEASING_STATUSES as readonly string[]).includes(next);
}

/**
 * THE DISPATCHED-STATE INVARIANT.
 *
 * True when a status change would take an already-dispatched reminder back to
 * a state where it is not dispatched. Every such change is REJECTED outright
 * by the database — this is not a release rule, it is a write that never
 * happens.
 *
 * WHY IT EXISTS, separately from the release rule above.
 *
 * `releasesAllowance` protects the LEDGER: a dispatched reminder keeps its
 * unit whatever happens to its status. That is necessary but not sufficient,
 * because RLS on reminder_logs permits `auth.uid() = user_id` updates. A user
 * could therefore set one of their own `sent` reminders back to `pending`
 * from the browser:
 *
 *     update reminder_logs set status = 'pending' where id = <their sent one>
 *
 * The ledger correctly refuses to refund, so the CAP is not bypassed. But
 * `pending` is in CLAIMABLE_STATUSES, so the reminder becomes approvable
 * again — and re-approving finds it `already_held`, spends nothing further,
 * and sends the same message to the customer once more. Unlimited SENDS for
 * one unit: a duplicate-delivery hole rather than an allowance hole, and
 * worse, because the person receiving the repeats is the trade's customer.
 *
 * Legitimate movement WITHIN the dispatched set stays allowed —
 * `delivery_unknown → sent` and `undelivered → sent` are exactly what
 * reconciliation does when the provider finally answers.
 */
export function isDispatchedRegression(previous: string, next: string): boolean {
  if (previous === next) return false;
  return consumesAllowance(previous) && !consumesAllowance(next);
}

/**
 * Counts consumed allowance from reminder_logs rows.
 *
 * Also de-duplicates by row id. That is belt-and-braces rather than a fix for
 * a known defect: the caller counts in the database, and this exists so a
 * future caller that joins channel rows onto logs — the one shape that WOULD
 * produce two rows for one reminder — still returns the reminder count.
 */
export function countConsumed(rows: Array<{ id?: string; status: string }>): number {
  const seen = new Set<string>();
  let anonymous = 0;

  for (const row of rows) {
    if (!consumesAllowance(row.status)) continue;
    if (row.id === undefined) anonymous++;
    else seen.add(row.id);
  }
  return seen.size + anonymous;
}

export interface BetaAllowance {
  allowance: number;
  /** Clamped to 0..allowance. */
  used: number;
  /** Never negative. */
  remaining: number;
  /** 0–100, clamped. */
  percentUsed: number;
  atLimit: boolean;
}

/**
 * Turns a raw count into a display-safe allowance.
 *
 * Clamping is not defensive noise. Legacy rows predate migration 009, the
 * allowance is a product decision that could change, and an eleventh reminder
 * existing in the database must never render as "-1 remaining" or a progress
 * bar wider than its track.
 */
export function betaAllowance(
  usedRaw: number,
  allowance: number = FOUNDING_BETA_ALLOWANCE
): BetaAllowance {
  const safeAllowance = Math.max(0, Math.floor(allowance));
  const used = Math.min(Math.max(0, Math.floor(usedRaw || 0)), safeAllowance);

  return {
    allowance: safeAllowance,
    used,
    // Math.max is redundant by construction — `used` is already clamped to
    // safeAllowance above, so this can never go negative. Kept as a second
    // guard because it is the number a user reads, and it must not depend on
    // one line elsewhere staying correct. Mutation testing confirms it is
    // currently unreachable, which is the intended state.
    remaining: Math.max(0, safeAllowance - used),
    percentUsed: safeAllowance === 0 ? 100 : Math.round((used / safeAllowance) * 100),
    atLimit: used >= safeAllowance,
  };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * ── THE HEADER USAGE PANEL'S WORDING ─────────────────────────────────────
 *
 * ONE statement, ONE number, at every width.
 *
 * The previous chip said "Founding beta · 10 free reminders" AND "10
 * remaining" side by side: the same fact twice, in two different framings,
 * competing for the eye in a space too small for either. A usage fraction
 * carries both halves at once — "4 / 10 used" already tells you six are left —
 * so the second element was not just redundant, it was the reason nothing in
 * the component could be read quickly.
 *
 * No percentage either. The bar shows the proportion; the text gives the exact
 * figures. Adding "40%" would be the third rendering of one number.
 */
/**
 * The two halves of the desktop line, exported separately so the panel can
 * weight "Founding beta" a step above the figures without either half being
 * written down twice. allowanceUsageLabel() is composed FROM them, so the
 * rendered pieces and the canonical string cannot drift.
 */
export const ALLOWANCE_LABEL_PREFIX = "Founding beta";

/**
 * True when the founding-beta allowance is spent.
 *
 * Exposed rather than re-derived at each call site so the wording, the styling
 * and any future gate all agree on one definition.
 */
export function allowanceExhausted(a: BetaAllowance): boolean {
  return a.remaining === 0;
}

/**
 * The cap state, as its OWN short string.
 *
 * Deliberately not appended to the usage sentence. Concatenating it produced
 * "Founding beta — 10 / 10 reminders used — limit reached" in a fixed-width
 * header panel, which truncated to "...limit reac…" — losing precisely the
 * word that carried the meaning. A separate element can sit beside the usage
 * line and be given its own space, and it cannot be clipped by the length of
 * the sentence in front of it.
 */
export const ALLOWANCE_LIMIT_BADGE = "Limit reached";

export function allowanceUsageDetail(a: BetaAllowance): string {
  return `${a.used} / ${a.allowance} ${plural(a.allowance, "reminder", "reminders")} used`;
}

export function allowanceUsageLabel(a: BetaAllowance): string {
  return `${ALLOWANCE_LABEL_PREFIX} — ${allowanceUsageDetail(a)}`;
}

/** Tablet and narrow desktop. Same fraction, less framing. */
export function allowanceUsageLabelCompact(a: BetaAllowance): string {
  return `Beta — ${a.used} / ${a.allowance} used`;
}

/** The mobile bar, which also carries a logo, a wordmark and Sign out. */
export function allowanceUsageLabelMini(a: BetaAllowance): string {
  return `Beta · ${a.used} / ${a.allowance}`;
}

/**
 * The progress element's accessible value text.
 *
 * Spelled out ("4 of 10") rather than the visible "4 / 10", because a screen
 * reader should hear a sentence rather than punctuation. It is NOT rendered:
 * the visible line is the primary meaning, and duplicating it on screen is the
 * defect this pass exists to remove.
 */
export function allowanceProgressLabel(a: BetaAllowance): string {
  return `${a.used} of ${a.allowance} free ${plural(a.allowance, "reminder", "reminders")} used`;
}
