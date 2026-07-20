import { Img, Section } from "@react-email/components";
import { EmailLayout, EmailFooter, PrimaryButton, ContentSection, CalloutBox, HelperText, emailBanner, appUrl } from "../components";

interface WelcomeEmailProps {
  businessName: string | null;
}

/**
 * The Welcome email — sent once per user via lib/welcome-email.ts,
 * triggered from app/api/profile/route.ts. Pure presentation; all
 * delivery/idempotency logic lives in the trigger, not here.
 *
 * Note on personalisation: there is no personal "first name" field
 * anywhere in this app's data model today (signup collects Business
 * Name, Email, Password only). business_name is the best available
 * signal, used as a best-effort greeting; when it's empty the heading
 * falls back to "Welcome to ServiceSignal" rather than a generic
 * "Welcome, there!".
 */
export function WelcomeEmail({ businessName }: WelcomeEmailProps) {
  const name = businessName?.trim();
  const heading = name ? `Welcome, ${name}!` : "Welcome to ServiceSignal";

  // v8.9.2 — environment-aware, NOT the same rule as the banner image
  // below. Resolves to NEXT_PUBLIC_APP_URL (localhost while testing
  // locally, the real domain in production) with the production origin
  // as a safe fallback if that variable is ever unset.
  const dashboardUrl = `${appUrl}/dashboard`;

  return (
    <EmailLayout
      previewText="Your ServiceSignal account is ready — here's how to get started."
      // Tighter top padding than the shared default: the banner right
      // below already provides its own visual separation, so the usual
      // full 40px top gap on top of that read as excessive empty space.
      contentPadding="16px 40px 40px 40px"
    >
      {/* Approved banner logo (v8.9.0) — replaces the shared EmailHeader
          for this template only; EmailHeader/other templates untouched.
          width/height stay exactly as approved (440x178, true aspect
          ratio) — only the surrounding margin was tightened, and the alt
          text shortened, so an undeployed/broken image degrades far less
          awkwardly without changing anything about the loaded state. */}
      <Section style={{ textAlign: "center", marginBottom: 20 }}>
        <Img
          src={emailBanner.src}
          alt="ServiceSignal"
          width={emailBanner.width}
          height={emailBanner.height}
          style={{ margin: "0 auto", display: "block", maxWidth: "100%", height: "auto", borderRadius: 8 }}
        />
      </Section>

      <ContentSection heading={heading}>
        Your account is ready. ServiceSignal chases unpaid invoices for you automatically —
        always with your review before anything sends.
      </ContentSection>

      <PrimaryButton href={dashboardUrl}>Go to your dashboard</PrimaryButton>

      <CalloutBox tone="info">
        <p style={{ margin: "0 0 8px 0", fontWeight: 650, fontSize: 14 }}>
          Three quick steps to get started
        </p>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
          <li>Add your first invoice</li>
          <li>Choose a reminder schedule</li>
          <li>Add a payment link in Settings — reminders then include a Pay Now button</li>
        </ol>
      </CalloutBox>

      <HelperText center>Questions? Just reply to this email.</HelperText>

      <EmailFooter />
    </EmailLayout>
  );
}

