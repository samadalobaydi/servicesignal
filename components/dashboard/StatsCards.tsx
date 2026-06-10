import { formatCurrency } from "@/lib/invoices";

interface StatsCardsProps {
  totalUnpaid: number;
  overdueCount: number;
  remindersScheduled: number;
  paidThisMonth: number;
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accentColor: string;
  icon: React.ReactNode;
  alert?: boolean;
}

function StatCard({ label, value, sub, accentColor, icon, alert }: StatCardProps) {
  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-3 relative overflow-hidden"
      style={{
        background: "#0f1628",
        border: `1px solid ${alert ? "rgba(255,107,107,0.2)" : "rgba(255,255,255,0.06)"}`,
      }}
    >
      {/* Subtle top accent line */}
      <div
        className="absolute top-0 left-0 right-0 h-0.5"
        style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }}
      />

      <div className="flex items-start justify-between">
        <p className="text-xs font-display uppercase tracking-wider" style={{ color: "#64748b", fontWeight: 600, letterSpacing: "0.1em" }}>
          {label}
        </p>
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${accentColor}14`, border: `1px solid ${accentColor}28` }}
        >
          {icon}
        </div>
      </div>

      <div>
        <p
          className="font-display leading-none"
          style={{ fontSize: "1.9rem", fontWeight: 800, color: alert ? "#ff6b6b" : "#ffffff" }}
        >
          {value}
        </p>
        {sub && (
          <p className="text-xs mt-1" style={{ color: "#475569" }}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

export default function StatsCards({ totalUnpaid, overdueCount, remindersScheduled, paidThisMonth }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        label="Total Unpaid"
        value={formatCurrency(totalUnpaid)}
        sub="across all open invoices"
        accentColor="#ff6b6b"
        alert={totalUnpaid > 0}
        icon={
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
            <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="#ff6b6b" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        }
      />
      <StatCard
        label="Overdue"
        value={String(overdueCount)}
        sub={overdueCount === 1 ? "invoice past due date" : "invoices past due date"}
        accentColor="#ffbd2e"
        alert={overdueCount > 0}
        icon={
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
            <path d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#ffbd2e" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        }
      />
      <StatCard
        label="Reminders Set"
        value={String(remindersScheduled)}
        sub="across open invoices"
        accentColor="#00c8ff"
        icon={
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
            <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" stroke="#00c8ff" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        }
      />
      <StatCard
        label="Paid This Month"
        value={formatCurrency(paidThisMonth)}
        sub="collected so far"
        accentColor="#00e676"
        icon={
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="#00e676" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        }
      />
    </div>
  );
}
