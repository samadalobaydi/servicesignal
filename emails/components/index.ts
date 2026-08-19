/**
 * ServiceSignal Email Design System.
 *
 * Reusable building blocks for every future email — welcome, verify email,
 * password reset/changed, invoice reminder/paid, trial ending, receipts,
 * announcements. No individual email templates live here; compose these
 * into a specific email in its own file when that work is approved.
 *
 * Example composition (illustrative only — not a real template):
 *
 *   <EmailLayout previewText="Your invoice is now overdue">
 *     <EmailHeader />
 *     <ContentSection heading="Invoice reminder">
 *       Hi Dave, your invoice remains unpaid.
 *     </ContentSection>
 *     <CalloutBox tone="danger">£450.00 is 7 days overdue.</CalloutBox>
 *     <PrimaryButton href={payLink}>Pay Securely</PrimaryButton>
 *     <HelperText center>If the button doesn't work, copy this link: {payLink}</HelperText>
 *     <EmailFooter />
 *   </EmailLayout>
 */

export { EmailLayout } from "./EmailLayout";
export { EmailHeader } from "./EmailHeader";
export { EmailBrandHeader } from "./EmailBrandHeader";
export { EmailFooter } from "./EmailFooter";
export { BrandFooter } from "./BrandFooter";
export { PrimaryButton } from "./PrimaryButton";
export { SecondaryButton } from "./SecondaryButton";
export { Divider } from "./Divider";
export { ContentSection } from "./ContentSection";
export { CalloutBox, type CalloutTone } from "./CalloutBox";
export { HelperText } from "./HelperText";
export { emailTheme, emailBanner } from "../theme";
