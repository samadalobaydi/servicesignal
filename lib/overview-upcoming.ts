import type { Invoice, ReminderLog, ReminderSchedule } from "@/types";
import { SCHEDULE_CHRONOLOGY, SCHEDULE_DAY } from "./reminder-schedule";
import { getTodayLondonDate } from "./date-status";
import { canEmailCustomer, isBeforeDailyRun } from "./daily-reminder-run";

/**
 * "Coming up" — the next reminder ServiceSignal will PREPARE, per invoice.
 *
 * ── WHY THIS IS ALLOWED TO EXIST ─────────────────────────────────────────
 *
 * A forecast is a promise. It only earns a place on the Overview if the
 * system genuinely does the thing on the date shown. It does, and the chain
 * is short enough to state in full:
 *
 *   1. Checkpoints are fixed integer offsets from the due date —
 *      SCHEDULE_DAY in lib/reminder-schedule.ts. Nothing is inferred: the
 *      date of a checkpoint is due_date + offset, exactly.
 *   2. /api/cron/send-reminders runs daily at the instant defined in
 *      lib/daily-reminder-run.ts. It matches TODAY against those same offsets
 *      via todaysSchedule() and inserts a 'pending' reminder_logs row when
 *      they coincide.
 *   3. BETA_APPROVAL_ONLY holds that row at 'pending'. The reminder is
 *      PREPARED and waits for the owner. It is not sent.
 *
 * So the honest claim is "we will prepare this for your review on 11 Aug",
 * and that is the only claim made. Nothing here says or implies a customer
 * will be contacted on that date — the owner still decides.
 *
 * ── THE FOUR THINGS THAT WOULD MAKE IT A LIE ─────────────────────────────
 *
 * The cron has preconditions. A forecast that ignores them promises work the
 * job will silently skip, so each one is mirrored below:
 *
 *   - the invoice must not be paid            → paid invoices excluded
 *   - customer_email must be valid            → canEmailCustomer, the SAME
 *                                               function the cron calls, not
 *                                               a second copy of the regex
 *   - the schedule must be one the owner chose → reminder_schedules
 *   - no reminder_logs row may exist for
 *     (invoice_id, schedule)                  → `claimed`, from pending AND
 *                                               history, not just
 *                                               reminders_sent
 *   - the run for that date must not have
 *     fired yet                               → isBeforeDailyRun
 *
 * The last one is also what stops "Coming up" repeating "Needs your
 * attention": an invoice whose reminder is already prepared has a row for
 * that checkpoint, so this module skips past it to the NEXT one — a
 * genuinely later checkpoint, never the same job twice.
 *
 * Pure and free of React so all of the above is unit-testable.
 */

/**
 * What each checkpoint is, as a noun. Deliberately NOT a sentence: the
 * "prepared for your review" claim is made once, in the section footnote,
 * rather than repeated on every row.
 */
const CHECKPOINT_LABEL: Record<ReminderSchedule, string> = {
  before_due_3_days: "Reminder 3 days before due date",
  due_today: "Due-date reminder",
  overdue_3_days: "3-day overdue reminder",
  overdue_7_days: "7-day overdue reminder",
  overdue_14_days: "14-day overdue reminder",
};

export interface UpcomingItem {
  invoiceId: string;
  customerName: string;
  invoiceReference: string | null;
  schedule: ReminderSchedule;
  /** ISO date (YYYY-MM-DD) the daily job will prepare this reminder. */
  date: string;
  /**
   * Whole days from today (Europe/London).
   *
   * 0 is legitimate and means "later today, before the daily run" — see
   * isBeforeDailyRun. It is never negative.
   */
  daysAway: number;
  /** "7-day overdue reminder" */
  description: string;
}

export interface UpcomingInput {
  invoices: Invoice[];
  /** status = 'pending'. */
  pendingReminders: ReminderLog[];
  /** sent, dismissed, failed, delivery_unknown, undelivered. */
  reminderHistory: ReminderLog[];
  now?: Date;
}

/** due_date + the checkpoint's fixed day offset. No inference, no guessing. */
export function checkpointDate(dueDateISO: string, schedule: ReminderSchedule): string {
  const d = new Date(dueDateISO);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + SCHEDULE_DAY[schedule]);
  return d.toISOString().slice(0, 10);
}

export function buildUpcomingItems(input: UpcomingInput): UpcomingItem[] {
  const now = input.now ?? new Date();
  const today = getTodayLondonDate(now);
  const todayMs = today.getTime();

  // Every (invoice, schedule) pair that already has a reminder_logs row. The
  // cron's own duplicate check is exactly this, so forecasting one of these
  // would promise something the job will skip.
  const claimed = new Set<string>();
  for (const r of [...input.pendingReminders, ...input.reminderHistory]) {
    claimed.add(`${r.invoice_id}::${r.schedule}`);
  }

  const items: UpcomingItem[] = [];

  for (const invoice of input.invoices) {
    // Marking paid is the kill switch for the whole lifecycle, forecast
    // included. The cron filters .neq("status", "paid") for the same reason.
    if (invoice.status === "paid") continue;

    // No deliverable address means the cron will skip this invoice every
    // single day. Promising a date for it would be the worst kind of
    // dashboard lie: specific, confident and never honoured. Shared predicate,
    // imported by the cron route too — see lib/daily-reminder-run.ts.
    if (!canEmailCustomer(invoice.customer_email)) continue;

    const selected = invoice.reminder_schedules ?? [];
    const sent = invoice.reminders_sent ?? [];

    for (const schedule of SCHEDULE_CHRONOLOGY) {
      if (!selected.includes(schedule)) continue;
      if (sent.includes(schedule)) continue;
      if (claimed.has(`${invoice.id}::${schedule}`)) continue;

      const date = checkpointDate(invoice.due_date, schedule);
      const ms = new Date(`${date}T00:00:00Z`).getTime();

      // Compared against the daily run INSTANT, not merely against today's
      // calendar date.
      //
      // The date-only version of this check ("ms <= todayMs") was wrong: it
      // hid a checkpoint falling today from London midnight onwards, even
      // though the run does not fire until 08:00 or — during BST — 09:00
      // London. A past checkpoint with no log is genuinely missed, and the
      // manual "Prepare reminder" action covers that; a checkpoint due in six
      // hours is not missed and must still be shown.
      if (!isBeforeDailyRun(date, now)) continue;

      items.push({
        invoiceId: invoice.id,
        customerName: invoice.customer_name,
        invoiceReference: invoice.invoice_reference ?? null,
        schedule,
        date,
        daysAway: Math.round((ms - todayMs) / 86_400_000),
        description: CHECKPOINT_LABEL[schedule],
      });

      // One row per invoice: the next thing that will happen. Listing every
      // remaining checkpoint would turn a glance into a schedule audit.
      break;
    }
  }

  // Chronological, then alphabetical so same-day rows have a stable order
  // rather than shuffling with whatever order the invoices arrived in.
  return items.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.customerName.localeCompare(b.customerName);
  });
}

/** "Later today" / "Tomorrow" / "In 4 days" — the relative gloss under the date. */
export function upcomingRelative(daysAway: number): string {
  // 0 is reachable: a checkpoint falling today, before the daily run has
  // fired. "In 0 days" would be the giveaway that the timezone handling was
  // never thought about.
  if (daysAway === 0) return "Later today";
  return daysAway === 1 ? "Tomorrow" : `In ${daysAway} days`;
}
