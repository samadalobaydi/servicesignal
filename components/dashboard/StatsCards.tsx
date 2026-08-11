import Link from "next/link";
import { formatCurrency } from "@/lib/invoices";

interface StatsCardsProps {
  totalUnpaid: number;
  overdueCount: number;
  /**
   * Prepared reminder events currently waiting for the owner's approval.
   *
   * Replaces "Reminders Set", which summed reminder_schedules.length across
   * open invoices — a count of CONFIGURED CHECKPOINTS, not of anything that
   * exists. One invoice on the Standard plan contributed 3, so "Reminders Set:
   * 9" could mean three invoices and zero actual reminders. Nothing could be
   * done with the number.
   */
  awaitingApproval: number;
  paidThisMonth: number;
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

/**
 * The four Overview KPIs.
 *
 * FIXED SLOTS. The third card previously swapped between "Needs Action" and
 * "Reminders Set" depending on the data, so the row measured different things
 * on different days and could never be learned. Every slot now always shows the
 * same metric; a value of zero is itself information.
 */
export default function StatsCards({ totalUnpaid, overdueCount, awaitingApproval, paidThisMonth }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
      <StatCard
        href="/dashboard/chasing"
        ariaLabel="View active chasing invoices"
        label="Total unpaid"
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
      <StatCard
        href="/dashboard/chasing"
        ariaLabel="View reminders awaiting your approval"
        label="Awaiting approval"
        value={String(awaitingApproval)}
        sub={awaitingApproval === 1 ? "reminder ready to review" : "reminders ready to review"}
        accent="var(--dash-accent)"
        accentSoft="var(--dash-accent-soft)"
        icon={
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        }
      />
      {/* The heading is the metric; the supporting line carries the caveat.
          ServiceSignal does not process payments, hold money or watch a bank
          account — this total exists only because the owner marked those
          invoices paid themselves, so "marked paid by you" has to stay. Pass 1
          put "Marked paid" in the heading too, which said it twice and made
          the only long label in the row. */}
      <StatCard
        href="/dashboard/paid"
        ariaLabel="View invoices you have marked paid"
        label="Paid this month"
        value={formatCurrency(paidThisMonth)}
        sub="marked paid by you"
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
