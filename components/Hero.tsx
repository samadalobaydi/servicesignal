export default function Hero() {
  return (
    <section
      className="relative min-h-screen flex items-center pt-24 pb-16 overflow-hidden bg-grid"
      style={{ background: "linear-gradient(180deg, #05080f 0%, #0a0e1a 100%)" }}
    >
      {/* Background glow blobs */}
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,200,255,0.07) 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
      />
      <div
        className="absolute bottom-0 right-0 w-[400px] h-[300px] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at bottom right, rgba(0,230,118,0.05) 0%, transparent 70%)",
        }}
      />

      <div className="max-w-6xl mx-auto px-6 w-full relative z-10">
        <div className="max-w-3xl mx-auto text-center">
          {/* Status badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[rgba(0,200,255,0.2)] bg-[rgba(0,200,255,0.05)] text-sm text-[#00c8ff] mb-8">
            <span className="pulse-dot" />
            <span className="font-display font-600" style={{fontWeight:600, letterSpacing:'0.03em'}}>NOW ACCEPTING BETA SIGNUPS</span>
          </div>

          {/* Headline */}
          <h1
            className="font-display text-white mb-6 leading-none"
            style={{
              fontSize: "clamp(2.8rem, 7vw, 5.5rem)",
              fontWeight: 900,
              letterSpacing: "-0.01em",
              lineHeight: 1.0,
            }}
          >
            STOP CHASING{" "}
            <span
              style={{
                color: "#00c8ff",
                textShadow: "0 0 40px rgba(0,200,255,0.4)",
              }}
            >
              LATE PAYMENTS
            </span>
            {" "}MANUALLY.
          </h1>

          {/* Subheadline */}
          <p
            className="text-[#94a3b8] mb-10 max-w-2xl mx-auto leading-relaxed"
            style={{ fontSize: "clamp(1rem, 2.5vw, 1.2rem)" }}
          >
            ServiceSignal automatically sends{" "}
            <strong className="text-white">email and SMS reminders</strong> to
            customers with unpaid invoices — so you can focus on the job, not
            the admin.
          </p>

          {/* CTA group */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-14">
            <a href="#signup" className="btn-primary w-full sm:w-auto text-center">
              Join the Beta — It's Free
            </a>
            <a href="#how-it-works" className="btn-outline w-full sm:w-auto text-center">
              See How It Works
            </a>
          </div>

          {/* Social proof bar */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 text-sm text-[#64748b]">
            <div className="flex items-center gap-2">
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" className="text-[#00e676]">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>No credit card required</span>
            </div>
            <div className="hidden sm:block w-1 h-1 rounded-full bg-[#1e2d4f]" />
            <div className="flex items-center gap-2">
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" className="text-[#00e676]">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Set up in under 5 minutes</span>
            </div>
            <div className="hidden sm:block w-1 h-1 rounded-full bg-[#1e2d4f]" />
            <div className="flex items-center gap-2">
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" className="text-[#00e676]">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Built for UK tradesmen</span>
            </div>
          </div>
        </div>

        {/* Mock dashboard preview */}
        <div className="mt-16 max-w-4xl mx-auto">
          <div
            className="rounded-xl border border-[rgba(0,200,255,0.15)] overflow-hidden"
            style={{
              background: "#0f1628",
              boxShadow: "0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,200,255,0.08)",
            }}
          >
            {/* Fake browser bar */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[rgba(255,255,255,0.06)] bg-[#05080f]">
              <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
              <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
              <div className="w-3 h-3 rounded-full bg-[#28c840]" />
              <div className="flex-1 mx-4 bg-[#0a0e1a] rounded px-3 py-1 text-xs text-[#475569] text-center">
                app.servicesignal.co.uk/dashboard
              </div>
            </div>

            {/* Mock invoice list */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-700 text-white text-lg tracking-wide" style={{fontWeight:700}}>
                  Unpaid Invoices
                </h3>
                <span className="text-xs px-2 py-1 rounded bg-[rgba(255,100,100,0.1)] text-[#ff6b6b] border border-[rgba(255,100,100,0.2)] font-display font-600" style={{fontWeight:600}}>
                  3 OVERDUE
                </span>
              </div>

              {/* Invoice rows */}
              <div className="space-y-3">
                {[
                  { name: "Dave Morrison", amount: "£1,240", due: "14 days overdue", status: "Reminder sent", statusColor: "#00c8ff" },
                  { name: "Sarah & Paul Clarke", amount: "£680", due: "7 days overdue", status: "2nd reminder due", statusColor: "#ffbd2e" },
                  { name: "Apex Building Ltd", amount: "£3,500", due: "28 days overdue", status: "Final notice sent", statusColor: "#ff6b6b" },
                ].map((row, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 rounded-lg border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(0,200,255,0.03)] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-display font-700 flex-shrink-0"
                        style={{
                          background: "rgba(0,200,255,0.1)",
                          color: "#00c8ff",
                          fontWeight: 700,
                        }}
                      >
                        {row.name.charAt(0)}
                      </div>
                      <div>
                        <div className="text-sm font-500 text-white">{row.name}</div>
                        <div className="text-xs text-[#64748b]">{row.due}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-700 text-white font-display" style={{fontWeight:700}}>{row.amount}</div>
                      <div className="text-xs" style={{ color: row.statusColor }}>
                        {row.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between">
                <span className="text-xs text-[#64748b]">Total outstanding</span>
                <span className="font-display font-800 text-white text-lg" style={{fontWeight:800}}>£5,420</span>
              </div>
            </div>
          </div>
          <p className="text-center text-xs text-[#475569] mt-3">
            Illustrative dashboard preview — actual UI shown during beta
          </p>
        </div>
      </div>
    </section>
  );
}
