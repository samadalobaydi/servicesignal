"use client";

import Link from "next/link";
import { useDashboard } from "@/components/dashboard/DashboardProvider";
import StatsCards from "@/components/dashboard/StatsCards";
import InvoiceStatusChart from "@/components/dashboard/InvoiceStatusChart";
import { formatCurrency } from "@/lib/invoices";
import { actionTypeLabel, actionTypeColor } from "@/lib/escalation";

export default function OverviewPage() {
  const {
    stats, needsActionCount, reminders, reminderHistory, buckets,
    latestActionMap, liveInvoices,
  } = useDashboard();

  const invoiceName = (invoiceId: string) =>
    liveInvoices.find((i) => i.id === invoiceId)?.customer_name ?? "Invoice";

  // ── Recent activity feed ────────────────────────────────────────────────
  // Built entirely from existing data: invoices (added / paid), reminder
  // logs (prepared / sent / dismissed / failed) and logged invoice actions.
  interface ActivityItem {
    key: string;
    when: string;       // ISO timestamp for sorting/display
    name: string;       // customer name
    label: string;      // friendly wording
    note?: string;
    color: string;      // dot colour
  }

  const feed: ActivityItem[] = [];

  for (const inv of liveInvoices) {
    feed.push({
      key: `inv-added-${inv.id}`, when: inv.created_at, name: inv.customer_name,
      label: "Invoice added", color: "var(--dash-accent-strong)",
    });
    if (inv.status === "paid" && inv.paid_at) {
      feed.push({
        key: `inv-paid-${inv.id}`, when: inv.paid_at, name: inv.customer_name,
        label: "Invoice marked paid — future reminders stopped", color: "var(--dash-green)",
      });
    }
  }

  for (const r of reminders) {
    feed.push({
      key: `rem-prep-${r.id}`, when: r.created_at, name: r.invoice?.customer_name ?? invoiceName(r.invoice_id),
      label: "Email reminder prepared", color: "var(--dash-accent-strong)",
    });
  }

  for (const r of reminderHistory) {
    const name = r.invoice?.customer_name ?? invoiceName(r.invoice_id);
    if (r.status === "sent") {
      feed.push({ key: `rem-sent-${r.id}`, when: r.sent_at ?? r.created_at, name, label: "Email reminder sent", color: "var(--dash-green)" });
    } else if (r.status === "dismissed") {
      feed.push({ key: `rem-dis-${r.id}`, when: r.created_at, name, label: "Reminder dismissed", color: "var(--dash-text-soft)" });
    } else if (r.status === "failed") {
      feed.push({ key: `rem-fail-${r.id}`, when: r.created_at, name, label: "Reminder failed to send", color: "var(--dash-red)" });
    }
  }

  for (const a of Object.values(latestActionMap)) {
    if (a.action_type === "marked_paid") continue; // covered by the invoice paid entry
    feed.push({
      key: `act-${a.id}`, when: a.created_at, name: invoiceName(a.invoice_id),
      label: actionTypeLabel(a.action_type), note: a.note ?? undefined,
      color: actionTypeColor(a.action_type),
    });
  }

  const recentActivity = feed
    .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
    .slice(0, 8);

  const chasingCount = buckets.chasing.length;
  const paidCount = buckets.paid.length;

  // Quick navigation cards
  const quickNav = [
    { href: "/dashboard/chasing", ariaLabel: "View active chasing invoices", label: "Active Chasing", desc: `${chasingCount} ${chasingCount === 1 ? "invoice" : "invoices"} to chase`, accent: "var(--dash-accent)", soft: "var(--dash-accent-soft)",
      icon: <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /> },
    { href: "/dashboard/needs-action", ariaLabel: "View invoices needing action", label: "Needs Action", desc: needsActionCount > 0 ? `${needsActionCount} need a decision` : "All clear", accent: "var(--dash-amber)", soft: "var(--dash-amber-soft)",
      icon: <path d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /> },
    { href: "/dashboard/paid", ariaLabel: "View paid invoices", label: "Paid Invoices", desc: `${paidCount} settled`, accent: "var(--dash-green)", soft: "var(--dash-green-soft)",
      icon: <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /> },
    { href: "/dashboard/settings", ariaLabel: "Open settings", label: "Settings", desc: "Business & reminders", accent: "var(--dash-text-muted)", soft: "var(--dash-card-muted)",
      icon: <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-2.82 1.17V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 003.6 15H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9.4 1.65 1.65 0 004.27 7.6l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6h.09A1.65 1.65 0 0011 3.09V3a2 2 0 114 0v.09a1.65 1.65 0 002.51 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /> },
  ];

  // "What needs attention" priorities
  const priorities: { text: string; href: string; tone: string }[] = [];
  if (needsActionCount > 0) priorities.push({ text: `${needsActionCount} ${needsActionCount === 1 ? "invoice needs" : "invoices need"} a decision`, href: "/dashboard/needs-action", tone: "var(--dash-red)" });
  if (reminders.length > 0) priorities.push({ text: `${reminders.length} ${reminders.length === 1 ? "reminder" : "reminders"} awaiting your approval`, href: "/dashboard/chasing", tone: "var(--dash-amber)" });
  if (stats.overdueCount > 0) priorities.push({ text: `${stats.overdueCount} overdue ${stats.overdueCount === 1 ? "invoice" : "invoices"} to chase`, href: "/dashboard/chasing", tone: "var(--dash-amber)" });

  return (
    <div className="space-y-8">
      <div>
        <h1 style={{ fontSize: "1.85rem", fontWeight: 700, color: "var(--dash-text)", letterSpacing: "-0.02em" }}>
          Overview
        </h1>
        <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)" }}>
          Here&apos;s what needs your attention today.
        </p>
      </div>

      <StatsCards
        totalUnpaid={stats.totalUnpaid}
        overdueCount={stats.overdueCount}
        remindersScheduled={stats.remindersScheduled}
        paidThisMonth={stats.paidThisMonth}
        needsActionCount={needsActionCount}
      />

      {/* What needs attention */}
      {priorities.length > 0 && (
        <div className="dash-card p-5">
          <p style={{ fontSize: "1.05rem", fontWeight: 650, color: "var(--dash-text)" }}>What needs attention</p>
          <div className="mt-3.5 space-y-2.5">
            {priorities.map((p, i) => (
              <Link key={i} href={p.href} className="flex items-center gap-3 group">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.tone }} />
                <span className="text-sm group-hover:underline" style={{ color: "var(--dash-text)", fontWeight: 500 }}>{p.text}</span>
                <svg className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" width="16" height="16" fill="none" viewBox="0 0 24 24" style={{ color: "var(--dash-text-soft)" }}>
                  <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quick navigation cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {quickNav.map((q) => (
          <Link key={q.href} href={q.href} aria-label={q.ariaLabel} className="dash-card p-5 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0ea5c4] cursor-pointer" style={{ textDecoration: "none" }}>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style={{ background: q.soft, color: q.accent }}>
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24">{q.icon}</svg>
            </div>
            <p style={{ fontSize: "0.95rem", fontWeight: 650, color: "var(--dash-text)" }}>{q.label}</p>
            <p className="text-sm mt-0.5" style={{ color: "var(--dash-text-muted)" }}>{q.desc}</p>
          </Link>
        ))}
      </div>

      {/* Invoice status chart + recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <InvoiceStatusChart />

        <div className="dash-card p-6">
          <div className="flex items-center justify-between mb-4">
            <p style={{ fontSize: "1.05rem", fontWeight: 650, color: "var(--dash-text)" }}>Recent Activity</p>
            {needsActionCount > 0 && (
              <Link href="/dashboard/needs-action" className="text-sm" style={{ color: "var(--dash-accent-strong)", fontWeight: 600 }}>
                View all →
              </Link>
            )}
          </div>
          {recentActivity.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--dash-text-soft)" }}>
              No activity logged yet. Actions you take on invoices will show up here.
            </p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {recentActivity.map((item) => (
                <div key={item.key} className="flex items-start gap-3">
                  <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: item.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm" style={{ color: "var(--dash-text)" }}>
                      <span style={{ fontWeight: 600 }}>{item.name}</span>
                      {" — "}{item.label}
                    </p>
                    {item.note && <p className="text-sm mt-0.5" style={{ color: "var(--dash-text-muted)" }}>&ldquo;{item.note}&rdquo;</p>}
                    <p className="text-xs mt-0.5" style={{ color: "var(--dash-text-soft)" }}>
                      {new Date(item.when).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
