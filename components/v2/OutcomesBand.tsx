/**
 * Section 4 — Outcomes.
 *
 * A narrow band translating the product into everyday language. Three plain
 * columns with small markers — deliberately not three boxed SaaS cards.
 *
 * The copy is written to be unusable by any other product. "Start from a
 * prepared reminder instead of rewriting the same overdue-invoice message"
 * could only describe this one; "save time and stay organised" could describe
 * anything, which is what made the earlier version the weakest passage on the
 * page. Each line names the specific thing that changes.
 *
 * Product truth. No hours saved, no faster payment, no cashflow percentage,
 * no guaranteed reduction in stress and no claim of complete automation.
 * Channel-neutral throughout: these three things are true whichever channel a
 * reminder eventually goes out on.
 */

const OUTCOMES = [
  {
    title: "Less repetitive chasing",
    line: "Start from a prepared reminder instead of rewriting the same overdue-invoice message.",
  },
  {
    title: "Professional every time",
    line: "Customer, invoice and business details stay clear and consistent in every reminder.",
  },
  {
    title: "Still your decision",
    line: "Review and approve every reminder before anything is sent.",
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
