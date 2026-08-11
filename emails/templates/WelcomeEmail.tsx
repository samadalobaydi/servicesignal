import { EmailLayout, EmailFooter, PrimaryButton, ContentSection, CalloutBox, HelperText, EmailBrandHeader } from "../components";
import { welcomeGreeting } from "../../lib/person-name";

interface WelcomeEmailProps {
  /**
   * The ACCOUNT HOLDER's own name, collected on the founding-beta form and
   * resolved by lib/welcome-email.ts. Never the business name — see
   * lib/person-name.ts for why that distinction is load-bearing.
   */
  personName: string | null;
  /**
   * Absolute, environment-aware URL for the CTA.
   *
   * Points at /continue, which decides the destination from the user's ACTUAL
   * onboarding status at click time — this email may be opened before setup,
   * part-way through, after completion, or from a different browser entirely,
   * and a hardcoded /onboarding would restart a finished user.
   *
   * A required prop rather than something this template resolves itself: the
   * sender must be able to REFUSE TO SEND when the origin is unconfigured, and
   * a template that quietly built its own link would make that impossible.
   */
  continueUrl: string;
}

/**
 * The Welcome email — sent once per user via lib/welcome-email.ts,
 * triggered from app/api/profile/route.ts. Pure presentation; all
 * delivery/idempotency logic lives in the trigger, not here.
 *
 * PERSONALISATION. The heading greets the PERSON by first name. It previously
 * used business_name, on the basis of a note claiming no personal name existed
 * in the data model — that stopped being true when the founding-beta form began
 * collecting one, and the note was never revisited. The result was "Welcome,
 * test1!", greeting a customer by their trading name.
 *
 * When no personal name can be resolved the heading falls back to a complete
 * "Welcome to ServiceSignal" — never to the business name, and never to
 * "Welcome, !".
 */
export function WelcomeEmail({ personName, continueUrl }: WelcomeEmailProps) {
  const heading = welcomeGreeting(personName);

  return (
    <EmailLayout
      previewText="Your account is created — three quick steps to get set up."
      // Tighter top padding than the shared default: the banner right
      // below already provides its own visual separation, so the usual
      // full 40px top gap on top of that read as excessive empty space.
      contentPadding="16px 40px 40px 40px"
    >
      {/* Current lockup, identical to the Beta Access email. Replaces the
          v8.9.0 dark banner (servicesignal-email-logo.png) and its legacy
          tagline. marginBottom matches the 20px the banner left behind, so
          the spacing below is unchanged. */}
      <EmailBrandHeader marginBottom={20} />

      {/* "created", not "ready": the account exists, but onboarding has not
          been done yet, and the two steps below are the whole point of the
          email. Telling someone they are ready and then giving them a checklist
          contradicts itself.
          SMS and email are named together and equally — neither is described as
          primary, supporting or richer. The approval clause is scoped to "each
          reminder" rather than made a permanent product guarantee, because Auto
          mode is planned. */}
      <ContentSection heading={heading}>
        Your ServiceSignal account has been created. ServiceSignal prepares
        professional SMS and email reminders for your overdue invoices, with each
        reminder ready for your review before it is sent.
      </ContentSection>

      <PrimaryButton href={continueUrl}>Open ServiceSignal</PrimaryButton>

      <CalloutBox tone="info">
        <p style={{ margin: "0 0 8px 0", fontWeight: 650, fontSize: 14 }}>
          Three quick steps to get started
        </p>
        {/* The locked first-reminder journey, end to end. Deliberately no
            profile, payment-link or channel step: the business details given at
            signup are reused rather than asked for again, and adding a step here
            that the flow does not contain would misdescribe it.

            THREE, not two. Reviewing is not the last thing that happens — the
            reminders sit in Active Chasing until the owner approves them, and
            an email that stopped at "review" would leave a customer believing
            their first chase had gone out when it had not.

            Step 3 names the OUTCOME the owner is here for — the reminders
            going out — rather than the screen the button happens to live on.
            The mechanism is approval in Active Chasing, and the app itself says
            so at the point of action; a welcome email listing an internal
            surface name would be describing our navigation, not their job.
            Step 2 now names BOTH channels explicitly. The old "Review your
            reminder before anything sends" was singular and channel-agnostic —
            written when email was the only channel — and no longer describes
            what Step 2 of onboarding actually shows. */}
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
          <li>Add your first overdue invoice</li>
          <li>Review your SMS and email reminders</li>
          <li>Send your invoice reminders</li>
        </ol>
      </CalloutBox>

      {/* TRUE, and verified: this email is sent FROM support@servicesignal.app
          with an explicit Reply-To of the same monitored mailbox (see
          lib/welcome-email.ts). Deliberately unlike a reminder email, whose
          Reply-To routes the customer to the trade. */}
      <HelperText center>Questions? Just reply to this email.</HelperText>

      <EmailFooter />
    </EmailLayout>
  );
}

