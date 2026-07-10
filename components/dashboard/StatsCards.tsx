import Link from "next/link";
import { formatCurrency } from "@/lib/invoices";

interface StatsCardsProps {
  totalUnpaid: number;
  overdueCount: number;
  remindersScheduled: number;
  paidThisMonth: number;
  needsActionCount: number;
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accent: string;
  accentSoft: string;
  icon: React.ReactNode;
  href: string;
  ariaLabel: string;
}

function StatCard({ label, value, sub, accent, accentSoft, icon, href, ariaLabel }: StatCardProps) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="dash-card p-5 flex flex-col gap-3.5 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0ea5c4] cursor-pointer"
      style={{ textDecoration: "none" }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: "var(--dash-text-muted)", fontWeight: 500 }}>{label}</p>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: accentSoft, color: accent }}>
          {icon}
        </div>
      </div>
      <div>
        <p style={{ fontSize: "1.9rem", fontWeight: 700, color: "var(--dash-text)", letterSpacing: "-0.02em", lineHeight: 1 }}>
          {value}
        </p>
        {sub && <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-soft)" }}>{sub}</p>}
      </div>
    </Link>
  );
}

export default function StatsCards({ totalUnpaid, overdueCount, remindersScheduled, paidThisMonth, needsActionCount }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
      <StatCard
        href="/dashboard/chasing"
        ariaLabel="View active chasing invoices"
        label="Total Unpaid"
        value={formatCurrency(totalUnpaid)}
        sub="across all open invoices"
        accent="var(--dash-red)"
        accentSoft="var(--dash-red-soft)"
        icon={
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
            <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        }
      />
      <StatCard
        href="/dashboard/chasing"
        ariaLabel="View overdue invoices in active chasing"
        label="Overdue"
        value={String(overdueCount)}
        sub={overdueCount === 1 ? "invoice past due" : "invoices past due"}
        accent="var(--dash-amber)"
        accentSoft="var(--dash-amber-soft)"
        icon={
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
            <path d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        }
      />
      {needsActionCount > 0 ? (
        <StatCard
          href="/dashboard/needs-action"
          ariaLabel="View invoices needing action"
          label="Needs Action"
          value={String(needsActionCount)}
          sub={needsActionCount === 1 ? "invoice needs a step" : "invoices need a step"}
          accent="var(--dash-red)"
          accentSoft="var(--dash-red-soft)"
          icon={
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M13 7l5 5m0 0l-5 5m5-5H6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          }
        />
      ) : (
        <StatCard
          href="/dashboard/chasing"
          ariaLabel="View invoices with reminders set"
          label="Reminders Set"
          value={String(remindersScheduled)}
          sub="across open invoices"
          accent="var(--dash-accent)"
          accentSoft="var(--dash-accent-soft)"
          icon={
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          }
        />
      )}
      <StatCard
        href="/dashboard/paid"
        ariaLabel="View paid invoices"
        label="Paid This Month"
        value={formatCurrency(paidThisMonth)}
        sub="collected so far"
        accent="var(--dash-green)"
        accentSoft="var(--dash-green-soft)"
        icon={
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        }
      />
    </div>
  );
}
