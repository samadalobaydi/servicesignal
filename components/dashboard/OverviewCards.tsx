interface Stats {
  totalUnpaid: number;
  overdueCount: number;
  remindersScheduled: number;
  paidThisMonth: number;
}

function fmt(n: number) {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accent: string;
  icon: React.ReactNode;
  urgent?: boolean;
}

function StatCard({ label, value, sub, accent, icon, urgent }: StatCardProps) {
  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-3"
      style={{
        background: "#0f1628",
        border: `1px solid ${urgent ? "rgba(255,107,107,0.2)" : "rgba(0,200,255,0.1)"}`,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-[#64748b] font-display uppercase tracking-wider" style={{ fontWeight: 600, letterSpacing: "0.1em" }}>
          {label}
        </span>
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: `${accent}18`, color: accent }}
        >
          {icon}
        </span>
      </div>
      <div>
        <p
          className="font-display text-white"
          style={{ fontSize: "1.9rem", fontWeight: 800, lineHeight: 1 }}
        >
          {value}
        </p>
        {sub && <p className="text-xs text-[#475569] mt-1">{sub}</p>}
      </div>
    </div>
  );
}

export default function OverviewCards({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        label="Total Unpaid"
        value={fmt(stats.totalUnpaid)}
        sub="across all open invoices"
        accent="#ff6b6b"
        urgent={stats.totalUnpaid > 0}
        icon={
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        }
      />
      <StatCard
        label="Overdue"
        value={String(stats.overdueCount)}
        sub={stats.overdueCount === 1 ? "invoice past due date" : "invoices past due date"}
        accent="#ffbd2e"
        urgent={stats.overdueCount > 0}
        icon={
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        }
      />
      <StatCard
        label="Reminders Queued"
        value={String(stats.remindersScheduled)}
        sub="scheduled across open invoices"
        accent="#00c8ff"
        icon={
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        }
      />
      <StatCard
        label="Paid This Month"
        value={fmt(stats.paidThisMonth)}
        sub="collected so far this month"
        accent="#00e676"
        icon={
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        }
      />
    </div>
  );
}
