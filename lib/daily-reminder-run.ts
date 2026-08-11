import { getTodayLondonDate } from "./date-status";

/**
 * The daily reminder run — the SINGLE SOURCE OF TRUTH for *when* it happens
 * and *which invoices it will act on*.
 *
 * Two things need to agree about this job: the job itself
 * (/api/cron/send-reminders) and anything that forecasts it (the Overview's
 * "Coming up"). Where they disagree, the dashboard lies. This module exists so
 * there is exactly one place to disagree with.
 *
 * ── THE BUG THIS WAS EXTRACTED TO FIX ────────────────────────────────────
 *
 * "Coming up" hid any checkpoint dated today, on the reasoning that the daily
 * run had already been and gone. That reasoning silently assumed the run
 * happens at London midnight. It does not:
 *
 *   cron schedule   0 8 * * *   →  08:00 UTC
 *   during GMT      08:00 UTC   =  08:00 London
 *   during BST      08:00 UTC   =  09:00 London
 *
 * So for the first eight or nine hours of every London day, a checkpoint
 * falling on that day had NOT been processed, and the owner was shown nothing
 * at all for it: too late to be "coming up", too early to exist in "Needs your
 * attention". A whole reminder disappeared from the page for a third of the
 * day, and for longer in summer.
 *
 * The calendar date is therefore not sufficient. The comparison has to be
 * against the actual run INSTANT.
 */

/**
 * The UTC hour at which the daily run fires.
 *
 * MUST match the cron expression registered in vercel.json. A test asserts
 * that it does, because these two numbers drifting apart is precisely the
 * failure this module was created to prevent.
 */
export const DAILY_RUN_UTC_HOUR = 8;

/** The cron expression this hour implies, for comparison against vercel.json. */
export const DAILY_RUN_CRON = `0 ${DAILY_RUN_UTC_HOUR} * * *`;

/**
 * The UTC instant at which the daily run happens on a given Europe/London
 * calendar date.
 *
 * WHY THIS MAPPING IS SOUND: London is UTC+0 (GMT) or UTC+1 (BST). An 08:00
 * UTC instant therefore lands at 08:00 or 09:00 London on the SAME calendar
 * date, so "the run for London date D" is unambiguously D at 08:00 UTC.
 *
 * That holds for any run hour from 00 to 22. At 23:00 UTC it would break —
 * during BST, 23:00 UTC on D is 00:00 London on D+1, and the run would belong
 * to the following London day. `assertRunHourIsSafe` guards this, and a test
 * exercises the guard.
 */
export function dailyRunInstant(londonDateISO: string): Date {
  return new Date(`${londonDateISO}T${String(DAILY_RUN_UTC_HOUR).padStart(2, "0")}:00:00Z`);
}

/** True when the configured hour keeps a UTC run inside the London day it belongs to. */
export function assertRunHourIsSafe(hour: number = DAILY_RUN_UTC_HOUR): boolean {
  return hour >= 0 && hour <= 22;
}

/** Today's Europe/London calendar date as YYYY-MM-DD. */
export function londonDateISO(now: Date = new Date()): string {
  return getTodayLondonDate(now).toISOString().slice(0, 10);
}

/**
 * Has today's run already happened?
 *
 * Inclusive at the boundary: at exactly 08:00:00 UTC the job is firing, so any
 * checkpoint for today belongs to it and not to a forecast of it.
 */
export function dailyRunHasHappened(now: Date = new Date()): boolean {
  return now.getTime() >= dailyRunInstant(londonDateISO(now)).getTime();
}

/**
 * Whether a checkpoint falling on `checkpointDateISO` is still in the future
 * relative to `now` — i.e. the daily run has not yet processed it.
 *
 *   before today            → false (missed; manual "Prepare reminder" covers it)
 *   today, before the run   → TRUE  (the case the old date-only check lost)
 *   today, at/after the run → false (it belongs to the run, not to a forecast)
 *   after today             → true
 */
export function isBeforeDailyRun(checkpointDateISO: string, now: Date = new Date()): boolean {
  const today = londonDateISO(now);
  if (checkpointDateISO < today) return false;
  if (checkpointDateISO > today) return true;
  return !dailyRunHasHappened(now);
}

/**
 * Whether the daily run is able to contact this customer at all.
 *
 * Previously this regular expression existed twice: once in the cron route and
 * once, copied by hand, in the Overview forecast. Two copies of a predicate
 * that MUST agree is a defect waiting for someone to loosen one of them — the
 * forecast would then promise a reminder for an address the job rejects every
 * single day.
 */
export const CUSTOMER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function canEmailCustomer(email: string | null | undefined): boolean {
  return !!email && CUSTOMER_EMAIL_RE.test(email);
}
