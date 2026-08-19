import { render } from "@react-email/render";
import { writeFileSync } from "fs";
import { join } from "path";
import {
  EmailLayout,
  EmailHeader,
  EmailBrandHeader,
  EmailFooter,
  BrandFooter,
  PrimaryButton,
  ContentSection,
  HelperText,
} from "../components";

/**
 * Generates the two static HTML templates for manual installation in
 * Supabase Dashboard → Authentication → Email Templates.
 *
 * These are NOT imported or run by the live application — Supabase's own
 * email sending never calls into this codebase. Run manually:
 *   npx tsx emails/supabase-templates/render-static-templates.ts
 * then copy the generated HTML into the corresponding Dashboard field.
 *
 * {{ .ConfirmationURL }} is passed through as a literal string prop, which
 * React renders verbatim (no HTML-special characters in the token itself
 * to trigger escaping). The assertion below is not advisory — the script
 * throws and refuses to write the files if the placeholder is missing
 * from the rendered output for either template.
 *
 * {{ .ConfirmationURL }} — confirmed against Supabase's current docs as
 * the correct, supported variable for both the confirm-signup and
 * recovery templates, and specifically the variant compatible with this
 * project's PKCE flow (app/auth/callback/route.ts expects the ?code=
 * Supabase appends to this URL — the newer {{ .TokenHash }} pattern uses
 * a different verification mechanism and is NOT used here).
 */

const CONFIRMATION_URL_TOKEN = "{{ .ConfirmationURL }}";

function ConfirmSignupTemplate() {
  return (
    <EmailLayout previewText="Confirm your email to finish setting up ServiceSignal.">
      <EmailHeader />
      <ContentSection heading="Confirm your email address">
        Follow the button below to confirm this email address and finish setting up your
        ServiceSignal account.
      </ContentSection>
      <PrimaryButton href={CONFIRMATION_URL_TOKEN}>Confirm email address</PrimaryButton>
      <HelperText center>This link expires shortly and can only be used once.</HelperText>
      <EmailFooter />
    </EmailLayout>
  );
}

/**
 * The password-recovery email.
 *
 * ── WHY THIS ONE DIFFERS FROM ConfirmSignupTemplate ABOVE ────────────────
 *
 * It was built with EmailHeader and EmailFooter, which put a 220px
 * servicesignal-auth-logo.png and the retired "AUTOMATED INVOICE CHASING FOR
 * UK BUSINESSES." tagline above the content, and a support address, website
 * link and copyright line below it. Neither belongs on a security email:
 *
 *   - the tagline is a claim the approval-first product no longer makes, and
 *     it was removed from the auth pages for the same reason;
 *   - the logo treatment is a marketing lockup, not a transactional one;
 *   - every extra link in the footer is one more thing a recipient has to
 *     evaluate while deciding whether the message is genuine. A reset email
 *     should contain exactly ONE actionable thing.
 *
 * EmailBrandHeader is the same small mark-plus-live-text lockup the sending
 * emails already use (BetaAccessEmail, WelcomeEmail), so this now matches the
 * mail ServiceSignal actually sends rather than an older presentation.
 *
 * ── THE TOKEN IS UNTOUCHED ───────────────────────────────────────────────
 *
 * {{ .ConfirmationURL }} is passed as a literal string to PrimaryButton's
 * href and appears exactly once in the output. Nothing here parses, rebuilds,
 * appends to or re-encodes it — the URL Supabase supplies is authoritative,
 * and generate() below refuses to write the file if it is missing.
 */
function ResetPasswordTemplate() {
  return (
    <EmailLayout previewText="Reset your ServiceSignal password.">
      <EmailBrandHeader marginBottom={20} />
      <ContentSection heading="Reset your password">
        We received a request to reset the password for your ServiceSignal account.
        Use the button below to choose a new password.
      </ContentSection>
      <PrimaryButton href={CONFIRMATION_URL_TOKEN}>Reset password</PrimaryButton>
      <HelperText center>
        If you didn&apos;t request this, you can safely ignore this email. Your password
        won&apos;t change unless you use the reset link.
      </HelperText>
      <BrandFooter />
    </EmailLayout>
  );
}

async function generate() {
  const confirmSignupHtml = await render(<ConfirmSignupTemplate />);
  const resetPasswordHtml = await render(<ResetPasswordTemplate />);

  // Automated assertion — not advisory. Refuses to write output if the
  // required Supabase variable isn't present, exactly as supplied,
  // in either rendered template.
  const templates: [string, string][] = [
    ["confirm-signup.html", confirmSignupHtml],
    ["reset-password.html", resetPasswordHtml],
  ];

  for (const [name, html] of templates) {
    if (!html.includes(CONFIRMATION_URL_TOKEN)) {
      throw new Error(
        `ABORTING: ${name} is missing the required Supabase variable ` +
        `${CONFIRMATION_URL_TOKEN} — refusing to write output. ` +
        `Check that PrimaryButton's href renders the raw string unmodified.`
      );
    }
  }

  for (const [name, html] of templates) {
    writeFileSync(join(__dirname, name), html, "utf-8");
    console.log(`✓ Wrote ${name} (${html.length} chars) — verified ${CONFIRMATION_URL_TOKEN} present.`);
  }

  console.log("\nNext step (manual): copy each file's contents into Supabase Dashboard →");
  console.log("Authentication → Email Templates → the matching template type, then Save.");
}

generate().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
