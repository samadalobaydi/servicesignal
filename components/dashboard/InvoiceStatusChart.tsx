"use client";

import { useState } from "react";
import { useDashboard } from "./DashboardProvider";
import { formatCurrency } from "@/lib/invoices";
import { getTodayLondonDate } from "@/lib/date-status";

/**
 * Overview "Invoice Status" card — a compact pure-SVG donut (no chart
 * library) showing Paid / Overdue / Active for a selected month, with
 * month-by-month navigation. Built entirely from invoice data already
 * loaded by the dashboard provider.
 */

interface MonthKey {
  year: number;
  month: number; // 0-based
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function sameMonth(iso: string, key: MonthKey): boolean {
  const d = new Date(iso);
  return d.getUTCFullYear() === key.year && d.getUTCMonth() === key.month;
}

export default function InvoiceStatusChart() {
  const { liveInvoices } = useDashboard();

  const today = getTodayLondonDate();
  const currentKey: MonthKey = { year: today.getUTCFullYear(), month: today.getUTCMonth() };
  const [view, setView] = useState<MonthKey>(currentKey);

  const isCurrentMonth = view.year === currentKey.year && view.month === currentKey.month;

  const prevMonth = () =>
    setView((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }));
  const nextMonth = () => {
    if (isCurrentMonth) return; // never navigate beyond the current month
    setView((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }));
  };

  // ── Classification for the selected month (real data, no demo values) ──
  // Paid    = invoices marked paid in this month (by paid_at).
  // Overdue = unpaid invoices due this month that are past due today.
  // Active  = unpaid invoices due this month that are not overdue.
  let paidTotal = 0, overdueTotal = 0, activeTotal = 0;
  let paidCount = 0, overdueCount = 0, activeCount = 0;

  for (const inv of liveInvoices) {
    if (inv.status === "paid") {
      if (inv.paid_at && sameMonth(inv.paid_at, view)) {
        paidTotal += inv.amount; paidCount++;
      }
    } else if (sameMonth(inv.due_date, view)) {
      if (inv.status === "overdue") {
        overdueTotal += inv.amount; overdueCount++;
      } else {
        activeTotal += inv.amount; activeCount++;
      }
    }
  }

  const grandTotal = paidTotal + overdueTotal + activeTotal;
  const isEmpty = paidCount + overdueCount + activeCount === 0;

  // ── Donut geometry ──
  const R = 58;
  const C = 2 * Math.PI * R;
  const stroke = 24;
  const segments = [
    { value: paidTotal, color: "var(--dash-green)" },
    { value: overdueTotal, color: "var(--dash-red)" },
    { value: activeTotal, color: "var(--dash-amber)" },
  ].filter((s) => s.value > 0);

  let offsetAcc = 0;

  const pct = (v: number) => (grandTotal > 0 ? Math.round((v / grandTotal) * 100) : 0);

  const rows = [
    { label: "Paid", total: paidTotal, count: paidCount, pct: pct(paidTotal), color: "var(--dash-green)" },
    { label: "Overdue", total: overdueTotal, count: overdueCount, pct: pct(overdueTotal), color: "var(--dash-red)" },
    { label: "Active", total: activeTotal, count: activeCount, pct: pct(activeTotal), color: "var(--dash-amber)" },
  ];

  // One concise performance summary for the month.
  const summary =
    overdueTotal > 0
      ? `${formatCurrency(overdueTotal)} is currently overdue.`
      : activeTotal === 0 && paidTotal > 0
        ? "All invoices have been paid this month."
        : `${pct(paidTotal)}% of invoice value has been paid.`;

  return (
    <div className="dash-card p-6 h-full flex flex-col">
      {/* Title + month selector */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p style={{ fontSize: "1.05rem", fontWeight: 650, color: "var(--dash-text)" }}>Invoice Status</p>
        <div className="flex items-center gap-1">
          <button
            onClick={prevMonth}
            aria-label="Previous month"
            className="inline-flex items-center justify-center rounded-lg"
            style={{ width: 28, height: 28, background: "#ffffff", border: "1px solid var(--dash-border-strong)", color: "var(--dash-text-muted)" }}
          >
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span className="text-sm text-center" style={{ color: "var(--dash-text)", fontWeight: 600, minWidth: 110 }}>
            {MONTH_NAMES[view.month]} {view.year}
          </span>
          <button
            onClick={nextMonth}
            disabled={isCurrentMonth}
            aria-label="Next month"
            className="inline-flex items-center justify-center rounded-lg"
            style={{
              width: 28, height: 28, background: "#ffffff",
              border: "1px solid var(--dash-border-strong)",
              color: isCurrentMonth ? "var(--dash-border-strong)" : "var(--dash-text-muted)",
              cursor: isCurrentMonth ? "default" : "pointer",
            }}
          >
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>

      {isEmpty ? (
        <div className="flex-1 flex items-center justify-center py-10">
          <p className="text-sm" style={{ color: "var(--dash-text-muted)" }}>No invoice activity for this month.</p>
        </div>
      ) : (
        <>
          {/* Donut + breakdown, side by side */}
          <div className="flex flex-col sm:flex-row items-center gap-6 my-5 flex-1">
            <div className="relative flex-shrink-0" style={{ width: 190, height: 190 }}>
              <svg width="190" height="190" viewBox="0 0 150 150" role="img" aria-label={`Invoice status for ${MONTH_NAMES[view.month]} ${view.year}`}>
                {/* Track */}
                <circle cx="75" cy="75" r={R} fill="none" stroke="var(--dash-border)" strokeWidth={stroke} />
                {/* Segments */}
                {segments.map((seg, i) => {
                  const frac = seg.value / grandTotal;
                  const dash = frac * C;
                  const el = (
                    <circle
                      key={i}
                      cx="75" cy="75" r={R}
                      fill="none"
                      stroke={seg.color}
                      strokeWidth={stroke}
                      strokeDasharray={`${dash} ${C - dash}`}
                      strokeDashoffset={-offsetAcc}
                      transform="rotate(-90 75 75)"
                    />
                  );
                  offsetAcc += dash;
                  return el;
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p style={{ fontWeight: 700, fontSize: "1.25rem", color: "var(--dash-text)", letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                  {formatCurrency(grandTotal)}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--dash-text-soft)" }}>Total invoiced</p>
              </div>
            </div>

            {/* Breakdown beside the donut */}
            <div className="w-full space-y-3.5 min-w-0">
              {rows.map((r) => (
                <div key={r.label} className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: r.color }} />
                  <div className="min-w-0">
                    <p className="text-sm" style={{ color: "var(--dash-text)", fontWeight: 600 }}>{r.label}</p>
                    <p className="text-xs" style={{ color: "var(--dash-text-soft)" }}>
                      {r.count} {r.count === 1 ? "invoice" : "invoices"} · {r.pct}%
                    </p>
                  </div>
                  <span className="ml-auto text-sm whitespace-nowrap" style={{ color: "var(--dash-text)", fontWeight: 650 }}>
                    {formatCurrency(r.total)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* One-line performance summary */}
          <div
            className="rounded-lg px-4 py-2.5 mt-auto"
            style={{ background: "var(--dash-card-muted)", border: "1px solid var(--dash-border)" }}
          >
            <p className="text-sm" style={{ color: "var(--dash-text)", fontWeight: 500 }}>{summary}</p>
          </div>
        </>
      )}
    </div>
  );
}
