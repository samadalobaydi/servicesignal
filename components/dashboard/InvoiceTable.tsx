"use client";

import type { Invoice } from "@/types";
import {
  formatCurrency,
  formatDate,
  daysOverdueLabel,
  SCHEDULE_LABELS,
  refreshStatuses,
} from "@/lib/invoices";

interface InvoiceTableProps {
  invoices: Invoice[];
  onMarkPaid: (id: string) => void;
  onDelete: (id: string) => void;
}

function StatusBadge({ status }: { status: Invoice["status"] }) {
  const config = {
    paid:    { label: "Paid",    bg: "rgba(0,230,118,0.1)",   border: "rgba(0,230,118,0.25)",   color: "#00e676" },
    unpaid:  { label: "Unpaid",  bg: "rgba(0,200,255,0.08)",  border: "rgba(0,200,255,0.2)",    color: "#00c8ff" },
    overdue: { label: "Overdue", bg: "rgba(255,107,107,0.1)", border: "rgba(255,107,107,0.25)", color: "#ff6b6b" },
  }[status];

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded font-display text-xs"
      style={{ background: config.bg, border: `1px solid ${config.border}`, color: config.color, fontWeight: 700, letterSpacing: "0.06em" }}
    >
      {status === "overdue" && (
        <span className="w-1.5 h-1.5 rounded-full mr-1.5 flex-shrink-0 animate-pulse" style={{ background: "#ff6b6b" }} />
      )}
      {config.label.toUpperCase()}
    </span>
  );
}

function ToneBadge({ tone }: { tone: Invoice["reminder_tone"] }) {
  const config = {
    friendly: { label: "Friendly", color: "#00e676" },
    firm:     { label: "Firm",     color: "#00c8ff" },
    final:    { label: "Final",    color: "#ff6b6b" },
  }[tone];
  return (
    <span className="text-xs font-display" style={{ color: config.color, fontWeight: 600 }}>
      {config.label}
    </span>
  );
}

