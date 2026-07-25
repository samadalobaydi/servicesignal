"use client";

import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface DashNavProps {
  onAddInvoice: () => void;
  userEmail?: string;
}

export default function DashNav({ onAddInvoice, userEmail }: DashNavProps) {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header
      className="sticky top-0 z-40 border-b"
      style={{
        background: "rgba(10,14,26,0.97)",
        backdropFilter: "blur(12px)",
        borderColor: "rgba(0,200,255,0.08)",
      }}
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 lg:px-12 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/branding/servicesignal-mark.png" alt="ServiceSignal" style={{ height: "22px", width: "auto", display: "block", flexShrink: 0 }} />
          <span
            className="font-display text-white hidden sm:block"
            style={{ fontWeight: 800, fontSize: "1rem", letterSpacing: "0.04em" }}
          >
            SERVICE<span style={{ color: "#00c8ff" }}>SIGNAL</span>
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
          {/* User email — small, muted */}
          {userEmail && (
            <span
              className="text-xs hidden sm:block truncate max-w-[160px]"
              style={{ color: "#9aa7bd" }}
              title={userEmail}
            >
              {userEmail}
            </span>
          )}

          {/* Back to landing */}
          <a
            href="/"
            className="text-xs flex items-center gap-1.5 transition-colors"
            style={{ color: "#a3b0c4" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#c2ccdb")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#a3b0c4")}
          >
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
              <path d="M10 19l-7-7m0 0l7-7m-7 7h18" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Home</span>
          </a>

          {/* Add Invoice */}
          <button
            onClick={onAddInvoice}
            className="btn-primary flex items-center gap-1.5"
            style={{ padding: "0.45rem 1rem", fontSize: "0.82rem" }}
          >
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            Add Invoice
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#a3b0c4",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#ff6b6b";
              e.currentTarget.style.borderColor = "rgba(255,107,107,0.2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#a3b0c4";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
            }}
            title="Sign out"
          >
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
              <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
