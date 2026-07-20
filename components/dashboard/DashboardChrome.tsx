"use client";

import { useState, useEffect } from "react";
import { useDashboard } from "./DashboardProvider";
import DashboardSidebar from "./DashboardSidebar";
import AddInvoiceForm from "./AddInvoiceForm";
import NotificationBell from "./NotificationBell";

export default function DashboardChrome({ children }: { children: React.ReactNode }) {
  const { loading, error, setError, notice, setNotice, handleAddInvoice, userEmail } = useDashboard();
  const [addOpen, setAddOpen] = useState(false);

  // Success notices clear themselves after a few seconds.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice, setNotice]);

  if (loading) {
    return (
      <div className="dash-root flex items-center justify-center">
        <div className="flex items-center gap-3" style={{ color: "var(--dash-text-muted)" }}>
          <svg className="animate-spin" width="20" height="20" fill="none" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0110 10" stroke="var(--dash-accent)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span className="text-sm" style={{ fontWeight: 600 }}>Loading your dashboard…</span>
        </div>
      </div>
    );
  }

  const initial = (userEmail?.[0] ?? "U").toUpperCase();

  return (
    <div className="dash-root">
      <DashboardSidebar />

      {/* Main content — offset by sidebar width on desktop */}
      <div className="md:pl-[248px]">
        {/* Top bar */}
        <header
          className="hidden md:flex items-center justify-end gap-3 h-[68px] px-8 lg:px-10 sticky top-0 z-20"
          style={{ background: "rgba(246,248,251,0.85)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--dash-border)" }}
        >
          <button
            onClick={() => setAddOpen(true)}
            className="dash-btn"
          >
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            Add Invoice
          </button>
          <NotificationBell />
          <div className="flex items-center gap-2.5 pl-3 ml-1" style={{ borderLeft: "1px solid var(--dash-border)" }}>
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm flex-shrink-0"
              style={{ background: "var(--dash-accent-soft)", color: "var(--dash-accent-strong)", fontWeight: 700 }}
            >
              {initial}
            </div>
            {userEmail && (
              <span className="text-sm truncate max-w-[200px]" style={{ color: "var(--dash-text-muted)", fontWeight: 500 }} title={userEmail}>
                {userEmail}
              </span>
            )}
          </div>
        </header>

        {/* Mobile Add Invoice floating button */}
        <button
          onClick={() => setAddOpen(true)}
          className="md:hidden fixed bottom-6 right-6 z-20 dash-btn shadow-lg"
          style={{ padding: "0.7rem 1.2rem", fontSize: "0.95rem", boxShadow: "0 10px 28px rgba(8,145,178,0.35)" }}
        >
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          Add Invoice
        </button>

        <main className="px-4 sm:px-8 lg:px-10 py-7 sm:py-9 max-w-[1240px] mx-auto">
          {notice && (
            <div
              className="rounded-xl px-5 py-3.5 mb-6 flex items-center justify-between text-sm"
              style={{ background: "var(--dash-green-soft)", border: "1px solid #a7f3d0", color: "var(--dash-green)" }}
            >
              <span style={{ fontWeight: 600 }}>{notice}</span>
              <button onClick={() => setNotice(null)} className="ml-4 opacity-60 hover:opacity-100">
                <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}
          {error && (
            <div
              className="rounded-xl px-5 py-3.5 mb-6 flex items-center justify-between text-sm"
              style={{ background: "var(--dash-red-soft)", border: "1px solid #fecaca", color: "var(--dash-red)" }}
            >
              <span style={{ fontWeight: 500 }}>{error}</span>
              <button onClick={() => setError(null)} className="ml-4 opacity-60 hover:opacity-100">
                <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}
          {children}
        </main>
      </div>

      <AddInvoiceForm
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={handleAddInvoice}
      />
    </div>
  );
}
