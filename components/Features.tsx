interface Feature {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
}

const features: Feature[] = [
  {
    icon: (
      <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
        <path
          d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          stroke="#0ea5c4"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    title: "Email Reminders",
    description:
      "Professional email reminders, branded with your business name. You review and approve each one before it sends.",
  },
  {
    icon: (
      <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
        <path
          d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
          stroke="#0ea5c4"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    title: "SMS Reminders",
    badge: "Coming soon",
    description:
      "SMS reminders are harder to ignore than email. Short, professional texts to nudge customers along — coming soon to ServiceSignal.",
  },
  {
    icon: (
      <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
        <path
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          stroke="#0ea5c4"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    title: "Custom Schedules",
    description:
      "Set reminders for 3 days before, on the due date, 7 days after, 14 days after — whatever works for your business.",
  },
  {
    icon: (
      <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
        <path
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          stroke="#0ea5c4"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    title: "Message Log",
    description:
      "A clear history of every reminder prepared and sent, so you know exactly where each invoice stands at a glance.",
  },
  {
    icon: (
      <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
        <path
          d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"
          stroke="#0ea5c4"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    title: "Paid / Unpaid Tracking",
    description:
      "One click to mark an invoice as paid. Reminders stop automatically. Clean, simple invoice status at all times.",
  },
  {
    icon: (
      <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
        <path
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          stroke="#0ea5c4"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    title: "Your Name, Not Ours",
    description:
      "Reminders are branded with your business name, so they look like they came from you — professional and personal.",
  },
];

export default function Features() {
  return (
    <section
      id="features"
      className="section"
      style={{ background: "#f6f8fb", borderTop: "1px solid #e5e7eb" }}
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <p
            className="font-display font-600 text-[#0ea5c4] mb-3 tracking-widest text-sm uppercase"
            style={{ fontWeight: 600, letterSpacing: "0.15em" }}
          >
            Features
          </p>
          <h2
            className="font-display text-[#0f172a] mb-4"
            style={{
              fontSize: "clamp(2rem, 5vw, 3.2rem)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Everything you need,{" "}
            <span className="text-[#0ea5c4]">nothing you don&apos;t</span>
          </h2>
          <p className="text-[#64748b] max-w-lg mx-auto">
            Simple, focused tools that solve one problem — helping you get your
            invoices paid without the endless manual chasing.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <div
              key={i}
              className="lp-card p-6 group hover:border-[#a5f0fa] transition-all hover:-translate-y-0.5"
              style={{ transition: "all 0.2s ease" }}
            >
              <div
                className="w-11 h-11 rounded-lg flex items-center justify-center mb-4"
                style={{ background: "#ecfeff", border: "1px solid #a5f0fa" }}
              >
                {f.icon}
              </div>
              <h3
                className="font-display text-[#0f172a] mb-2 flex items-center gap-2 flex-wrap"
                style={{ fontSize: "1.15rem", fontWeight: 700 }}
              >
                {f.title}
                {f.badge && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-md font-display whitespace-nowrap flex-shrink-0"
                    style={{ background: "#fffbeb", color: "#d97706", fontWeight: 600, letterSpacing: "0.02em", textTransform: "none" }}
                  >
                    {f.badge}
                  </span>
                )}
              </h3>
              <p className="text-[#64748b] text-sm leading-relaxed">
                {f.description}
              </p>
            </div>
          ))}
        </div>

        {/* Coming soon strip */}
        <div
          className="mt-10 rounded-xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4"
          style={{ background: "#ecfeff", border: "1px solid #a5f0fa" }}
        >
          <div className="flex items-center gap-3">
            <span className="text-xs px-2 py-1 rounded bg-[#ecfeff] text-[#0ea5c4] font-display font-600 uppercase tracking-wider" style={{fontWeight:600}}>
              Coming soon
            </span>
            <span className="text-[#94a3b8] text-sm">
              WhatsApp reminders · Xero / QuickBooks sync · Quote follow-ups · Mobile app
            </span>
          </div>
          <a href="#signup" className="text-[#0ea5c4] text-sm font-display font-600 hover:underline whitespace-nowrap" style={{fontWeight:600}}>
            Join beta to influence roadmap →
          </a>
        </div>
      </div>
    </section>
  );
}
