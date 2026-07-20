import type { Metadata } from "next";
import LegalPageLayout from "@/components/LegalPageLayout";
import { LEGAL_CONFIG } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy — ServiceSignal",
  description: "How ServiceSignal collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" effectiveDate={LEGAL_CONFIG.privacyEffectiveDate} version={LEGAL_CONFIG.privacyVersion}>
      <p>
        This Privacy Policy explains how ServiceSignal collects, uses, and
        protects information when you use our website and product.
        ServiceSignal is a UK-focused service; this policy is written with UK
        GDPR and the Data Protection Act 2018 in mind.
      </p>
      <p style={{ fontStyle: "italic", color: "#64748b" }}>
        This is an MVP document for our beta period, prepared for clarity
        rather than as a substitute for professional legal advice. It will be
        reviewed by a qualified solicitor before general availability.
      </p>

      <h2>1. Information we collect</h2>
      <h3>Account and profile data</h3>
      <p>
        When you create an account, we collect your email address, a securely
        hashed password (via Supabase Auth — we never see or store your
        plaintext password), and any business details you choose to add, such
        as a business name, contact email, contact phone, and reminder
        preferences.
      </p>
      <h3>Invoice and customer data</h3>
      <p>
        You may enter your customers&apos; names, email addresses, phone numbers,
        invoice amounts, due dates, and optional payment links. This data is
        used solely to provide the invoice-chasing service back to you.
      </p>
      <h3>Beta signup data</h3>
      <p>
        Before creating a full account, you may submit your email address
        through our beta waitlist form on the landing page. This is used to
        contact you about ServiceSignal&apos;s beta and is stored separately from
        full account data.
      </p>
      <h3>Technical and usage data</h3>
      <p>
        We collect standard technical data needed to operate the service —
        such as authentication session tokens (via cookies) and basic request
        logs on our hosting and database infrastructure — used for security,
        debugging, and reliability.
      </p>
      <h3>Email-delivery data</h3>
      <p>
        When we send reminder or account emails through Resend, delivery
        metadata (such as whether an email was sent successfully) is recorded
        so we can show you accurate activity history and avoid sending
        duplicate emails.
      </p>

      <h2>2. Purposes and lawful bases (UK GDPR)</h2>
      <ul>
        <li><strong>Providing the service</strong> — performance of our contract with you (Art. 6(1)(b)).</li>
        <li><strong>Security and fraud prevention</strong> — our legitimate interests (Art. 6(1)(f)).</li>
        <li><strong>Beta communications</strong> — your consent, given when you submit the waitlist form (Art. 6(1)(a)).</li>
        <li><strong>Legal compliance</strong> — where we&apos;re required to by law (Art. 6(1)(c)).</li>
      </ul>

      <h2>3. Processors and third-party services</h2>
      <p>We use the following processors to operate ServiceSignal:</p>
      <ul>
        <li><strong>Supabase</strong> — authentication and database hosting.</li>
        <li><strong>Resend</strong> — sends reminder and account emails on our behalf.</li>
        <li><strong>Vercel</strong> — application hosting.</li>
      </ul>
      <p>
        Where you add a payment link to an invoice, the third-party payment
        provider you choose (for example Stripe, GoCardless, PayPal, or SumUp)
        processes any payment made by your customer directly — ServiceSignal
        is not party to that transaction and does not process payments itself.
      </p>

      <h2>4. International transfers</h2>
      <p>
        Some of our processors (including Resend) operate infrastructure
        outside the UK, which may involve transferring data internationally.
        Where this happens, we rely on the processor&apos;s own UK/EU-adequacy
        safeguards, such as Standard Contractual Clauses, as required by UK
        GDPR.
      </p>

      <h2>5. Retention</h2>
      <p>
        We keep account and invoice data for as long as your account is
        active, plus a reasonable period afterward to allow account recovery
        and meet legal obligations. You can request deletion at any time — see
        Section 7.
      </p>

      <h2>6. Security</h2>
      <p>
        We use industry-standard measures to protect your data, including
        encryption in transit and at rest (via our infrastructure providers)
        and row-level access controls that ensure your data is only
        accessible to your own account.
      </p>

      <h2>7. Your rights</h2>
      <p>Under UK GDPR, you have the right to:</p>
      <ul>
        <li>access the personal data we hold about you;</li>
        <li>correct inaccurate data;</li>
        <li>request deletion of your data;</li>
        <li>restrict or object to certain processing;</li>
        <li>request a portable copy of your data;</li>
        <li>withdraw consent at any time, where processing is based on consent.</li>
      </ul>
      <p>
        To exercise any of these rights, contact us at{" "}
        <a href={`mailto:${LEGAL_CONFIG.privacyEmail}`}>{LEGAL_CONFIG.privacyEmail}</a>.
      </p>

      <h2>8. Cookies and similar technology</h2>
      <p>
        We use essential cookies to keep you signed in and to secure your
        session. We do not currently use advertising or third-party tracking
        cookies.
      </p>

      <h2>9. Children</h2>
      <p>
        ServiceSignal is intended for business use by adults. We do not
        knowingly collect personal data from children.
      </p>

      <h2>10. Changes to this policy</h2>
      <p>
        We may update this policy as ServiceSignal develops. We&apos;ll update the
        version number and effective date above when we do.
      </p>

      <h2>11. Contact and complaints</h2>
      <p>
        Questions about this policy can be sent to{" "}
        <a href={`mailto:${LEGAL_CONFIG.privacyEmail}`}>{LEGAL_CONFIG.privacyEmail}</a>.
        If you&apos;re unhappy with how we&apos;ve handled your data, you also have the
        right to complain to the UK&apos;s Information Commissioner&apos;s Office (ICO)
        at{" "}
        <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer">ico.org.uk</a>.
      </p>
    </LegalPageLayout>
  );
}
