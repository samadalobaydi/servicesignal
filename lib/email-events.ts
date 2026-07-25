import "server-only";
import { getEmailEventsAdmin } from "./email-events-admin";

export type EmailType = "welcome";

interface ClaimResult {
  id: string;
  claim_token: string;
  attempt_count: number;
}

/**
 * The narrow, sole interface application code uses to touch email_events.
 * Every function here calls one of the three SECURITY DEFINER Postgres
 * functions via the service-role client — never raw table access.
 */

/**
 * Attempts to claim the right to send. Returns null if there's nothing to
 * do (already sent, or another request currently holds a live claim) —
 * that's the common, expected outcome on every call after the first
 * successful send, not an error.
 */
export async function tryClaim(userId: string, emailType: EmailType): Promise<ClaimResult | null> {
  const admin = getEmailEventsAdmin();
  if (!admin) return null;

  const { data, error } = await admin.rpc("claim_email_send", {
    p_user_id: userId,
    p_email_type: emailType,
  });

  if (error) {
    console.error("[email-events] claim_email_send failed:", error.message);
    return null;
  }

  return data?.[0] ?? null;
}

/** Marks a claimed event as sent. Requires the exact token the claim issued. */
export async function confirmSent(id: string, claimToken: string, resendId: string): Promise<void> {
  const admin = getEmailEventsAdmin();
  if (!admin) return;

  const { error } = await admin.rpc("confirm_email_sent", {
    p_id: id,
    p_claim_token: claimToken,
    p_resend_id: resendId,
  });

  if (error) console.error("[email-events] confirm_email_sent failed:", error.message);
}

/** Marks a claimed event as failed — becomes immediately reclaimable. */
export async function markFailed(id: string, claimToken: string, errorMessage: string): Promise<void> {
  const admin = getEmailEventsAdmin();
  if (!admin) return;

  const { error } = await admin.rpc("fail_email_send", {
    p_id: id,
    p_claim_token: claimToken,
    p_error: errorMessage,
  });

  if (error) console.error("[email-events] fail_email_send failed:", error.message);
}
