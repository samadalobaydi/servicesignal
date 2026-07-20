import type { Invoice } from "@/types";
import OverviewCards from "./OverviewCards";

interface Stats {
  totalUnpaid: number;
  overdueCount: number;
  remindersScheduled: number;
  paidThisMonth: number;
}

function fmt(n: number) {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

interface OverviewTabProps {
  stats: Stats;
  invoices: Invoice[];
  onAddClick: () => void;
  onViewAll: () => void;
}

export default function OverviewTab({ stats, invoices, onAddClick, onViewAll }: OverviewTabProps) {
  const overdue = invoices.filter((i) => i.status === "overdue").sort((a, b) => a.due_date.localeCompare(b.due_date));
  const recent = invoices.slice(0, 5);

  return (
    <div className="space-y-8">
      {/* Page title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-white" style={{ fontSize: "1.8rem", fontWeight: 800 }}>
            OVERVIEW
          </h1>
          <p className="text-[#64748b] text-sm">Here's where your money stands right now.</p>
        </div>
        <button onClick={onAddClick} className="btn-primary shrink-0" style={{ padding: "0.6rem 1.4rem", fontSize: "0.9rem" }}>
          + Add Invoice
        </button>
      </div>

      {/* Stat cards */}
      <OverviewCards stats={stats} />

      {/* Overdue spotlight */}
      {overdue.length > 0 && (
        <div
          className="rounded-xl p-5"
          style={{ background: "rgba(255,107,107,0.04)", border: "1px solid rgba(255,107,107,0.15)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
              <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="#ff6b6b" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <p className="font-display text-[#ff6b6b] text-sm uppercase tracking-wider" style={{ fontWeight: 700, letterSpacing: "0.1em" }}>
              {overdue.length} Overdue Invoice{overdue.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="space-y-2">
            {overdue.slice(0, 4).map((inv) => {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const due = new Date(inv.due_date + "T00:00:00");
              const days = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
              return (
                <div
                  key={inv.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg"
                  style={{ background: "rgba(255,107,107,0.06)", border: "1px solid rgba(255,107,107,0.1)" }}
                >
                  <div>
                    <span className="text-white text-sm">{inv.customer_name}</span>
                    <span className="text-[#ff6b6b] text-xs ml-2">{days}d overdue</span>
                  </div>
                  <span className="font-display font-700 text-white" style={{ fontWeight: 700 }}>
                    {fmt(inv.amount)}
                  </span>
                </div>
              );
            })}
          </div>
          {overdue.length > 4 && (
            <button onClick={onViewAll} className="text-xs text-[#ff6b6b] mt-3 hover:underline">
              View all {overdue.length} overdue →
            </button>
          )}
        </div>
      )}

      {/* Empty state CTA */}
      {invoices.length === 0 && (
        <div
          className="rounded-xl p-10 text-center"
          style={{ background: "#0f1628", border: "1px dashed rgba(0,200,255,0.15)" }}
        >
          <p className="font-display text-white mb-2" style={{ fontSize: "1.1rem", fontWeight: 700 }}>
            No invoices yet
          </p>
          <p className="text-[#64748b] text-sm mb-5">
            Add your first invoice to start tracking what you're owed.
          </p>
          <button onClick={onAddClick} className="btn-primary">
            Add Your First Invoice
          </button>
        </div>
      )}

      {/* Recent invoices */}
      {recent.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="font-display text-white text-sm uppercase tracking-wider" style={{ fontWeight: 700, letterSpacing: "0.1em" }}>
              Recent Invoices
            </p>
            <button onClick={onViewAll} className="text-xs text-[#00c8ff] hover:underline">
              View all →
            </button>
          </div>
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid rgba(0,200,255,0.08)" }}
          >
            {recent.map((inv, i) => {
              const statusColor = inv.status === "overdue" ? "#ff6b6b" : inv.status === "paid" ? "#00e676" : "#00c8ff";
              return (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 px-4 py-3"
                  style={{
                    background: i % 2 === 0 ? "#0f1628" : "#0a0e1a",
                    borderBottom: i < recent.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  }}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center font-display text-xs flex-shrink-0"
                    style={{ background: "rgba(0,200,255,0.08)", color: "#00c8ff", fontWeight: 700 }}
                  >
                    {inv.customer_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm truncate">{inv.customer_name}</p>
                    <p className="text-[#475569] text-xs">Due {fmtDate(inv.due_date)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-display font-700 text-white text-sm" style={{ fontWeight: 700 }}>
                      {fmt(inv.amount)}
                    </p>
                    <p className="text-xs capitalize" style={{ color: statusColor }}>
                      {inv.status}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
