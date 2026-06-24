import { Resend } from "resend";

/**
 * Server-side Resend client.
 * RESEND_API_KEY is never read in any client component — this file is only
 * ever imported from API routes (app/api/cron/..., app/api/reminders/...).
 *
 * Returns null if the key is missing so callers can fail gracefully
 * (log a clear message, mark the reminder as 'failed', and continue —
 * never crash the request).
 */
export function getResendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();

  if (!key) {
    console.warn(
      "\x1b[33m⚠ ServiceSignal: RESEND_API_KEY is not set.\x1b[0m\n" +
      "  Reminder emails cannot be sent until this is configured.\n" +
      "  Add RESEND_API_KEY to .env.local (and Vercel) to enable sending."
    );
    return null;
  }

  return new Resend(key);
}

/** Sender identity for all reminder emails — fixed for MVP. */
export const REMINDER_FROM = "ServiceSignal <reminders@servicesignal.app>";
