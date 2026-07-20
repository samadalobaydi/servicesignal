"use client";

import { useState } from "react";
import type { Invoice } from "@/types";
import { useDashboard } from "@/components/dashboard/DashboardProvider";
import NeedsActionQueue from "@/components/dashboard/NeedsActionQueue";
import NextStepModal from "@/components/dashboard/NextStepModal";
import SummaryStrip, { type SummaryStat } from "@/components/dashboard/SummaryStrip";
import InvoiceSearchInput, { matchesInvoiceSearch, SearchEmptyState } from "@/components/dashboard/InvoiceSearchInput";
import { formatCurrency } from "@/lib/invoices";

export default function NeedsActionPage() {
  const {
    buckets, pendingReminderInvoiceIds, latestSentMap, latestActionMap,
    needsActionCount, handlePrepareReminder, refreshAll,
  } = useDashboard();
  const [actionInvoice, setActionInvoice] = useState<Invoice | null>(null);
  const [search, setSearch] = useState("");

  const items = buckets.needs_action;
  const visible = items.filter((inv) => matchesInvoiceSearch(inv, search));
  const searching = search.trim().length > 0;
  const totalValue = items.reduce((sum, inv) => sum + inv.amount, 0);
  const withHistory = items.filter((inv) => latestActionMap[inv.id]).length;

  const summary: SummaryStat[] = [
    {
      href: "/dashboard/needs-action", ariaLabel: "View invoices needing action",
      label: "Need action", value: String(items.length),
      hint: items.length === 1 ? "invoice flagged" : "invoices flagged",
      accent: items.length > 0 ? "var(--dash-red)" : "var(--dash-text)", iconBg: "var(--dash-red-soft)",
      icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    },
    {
      href: "/dashboard/needs-action", ariaLabel: "View value needing a decision",
      label: "Value needing decision", value: formatCurrency(totalValue),
      hint: "total outstanding",
      accent: "var(--dash-text)", iconBg: "var(--dash-card-muted)",
      icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
    },
    {
      href: "/dashboard/needs-action", ariaLabel: "View urgent invoices",
      label: "Urgent", value: String(needsActionCount),
      hint: "no payment after reminders",
      accent: needsActionCount > 0 ? "var(--dash-amber)" : "var(--dash-text)", iconBg: "var(--dash-amber-soft)",
      icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M13 7l5 5m0 0l-5 5m5-5H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    },
    {
      href: "/dashboard/needs-action", ariaLabel: "View actioned invoices",
      label: "Actioned", value: String(withHistory),
      hint: "have a logged update",
      accent: "var(--dash-green)", iconBg: "var(--dash-green-soft)",
      icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 style={{ fontSize: "1.85rem", fontWeight: 700, color: "var(--dash-text)", letterSpacing: "-0.02em" }}>
          Needs Action
        </h1>
        <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)" }}>
          Review invoices where automated reminders have run out. Each card shows what happened and what to do next.
        </p>
      </div>

      <InvoiceSearchInput value={search} onChange={setSearch} placeholder="Search invoices needing action..." />

      {items.length > 0 && <SummaryStrip stats={summary} />}

      {searching && visible.length === 0 ? (
        <SearchEmptyState />
      ) : (
        <NeedsActionQueue
          invoices={visible}
          pendingReminderInvoiceIds={pendingReminderInvoiceIds}
          latestSentMap={latestSentMap}
          latestActionMap={latestActionMap}
          onChooseAction={setActionInvoice}
        />
      )}

      {actionInvoice && (
        <NextStepModal
          invoice={actionInvoice}
          onClose={() => setActionInvoice(null)}
          onActionRecorded={refreshAll}
          onPrepareReminder={handlePrepareReminder}
        />
      )}
    </div>
  );
}
