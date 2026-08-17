import { SCHEDULE_DAY, SCHEDULE_CHRONOLOGY, daysFromDue } from "./reminder-schedule";
import type { ReminderSchedule } from "@/types";

/**
 * What a reminder plan will ACTUALLY do for an invoice, from today onwards.
 *
 * WHY THIS EXISTS
 *
 * The shared preset summaries in lib/invoice-form.ts describe a plan from the
 * beginning of its life — Standard reads "On the due date, then 3 and 7 days
 * overdue" — which is correct in the dashboard drawer and wrong during
 * onboarding whenever the invoice is ALREADY overdue, in two separate ways:
 *
 *   1. It describes checkpoints that have already passed. An invoice 4 days
 *      overdue can never receive its "on the due date" reminder.
 *   2. Worse, it PROMISES more reminders than will ever arrive. Two independent
 *      rules combine to make missed checkpoints unrecoverable:
 *
 *        - scheduleToPrepare() picks the FURTHEST-ALONG reached checkpoint, so
 *          onboarding prepares exactly one reminder and the earlier reached
 *          checkpoints are simply skipped.
 *        - the daily cron matches on an EXACT day count (todaysSchedule →
 *          scheduleForDaysFromDue), so a checkpoint whose day has passed is
 *          never revisited.
 *
 *      An invoice entered 12 days overdue on the Standard plan therefore gets
 *      ONE reminder, ever — while the summary advertises three.
 *
 * That second point is the real defect. Describing history inaccurately is
 * untidy; over-promising how many times a customer will be chased is a broken
 * expectation on the first screen of the product.
 *
 * SHARED BEHAVIOUR IS UNCHANGED. This computes a description only. No
 * scheduling rule, no eligibility rule and no stored value is altered, and
 * lib/invoice-form.ts is untouched so the dashboard keeps its own correct
 * wording.
 */

export interface OnboardingSchedulePlan {
  /** Prepared immediately on submit — the furthest-along reached checkpoint. */
  now: ReminderSchedule | null;
  /** Checkpoints still ahead. The cron will reach each on its exact day. */
  later: ReminderSchedule[];
  /**
   * Reached checkpoints that will NOT produce a reminder, because a later one
   * supersedes them and the cron never revisits a past day. Surfaced so the UI
   * can stay silent about them rather than implying they are still coming.
   */
  missed: ReminderSchedule[];
  /** Days past the due date, as the scheduler computes it. */
  daysOverdue: number;
}

/**
 * Mirrors scheduleToPrepare() with `alreadySent` empty, which is always the
 * case for an invoice being created. Kept as a separate pure function rather
 * than calling into the scheduler so this module can never mutate anything.
 */
export function planFromDueDate(
  selectedSchedules: readonly ReminderSchedule[],
  dueDateISO: string,
  today: Date = new Date()
): OnboardingSchedulePlan {
  const days = daysFromDue(dueDateISO, today);

  const selected = SCHEDULE_CHRONOLOGY.filter((s) => selectedSchedules.includes(s));
  const reached = selected.filter((s) => SCHEDULE_DAY[s] <= days);
  const later = selected.filter((s) => SCHEDULE_DAY[s] > days);

  const now = reached.length > 0 ? reached[reached.length - 1] : null;
  const missed = now ? reached.slice(0, -1) : [];

  return { now, later, missed, daysOverdue: days };
}

/** "3 days overdue", "7 days overdue", "the due date" — for use mid-sentence. */
function checkpointPhrase(schedule: ReminderSchedule): string {
  switch (schedule) {
    case "before_due_3_days": return "3 days before the due date";
    case "due_today": return "the due date";
    case "overdue_3_days": return "3 days overdue";
    case "overdue_7_days": return "7 days overdue";
    case "overdue_14_days": return "14 days overdue";
  }
}

function joinPhrases(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The sentence shown under "Schedule" during onboarding.
 *
 * Written from NOW rather than from the invoice's due date, because that is the
 * only frame in which the answer is both true and useful: the owner wants to
 * know what happens next, not what would have happened had they signed up three
 * weeks ago. It never mentions a missed checkpoint — naming a reminder that
 * cannot arrive is exactly the confusion this replaces.
 */
export function describePlan(plan: OnboardingSchedulePlan): string {
  const remaining = plan.later.map(checkpointPhrase);

  if (!plan.now) {
    // AN ORDINARY CASE NOW, not a defensive one. Onboarding accepts invoices
    // that are not yet due, so this is what a customer joining with an invoice
    // due next week sees. It must therefore be a complete, forward-looking
    // description rather than a fallback: every checkpoint is still ahead, so
    // every one of them is named, and nothing claims a reminder is ready.
    if (remaining.length === 0) return "No reminders are scheduled for this invoice.";
    return remaining.length === 1
      ? `First reminder at ${remaining[0]}.`
      : `First reminder at ${remaining[0]}, then at ${joinPhrases(remaining.slice(1))}.`;
  }

  if (remaining.length === 0) {
    // "at this stage", not "this overdue". A checkpoint can be reached before
    // the due date — before_due_3_days sits at offset -3 — so this sentence is
    // also shown for an invoice that is not overdue at all.
    return "One reminder, ready to review now. This plan has no later reminders for an invoice at this stage.";
  }

  return `First reminder ready to review now, then at ${joinPhrases(remaining)}.`;
}

/** Convenience for the field: plan and sentence in one call. */
export function describeScheduleFromDueDate(
  selectedSchedules: readonly ReminderSchedule[],
  dueDateISO: string,
  today: Date = new Date()
): string | null {
  if (!dueDateISO || selectedSchedules.length === 0) return null;
  const parsed = new Date(dueDateISO);
  if (Number.isNaN(parsed.getTime())) return null;
  return describePlan(planFromDueDate(selectedSchedules, dueDateISO, today));
}
