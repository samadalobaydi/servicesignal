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
 *   - if none have been reached yet (invoice not yet due), pick the
 *     earliest unsent schedule so the user can still send an early nudge
 *   - returns null only if every selected schedule has already been sent
 */
export function scheduleToPrepare(
  selectedSchedules: ReminderSchedule[],
  alreadySent: ReminderSchedule[],
  dueDateISO: string,
  today: Date = new Date()
): ReminderSchedule | null {
  const unsent = SCHEDULE_CHRONOLOGY.filter(
    (s) => selectedSchedules.includes(s) && !alreadySent.includes(s)
  );
  if (unsent.length === 0) return null;

  const days = daysFromDue(dueDateISO, today);

  // Map each schedule to the days-from-due it represents
  const scheduleDay: Record<ReminderSchedule, number> = {
    before_due_3_days: -3,
    due_today: 0,
    overdue_3_days: 3,
    overdue_7_days: 7,
    overdue_14_days: 14,
  };

  // Latest unsent checkpoint that today has already reached or passed
  const reached = unsent.filter((s) => scheduleDay[s] <= days);
  if (reached.length > 0) {
    return reached[reached.length - 1]; // furthest-along reached checkpoint
  }

  // Invoice not yet at any checkpoint — offer the earliest unsent one
  return unsent[0];
}
