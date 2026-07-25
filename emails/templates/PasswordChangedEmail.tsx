import { EmailLayout, EmailHeader, EmailFooter, ContentSection, CalloutBox, HelperText } from "../components";

interface PasswordChangedEmailProps {
  changedAt: string; // pre-formatted, e.g. "19 July 2026 at 14:32"
}

/**
 * Password Changed / security confirmation email.
 *
 * PRESENTATION ONLY — nothing in the codebase imports or sends this yet.
 * Wiring a trigger is a separate, dedicated security task per the
 * approved architecture (moving updateUser() server-side, or a Database
 * Webhook on auth.users — a decision deliberately deferred).
 *
 * Deliberately excludes anything session-related: no tokens, no session
 * identifiers, no embedded "undo" link. The "wasn't you" link points at
 * the ordinary self-service /forgot-password flow — never a magic link
 * that would itself grant access.
 */
export function PasswordChangedEmail({ changedAt }: PasswordChangedEmailProps) {
  return (
    <EmailLayout previewText="Your ServiceSignal password was changed.">
      <EmailHeader />
      <ContentSection heading="Your password was changed">
        This is a confirmation that your ServiceSignal account password was changed on {changedAt}.
      </ContentSection>
      <CalloutBox tone="info">
        If this was you, no action is needed.
      </CalloutBox>
      <HelperText center>
        If you didn&apos;t make this change, reset your password right away at{" "}
        servicesignal.app/forgot-password
      </HelperText>
      <EmailFooter />
    </EmailLayout>
  );
}
