export default function Pricing() {
  return (
    <section
      id="pricing"
      className="section"
      style={{ background: "#05080f", borderTop: "1px solid rgba(255,255,255,0.04)" }}
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <p
            className="font-display font-600 text-[#00c8ff] mb-3 tracking-widest text-sm uppercase"
            style={{ fontWeight: 600, letterSpacing: "0.15em" }}
          >
            Pricing
          </p>
          <h2
            className="font-display text-white mb-4"
            style={{
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 800,
              letterSpacing: "-0.01em",
            }}
          >
            SIMPLE PRICING.{" "}
            <span className="text-[#00c8ff]">NO SURPRISES.</span>
          </h2>
          <p className="text-[#94a3b8] max-w-lg mx-auto">
            Beta users get early access at a locked-in rate before we go public.
          </p>
        </div>

        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Beta plan */}
          <div
            className="rounded-xl p-6 col-span-1 md:col-span-1 relative overflow-hidden"
            style={{
              background: "rgba(0,200,255,0.05)",
              border: "2px solid #00c8ff",
              boxShadow: "0 0 40px rgba(0,200,255,0.1)",
            }}
          >
            <div className="absolute top-4 right-4">
              <span
                className="text-xs px-2 py-1 rounded font-display font-700 uppercase"
                style={{
                  background: "#00c8ff",
                  color: "#05080f",
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
                className="font-display text-white"
                style={{ fontSize: "3.5rem", fontWeight: 900, lineHeight: 1 }}
              >
                FREE
              </span>
            </div>
            <p className="text-[#64748b] text-sm mb-6">During beta period</p>

            <ul className="space-y-3 mb-8">
              {[
                "Unlimited invoices",
                "Email reminders",
                "SMS reminders",
                "Custom schedules",
                "Message log",
                "Priority support",
                "Influence the roadmap",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-[#94a3b8]">
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" stroke="#00e676" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {item}
                </li>
              ))}
            </ul>

            <a href="#signup" className="btn-primary w-full text-center block">
              Join the Beta
            </a>
          </div>

          {/* Starter plan */}
          <div className="card p-6">
            <p className="text-[#94a3b8] text-sm mb-2">Starter</p>
            <div className="flex items-end gap-1 mb-1">
              <span className="text-[#64748b] text-xl font-display" style={{fontWeight:700}}>£</span>
              <span
                className="font-display text-white"
                style={{ fontSize: "3rem", fontWeight: 900, lineHeight: 1 }}
              >
                20
              </span>
              <span className="text-[#64748b] text-sm mb-2">/month</span>
            </div>
            <p className="text-[#64748b] text-sm mb-6">After beta — locked in for early users</p>

            <ul className="space-y-3 mb-8">
              {[
                "Up to 50 active invoices",
                "Email reminders",
                "SMS reminders (100/mo)",
                "Custom schedules",
                "Message log",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-[#94a3b8]">
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" stroke="#00c8ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {item}
                </li>
              ))}
            </ul>

            <a href="#signup" className="btn-outline w-full text-center block">
              Lock In Beta Rate
            </a>
          </div>

          {/* Pro plan */}
          <div className="card p-6">
            <p className="text-[#94a3b8] text-sm mb-2">Pro</p>
            <div className="flex items-end gap-1 mb-1">
              <span className="text-[#64748b] text-xl font-display" style={{fontWeight:700}}>£</span>
              <span
                className="font-display text-white"
                style={{ fontSize: "3rem", fontWeight: 900, lineHeight: 1 }}
              >
                49
              </span>
              <span className="text-[#64748b] text-sm mb-2">/month</span>
            </div>
            <p className="text-[#64748b] text-sm mb-6">For busier teams — estimated pricing</p>

            <ul className="space-y-3 mb-8">
              {[
                "Unlimited invoices",
                "Email reminders",
                "Unlimited SMS reminders",
                "Multiple team members",
                "WhatsApp (coming soon)",
                "Xero / QuickBooks (coming soon)",
                "Priority support",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-[#94a3b8]">
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" stroke="#00c8ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {item}
                </li>
              ))}
            </ul>

            <a href="#signup" className="btn-outline w-full text-center block">
              Lock In Beta Rate
            </a>
          </div>
        </div>

        <p className="text-center text-[#475569] text-sm mt-8">
          * Beta users get early-adopter pricing locked in for life. Pricing is subject to change before public launch.
        </p>
      </div>
    </section>
  );
}
