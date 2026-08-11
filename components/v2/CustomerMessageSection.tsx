import { DEMO } from "./demo";

/**
 * Section 2 — Professional follow-up.
 *
 * Purpose: explain why the reminder is professional, trustworthy and suitable
 * to send to a real customer. The persuasive copy and its three supporting
 * points sit on one side; the real email artefact sits on the other, so the
 * argument and its evidence are read together.
 *
 * Static by design: no motion, no observers, no hover behaviour.
 *
 * Product truth. The email mirrors lib/email-templates.ts exactly:
 *  - ServiceSignal is the sender, shown honestly. The business name appears
 *    in the subject, the body and the sign-off — it is not the From address.
 *  - No delivery, open, read, reply or click tracking is depicted.
 *  - No Pay Now button, because this invoice has no payment link. That is
 *    what the real product renders in the same situation.
 *  - No phone hardware, no browser chrome, no invented email client.
 */

const POINTS = [
  {
    title: "Clearly connected to your business",
    line: "Your business name appears in the subject, message and sign-off, while ServiceSignal is clearly identified as the sender.",
  },
  {
    title: "Clear about what's owed",
    line: "The customer, invoice amount, due date and overdue position are stated plainly.",
  },
  {
    title: "Replies come back to you",
    line: "Customer replies go to the email address connected to your ServiceSignal account.",
  },
];

export default function CustomerMessageSection() {
  return (
    <section id="customer" className="v2-pfu" aria-labelledby="pfu-heading">
      <span className="v2-pfu-wash" aria-hidden="true" />

      <div className="v2-section v2-pfu-grid">
        {/* ── Argument: copy + the three supporting points ── */}
        <div className="v2-pfu-copy">
          <p className="v2-pfu-eyebrow">Professional follow-up</p>
          <h2 id="pfu-heading" className="v2-pfu-heading">
            A reminder you&rsquo;d be comfortable putting your name on.
          </h2>
          {/* Names the channel explicitly. The section demonstrates the EMAIL
              reminder — the richer of the two channels ServiceSignal is being
              built around — and saying so stops the page reading as though
              email were the whole product. It deliberately stops short of
              implying an SMS channel exists yet, because it does not. */}
          <p className="v2-pfu-sub">
            This is the email reminder your customer receives: clear about
            what&rsquo;s owed, polite in tone and unmistakably connected to your
            business.
          </p>

          <ul className="v2-pfu-points">
            {POINTS.map((p) => (
              <li key={p.title}>
                <span className="v2-pfu-tick" aria-hidden="true">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span>
                  <span className="v2-pfu-point-t">{p.title}</span>
                  <span className="v2-pfu-point-l">{p.line}</span>
                </span>
              </li>
            ))}
          </ul>

          {/* Conditional — this invoice has no payment link, so no button
              appears in the email beside it. */}
          <p className="v2-pfu-paynote">
            When you add a payment link, the email can include a Pay Now button
            pointing to your chosen payment page. ServiceSignal never handles the
            payment.
          </p>
        </div>

        {/* ── Evidence: the real reminder email ── */}
        <div className="v2-pfu-proof">
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
        </div>
      </div>
    </section>
  );
}
