const problems = [
  {
    icon: (
      <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
        <path
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          stroke="#ff6b6b"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
    stat: "£8,000+",
    label: "Average unpaid at any one time",
    description:
      "Most tradesmen are sitting on thousands in overdue invoices they're too busy — or too awkward — to chase.",
  },
  {
    icon: (
      <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
        <path
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          stroke="#ffbd2e"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
    stat: "47 days",
    label: "Average time to get paid",
    description:
      "Late payment is the UK's biggest small business killer. While you wait, you're still paying for materials, fuel, and wages.",
  },
  {
    icon: (
      <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
        <path
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          stroke="#94a3b8"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
    stat: "3–5 hrs/week",
    label: "Lost to manual chasing",
    description:
      "Sending reminders manually, logging calls, writing emails — it's time you could spend on jobs that actually pay.",
  },
];

export default function Problem() {
  return (
    <section
      className="section"
      style={{ background: "#05080f", borderTop: "1px solid rgba(255,255,255,0.04)" }}
    >
      <div className="max-w-6xl mx-auto px-6">
        {/* Section label */}
        <div className="text-center mb-14">
          <p
            className="font-display font-600 text-[#00c8ff] mb-3 tracking-widest text-sm uppercase"
            style={{ fontWeight: 600, letterSpacing: "0.15em" }}
          >
            The Problem
          </p>
          <h2
            className="font-display text-white mb-4"
            style={{
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 800,
              letterSpacing: "-0.01em",
            }}
          >
            GETTING PAID SHOULDN'T BE{" "}
            <span className="text-[#ff6b6b]">THIS HARD.</span>
          </h2>
          <p className="text-[#94a3b8] max-w-xl mx-auto leading-relaxed">
            You did the work. You sent the invoice. And now you're waiting —
            or worse, having to chase the same customer three times like it's
            your second job.
          </p>
        </div>

        {/* Problem cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {problems.map((p, i) => (
            <div
              key={i}
              className="card p-6 hover:border-[rgba(0,200,255,0.2)] transition-colors"
            >
              <div className="mb-4">{p.icon}</div>
              <div
                className="font-display text-white mb-1"
                style={{ fontSize: "2.2rem", fontWeight: 800, lineHeight: 1 }}
              >
                {p.stat}
              </div>
              <div className="text-[#94a3b8] text-sm font-500 mb-3">{p.label}</div>
              <div className="signal-line mb-3" />
              <p className="text-[#64748b] text-sm leading-relaxed">{p.description}</p>
            </div>
          ))}
        </div>

        {/* Quote block */}
        <div
          className="max-w-3xl mx-auto rounded-xl p-8 text-center"
          style={{
            background: "rgba(255, 107, 107, 0.05)",
            border: "1px solid rgba(255, 107, 107, 0.15)",
          }}
        >
          <p
            className="font-display text-white mb-4"
            style={{ fontSize: "clamp(1.2rem, 3vw, 1.8rem)", fontWeight: 700 }}
          >
            "I was owed £12,000 at one point. I'd done the work, I'd sent
            the invoices — I just kept forgetting to follow up."
          </p>
          <p className="text-[#64748b] text-sm">
            — Builder with 15 years experience, Essex
          </p>
        </div>
      </div>
    </section>
  );
}
