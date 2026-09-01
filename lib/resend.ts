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

/**
 * Sender identities. Two addresses, two jobs — deliberately separate so a
 * deliverability problem with one can never take down the other:
 *
 *   reminders@ — automated invoice reminders to the BUSINESS OWNER'S customers.
 *                Reply-To is set per-send to the owner's own account email, so
 *                a customer replying reaches the trade, not ServiceSignal.
 *   support@   — beta access, welcome, account and legal contact. Replies come
 *                to a monitored ServiceSignal mailbox.
 */
export const REMINDER_FROM_ADDRESS = "reminders@servicesignal.app";

// There is deliberately NO generic "ServiceSignal <...>" From constant for
// reminder sends. Every reminder send path (Prepare/Approve/Retry/Regenerate,
// and the dormant Auto cron path) must build its From header from a resolved
// sender identity via reminderFromHeader() (lib/sender-identity.ts) — never
// a hardcoded fallback that could silently ship "ServiceSignal" as the
// customer-facing chasing identity. A stale REMINDER_FROM constant used to
// sit in ApprovalDeps unread, and once did leak into the dormant Auto path's
// actual send call; both were removed for exactly this reason.

export const SUPPORT_ADDRESS = "support@servicesignal.app";
export const SUPPORT_FROM = `ServiceSignal <${SUPPORT_ADDRESS}>`;
