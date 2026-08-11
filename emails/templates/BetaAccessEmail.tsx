import { Section, Text } from "@react-email/components";
import { EmailLayout, EmailFooter, PrimaryButton, ContentSection, HelperText, EmailBrandHeader } from "../components";

interface BetaAccessEmailProps {
  /** First name only, already trimmed. Empty string falls back to a neutral greeting. */
  firstName: string;
  /** The absolute, environment-aware verification URL, token included. */
  verifyUrl: string;
}

/**
 * Beta access email — sent once per successful beta signup via
 * lib/beta-access-email.ts. Pure presentation; delivery logic lives in the
 * sender, not here.
 *
 * This is now the VERIFICATION email, and the only one in the journey. It
 * previously linked straight to /signup, after which Supabase sent its own
 * generic confirmation — two emails, two competing routes, and a visible
 * Supabase-branded step. The address is now proven here, once, and the
 * account is created already-confirmed.
 *
 * The link carries a single-use token that expires in 48 hours, so unlike the
 * previous version this template CAN state those properties: they are real.
 *
 * The applicant's email address is deliberately NOT placed in the URL — only
 * the opaque token is. Query strings leak into referrer headers, browser
 * history and server logs.
 */
export function BetaAccessEmail({ firstName, verifyUrl }: BetaAccessEmailProps) {
  const name = firstName.trim();
  const greeting = name ? `Hi ${name},` : "Hi,";
  return (
    <EmailLayout
      previewText="You can create your ServiceSignal account now."
      contentPadding="16px 40px 40px 40px"
    >
      {/* Current lockup: transparent mark + live "ServiceSignal" text. The
          dark rectangular banner and its legacy tagline are gone. marginBottom
          matches the 20px the banner previously left, so surrounding spacing
          is unchanged. */}
      <EmailBrandHeader marginBottom={20} />

      <ContentSection heading="Verify your email address">
        {greeting}
      </ContentSection>

      <Text style={{ fontSize: 15, lineHeight: 1.65, margin: "16px 0 0 0", color: "#0f172a" }}>
        Thanks for joining the ServiceSignal founding beta. Confirm your email
        address, then finish creating your account.
      </Text>

      <Section style={{ textAlign: "center", margin: "28px 0" }}>
        <PrimaryButton href={verifyUrl}>Verify your email</PrimaryButton>
      </Section>

      {/* CHANNEL-NEUTRAL, AND DELIBERATELY SO.
          This previously read "SMS reminders and supporting emails", which was
          wrong twice over: it ranked one channel above the other, and it
          advertised SMS, which the current build does not send. A verification
          email is not the place to describe a product roadmap — it exists to
          get one address confirmed — so this states only what is true now and
          will still be true at launch: reminders are prepared, and nothing
          leaves without the owner's approval. */}
      <Text style={{ fontSize: 15, lineHeight: 1.65, margin: "0 0 16px 0", color: "#0f172a" }}>
        ServiceSignal helps you prepare professional invoice reminders, with
        every message waiting for your review and approval before anything is
        sent.
      </Text>

      <HelperText>
        This link is personal to you, can be used once, and expires in 48 hours.
        If the button doesn&apos;t work, copy and paste this link into your
        browser:
        <br />
        {/* The fallback URL carries a ~43-character base64url token, so the
            whole string is roughly 90 characters with no space, hyphen or
            slash late enough to break on. Left inline in muted body text it
            pushed past the 560px content width on mobile and in Outlook.
            Given its own line and explicit break rules it wraps instead.
            Same string as the button's href — one destination, never two. */}
        <span style={{ wordBreak: "break-all", overflowWrap: "anywhere", color: "#475569" }}>
          {verifyUrl}
        </span>
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
export function betaAccessEmailText(firstName: string, verifyUrl: string): string {
  const name = firstName.trim();
  const greeting = name ? `Hi ${name},` : "Hi,";
  return [
    greeting,
    "",
    "Thanks for joining the ServiceSignal founding beta. Confirm your email address, then finish creating your account.",
    "",
    `Verify your email: ${verifyUrl}`,
    "",
    "This link is personal to you, can be used once, and expires in 48 hours.",
    "",
    // Kept identical in wording to the HTML version above — a plain-text part
    // that says something different is a spam-filter signal, not a nicety.
    "ServiceSignal helps you prepare professional invoice reminders, with every message waiting for your review and approval before anything is sent.",
    "",
    "You received this email because you requested access to the ServiceSignal founding beta.",
    "",
    "ServiceSignal",
    "support@servicesignal.app",
  ].join("\n");
}
