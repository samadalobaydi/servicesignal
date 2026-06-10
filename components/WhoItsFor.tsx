const trades = [
  { icon: "🔨", name: "Builders" },
  { icon: "⚡", name: "Electricians" },
  { icon: "🔧", name: "Plumbers" },
  { icon: "🧹", name: "Cleaners" },
  { icon: "🌿", name: "Landscapers" },
  { icon: "🎨", name: "Decorators" },
  { icon: "🛠️", name: "Handymen" },
  { icon: "🏗️", name: "Construction" },
  { icon: "🔒", name: "Security" },
  { icon: "❄️", name: "HVAC / Gas" },
  { icon: "🪟", name: "Window Fitters" },
  { icon: "🚿", name: "Bathroom Fitters" },
];

export default function WhoItsFor() {
  return (
    <section
      className="section bg-grid"
      style={{ background: "#0a0e1a" }}
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left: text */}
          <div>
            <p
              className="font-display font-600 text-[#00c8ff] mb-3 tracking-widest text-sm uppercase"
              style={{ fontWeight: 600, letterSpacing: "0.15em" }}
            >
              Who It's For
            </p>
            <h2
              className="font-display text-white mb-6"
              style={{
                fontSize: "clamp(2rem, 5vw, 3.2rem)",
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: "-0.01em",
              }}
            >
              BUILT FOR PEOPLE WHO DO THE{" "}
              <span className="text-[#00c8ff]">ACTUAL WORK.</span>
            </h2>
            <p className="text-[#94a3b8] leading-relaxed mb-6">
              ServiceSignal is for tradesmen and local service businesses who
              are great at their trade but don't have time to be a full-time
              accountant or office manager.
            </p>
            <p className="text-[#94a3b8] leading-relaxed mb-8">
              Whether you're a one-man band or managing a small team, if late
              payments are costing you cash flow and mental energy — this
              is for you.
            </p>

            {/* Key callout */}
            <div
              className="rounded-xl p-5"
              style={{
                background: "rgba(0,230,118,0.05)",
                border: "1px solid rgba(0,230,118,0.15)",
              }}
            >
              <p className="text-[#00e676] font-display font-700 text-lg mb-1" style={{fontWeight:700}}>
                You don't need to be "techy"
              </p>
              <p className="text-[#94a3b8] text-sm">
                If you can send a text message, you can use ServiceSignal.
                There's nothing complicated here — no subscriptions to manage,
                no accountancy jargon. Just invoices in, reminders out, money
                in the bank.
              </p>
            </div>
          </div>

          {/* Right: trade grid */}
          <div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {trades.map((trade, i) => (
                <div
                  key={i}
                  className="card p-4 flex flex-col items-center gap-2 hover:border-[rgba(0,200,255,0.2)] transition-colors text-center"
                >
                  <span className="text-2xl">{trade.icon}</span>
                  <span className="text-[#94a3b8] text-xs font-500">
                    {trade.name}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-center text-[#475569] text-xs mt-4">
              + any other local service business that sends invoices
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
