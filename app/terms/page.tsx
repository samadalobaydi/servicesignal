import type { Metadata } from "next";
import LegalPageLayout from "@/components/LegalPageLayout";
import { LEGAL_CONFIG } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service — ServiceSignal",
  description: "ServiceSignal's Terms of Service.",
};

const SECTIONS = [
  { id: "s1", label: "1. Eligibility and accounts" },
  { id: "s2", label: "2. Beta service status" },
  { id: "s3", label: "3. Acceptable use" },
  { id: "s4", label: "4. Your responsibility for invoice and customer data" },
  { id: "s5", label: "5. Responsibility for lawful reminder communications" },
  { id: "s6", label: "6. Payment links" },
  { id: "s7", label: "7. Fees and future paid plans" },
  { id: "s8", label: "8. Intellectual property" },
  { id: "s9", label: "9. Third-party services" },
  { id: "s10", label: "10. Availability" },
  { id: "s11", label: "11. Suspension and termination" },
  { id: "s12", label: "12. Disclaimers" },
  { id: "s13", label: "13. Limitation of liability" },
  { id: "s14", label: "14. Governing law and jurisdiction" },
  { id: "s15", label: "15. Contact" },
  { id: "s16", label: "16. Changes to these Terms" },
] as const;

export default function TermsPage({
  searchParams,
}: {
  searchParams?: { from?: string | string[] };
}) {
  return (
    <LegalPageLayout
      title="Terms of Service"
      effectiveDate={LEGAL_CONFIG.termsEffectiveDate}
      version={LEGAL_CONFIG.termsVersion}
      from={searchParams?.from}
      sections={SECTIONS}
    >
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your use of ServiceSignal
        (&quot;ServiceSignal&quot;, &quot;we&quot;, &quot;us&quot;), a software service that helps UK
        trades and local-service businesses chase unpaid invoices. By creating an
        account, you agree to these Terms.
      </p>
      <p>
        These Terms apply during the ServiceSignal founding beta.
      </p>

      <h2 id="s1">1. Eligibility and accounts</h2>
      <p>
        You must be at least 18 years old and able to form a binding contract to use
        ServiceSignal. You&apos;re responsible for keeping your account credentials
        secure and for all activity that happens under your account.
      </p>

      <h2 id="s2">2. Beta service status</h2>
      <p>
        ServiceSignal is currently in beta. Features may change, be added, or be
        removed without notice. ServiceSignal currently supports email reminders
        only. We&apos;ll update this document as features become available.
      </p>

      <h2 id="s3">3. Acceptable use</h2>
      <p>You agree not to use ServiceSignal to:</p>
      <ul>
        <li>send harassing, threatening, deceptive, or unlawful communications to any recipient;</li>
        <li>chase debts you do not genuinely believe are owed to you;</li>
        <li>upload data you don&apos;t have the right to hold or process;</li>
        <li>attempt to disrupt, reverse-engineer, or gain unauthorised access to the service;</li>
        <li>use the service in a way that breaches any applicable law, including UK consumer credit and debt collection regulation.</li>
      </ul>

      <h2 id="s4">4. Your responsibility for invoice and customer data</h2>
      <p>
        You control what customer names, contact details, and invoice information
        you enter into ServiceSignal. You&apos;re responsible for the accuracy of that
        data and for having a lawful basis to hold and use it — including your
        customers&apos; contact details for the purpose of payment reminders.
      </p>

      <h2 id="s5">5. Responsibility for lawful reminder communications</h2>
      <p>
        ServiceSignal sends reminder emails on your instruction and using content
        you approve or configure. You&apos;re responsible for ensuring the reminders
        you send comply with applicable law and reflect a genuine, accurate debt.
        ServiceSignal is a tool for your communications, not a debt collection
        agency acting on our own behalf.
      </p>

      <h2 id="s6">6. Payment links</h2>
      <p>
        If you add a payment link to an invoice, that link is supplied by you and
        points to whichever third-party payment provider you choose. ServiceSignal
        does not process payments, hold funds, or act as a payment processor — we
        only include the link you provide in reminder emails.
      </p>

      <h2 id="s7">7. Fees and future paid plans</h2>
      <p>
        ServiceSignal is currently free during beta. We may introduce paid plans in
        the future; if we do, we&apos;ll give you reasonable notice before any charge
        applies to your account, and continued use after that notice constitutes
        acceptance of the then-current pricing terms.
      </p>

      <h2 id="s8">8. Intellectual property</h2>
      <p>
        ServiceSignal&apos;s software, branding, and design are our property or
        licensed to us. You retain ownership of the invoice and customer data you
        enter; you grant us the right to process it solely to provide the service
        to you.
      </p>

      <h2 id="s9">9. Third-party services</h2>
      <p>
        ServiceSignal relies on third-party infrastructure to operate, including
        Supabase (authentication and database), Resend (email delivery), and
        Vercel (hosting). Your use of ServiceSignal is also subject to the
        availability and terms of these providers.
      </p>

      <h2 id="s10">10. Availability</h2>
      <p>
        We aim to keep ServiceSignal available and reliable, but we don&apos;t
        guarantee uninterrupted access, particularly during the beta period.
        Scheduled maintenance, third-party outages, or beta instability may
        affect availability from time to time.
      </p>

      <h2 id="s11">11. Suspension and termination</h2>
      <p>
        You may stop using ServiceSignal at any time. We may suspend or terminate
        an account that breaches these Terms, poses a security risk, or is used
        unlawfully, and will where reasonably possible give notice before doing so.
      </p>

      <h2 id="s12">12. Disclaimers</h2>
      <p>
        ServiceSignal is provided &quot;as is&quot; during beta, without warranties of any
        kind, express or implied, including as to fitness for a particular
        purpose or uninterrupted availability, to the fullest extent permitted
        by law.
      </p>

      <h2 id="s13">13. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, ServiceSignal&apos;s total liability
        to you arising from your use of the service is limited to the amount
        you&apos;ve paid us in the 12 months before the claim (which, during the free
        beta, is £0). We do not exclude liability for death, personal injury
        caused by negligence, or fraud, where the law does not permit such
        exclusion.
      </p>

      <h2 id="s14">14. Governing law and jurisdiction</h2>
      <p>
        These Terms are governed by the laws of {LEGAL_CONFIG.jurisdiction}, and
        any dispute will be subject to the exclusive jurisdiction of the courts
        of {LEGAL_CONFIG.jurisdiction}.
      </p>

      <h2 id="s15">15. Contact</h2>
      <p>
        Questions about these Terms can be sent to{" "}
        <a href={`mailto:${LEGAL_CONFIG.supportEmail}`}>{LEGAL_CONFIG.supportEmail}</a>.
      </p>

      <h2 id="s16">16. Changes to these Terms</h2>
      <p>
        We may update these Terms as ServiceSignal develops. We&apos;ll update the
        version number and effective date above when we do, and material changes
        will be communicated to active accounts.
      </p>
    </LegalPageLayout>
  );
}
