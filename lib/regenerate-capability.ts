/**
 * Temporary production gate for the sender-identity-drift Regenerate
 * capability (lib/reminder-regenerate.ts, POST /api/reminders/[id]/regenerate,
 * migration 016).
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * regenerate_reminder_identity() (migration 016) is safe in isolation — see
 * its own DDL audits. But the TypeScript layer that calls it composes
 * replacement content from CURRENT invoice data read through the ordinary
 * application read path, and until migration 013 is applied, `authenticated`
 * still holds table-level UPDATE on public.invoices — so a direct browser
 * write to an invoice's own row (bypassing update_invoice_with_refresh
 * entirely) can change generation-relevant fields without bumping
 * send_attempt_count, defeating migration 016's own source-version guard.
 * See the deployment-sequencing audit for the full reasoning. This gate
 * keeps Regenerate unavailable until that window is closed.
 *
 * ── SERVER-AUTHORITATIVE, NOT A UI-ONLY SWITCH ────────────────────────────
 *
 * Checked independently in TWO places, neither trusting the other:
 *
 *   1. app/api/reminders/[id]/regenerate/route.ts — the authoritative gate.
 *      Refuses before authenticating the session or reading anything, so
 *      regenerateReminder() and the RPC are structurally unreachable while
 *      disabled, exactly like BETA_APPROVAL_ONLY's cron gate.
 *   2. lib/reminder-review.ts — read server-side and threaded into
 *      ReminderReviewData.regenerateEnabled, so ReminderReviewPanel can hide
 *      the "Regenerate reminder" action. This is a courtesy, not the
 *      enforcement point — the browser is never trusted for that.
 *
 * Deliberately NOT in lib/beta-capabilities.ts. That file's flags are plain
 * module constants by design — a permanent product decision that should go
 * through code review to flip. This gate is the opposite: a temporary,
 * operational switch meant to be flipped exactly once, at a moment defined
 * by DATABASE state (migration 013 applied and verified), not by a code
 * change. An environment variable lets that happen without a second full
 * deploy cycle — which would only reintroduce the same "is the deployed
 * code in sync with the applied migrations" question this gate exists to
 * avoid answering the hard way.
 *
 * Never NEXT_PUBLIC_*. Read only in server code.
 *
 * ── DEFAULT: DISABLED ─────────────────────────────────────────────────────
 *
 * Any value other than the exact string "true" — including unset — disables
 * the feature. This is the safer state, and requires no configuration to
 * remain in effect.
 *
 * ── INTENDED DEPLOYMENT SEQUENCE ──────────────────────────────────────────
 *
 *   1. Apply migration 016.
 *   2. Deploy this application code with REGENERATE_ENABLED unset (or any
 *      value other than "true"). Regenerate stays unavailable; the
 *      underlying identity-drift Approve/Retry refusal (migration 015) is
 *      completely unaffected and continues to fail closed either way.
 *   3. Fix the outstanding direct-invoice-write dependency (see the
 *      deployment-sequencing audit), apply migration 013, run its own
 *      documented verification queries.
 *   4. After migration 013 has been applied AND its verification has
 *      passed, set REGENERATE_ENABLED=true for the Vercel Production
 *      environment.
 *   5. Redeploy Production so the new environment-variable value takes
 *      effect — per Vercel's documented behavior, an environment-variable
 *      change applies to new deployments, not to already-running ones.
 *   6. Verify Regenerate is available in Production before relying on it.
 */
export function isRegenerateEnabled(): boolean {
  return process.env.REGENERATE_ENABLED === "true";
}
