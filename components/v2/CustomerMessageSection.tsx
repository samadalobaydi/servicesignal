import { DEMO } from "./demo";

/**
 * Section 2 — What your customer actually gets.
 *
 * The perspective shifts from the owner's workspace (hero) to the customer's
 * side: the actual reminder, shown at readable size, with plain commentary
 * beside it.
 *
 * Renders one fixed state. It reads nothing from the hero tour and requires
 * no interaction — INV-1042 provides continuity, not a dependency.
 *
 * Static by design: no motion, no observers, no hover behaviour.
 *
 * Product truth: no delivery, open, read, reply or click tracking; no
 * business-owned sender identity; no payment domain; no checkout. The
 * payment link is presentational text, never a live anchor.
 */

const COMMENTARY = [
  {
    title: "Your business stays front and centre",
    line: `The reminder clearly identifies ${DEMO.businessName}, so your customer knows who it relates to.`,
  },
  {
    title: "Everything is specific",
    line: `Invoice ${DEMO.reference}, the ${DEMO.amount} amount and its overdue status are clear at a glance.`,
  },
  {
    title: "A clear route to pay",
    line: `The link takes the customer to ${DEMO.businessName}'s chosen payment destination.`,
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

        {/* ── Message, commentary, supporting email ── */}
        <div className="v2-cms-right">
          {/* SMS surface — the dominant object, full width of this column */}
          <figure
            className="v2-cms-sms"
            aria-label={`Example reminder sent by SMS. It reads: ${DEMO.sms} A payment link is shown beneath the message. This is a demonstration — the link is not active.`}
          >
            <figcaption className="v2-cms-sms-head">SMS · Primary</figcaption>
            <p className="v2-cms-sms-body">{DEMO.sms}</p>
            {/* Presentational only: brand-blue text, not an anchor, not
                focusable, no hover or pointer, because there is no destination. */}
            <p className="v2-cms-sms-link" aria-hidden="true">
              {DEMO.paymentLinkLabel}
            </p>
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

          {/* Supporting email — contained but clearly secondary */}
          <div className="v2-cms-email">
            <p className="v2-cms-email-label">Email · supporting</p>
            <p className="v2-cms-email-subj">{DEMO.emailSubject}</p>
            <p className="v2-cms-email-line">
              The same invoice detail and payment route, with more room for context.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
