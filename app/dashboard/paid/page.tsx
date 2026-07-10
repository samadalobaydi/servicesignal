"use client";

import { useState, Fragment } from "react";
import { useDashboard } from "@/components/dashboard/DashboardProvider";
import { formatCurrency, formatDate } from "@/lib/invoices";
import SummaryStrip, { type SummaryStat } from "@/components/dashboard/SummaryStrip";
import InvoiceActivityLog, { HistoryToggle } from "@/components/dashboard/InvoiceActivityLog";
import InvoiceSearchInput, { matchesInvoiceSearch, SearchEmptyState } from "@/components/dashboard/InvoiceSearchInput";

export default function PaidPage() {
  const { buckets, handleDeleteInvoice } = useDashboard();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openLogId, setOpenLogId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const toggleLog = (id: string) => setOpenLogId((cur) => (cur === id ? null : id));

  const paid = [...buckets.paid].sort((a, b) => {
    // newest paid first; fall back to created_at when paid_at is null
    const ta = a.paid_at ? new Date(a.paid_at).getTime() : new Date(a.created_at).getTime();
    const tb = b.paid_at ? new Date(b.paid_at).getTime() : new Date(b.created_at).getTime();
    return tb - ta;
  });

  // Archive summary (existing data only)
  const totalCollected = paid.reduce((sum, inv) => sum + inv.amount, 0);
  const avgPaid = paid.length > 0 ? totalCollected / paid.length : 0;
  const latestPaidDate = paid.find((inv) => inv.paid_at)?.paid_at ?? null;

  const summary: SummaryStat[] = [
    {
      href: "/dashboard/paid", ariaLabel: "View paid invoices",
      label: "Total collected", value: formatCurrency(totalCollected),
      hint: "all settled invoices",
      accent: "var(--dash-green)", iconBg: "var(--dash-green-soft)",
      icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
    },
    {
      href: "/dashboard/paid", ariaLabel: "View paid invoices",
      label: "Paid invoices", value: String(paid.length),
      hint: paid.length === 1 ? "settled" : "settled",
      accent: "var(--dash-text)", iconBg: "var(--dash-card-muted)",
      icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    },
    {
      href: "/dashboard/paid", ariaLabel: "View paid invoices",
      label: "Average invoice", value: formatCurrency(avgPaid),
      hint: "per settled invoice",
      accent: "var(--dash-text)", iconBg: "var(--dash-card-muted)",
      icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M3 12h4l3 8 4-16 3 8h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    },
    {
      href: "/dashboard/paid", ariaLabel: "View paid invoices",
      label: "Latest payment", value: latestPaidDate ? formatDate(latestPaidDate) : "—",
      hint: "most recent settled",
      accent: "var(--dash-text)", iconBg: "var(--dash-card-muted)",
      icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    },
  ];

  const visiblePaid = paid.filter((inv) => matchesInvoiceSearch(inv, search));
  const searching = search.trim().length > 0;

  const confirmDelete = async (id: string) => {
    setBusyId(id);
    await handleDeleteInvoice(id);
    setBusyId(null);
    setConfirmId(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 style={{ fontSize: "1.85rem", fontWeight: 700, color: "var(--dash-text)", letterSpacing: "-0.02em" }}>
          Paid Invoices
        </h1>
        <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)" }}>
          Invoices that have been settled. Kept here as a record.
        </p>
      </div>

      <InvoiceSearchInput value={search} onChange={setSearch} placeholder="Search paid invoices..." />

      {paid.length > 0 && <SummaryStrip stats={summary} />}

      {searching && visiblePaid.length === 0 ? (
        <SearchEmptyState />
      ) : paid.length === 0 ? (
        <div className="dash-card p-12 text-center">
          <p style={{ fontWeight: 650, fontSize: "1.05rem", color: "var(--dash-text)" }}>No paid invoices yet</p>
          <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)" }}>When you mark an invoice paid, it moves here.</p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {visiblePaid.map((inv) => (
              <div key={inv.id} className="dash-card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-base truncate" style={{ fontWeight: 650, color: "var(--dash-text)" }}>{inv.customer_name}</p>
                    <p className="text-sm truncate" style={{ color: "var(--dash-text-muted)" }}>{inv.customer_email}</p>
                  </div>
                  <p className="flex-shrink-0" style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--dash-text)" }}>{formatCurrency(inv.amount)}</p>
                </div>
                <div className="flex items-center justify-between text-sm" style={{ color: "var(--dash-text-muted)" }}>
                  <span>Due {formatDate(inv.due_date)}</span>
                  <span style={{ color: "var(--dash-green)", fontWeight: 600 }}>Paid {inv.paid_at ? formatDate(inv.paid_at) : "—"}</span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs" style={{ background: "var(--dash-green-soft)", color: "var(--dash-green)", fontWeight: 600 }}>Paid</span>
                  {confirmId === inv.id ? (
                    <span className="flex items-center gap-2">
                      <button onClick={() => confirmDelete(inv.id)} disabled={busyId === inv.id} className="text-xs" style={{ color: "var(--dash-red)", fontWeight: 600 }}>{busyId === inv.id ? "Deleting..." : "Confirm"}</button>
                      <button onClick={() => setConfirmId(null)} className="text-xs" style={{ color: "var(--dash-text-muted)", fontWeight: 600 }}>Cancel</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmId(inv.id)} aria-label="Delete" style={{ color: "var(--dash-text-soft)" }}>
                      <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  )}
                </div>
                <HistoryToggle open={openLogId === inv.id} onClick={() => toggleLog(inv.id)} />
                {openLogId === inv.id && <InvoiceActivityLog invoiceId={inv.id} />}
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block dash-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr style={{ background: "var(--dash-card-muted)", borderBottom: "1px solid var(--dash-border)" }}>
                  {["Customer", "Amount", "Original due", "Paid date", "Status", ""].map((h, i) => (
                    <th key={h} className={`${i === 5 ? "text-right" : "text-left"} px-6 py-3.5 text-xs uppercase`} style={{ color: "var(--dash-text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visiblePaid.map((inv, idx) => (
                  <Fragment key={inv.id}>
                  <tr style={{ borderTop: "1px solid var(--dash-border)" }}>
                    <td className="px-6 py-4">
                      <p className="text-base" style={{ fontWeight: 600, color: "var(--dash-text)" }}>{inv.customer_name}</p>
                      <p className="text-sm" style={{ color: "var(--dash-text-muted)" }}>{inv.customer_email}</p>
                      <div className="mt-1.5"><HistoryToggle open={openLogId === inv.id} onClick={() => toggleLog(inv.id)} /></div>
                    </td>
                    <td className="px-6 py-4"><span style={{ fontWeight: 700, fontSize: "1.05rem", color: "var(--dash-text)" }}>{formatCurrency(inv.amount)}</span></td>
                    <td className="px-6 py-4"><span className="text-sm" style={{ color: "var(--dash-text)" }}>{formatDate(inv.due_date)}</span></td>
                    <td className="px-6 py-4"><span className="text-sm" style={{ color: "var(--dash-green)", fontWeight: 600 }}>{inv.paid_at ? formatDate(inv.paid_at) : "—"}</span></td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs" style={{ background: "var(--dash-green-soft)", color: "var(--dash-green)", fontWeight: 600 }}>Paid</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end">
                        {confirmId === inv.id ? (
                          <span className="flex items-center gap-2">
                            <button onClick={() => confirmDelete(inv.id)} disabled={busyId === inv.id} className="text-sm" style={{ color: "var(--dash-red)", fontWeight: 600 }}>{busyId === inv.id ? "Deleting..." : "Confirm"}</button>
                            <button onClick={() => setConfirmId(null)} className="text-sm" style={{ color: "var(--dash-text-muted)", fontWeight: 600 }}>Cancel</button>
                          </span>
                        ) : (
                          <button onClick={() => setConfirmId(inv.id)} aria-label="Delete" className="opacity-60 hover:opacity-100 transition-opacity" style={{ color: "var(--dash-text-soft)" }}>
                            <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {openLogId === inv.id && (
                    <tr>
                      <td colSpan={6} className="px-6 pb-4">
                        <InvoiceActivityLog invoiceId={inv.id} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
