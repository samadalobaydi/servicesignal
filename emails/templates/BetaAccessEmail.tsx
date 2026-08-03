import { Img, Section, Text } from "@react-email/components";
import { EmailLayout, EmailFooter, PrimaryButton, ContentSection, HelperText, emailBanner } from "../components";
import { getAppBaseUrl } from "@/lib/app-urls";

interface BetaAccessEmailProps {
  /** First name only, already trimmed. Empty string falls back to a neutral greeting. */
  firstName: string;
}

/**
 * Beta access email — sent once per successful beta signup via
 * lib/beta-access-email.ts. Pure presentation; delivery logic lives in the
 * sender, not here.
 *
 * Product truth. The CTA is a plain link to /signup — no token, no invite,
 * nothing gated. Email ownership is verified once, by Supabase, when the
 * account is confirmed. This template therefore makes NO claim about the
 * link expiring, being single-use or being personal to the recipient,
 * because none of those things are implemented.
 *
 * The applicant's email address is deliberately NOT placed in the URL:
 * query strings leak into referrer headers, browser history and server logs.
 */
export function BetaAccessEmail({ firstName }: BetaAccessEmailProps) {
  const name = firstName.trim();
  const greeting = name ? `Hi ${name},` : "Hi,";
  const signupUrl = `${getAppBaseUrl()}/signup`;

  return (
    <EmailLayout
      previewText="You can create your ServiceSignal account now."
      contentPadding="16px 40px 40px 40px"
    >
      {/* Approved banner asset. Explicit width AND height attributes keep the
          true 2048x826 aspect ratio in Outlook, which ignores height:auto.
          Not a CSS background image — those are stripped by most clients. */}
      <Section style={{ textAlign: "center", marginBottom: 20 }}>
        <Img
          src={emailBanner.src}
          alt={emailBanner.alt}
          width={emailBanner.width}
          height={emailBanner.height}
          style={{ margin: "0 auto", display: "block", height: "auto", maxWidth: "100%" }}
        />
      </Section>

      <ContentSection heading="Your founding beta access">
        {greeting}
      </ContentSection>

      <Text style={{ fontSize: 15, lineHeight: 1.65, margin: "16px 0 0 0", color: "#0f172a" }}>
        Thanks for joining the ServiceSignal founding beta. You can create your
        account now and start setting ServiceSignal up for your business.
      </Text>

      <Section style={{ textAlign: "center", margin: "28px 0" }}>
        <PrimaryButton href={signupUrl}>Create your ServiceSignal account</PrimaryButton>
      </Section>

      <Text style={{ fontSize: 15, lineHeight: 1.65, margin: "0 0 16px 0", color: "#0f172a" }}>
        ServiceSignal helps you follow up overdue invoices with professional
        email reminders. Every reminder is prepared for you and waits in your
        approval queue — nothing is sent to a customer until you review it and
        decide it should go.
      </Text>

      <HelperText>
        If the button doesn&apos;t work, open {signupUrl} in your browser.
      </HelperText>

      {/* Reason-for-receipt. Required for a legitimate transactional email and
          expected by spam filters; EmailFooter itself takes no props, so this
          sits immediately above it rather than being threaded through. */}
      <Text
        style={{
          fontSize: 12.5,
          lineHeight: 1.6,
          margin: "20px 0 0 0",
          color: "#94a3b8",
          textAlign: "center",
        }}
      >
        You received this email because you requested access to the ServiceSignal
        founding beta.
      </Text>

      <EmailFooter />
    </EmailLayout>
  );
}

/**
 * Plain-text alternative. Sent alongside the HTML so the message is readable
 * in text-only clients and reads as a legitimate transactional email to spam
 * filters, which treat HTML-only mail with more suspicion.
 */
export function betaAccessEmailText(firstName: string): string {
  const name = firstName.trim();
  const greeting = name ? `Hi ${name},` : "Hi,";
  const signupUrl = `${getAppBaseUrl()}/signup`;

  return [
    greeting,
    "",
    "Thanks for joining the ServiceSignal founding beta. You can create your account now and start setting ServiceSignal up for your business.",
    "",
    `Create your ServiceSignal account: ${signupUrl}`,
    "",
    "ServiceSignal helps you follow up overdue invoices with professional email reminders. Every reminder is prepared for you and waits in your approval queue — nothing is sent to a customer until you review it and decide it should go.",
    "",
    "You received this email because you requested access to the ServiceSignal founding beta.",
    "",
    "ServiceSignal",
    "support@servicesignal.app",
  ].join("\n");
}
