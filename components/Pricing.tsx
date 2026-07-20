export default function Pricing() {
  return (
    <section
      id="pricing"
      className="section"
      style={{ background: "#f6f8fb", borderTop: "1px solid #e5e7eb" }}
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <p
            className="font-display font-600 text-[#0ea5c4] mb-3 tracking-widest text-sm uppercase"
            style={{ fontWeight: 600, letterSpacing: "0.15em" }}
          >
            Pricing
          </p>
          <h2
            className="font-display text-[#0f172a] mb-4"
            style={{
              fontSize: "clamp(2rem, 5vw, 3.2rem)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Simple pricing,{" "}
            <span className="text-[#0ea5c4]">no surprises</span>
          </h2>
          <p className="text-[#64748b] max-w-lg mx-auto">
            ServiceSignal is free during beta. The plans below are planned for after launch — early users can lock in a lower rate.
          </p>
        </div>

        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Beta plan */}
          <div
            className="rounded-xl p-6 col-span-1 md:col-span-1 relative overflow-hidden"
            style={{
              background: "#ffffff",
              border: "2px solid #0ea5c4",
              boxShadow: "0 12px 32px rgba(14,165,196,0.15)",
            }}
          >
            <div className="absolute top-4 right-4">
              <span
                className="text-xs px-2 py-1 rounded font-display font-700 uppercase"
                style={{
                  background: "#0ea5c4",
                  color: "#f6f8fb",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                }}
              >
                Beta
              </span>
            </div>

            <p className="text-[#94a3b8] text-sm mb-2">Beta Access</p>
            <div className="flex items-end gap-1 mb-1">
              <span
                className="font-display text-[#0f172a]"
                style={{ fontSize: "3.5rem", fontWeight: 900, lineHeight: 1 }}
              >
                FREE
              </span>
            </div>
            <p className="text-[#94a3b8] text-sm mb-6">During beta period</p>

            <ul className="space-y-3 mb-8">
              {[
                "Unlimited invoices",
                "Email reminders",
                "SMS reminders (coming soon)",
                "Custom schedules",
                "Message log",
                "Priority support",
                "Influence the roadmap",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-[#94a3b8]">
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {item}
                </li>
              ))}
            </ul>

            <a href="#signup" className="lp-btn w-full text-center block">
              Join the Beta
            </a>
          </div>

          {/* Starter plan */}
          <div className="lp-card p-6">
            <p className="text-[#94a3b8] text-sm mb-2">Starter</p>
            <div className="flex items-end gap-1 mb-1">
              <span className="text-[#94a3b8] text-sm mb-2 mr-1">Est.</span>
              <span className="text-[#94a3b8] text-xl font-display" style={{fontWeight:700}}>£</span>
              <span
                className="font-display text-[#0f172a]"
                style={{ fontSize: "3rem", fontWeight: 900, lineHeight: 1 }}
              >
                20
              </span>
              <span className="text-[#94a3b8] text-sm mb-2">/month</span>
            </div>
            <p className="text-[#94a3b8] text-sm mb-6">Planned after beta — early users can lock in a lower rate</p>

            <ul className="space-y-3 mb-8">
              {[
                "Up to 50 active invoices",
                "Email reminders",
                "SMS reminders (coming soon)",
                "Custom schedules",
                "Message log",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-[#94a3b8]">
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" stroke="#0ea5c4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {item}
                </li>
              ))}
            </ul>

            <a href="#signup" className="lp-btn-ghost w-full text-center block">
              Join the Beta
            </a>
          </div>

          {/* Pro plan */}
          <div className="lp-card p-6">
            <p className="text-[#94a3b8] text-sm mb-2">Pro</p>
            <div className="flex items-end gap-1 mb-1">
              <span className="text-[#94a3b8] text-sm mb-2 mr-1">Est.</span>
              <span className="text-[#94a3b8] text-xl font-display" style={{fontWeight:700}}>£</span>
              <span
                className="font-display text-[#0f172a]"
                style={{ fontSize: "3rem", fontWeight: 900, lineHeight: 1 }}
              >
                49
              </span>
              <span className="text-[#94a3b8] text-sm mb-2">/month</span>
            </div>
            <p className="text-[#94a3b8] text-sm mb-6">Planned for busier teams — estimated pricing</p>

            <ul className="space-y-3 mb-8">
              {[
                "Unlimited invoices",
                "Email reminders",
                "SMS reminders (coming soon)",
                "Multiple team members",
                "WhatsApp (coming soon)",
                "Xero / QuickBooks (coming soon)",
                "Priority support",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-[#94a3b8]">
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" stroke="#0ea5c4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {item}
                </li>
              ))}
            </ul>

            <a href="#signup" className="lp-btn-ghost w-full text-center block">
              Join the Beta
            </a>
          </div>
        </div>

        <p className="text-center text-[#94a3b8] text-sm mt-8">
          * Beta users get early-adopter pricing locked in for life. Pricing is subject to change before public launch.
        </p>
      </div>
    </section>
  );
}
