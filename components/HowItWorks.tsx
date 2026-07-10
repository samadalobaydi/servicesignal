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
      "Choose when to send reminders — 3 days before due, on the due date, 7 days after, and so on. Set your schedule preferences.",
    detail: "Flexible schedules to suit your payment terms.",
  },
  {
    number: "03",
    title: "Review and send the reminders",
    description:
      "ServiceSignal prepares professional email reminders for you to approve and send. You stay in control of every message. SMS reminders are coming soon.",
    detail: "Approval mode first — nothing goes out without your say-so.",
  },
  {
    number: "04",
    title: "Mark it paid and move on",
    description:
      "When the money lands, mark the invoice as paid in one click. The reminders stop. The job is done.",
    detail: "A clear log of every reminder prepared and sent.",
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="section bg-grid"
      style={{ background: "#ffffff" }}
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <p
            className="font-display font-600 text-[#0ea5c4] mb-3 tracking-widest text-sm uppercase"
            style={{ fontWeight: 600, letterSpacing: "0.15em" }}
          >
            How It Works
          </p>
          <h2
            className="font-display text-[#0f172a] mb-4"
            style={{
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 800,
              letterSpacing: "-0.01em",
            }}
          >
            Up and running{" "}
            <span className="text-[#0ea5c4]">in minutes</span>
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
              className="flex gap-5 p-6 rounded-xl border border-[#e5e7eb] bg-[#ffffff] hover:border-[#a5f0fa] transition-all group"
            >
              <div className="flex-shrink-0">
                <div
                  className="font-display font-800 text-[#0ea5c4] leading-none"
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
                  className="font-display text-[#0f172a] mb-2"
                  style={{ fontSize: "1.25rem", fontWeight: 700 }}
                >
                  {step.title}
                </h3>
                <p className="text-[#94a3b8] text-sm leading-relaxed mb-2">
                  {step.description}
                </p>
                <p className="text-[#0ea5c4] text-xs font-display font-600" style={{fontWeight:600}}>
                  {step.detail}
                </p>
              </div>
              <div className="flex-shrink-0 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <path
                    d="M9 18l6-6-6-6"
                    stroke="#0ea5c4"
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
            className="text-center font-display font-600 text-[#94a3b8] mb-6 text-sm uppercase tracking-widest"
            style={{ fontWeight: 600, letterSpacing: "0.12em" }}
          >
            Example reminder sent by ServiceSignal
          </p>

          {/* Email reminder preview */}
          <div
            className="rounded-xl p-6 border"
            style={{
              background: "#ffffff",
              borderColor: "#e5e7eb",
            }}
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-[#0ea5c4]" />
                <span className="text-[#0891b2] text-xs font-display font-600 uppercase tracking-widest" style={{fontWeight:600}}>
                  Email reminder — you approve before it sends
                </span>
              </div>
            </div>
            <div
              className="rounded-lg p-4 text-sm leading-relaxed"
              style={{
                background: "#f8fafc",
                border: "1px solid #e5e7eb",
                borderLeft: "3px solid #0ea5c4",
                color: "#334155",
              }}
            >
              <p className="mb-1" style={{ color: "#0f172a" }}>
                Hi Dave, this is a reminder from{" "}
                <strong>Morrison Electrical Ltd</strong>.
              </p>
              <p className="mb-2">
                Your invoice for{" "}
                <strong style={{ color: "#0f172a" }}>£1,240.00</strong> is now{" "}
                <strong style={{ color: "#0f172a" }}>14 days overdue</strong>. It was due on{" "}
                <strong style={{ color: "#0f172a" }}>15 Jan 2025</strong> and remains unpaid.
              </p>
              <p>
                Please arrange payment as soon as possible. If you&apos;ve
                already paid, please ignore this message.
              </p>
              <p className="mt-3" style={{ color: "#64748b" }}>
                Sent on behalf of Morrison Electrical Ltd via ServiceSignal.
              </p>
            </div>
            <p className="text-center text-xs mt-4" style={{ color: "#94a3b8" }}>
              SMS reminders coming soon.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
