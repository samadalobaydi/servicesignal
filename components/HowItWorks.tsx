const steps = [
  {
    number: "01",
    title: "Add your customer and invoice",
    description:
      "Enter the customer name, invoice amount, and due date. Takes 30 seconds. Import from a spreadsheet or add manually.",
    detail: "No integration needed. Just type it in.",
  },
  {
    number: "02",
    title: "Set your reminder schedule",
    description:
      "Choose when to send reminders — 3 days before due, on the due date, 7 days after, and so on. Set it once.",
    detail: "Flexible schedules to suit your payment terms.",
  },
  {
    number: "03",
    title: "ServiceSignal sends the reminders",
    description:
      "Automated email and SMS reminders go out on schedule — professional, firm, and on your behalf. No awkward calls.",
    detail: "Polite but persistent. Exactly the right tone.",
  },
  {
    number: "04",
    title: "Mark it paid and move on",
    description:
      "When the money lands, mark the invoice as paid in one click. The reminders stop. The job is done.",
    detail: "Full log of every message sent for your records.",
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="section bg-grid"
      style={{ background: "#0a0e1a" }}
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <p
            className="font-display font-600 text-[#00c8ff] mb-3 tracking-widest text-sm uppercase"
            style={{ fontWeight: 600, letterSpacing: "0.15em" }}
          >
            How It Works
          </p>
          <h2
            className="font-display text-white mb-4"
            style={{
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 800,
              letterSpacing: "-0.01em",
            }}
          >
            UP AND RUNNING{" "}
            <span className="text-[#00c8ff]">IN MINUTES.</span>
          </h2>
          <p className="text-[#94a3b8] max-w-lg mx-auto">
            No complicated setup. No training required. If you can use
            WhatsApp, you can use ServiceSignal.
          </p>
        </div>

        {/* Steps */}
        <div className="max-w-3xl mx-auto space-y-6">
          {steps.map((step, i) => (
            <div
              key={i}
              className="flex gap-5 p-6 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#0f1628] hover:border-[rgba(0,200,255,0.15)] transition-all group"
            >
              <div className="flex-shrink-0">
                <div
                  className="font-display font-800 text-[#00c8ff] leading-none"
                  style={{
                    fontSize: "2.5rem",
                    fontWeight: 900,
                    opacity: 0.25,
                    lineHeight: 1,
                    transition: "opacity 0.2s",
                  }}
                >
                  {step.number}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h3
                  className="font-display text-white mb-2"
                  style={{ fontSize: "1.25rem", fontWeight: 700 }}
                >
                  {step.title}
                </h3>
                <p className="text-[#94a3b8] text-sm leading-relaxed mb-2">
                  {step.description}
                </p>
                <p className="text-[#00c8ff] text-xs font-display font-600" style={{fontWeight:600}}>
                  {step.detail}
                </p>
              </div>
              <div className="flex-shrink-0 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <path
                    d="M9 18l6-6-6-6"
                    stroke="#00c8ff"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
          ))}
        </div>

        {/* Example message preview */}
        <div className="mt-16 max-w-2xl mx-auto">
          <p
            className="text-center font-display font-600 text-[#64748b] mb-6 text-sm uppercase tracking-widest"
            style={{ fontWeight: 600, letterSpacing: "0.12em" }}
          >
            Example reminder sent by ServiceSignal
          </p>

          {/* SMS preview */}
          <div
            className="rounded-xl p-6 border"
            style={{
              background: "#0f1628",
              borderColor: "rgba(0,200,255,0.12)",
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-2 h-2 rounded-full bg-[#00c8ff]" />
              <span className="text-[#00c8ff] text-xs font-display font-600 uppercase tracking-widest" style={{fontWeight:600}}>
                SMS — Sent automatically
              </span>
            </div>
            <div
              className="rounded-lg p-4 text-sm text-[#94a3b8] leading-relaxed"
              style={{
                background: "rgba(0,0,0,0.3)",
                borderLeft: "3px solid rgba(0,200,255,0.3)",
              }}
            >
              <p className="text-white mb-1">
                Hi Dave, this is a reminder from{" "}
                <strong>Morrison Electrical Ltd</strong>.
              </p>
              <p className="mb-2">
                Invoice <strong className="text-white">#INV-0042</strong> for{" "}
                <strong className="text-white">£1,240.00</strong> was due on{" "}
                <strong className="text-white">15 Jan 2025</strong> and is now
                overdue.
              </p>
              <p>
                Please arrange payment at your earliest convenience. If you've
                already paid, please ignore this message.
              </p>
              <p className="mt-2 text-[#00c8ff] text-xs">
                Replies go to: dave@morrisonelectrical.co.uk
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
