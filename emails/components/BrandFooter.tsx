import { Section, Text, Hr } from "@react-email/components";
import { emailTheme } from "../theme";

/**
 * The minimal footer: a hairline rule and the product name. Nothing else.
 *
 * ── WHY THIS IS NOT EmailFooter ──────────────────────────────────────────
 *
 * EmailFooter carries "Need help?", the support address, the website and a
 * copyright line. That is right for the emails a customer might reply to —
 * beta access, welcome — and wrong for a security email, where every extra
 * link is another thing a recipient has to evaluate while deciding whether the
 * message is genuine. A password-reset email should contain exactly one
 * actionable thing, and it should be the reset button.
 *
 * It is a NEW component rather than a prop on EmailFooter because that footer
 * is rendered by three live emails (BetaAccessEmail, WelcomeEmail,
 * PasswordChangedEmail). Adding a "minimal" mode there would put a branch in
 * the shared path for the benefit of one caller, and a mistake in it would
 * silently restyle mail that is already sending correctly.
 *
 * No copyright line: it is legal boilerplate nobody reads, and the brief for
 * this email asks for none.
 */
export function BrandFooter() {
  return (
    <>
      <Hr style={{ borderColor: emailTheme.colors.divider, margin: "32px 0 20px 0" }} />
      <Section style={{ textAlign: "center" }}>
        <Text
          style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: emailTheme.colors.textSoft,
          }}
        >
          ServiceSignal
        </Text>
      </Section>
    </>
  );
}
