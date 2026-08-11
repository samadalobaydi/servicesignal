/**
 * Section 5 — FAQ.
 *
 * Split composition: heading and framing on the left, one continuous accordion
 * surface on the right. Single column on mobile.
 *
 * Built on native <details>/<summary>: keyboard operable and screen-reader
 * correct with no JavaScript, and it still works if JS fails to load. No
 * height animation — the instant open is both calmer and the accessible
 * default. All questions start closed.
 *
 * Product truth. Every answer is limited to what the code actually does:
 * approval-only sending, ServiceSignal as the sending service with the
 * business named inside the message, Reply-To pointed at the account email,
 * no payment processing, no payment detection, no accounting integration.
 * No answer claims delivery, open, read or click tracking, a monitored reply
 * inbox, a launch date or pricing.
 *
 * ON THE CHANNEL QUESTION. SMS is the intended primary channel and is NOT
 * implemented: there is no SMS transport anywhere in the codebase, and
 * invoices.customer_phone is stored and displayed but never messaged. The
 * answer below therefore uses the future-tense, staged-rollout wording and
 * states plainly which channel works today. Present-tense SMS availability
 * must not appear here until a send path exists.
 */

const FAQS = [
  {
    // First deliberately: "how does it actually reach my customer" is the
    // question a trade asks before any other, and getting it wrong by omission
    // would be the page's biggest credibility risk.
    q: "Will reminders be sent by SMS or email?",
    a: "ServiceSignal is being built around SMS-first reminders, with email for more detailed follow-up. Channels are being introduced in stages during the founding beta, and email reminders are what you can send today. Either way, you review and approve every reminder before anything is sent.",
  },
  {
    q: "Does ServiceSignal send reminders automatically?",
    a: "No. ServiceSignal prepares the reminder and holds it. Nothing is sent until you have read it and approved it yourself.",
  },
  {
    q: "Will my customer know who the reminder is from?",
    a: "Yes. Your business name appears in the subject, the message and the sign-off, and ServiceSignal is named as the sending service. It does not go out from your own mailbox — but replies come back to the email address connected to your ServiceSignal account.",
  },
  {
    q: "What happens when my customer pays?",
    a: "Your customer pays you directly, through whatever payment method you already use. ServiceSignal does not process or detect the payment — you mark the invoice as paid, and any remaining reminders stop.",
  },
  {
    q: "Do I need to connect accounting software?",
    a: "No. You enter the customer, invoice amount and due date directly. ServiceSignal is not accounting software — it does one thing, which is following up overdue invoices.",
  },
  {
    q: "Do I need to add a payment link?",
    a: "No — a payment link is optional. When you add one, the reminder can include a Pay Now button pointing to your chosen payment page. ServiceSignal never handles the payment.",
  },
];

export default function FaqSection() {
  return (
    <section id="faq" className="v2-faq" aria-labelledby="faq-heading">
      <div className="v2-section v2-faq-grid">
        <div className="v2-faq-copy">
          <h2 id="faq-heading" className="v2-faq-heading">
            Straight answers before you join.
          </h2>
          <p className="v2-faq-sub">
            Channels, approval, payments, setup and what ServiceSignal
            deliberately does not do.
          </p>
        </div>

        <div className="v2-faq-list">
          {FAQS.map((item) => (
            <details key={item.q} className="v2-faq-item">
              <summary className="v2-faq-q">
                <span className="v2-faq-q-t">{item.q}</span>
                {/* Rotates 45° when open, turning + into ×. Transform only —
                    no layout shift, and it is decorative: <details> already
                    announces its own expanded state. */}
                <span className="v2-faq-ico" aria-hidden="true" />
              </summary>
              <p className="v2-faq-a">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