function ReminderPips({ invoice }: { invoice: Invoice }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {invoice.reminder_schedules.map((s) => {
        const sent = invoice.reminders_sent.includes(s);
        return (
          <span
            key={s}
            className="text-xs px-1.5 py-0.5 rounded"
            title={sent ? `${SCHEDULE_LABELS[s]} — sent` : `${SCHEDULE_LABELS[s]} — pending`}
            style={{
              background: sent ? "rgba(0,230,118,0.1)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${sent ? "rgba(0,230,118,0.25)" : "rgba(255,255,255,0.08)"}`,
              color: sent ? "#00e676" : "#475569",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {sent ? "✓" : "○"} {SCHEDULE_LABELS[s].replace(" overdue", "")}
          </span>
        );
      })}
    </div>
  );
}

// ── Mobile card ──────────────────────────────────────────────────────────────
function InvoiceCard({ invoice, onMarkPaid, onDelete }: {
  invoice: Invoice;
  onMarkPaid: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{
        background: "#0f1628",
        border: `1px solid ${invoice.status === "overdue" ? "rgba(255,107,107,0.15)" : "rgba(255,255,255,0.06)"}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-white text-base truncate" style={{ fontWeight: 700 }}>
            {invoice.customer_name}
          </p>
          <p className="text-xs truncate" style={{ color: "#64748b" }}>{invoice.customer_email}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-display text-white" style={{ fontWeight: 800, fontSize: "1.1rem" }}>
            {formatCurrency(invoice.amount)}
          </p>
          <StatusBadge status={invoice.status} />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs" style={{ color: "#64748b" }}>
        <span>Due {formatDate(invoice.due_date)}</span>
        <span
          className="font-display"
          style={{ fontWeight: 600, color: invoice.status === "overdue" ? "#ff6b6b" : invoice.status === "paid" ? "#00e676" : "#94a3b8" }}
        >
          {daysOverdueLabel(invoice)}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <ToneBadge tone={invoice.reminder_tone} />
        <span style={{ color: "#1e2d4f" }}>·</span>
        <ReminderPips invoice={invoice} />
      </div>

      <div className="flex gap-2 pt-1">
        {invoice.status !== "paid" && (
          <button
            onClick={() => onMarkPaid(invoice.id)}
            className="flex-1 py-2 rounded-lg text-xs font-display font-700 transition-colors"
            style={{ background: "rgba(0,230,118,0.1)", border: "1px solid rgba(0,230,118,0.2)", color: "#00e676", fontWeight: 700, letterSpacing: "0.06em" }}
          >
            MARK PAID
          </button>
        )}
        <button
          onClick={() => onDelete(invoice.id)}
          className="px-4 py-2 rounded-lg text-xs transition-colors"
          style={{ background: "rgba(255,107,107,0.06)", border: "1px solid rgba(255,107,107,0.12)", color: "#ff6b6b" }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="text-center py-16 px-4">
      <div
        className="w-14 h-14 rounded-xl mx-auto mb-4 flex items-center justify-center"
        style={{ background: "rgba(0,200,255,0.06)", border: "1px solid rgba(0,200,255,0.12)" }}
      >
        <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            stroke="#00c8ff" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <p className="font-display text-white text-xl mb-2" style={{ fontWeight: 700 }}>No invoices yet</p>
      <p className="text-sm mb-6" style={{ color: "#64748b" }}>Add your first unpaid invoice to get started</p>
      <button onClick={onAdd} className="btn-primary" style={{ padding: "0.6rem 1.5rem", fontSize: "0.9rem" }}>
        Add Your First Invoice
      </button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function InvoiceTable({ invoices, onMarkPaid, onDelete }: InvoiceTableProps) {
  const live = refreshStatuses(invoices);

  // Sort: overdue first, then unpaid, then paid; within each group newest first
  const sorted = [...live].sort((a, b) => {
    const order = { overdue: 0, unpaid: 1, paid: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  if (sorted.length === 0) return <EmptyState onAdd={() => {}} />;

  return (
    <div>
      {/* ── Mobile: card list ── */}
      <div className="flex flex-col gap-3 md:hidden">
        {sorted.map((inv) => (
          <InvoiceCard key={inv.id} invoice={inv} onMarkPaid={onMarkPaid} onDelete={onDelete} />
        ))}
      </div>

      {/* ── Desktop: table ── */}
      <div
        className="hidden md:block rounded-xl overflow-hidden"
        style={{ border: "1px solid rgba(255,255,255,0.06)" }}
      >
        <table className="w-full">
          <thead>
            <tr style={{ background: "#05080f", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              {["Customer", "Amount", "Due Date", "Status", "Reminders", "Actions"].map((h) => (
                <th
                  key={h}
                  className="text-left px-4 py-3 font-display text-xs uppercase tracking-wider"
                  style={{ color: "#475569", fontWeight: 600, letterSpacing: "0.1em" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((inv, i) => (
              <tr
                key={inv.id}
                style={{
                  background: i % 2 === 0 ? "#0f1628" : "#0b1020",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                  borderLeft: inv.status === "overdue" ? "2px solid rgba(255,107,107,0.4)" : "2px solid transparent",
                }}
              >
                {/* Customer */}
                <td className="px-4 py-3">
                  <p className="text-sm text-white font-medium">{inv.customer_name}</p>
                  <p className="text-xs" style={{ color: "#475569" }}>{inv.customer_email}</p>
                  {inv.customer_phone && (
                    <p className="text-xs" style={{ color: "#475569" }}>{inv.customer_phone}</p>
                  )}
                </td>

                {/* Amount */}
                <td className="px-4 py-3">
                  <p className="font-display text-white" style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                    {formatCurrency(inv.amount)}
                  </p>
                </td>

                {/* Due date */}
                <td className="px-4 py-3">
                  <p className="text-sm" style={{ color: "#94a3b8" }}>{formatDate(inv.due_date)}</p>
                  <p
                    className="text-xs font-display mt-0.5"
                    style={{
                      fontWeight: 600,
                      color: inv.status === "overdue" ? "#ff6b6b" : inv.status === "paid" ? "#00e676" : "#64748b",
                    }}
                  >
                    {daysOverdueLabel(inv)}
                  </p>
                </td>

                {/* Status */}
                <td className="px-4 py-3">
                  <StatusBadge status={inv.status} />
                </td>

                {/* Reminders */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <ToneBadge tone={inv.reminder_tone} />
                  </div>
                  <ReminderPips invoice={inv} />
                </td>

                {/* Actions */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {inv.status !== "paid" && (
                      <button
                        onClick={() => onMarkPaid(inv.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-display transition-colors whitespace-nowrap"
                        style={{
                          background: "rgba(0,230,118,0.08)",
                          border: "1px solid rgba(0,230,118,0.2)",
                          color: "#00e676",
                          fontWeight: 700,
                          letterSpacing: "0.06em",
                        }}
                      >
                        MARK PAID
                      </button>
                    )}
                    {inv.status === "paid" && (
                      <span className="text-xs" style={{ color: "#475569" }}>
                        {inv.paid_at ? `Paid ${formatDate(inv.paid_at)}` : "Paid"}
                      </span>
                    )}
                    <button
                      onClick={() => onDelete(inv.id)}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: "#475569" }}
                      title="Delete invoice"
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#ff6b6b")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#475569")}
                    >
                      <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-center mt-4" style={{ color: "#1e2d4f" }}>
        {sorted.length} invoice{sorted.length !== 1 ? "s" : ""} total
      </p>
    </div>
  );
}
