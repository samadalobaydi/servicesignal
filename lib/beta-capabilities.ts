/**
 * Founding-beta capability flags.
 *
 * These are SERVER-AUTHORITATIVE. They are deliberately plain module
 * constants rather than environment variables, and must never be exposed as
 * NEXT_PUBLIC_* values: the browser is not an enforcement point.
 *
 * ── BETA_APPROVAL_ONLY ──────────────────────────────────────────────────────
 * While true, ServiceSignal never sends a reminder without the owner
 * explicitly approving it. This is what makes the public promise
 * "Nothing sends without your approval" literally true.
 *
 * The Auto Mode implementation is intentionally left intact — nothing is
 * deleted. It is gated at three points, all reading this one constant:
 *
 *   1. app/api/cron/send-reminders/route.ts — the final sending gate. This is
 *      the authoritative one. It holds even for profile rows already stored as
 *      'auto', direct API calls, and any future UI regression.
 *   2. app/api/profile/route.ts — rejects attempts to set reminder_mode 'auto'
 *      with a structured 400.
 *   3. components/dashboard/SettingsCard.tsx + app/dashboard/settings/page.tsx
 *      — the choice is not offered, and the page never labels a profile as
 *      Auto Mode while sending is actually gated.
 *
 * Setting this to false restores the previous behaviour everywhere at once.
 * The ReminderMode type union still includes 'auto' so historical rows
 * continue to read and type correctly.
 */
export const BETA_APPROVAL_ONLY = true;
