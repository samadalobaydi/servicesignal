import type { ReminderSchedule } from "@/types";
import { getTodayLondonDate, getDaysFromDue, getDaysOverdue } from "./date-status";

/**
 * Returns "today" as a Europe/London calendar date at midnight UTC.
 * Delegates to the canonical source of truth in lib/date-status.ts.
 */
export function londonToday(now: Date = new Date()): Date {
  return getTodayLondonDate(now);
}

/**
 * Calculates the number of days between today and the invoice's due date.
 * Positive = overdue by that many days. Negative = due in that many days.
 * Zero = due today. Delegates to the canonical source of truth.
 */
export function daysFromDue(dueDateISO: string, today: Date = getTodayLondonDate()): number {
  const due = new Date(dueDateISO);
  due.setUTCHours(0, 0, 0, 0);

  const t = new Date(today);
  t.setUTCHours(0, 0, 0, 0);

  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((t.getTime() - due.getTime()) / msPerDay);
}

/**
 * Days a given invoice is overdue, computed live from its due_date against
 * today's Europe/London date. 0 or negative means not yet overdue.
 * Delegates to the canonical source of truth in lib/date-status.ts.
 */
export function daysOverdue(dueDateISO: string, now: Date = new Date()): number {
  return getDaysOverdue(dueDateISO, now);
}

/**
 * Maps a days-from-due value to the matching reminder schedule key.
 * Returns null if no schedule corresponds to that exact day count —
 * reminders only fire on these specific days, not every day overdue.
 */
export function scheduleForDaysFromDue(days: number): ReminderSchedule | null {
  switch (days) {
    case -3: return "before_due_3_days";
    case 0:  return "due_today";
    case 3:  return "overdue_3_days";
    case 7:  return "overdue_7_days";
    case 14: return "overdue_14_days";
    default: return null;
  }
}

/**
 * Convenience: given a due_date, returns the schedule key that applies
 * today (relative to the provided `today`), or null if today doesn't
 * match any of the five reminder checkpoints.
 */
export function todaysSchedule(
  dueDateISO: string,
  today: Date = new Date()
): ReminderSchedule | null {
  return scheduleForDaysFromDue(daysFromDue(dueDateISO, today));
}

/** Human-readable description of a schedule, used in email copy. */
export function scheduleTimingPhrase(schedule: ReminderSchedule): string {
  switch (schedule) {
    case "before_due_3_days": return "is due in 3 days";
    case "due_today":         return "is due today";
    case "overdue_3_days":    return "is now 3 days overdue";
    case "overdue_7_days":    return "is now 7 days overdue";
    case "overdue_14_days":   return "is now 14 days overdue";
  }
}

/** Chronological order of all schedules, earliest first. */
export const SCHEDULE_CHRONOLOGY: ReminderSchedule[] = [
  "before_due_3_days",
  "due_today",
  "overdue_3_days",
  "overdue_7_days",
  "overdue_14_days",
];

/**
 * Chooses which schedule a MANUAL "Prepare Reminder" action should create
 * for an invoice. This is independent of cron timing — the user is
 * explicitly choosing to chase now.
 *
 * Logic: among the schedules the user selected for this invoice that have
 * NOT already been sent, pick the one that best matches how overdue the
 * invoice is right now:
 *   - the latest checkpoint at or before today's days-overdue (so a 10-day
 *     overdue invoice prepares the "7 days overdue" message, not "3 days")
 *   - returns null when NO selected checkpoint has been reached yet, or when
 *     every selected schedule has already been sent
 *
 * SAFETY (v8.9.2): this previously fell back to `unsent[0]` when no checkpoint
 * had been reached, which queued a reminder for an invoice that was nowhere
 * near its first checkpoint — an invoice due in 30 days with only
 * overdue_14_days selected got a reminder in the approval queue today. The
 * email body is computed live from due-status at send time, so nothing false
 * would have reached a customer, but the queue entry was premature and the
 * "Prepare Reminder" control implied an action the schedule did not support.
 * Eligibility is now strict: selected, unsent, AND reached.
 */
export function scheduleToPrepare(
  selectedSchedules: ReminderSchedule[],
  alreadySent: ReminderSchedule[],
  dueDateISO: string,
  today: Date = new Date()
): ReminderSchedule | null {
  const unsent = unsentSchedules(selectedSchedules, alreadySent);
  if (unsent.length === 0) return null;

  const days = daysFromDue(dueDateISO, today);

  // Latest unsent checkpoint that today has already reached or passed.
  const reached = unsent.filter((s) => SCHEDULE_DAY[s] <= days);
  if (reached.length > 0) {
    return reached[reached.length - 1]; // furthest-along reached checkpoint
  }

  // No checkpoint reached yet. NOT eligible — see the safety note above.
  return null;
}

/**
 * The days-from-due each checkpoint represents. Negative is before the due
 * date. Exported so callers can explain *when* a reminder becomes available
 * rather than only that it is unavailable.
 */
export const SCHEDULE_DAY: Record<ReminderSchedule, number> = {
  before_due_3_days: -3,
  due_today: 0,
  overdue_3_days: 3,
  overdue_7_days: 7,
  overdue_14_days: 14,
};

function unsentSchedules(
  selectedSchedules: ReminderSchedule[],
  alreadySent: ReminderSchedule[]
): ReminderSchedule[] {
  return SCHEDULE_CHRONOLOGY.filter(
    (s) => selectedSchedules.includes(s) && !alreadySent.includes(s)
  );
}

/**
 * Why a reminder cannot be prepared right now, so the UI and the API can say
 * something specific instead of failing silently.
 *
 *   "none_selected"  — the invoice has no reminder schedules at all
 *   "all_sent"       — every selected schedule has already gone out
 *   "not_yet_due"    — schedules remain, but none has been reached yet
 */
export type PrepareBlockedReason = "none_selected" | "all_sent" | "not_yet_due";

export interface PrepareEligibility {
  /** The schedule that may be prepared now, or null. */
  schedule: ReminderSchedule | null;
  /** Set only when schedule is null. */
  blockedReason?: PrepareBlockedReason;
  /**
   * ISO date (YYYY-MM-DD) on which the earliest remaining checkpoint becomes
   * eligible. Set only when blockedReason is "not_yet_due".
   */
  eligibleFrom?: string;
}

/**
 * The full eligibility picture. scheduleToPrepare() answers "can I?"; this
 * answers "and if not, why, and when?".
 */
export function prepareEligibility(
  selectedSchedules: ReminderSchedule[],
  alreadySent: ReminderSchedule[],
  dueDateISO: string,
  today: Date = new Date()
): PrepareEligibility {
  if (!selectedSchedules || selectedSchedules.length === 0) {
    return { schedule: null, blockedReason: "none_selected" };
  }

  const unsent = unsentSchedules(selectedSchedules, alreadySent);
  if (unsent.length === 0) {
    return { schedule: null, blockedReason: "all_sent" };
  }

  const schedule = scheduleToPrepare(selectedSchedules, alreadySent, dueDateISO, today);
  if (schedule) return { schedule };

  // Nothing reached yet: the earliest remaining checkpoint decides the date.
  const earliestOffset = Math.min(...unsent.map((s) => SCHEDULE_DAY[s]));
  const due = new Date(dueDateISO);
  due.setUTCHours(0, 0, 0, 0);
  due.setUTCDate(due.getUTCDate() + earliestOffset);

  return {
    schedule: null,
    blockedReason: "not_yet_due",
    eligibleFrom: due.toISOString().slice(0, 10),
  };
}
