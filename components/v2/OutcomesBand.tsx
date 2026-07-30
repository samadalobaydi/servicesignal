/**
 * Section 4 — Outcomes.
 *
 * A narrow band translating the product into everyday language. Three plain
 * columns with small markers — deliberately not three boxed SaaS cards.
 *
 * Product truth. No hours saved, no faster payment, no cashflow percentage,
 * no guaranteed reduction in stress and no claim of complete automation.
 * Every line describes something the software demonstrably does.
 */

const OUTCOMES = [
  {
    title: "Less repetitive admin",
    line: "No rewriting the same overdue-invoice email from scratch every time.",
  },
  {
    title: "Professional every time",
    line: "The customer, amount, due date and business name stay clear and consistent.",
  },
  {
    title: "Still your decision",
    line: "You review every reminder and decide whether it should be sent.",
  },
];

export default function OutcomesBand() {
  return (
    <section className="v2-out" aria-labelledby="out-heading">
      <div className="v2-section">
        <h2 id="out-heading" className="v2-out-heading">
          What changes in your day-to-day.
        </h2>

        <ul className="v2-out-list">
          {OUTCOMES.map((o) => (
            <li key={o.title} className="v2-out-item">
              <span className="v2-out-marker" aria-hidden="true" />
              <p className="v2-out-t">{o.title}</p>
              <p className="v2-out-l">{o.line}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
