"use client";

interface DashNavProps {
  onAddInvoice: () => void;
}

export default function DashNav({ onAddInvoice }: DashNavProps) {
  return (
    <header
      className="sticky top-0 z-40 border-b"
      style={{
        background: "rgba(10,14,26,0.97)",
        backdropFilter: "blur(12px)",
        borderColor: "rgba(0,200,255,0.08)",
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div
            className="w-6 h-6 rounded flex items-center justify-center"
            style={{ background: "#00c8ff" }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M8 1L14 13H2L8 1Z" fill="#0a0e1a" />
              <circle cx="8" cy="10" r="1.5" fill="#00c8ff" />
            </svg>
          </div>
          <span
            className="font-display text-white hidden sm:block"
            style={{ fontWeight: 800, fontSize: "1rem", letterSpacing: "0.04em" }}
          >
            SERVICE<span style={{ color: "#00c8ff" }}>SIGNAL</span>
          </span>
          <span
            className="ml-2 text-xs px-2 py-0.5 rounded font-display"
            style={{
              background: "rgba(0,200,255,0.1)",
              border: "1px solid rgba(0,200,255,0.2)",
              color: "#00c8ff",
              fontWeight: 600,
              letterSpacing: "0.06em",
            }}
          >
            BETA
          </span>
        </div>

        {/* Centre label */}
        <p
          className="font-display text-white hidden md:block"
          style={{ fontWeight: 700, fontSize: "0.95rem", letterSpacing: "0.06em" }}
        >
          INVOICE DASHBOARD
        </p>

        {/* Right actions */}
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="text-xs flex items-center gap-1.5 transition-colors"
            style={{ color: "#64748b" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#94a3b8")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
          >
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
              <path
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="hidden sm:inline">Landing page</span>
          </a>

          <button
            onClick={onAddInvoice}
            className="btn-primary flex items-center gap-1.5"
            style={{ padding: "0.45rem 1rem", fontSize: "0.82rem" }}
          >
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            Add Invoice
          </button>
        </div>
      </div>
    </header>
  );
}
