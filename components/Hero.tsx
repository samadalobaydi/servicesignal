export default function Hero() {
  return (
    <section className="relative pt-28 pb-16 sm:pt-32 sm:pb-20 overflow-hidden" style={{ background: "#f6f8fb" }}>
      {/* Soft brand glow */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[720px] h-[420px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(ellipse at center, rgba(14,165,196,0.10) 0%, transparent 70%)", filter: "blur(30px)" }}
      />

      <div className="lp-section relative z-10">
        <div className="max-w-3xl mx-auto text-center">
          {/* Eyebrow */}
          <div className="lp-eyebrow mb-7">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#0ea5c4" }} />
            Now accepting beta signups
          </div>

          {/* Headline */}
          <h1 style={{ fontSize: "clamp(2.2rem, 5vw, 3.6rem)", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1, color: "#0f172a" }}>
            Stop chasing invoices.{" "}
            <span style={{ color: "#0ea5c4" }}>Let ServiceSignal do the heavy lifting.</span>
          </h1>

          {/* Subheadline — accurate to current product (email live, SMS coming soon) */}
          <p className="mt-6 max-w-2xl mx-auto" style={{ fontSize: "clamp(1.05rem, 2vw, 1.2rem)", lineHeight: 1.6, color: "#64748b" }}>
            Add unpaid invoices, review reminders, and let ServiceSignal help you follow up professionally by{" "}
            <strong style={{ color: "#0f172a", fontWeight: 600 }}>email</strong>. SMS reminders are coming soon.
          </p>

          {/* CTA group */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mt-9">
            <a href="#signup" className="lp-btn w-full sm:w-auto">Join the beta — it&apos;s free</a>
            <a href="#how-it-works" className="lp-btn-ghost w-full sm:w-auto">See how it works</a>
          </div>

          {/* Trust bar */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mt-8 text-sm" style={{ color: "#64748b" }}>
            {["No credit card required", "Set up in under 5 minutes", "Built for UK trades"].map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Mock dashboard preview — matches the real light dashboard */}
        <div className="mt-14 sm:mt-16 max-w-4xl mx-auto">
          <div className="lp-card overflow-hidden" style={{ boxShadow: "0 24px 60px rgba(16,24,40,0.14)" }}>
            {/* Fake browser bar */}
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid #e5e7eb", background: "#f8fafc" }}>
              <div className="w-3 h-3 rounded-full" style={{ background: "#ff5f57" }} />
              <div className="w-3 h-3 rounded-full" style={{ background: "#ffbd2e" }} />
              <div className="w-3 h-3 rounded-full" style={{ background: "#28c840" }} />
              <div className="flex-1 mx-4 rounded px-3 py-1 text-xs text-center" style={{ background: "#ffffff", border: "1px solid #e5e7eb", color: "#94a3b8" }}>
                servicesignal.app/dashboard
              </div>
            </div>

            {/* Mock app: navy sidebar + light content */}
            <div className="flex" style={{ minHeight: 320 }}>
              {/* Sidebar */}
              <div className="hidden sm:flex flex-col w-44 flex-shrink-0 py-4 px-3 gap-1" style={{ background: "#0f172a" }}>
                <div className="flex items-center gap-2 px-2 pb-4 mb-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: "#0ea5c4" }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1L14 13H2L8 1Z" fill="#0f172a" /></svg>
                  </div>
                  <span className="text-white text-sm" style={{ fontWeight: 700 }}>Service<span style={{ color: "#38bdf8" }}>Signal</span></span>
                </div>
                {[["Overview", true], ["Active Chasing", false], ["Needs Action", false], ["Paid Invoices", false], ["Settings", false]].map(([label, active], i) => (
                  <div key={i} className="px-2.5 py-2 rounded-lg text-xs" style={{ background: active ? "rgba(56,189,248,0.14)" : "transparent", color: active ? "#ffffff" : "#94a3b8", fontWeight: active ? 600 : 500 }}>
                    {label as string}
                  </div>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 p-5" style={{ background: "#f6f8fb" }}>
                {/* Stat cards */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[["Total Unpaid", "£5,420", "#dc2626"], ["Overdue", "3", "#d97706"], ["Paid This Month", "£8,900", "#059669"]].map((c, i) => (
                    <div key={i} className="lp-card p-3">
                      <div className="text-xs" style={{ color: "#64748b" }}>{c[0]}</div>
                      <div style={{ fontSize: "1.15rem", fontWeight: 700, color: c[2], letterSpacing: "-0.01em" }}>{c[1]}</div>
                    </div>
                  ))}
                </div>

                {/* Invoice rows */}
                <div className="lp-card p-3">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-sm" style={{ fontWeight: 650, color: "#0f172a" }}>Active Chasing</span>
                    <span className="text-xs px-2 py-0.5 rounded-md" style={{ background: "#fef2f2", color: "#dc2626", fontWeight: 600 }}>3 overdue</span>
                  </div>
                  <div className="space-y-2">
                    {[
                      { name: "Dave Morrison", amount: "£1,240", due: "14 days overdue", status: "Reminder sent", color: "#0891b2" },
                      { name: "Sarah & Paul Clarke", amount: "£680", due: "7 days overdue", status: "Ready to chase", color: "#d97706" },
                      { name: "Apex Building Ltd", amount: "£3,500", due: "28 days overdue", status: "Final notice sent", color: "#dc2626" },
                    ].map((row, i) => (
                      <div key={i} className="flex items-center justify-between p-2.5 rounded-lg" style={{ background: "#f8fafc", border: "1px solid #eef1f5" }}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0" style={{ background: "#ecfeff", color: "#0891b2", fontWeight: 700 }}>{row.name.charAt(0)}</div>
                          <div className="min-w-0">
                            <div className="text-xs truncate" style={{ fontWeight: 500, color: "#0f172a" }}>{row.name}</div>
                            <div className="text-xs" style={{ color: "#94a3b8" }}>{row.due}</div>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-xs" style={{ fontWeight: 700, color: "#0f172a" }}>{row.amount}</div>
                          <div className="text-xs" style={{ color: row.color }}>{row.status}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="text-center text-xs mt-3" style={{ color: "#94a3b8" }}>
            Illustrative dashboard preview — actual UI shown during beta
          </p>
        </div>
      </div>
    </section>
  );
}
