import "server-only";
import { render } from "@react-email/render";
import { getResendClient, SUPPORT_FROM, SUPPORT_ADDRESS } from "@/lib/resend";
import { BetaAccessEmail, betaAccessEmailText } from "@/emails/templates/BetaAccessEmail";

/**
 * Sends the founding-beta access email.
 *
 * Deliberately returns a boolean rather than throwing: saving the signup and
 * sending the email are SEPARATE OUTCOMES. The lead is already in the
 * database by the time this runs, and a send failure must never fail the
 * request or lose the row — it only changes what the visitor is told.
 *
 * Identity:
 *   From     ServiceSignal <support@servicesignal.app>
 *   Reply-To support@servicesignal.app  (explicit, so replies are never
 *            silently routed to the reminders mailbox)
 */
export async function sendBetaAccessEmail(params: {
  to: string;
  firstName: string;
}): Promise<boolean> {
  const { to, firstName } = params;

  const resend = getResendClient();
  if (!resend) {
    console.error(
      "[beta-access] RESEND_API_KEY not configured — access email not sent to a saved signup."
    );
    return false;
  }

  try {
    const element = BetaAccessEmail({ firstName });
    const html = await render(element);
    const text = betaAccessEmailText(firstName);

    const { data, error } = await resend.emails.send({
      from: SUPPORT_FROM,
      to,
      replyTo: SUPPORT_ADDRESS,
      subject: "Your ServiceSignal founding beta access",
      html,
      text,
    });

    if (error) {
      // Enough to diagnose and retry by hand; nothing internal is ever
      // returned to the visitor.
      console.error("[beta-access] Resend rejected the send:", error.message);
      return false;
    }

    console.log(`[beta-access] sent — resend id ${data?.id ?? "unknown"}`);
    return true;
  } catch (err) {
    console.error(
      "[beta-access] unexpected send failure:",
      err instanceof Error ? err.message : "unknown error"
    );
    return false;
  }
}

/** First name from a full name field. Empty string when nothing usable. */
export function firstNameFrom(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}
