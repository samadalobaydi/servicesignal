const problems = [
  {
    icon: (
      <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
        <path
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          stroke="#dc2626"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
    stat: "Thousands",
    label: "Often tied up in unpaid invoices",
    description:
      "Many tradespeople are sitting on significant sums in overdue invoices they're too busy — or too awkward — to chase.",
  },
  {
    icon: (
      <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
        <path
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          stroke="#d97706"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
    stat: "Weeks",
    label: "Often spent waiting to get paid",
    description:
      "Late payment is one of the biggest pressures on UK small businesses. While you wait, you're still paying for materials, fuel, and wages.",
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
    stat: "Hours",
    label: "Lost to manual chasing",
    description:
      "Sending reminders manually, logging calls, writing emails — it's time you could spend on jobs that actually pay.",
  },
];

export default function Problem() {
  return (
    <section
      className="section"
      style={{ background: "#f6f8fb", borderTop: "1px solid #e5e7eb" }}
    >
      <div className="max-w-6xl mx-auto px-6">
        {/* Section label */}
        <div className="text-center mb-14">
          <p
            className="font-display font-600 text-[#0ea5c4] mb-3 tracking-widest text-sm uppercase"
            style={{ fontWeight: 600, letterSpacing: "0.15em" }}
          >
            The Problem
          </p>
          <h2
            className="font-display text-[#0f172a] mb-4"
            style={{
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 800,
              letterSpacing: "-0.01em",
            }}
          >
            Getting paid shouldn't be{" "}
            <span className="text-[#dc2626]">this hard</span>
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
              className="lp-card p-6 hover:border-[#a5f0fa] transition-colors"
            >
              <div className="mb-4">{p.icon}</div>
              <div
                className="font-display text-[#0f172a] mb-1"
                style={{ fontSize: "2.2rem", fontWeight: 600, lineHeight: 1 }}
              >
                {p.stat}
              </div>
              <div className="text-[#94a3b8] text-sm font-500 mb-3">{p.label}</div>
              <div className="signal-line mb-3" />
              <p className="text-[#94a3b8] text-sm leading-relaxed">{p.description}</p>
            </div>
          ))}
        </div>

        {/* Quote block */}
        <div
          className="max-w-3xl mx-auto rounded-xl p-8 text-center"
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
          }}
        >
          <p
            className="font-display text-[#0f172a] mb-4"
            style={{ fontSize: "clamp(1.2rem, 3vw, 1.7rem)", fontWeight: 700 }}
          >
            It&apos;s a familiar story: the work is done, the invoices are sent —
            and following up keeps slipping to the bottom of the list.
          </p>
          <p className="text-[#64748b] text-sm">
            ServiceSignal is built to take that follow-up off your plate.
          </p>
        </div>
      </div>
    </section>
  );
}
