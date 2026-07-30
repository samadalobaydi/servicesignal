import { DEMO } from "./demo";

/**
 * Section 2 — What your customer actually gets.
 *
 * The perspective shifts from the owner's workspace (hero) to the customer's
 * side: the actual reminder email, shown at readable size, with plain
 * commentary beside it.
 *
 * Renders one fixed state. It reads nothing from the hero tour and requires
 * no interaction — INV-1042 provides continuity, not a dependency.
 *
 * Static by design: no motion, no observers, no hover behaviour.
 *
 * Product truth. The email shown here mirrors lib/email-templates.ts:
 *  - ServiceSignal is the sender, shown honestly. The business name appears
 *    in the subject, the body and the sign-off — it is not the From address.
 *  - No delivery, open, read, reply or click tracking is depicted.
 *  - No Pay Now button, because this invoice has no payment link. That is
 *    what the real product renders in the same situation.
 *  - No phone hardware, no browser chrome, no invented email client.
 */

const COMMENTARY = [
  {
    title: "Clearly connected to your business",
    line: `${DEMO.businessName} appears in the subject, message and sign-off, while ServiceSignal is shown honestly as the sender.`,
  },
  {
    title: "Clear about what's owed",
    line: "The amount, due date and how overdue the invoice is are stated plainly.",
  },
  {
    title: "Replies come back to you",
    line: "Customer replies go to the email address connected to your ServiceSignal account.",
  },
];

export default function CustomerMessageSection() {
  return (
    <section className="v2-cms" aria-labelledby="cms-heading">
      <span className="v2-cms-wash" aria-hidden="true" />

      <div className="v2-section v2-cms-grid">
        {/* ── Copy ── */}
        <div className="v2-cms-copy">
          <p className="v2-cms-eyebrow">What your customer sees</p>
          <h2 id="cms-heading" className="v2-cms-heading">
            A reminder you&rsquo;d be comfortable sending yourself.
          </h2>
          <p className="v2-cms-sub">
            Clear about what&rsquo;s owed, polite in tone, and easy for your customer to act on.
          </p>
        </div>

        {/* ── The real reminder email, then commentary ── */}
        <div className="v2-cms-right">
          <figure
            className="v2-cms-mail"
            aria-label={`Example reminder email. From ${DEMO.emailFromName}, ${DEMO.emailFromAddress}. Subject: ${DEMO.emailSubject}. It reads: ${DEMO.emailOpening} ${DEMO.emailFromLine} ${DEMO.emailBody} ${DEMO.emailClosingLine} ${DEMO.emailSignOff}. ${DEMO.emailFooter}. This is a demonstration.`}
          >
            <figcaption className="v2-cms-mail-label">Email reminder</figcaption>

            <div className="v2-cms-mail-head">
              <span className="v2-cms-mail-line">
                <span className="v2-cms-mail-k">From</span>
                <span className="v2-cms-mail-v">
                  {DEMO.emailFromName}{" "}
                  <span className="v2-cms-mail-addr">&lt;{DEMO.emailFromAddress}&gt;</span>
                </span>
              </span>
              <span className="v2-cms-mail-line">
                <span className="v2-cms-mail-k">Subject</span>
                <span className="v2-cms-mail-v v2-cms-mail-subj">{DEMO.emailSubject}</span>
              </span>
            </div>

            <div className="v2-cms-mail-body">
              <p>{DEMO.emailOpening}</p>
              <p className="v2-cms-mail-fromline">{DEMO.emailFromLine}</p>
              <p>{DEMO.emailBody}</p>
              <p className="v2-cms-mail-sign">
                {DEMO.emailClosingLine}
                <br />
                {DEMO.emailSignOff}
              </p>
            </div>

            <p className="v2-cms-mail-foot">{DEMO.emailFooter}</p>
          </figure>

          {/* Commentary — three plain text columns, no cards */}
          <div className="v2-cms-notes">
            {COMMENTARY.map((c) => (
              <div key={c.title}>
                <p className="v2-cms-note-t">{c.title}</p>
                <p className="v2-cms-note-l">{c.line}</p>
              </div>
            ))}
          </div>

          {/* Conditional, deliberately quiet — this invoice has no payment
              link, so no button appears above. */}
          <p className="v2-cms-paynote">
            When you add a payment link, the email includes a Pay Now button pointing
            to your chosen payment page. ServiceSignal never handles the money.
          </p>
        </div>
      </div>
    </section>
  );
}
