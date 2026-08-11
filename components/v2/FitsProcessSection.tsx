import { DEMO } from "./demo";

/**
 * Section 3 — Fits your process.
 *
 * ServiceSignal sits alongside how a business already invoices and gets paid.
 * The visual is a compact three-stage panel built from real ServiceSignal UI
 * fragments — the fields the owner actually fills in, the state the reminder
 * actually holds, and the action the owner actually takes — connected by a
 * rail. It is deliberately not a second copy of the hero dashboard, and not a
 * generic illustrated infographic.
 *
 * Product truth. Nothing here implies an accounting connection, payment
 * detection, a bank feed, background automation, ServiceSignal receiving money
 * or an invoice marking itself paid. Stage three is explicitly an owner action.
 */

const STAGES = [
  {
    n: "1",
    title: "Add the invoice details",
    line: "Enter the customer, amount and due date. Add your own payment link when you have one.",
  },
  {
    n: "2",
    title: "Review the prepared reminder",
    line: "ServiceSignal writes the reminder and holds it until you decide it is ready.",
  },
  {
    n: "3",
    title: "Keep using your normal payment route",
    line: "Your customer pays you as usual. When you know the invoice is paid, mark it as paid and any remaining reminders stop.",
  },
];

export default function FitsProcessSection() {
  return (
    <section className="v2-fit" aria-labelledby="fit-heading">
      <div className="v2-section v2-fit-grid">
        {/* ── Product-led visual (left on desktop, second on mobile) ── */}
        <div className="v2-fit-visual">
          <div className="v2-fit-panel" aria-hidden="true">
            {/* Stage 1 — the fields the owner fills in */}
            <div className="v2-fit-stage">
              <span className="v2-fit-rail"><span className="v2-fit-dot">1</span></span>
              <div className="v2-fit-card">
                <span className="v2-fit-card-h">New invoice</span>
                <div className="v2-fit-fields">
                  <span className="v2-fit-field"><span>Customer</span><strong>{DEMO.customerName}</strong></span>
                  <span className="v2-fit-field"><span>Amount</span><strong>{DEMO.amount}</strong></span>
                  <span className="v2-fit-field"><span>Due date</span><strong>{DEMO.dueDate}</strong></span>
                  <span className="v2-fit-field"><span>Payment link</span><em>Optional</em></span>
                </div>
              </div>
            </div>

            {/* Stage 2 — the reminder waiting, unsent */}
            <div className="v2-fit-stage">
              <span className="v2-fit-rail"><span className="v2-fit-dot">2</span></span>
              <div className="v2-fit-card">
                <span className="v2-fit-card-h">Reminder prepared</span>
                <div className="v2-fit-rowline">
                  <span className="v2-fit-ref">{DEMO.reference} · {DEMO.amount}</span>
                  <span className="v2-chip c-ready">Ready for review</span>
                </div>
                <span className="v2-fit-act">Review reminder</span>
              </div>
            </div>

            {/* Stage 3 — an owner action, never an automatic detection */}
            <div className="v2-fit-stage is-last">
              <span className="v2-fit-rail"><span className="v2-fit-dot">3</span></span>
              <div className="v2-fit-card">
                <span className="v2-fit-card-h">Paid outside ServiceSignal</span>
                <div className="v2-fit-rowline">
                  <span className="v2-fit-ref">{DEMO.reference}</span>
                  <span className="v2-fit-act quiet">Mark as paid</span>
                </div>
                <span className="v2-fit-note">Remaining reminders stop.</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Copy (right on desktop, first on mobile) ── */}
        <div className="v2-fit-copy">
          <p className="v2-fit-eyebrow">Fits your process</p>
          <h2 id="fit-heading" className="v2-fit-heading">
            Keep invoicing and getting paid the way you already do.
          </h2>
          <p className="v2-fit-sub">
            There&rsquo;s no accounting connection and no new payment system to set up.
            Add the invoice details you already have, review the reminder and keep
            using your existing payment route.
          </p>

          <ol className="v2-fit-steps">
            {STAGES.map((s) => (
              <li key={s.n}>
                <span className="v2-fit-step-n" aria-hidden="true">{s.n}</span>
                <span>
                  <span className="v2-fit-step-t">{s.title}</span>
                  <span className="v2-fit-step-l">{s.line}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
