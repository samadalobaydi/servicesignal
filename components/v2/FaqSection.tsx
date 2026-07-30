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
 * approval-only sending, email as the single channel, ServiceSignal as the
 * sender with the business named in the message, no payment processing, no
 * payment detection, no accounting integration. No answer mentions SMS,
 * WhatsApp, tracking, delivery, opens, clicks, monitored replies, launch
 * dates or pricing.
 */

const FAQS = [
  {
    q: "Does ServiceSignal send reminders automatically?",
    a: "No. ServiceSignal prepares each email reminder and holds it for you. Nothing sends until you review and approve it.",
  },
  {
    q: "Will my customer know who the reminder is from?",
    a: "Yes. The email is sent by ServiceSignal, while your business name appears in the subject, message and sign-off. Replies go to the email address connected to your ServiceSignal account.",
  },
  {
    q: "What happens when my customer pays?",
    a: "You mark the invoice as paid and any remaining reminders stop. ServiceSignal does not process payments, hold your money or monitor your bank account.",
  },
  {
    q: "Do I need to connect accounting software?",
    a: "No. You add the customer, invoice amount and due date directly. ServiceSignal is not accounting software — it focuses on following up overdue invoices.",
  },
  {
    q: "Do I need to add a payment link?",
    a: "No. You can send a reminder without one. When you add a payment link, the email can include a Pay Now button pointing to your chosen payment page. ServiceSignal never handles the payment.",
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
            Approval, payments, setup and what ServiceSignal deliberately does not do.
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
