import { SUPPORT_FROM } from "@/lib/resend";
import "server-only";
import { render } from "@react-email/render";
import { tryClaim, confirmSent, markFailed } from "./email-events";
import { getResendClient } from "./resend";
import { WelcomeEmail } from "@/emails/templates/WelcomeEmail";

const RESEND_TIMEOUT_MS = 10_000;
// Welcome is account communication, so it sends from the monitored support
// mailbox rather than a separate unmonitored address.
const WELCOME_FROM = SUPPORT_FROM;

/**
 * Attempts to send the one-time Welcome email for a user, using the
 * atomic claim/confirm/fail mechanism in lib/email-events.ts.
 *
 * Safe to call on EVERY authenticated request — after the first
 * successful send, tryClaim() is a fast no-op (see email_events.sql's
 * WHERE clause, which structurally excludes 'sent' rows). This is what
 * makes a failed/timed-out attempt retryable on a later request even
 * though the user's profile already exists by then.
 *
 * This function can NEVER throw — every path is caught internally, so a
 * failure here can never break the caller's response.
 */
export async function sendWelcomeEmailIfNeeded(
  userId: string,
  email: string | null | undefined,
  businessName: string | null
): Promise<void> {
  try {
    // Correction 3: don't blindly use a possibly-missing email. Skip the
    // whole attempt (don't even burn a claim) rather than fail loudly —
    // a later request, once/if the user has a usable email, retries cleanly.
    const recipient = email?.trim();
    if (!recipient) {
      console.warn(`[welcome-email] User ${userId} has no usable email address — skipping welcome email.`);
      return;
    }

    const claim = await tryClaim(userId, "welcome");
    if (!claim) return; // already sent, or another request currently owns it

    const resend = getResendClient();
    if (!resend) {
      // Pre-send, definite: no request was ever attempted.
      await markFailed(claim.id, claim.claim_token, "RESEND_API_KEY not configured");
      return;
    }

    let html: string, text: string;
    try {
      html = await render(WelcomeEmail({ businessName }));
      text = await render(WelcomeEmail({ businessName }), { plainText: true });
    } catch (renderErr) {
      // Pre-send, definite: no request ever reached Resend.
      await markFailed(
        claim.id,
        claim.claim_token,
        renderErr instanceof Error ? renderErr.message : "Render failed"
      );
      return;
    }

    // STABLE across every retry of this row — always claim.id, never
    // claim_token (which rotates on each reclaim). This is the secondary
    // protection: if a "pending" outcome below actually succeeded, a
    // later retry reusing this same key lets Resend recognise it and
    // return the original result rather than sending again. Resend
    // retains idempotency keys for 24 hours (confirmed against their
    // docs) — the DB-level claim remains the primary defence regardless.
    const idempotencyKey = claim.id;

    const TIMEOUT = Symbol("timeout");
    let timer: ReturnType<typeof setTimeout> | undefined;

    type SendResult = Awaited<ReturnType<typeof resend.emails.send>>;
    let outcome: "sent" | "failed" | "unknown";
    let sendResult: SendResult | null = null;
    let recordedMessage: string | null = null;

    try {
      const sendPromise = resend.emails.send(
        {
          from: WELCOME_FROM,
          to: recipient,
          subject: "Welcome to ServiceSignal",
          html,
          text,
        },
        { idempotencyKey }
      );

      const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), RESEND_TIMEOUT_MS);
      });

      const raced = await Promise.race([sendPromise, timeoutPromise]);

      // Correction 2: clear the timer the moment we know which one won —
      // if sendPromise settled first, the timer is now pointless and
      // should not be left dangling.
      if (timer) clearTimeout(timer);

      if (raced === TIMEOUT) {
        // Correction 1: UNKNOWN outcome. Promise.race does not cancel the
        // underlying HTTP request — Resend may still complete it. Do not
        // treat this as failure.
        outcome = "unknown";
      } else {
        sendResult = raced;
        if (sendResult.error) {
          // A structured API error response IS a definite, confirmed
          // failure — Resend told us plainly it did not send.
          outcome = "failed";
          recordedMessage = sendResult.error.message;
        } else {
          outcome = "sent";
        }
      }
    } catch (networkErr) {
      // Correction 1: a rejected promise / thrown network exception does
      // NOT prove the request never reached Resend — the response may
      // simply have been lost. Treat as unknown, not a definite failure.
      if (timer) clearTimeout(timer);
      outcome = "unknown";
      console.warn(
        `[welcome-email] Send promise rejected for event ${claim.id} (treated as unknown, not failed):`,
        networkErr instanceof Error ? networkErr.message : "Unknown error"
      );
    }

    if (outcome === "unknown") {
      // Leave the row exactly as claim_email_send set it — status
      // remains 'pending'. The existing 10-minute stale-claim window
      // controls the retry; the retry reuses this same idempotencyKey.
      console.error(
        `[welcome-email] Unknown outcome for event ${claim.id} (timeout or network error) — ` +
        `left pending for stale-claim recovery, not marked failed.`
      );
      return;
    }

    if (outcome === "sent" && sendResult) {
      await confirmSent(claim.id, claim.claim_token, sendResult.data?.id ?? "");
      return;
    }

    // outcome === "failed" — a definite, structured error. Safe to record.
    await markFailed(claim.id, claim.claim_token, recordedMessage ?? "Unknown error");
  } catch (err) {
    // Catches anything above, including admin-client init failure inside
    // tryClaim. Never logs the service-role key or any secret — only
    // err.message. Never rethrown, by design.
    console.error(
      "[welcome-email] Unexpected failure:",
      err instanceof Error ? err.message : "Unknown error"
    );
  }
}
