"use client";

import { useState } from "react";
import type { Invoice, InvoiceStatus, ReminderTone } from "@/types";

function fmt(n: number) {
  return `£${n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysOverdue(dueDate: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const diff = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
  return diff;
}

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; bg: string; color: string }> = {
  paid:    { label: "Paid",    bg: "rgba(0,230,118,0.1)",   color: "#00e676" },
  unpaid:  { label: "Unpaid",  bg: "rgba(0,200,255,0.1)",   color: "#00c8ff" },
  overdue: { label: "Overdue", bg: "rgba(255,107,107,0.1)", color: "#ff6b6b" },
};

const TONE_LABEL: Record<ReminderTone, string> = {
  friendly: "Friendly",
  firm:     "Firm",
  final:    "Final",
};

const SCHEDULE_LABEL: Record<string, string> = {
  "1_day":  "1d",
  "3_days": "3d",
  "7_days": "7d",
};

interface InvoiceListProps {
  invoices: Invoice[];
  onMarkPaid: (id: string) => void;
  onDelete: (id: string) => void;
  onAddClick: () => void;
}

type FilterStatus = "all" | InvoiceStatus;
type SortKey = "due_date" | "amount" | "customer_name" | "status";

export default function InvoiceList({ invoices, onMarkPaid, onDelete, onAddClick }: InvoiceListProps) {
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [sort, setSort] = useState<SortKey>("due_date");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filtered = invoices
    .filter((inv) => filter === "all" || inv.status === filter)
    .sort((a, b) => {
      if (sort === "due_date") return a.due_date.localeCompare(b.due_date);
      if (sort === "amount") return b.amount - a.amount;
      if (sort === "customer_name") return a.customer_name.localeCompare(b.customer_name);
      if (sort === "status") return a.status.localeCompare(b.status);
      return 0;
    });

  const filterButtons: { value: FilterStatus; label: string }[] = [
    { value: "all",     label: `All (${invoices.length})` },
    { value: "overdue", label: `Overdue (${invoices.filter((i) => i.status === "overdue").length})` },
    { value: "unpaid",  label: `Unpaid (${invoices.filter((i) => i.status === "unpaid").length})` },
    { value: "paid",    label: `Paid (${invoices.filter((i) => i.status === "paid").length})` },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-white" style={{ fontSize: "1.8rem", fontWeight: 800 }}>
            INVOICES
          </h1>
          <p className="text-[#64748b] text-sm">
            {invoices.length === 0 ? "No invoices yet" : `${invoices.length} invoice${invoices.length !== 1 ? "s" : ""} total`}
          </p>
        </div>
        <button onClick={onAddClick} className="btn-primary shrink-0" style={{ padding: "0.6rem 1.4rem", fontSize: "0.9rem" }}>
          + Add Invoice
        </button>
      </div>

      {/* Empty state */}
      {invoices.length === 0 && (
        <div
          className="rounded-xl p-12 text-center"
          style={{ background: "#0f1628", border: "1px solid rgba(0,200,255,0.08)" }}
        >
          <div
            className="w-14 h-14 rounded-xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: "rgba(0,200,255,0.08)", border: "1px solid rgba(0,200,255,0.15)" }}
          >
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="#00c8ff" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <h3 className="font-display text-white mb-2" style={{ fontSize: "1.2rem", fontWeight: 700 }}>
            No invoices yet
          </h3>
          <p className="text-[#64748b] text-sm mb-5">
            Add your first unpaid invoice to start tracking reminders.
          </p>
          <button onClick={onAddClick} className="btn-primary">
            Add Your First Invoice
          </button>
        </div>
      )}

      {/* Filters + sort */}
      {invoices.length > 0 && (
        <>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            {/* Filter pills */}
            <div className="flex gap-2 flex-wrap">
              {filterButtons.map((btn) => (
                <button
                  key={btn.value}
                  onClick={() => setFilter(btn.value)}
                  className="text-xs px-3 py-1.5 rounded-lg transition-all font-display"
                  style={{
                    fontWeight: 600,
                    background: filter === btn.value ? "rgba(0,200,255,0.12)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${filter === btn.value ? "rgba(0,200,255,0.3)" : "rgba(255,255,255,0.07)"}`,
                    color: filter === btn.value ? "#00c8ff" : "#64748b",
                  }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
            {/* Sort */}
            <div className="sm:ml-auto">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="form-input text-xs py-1.5"
                style={{ paddingTop: "0.375rem", paddingBottom: "0.375rem" }}
              >
                <option value="due_date">Sort: Due Date</option>
                <option value="amount">Sort: Amount</option>
                <option value="customer_name">Sort: Name</option>
                <option value="status">Sort: Status</option>
              </select>
            </div>
          </div>

          {/* No results after filter */}
          {filtered.length === 0 && (
            <div className="rounded-xl p-8 text-center" style={{ background: "#0f1628", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-[#64748b] text-sm">No invoices match this filter.</p>
            </div>
          )}

          {/* Desktop table */}
          {filtered.length > 0 && (
            <>
              <div className="hidden md:block rounded-xl overflow-hidden" style={{ border: "1px solid rgba(0,200,255,0.08)" }}>
                <table className="w-full text-sm" style={{ background: "#0f1628" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "#05080f" }}>
                      {["Customer", "Amount", "Due Date", "Status", "Reminders", "Actions"].map((h) => (
                        <th
                          key={h}
                          className="text-left px-4 py-3 text-xs font-display uppercase tracking-wider text-[#475569]"
                          style={{ fontWeight: 600, letterSpacing: "0.1em" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((inv, i) => {
                      const st = STATUS_CONFIG[inv.status];
                      const days = inv.status === "overdue" ? daysOverdue(inv.due_date) : null;
                      return (
                        <tr
                          key={inv.id}
                          style={{
                            borderBottom: i < filtered.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                            background: inv.status === "overdue" ? "rgba(255,107,107,0.02)" : "transparent",
                          }}
                        >
                          {/* Customer */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div
                                className="w-7 h-7 rounded-full flex items-center justify-center font-display text-xs flex-shrink-0"
                                style={{ background: "rgba(0,200,255,0.08)", color: "#00c8ff", fontWeight: 700 }}
                              >
                                {inv.customer_name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="text-white font-500 truncate">{inv.customer_name}</p>
                                <p className="text-[#475569] text-xs truncate">{inv.customer_email}</p>
                              </div>
                            </div>
                          </td>
                          {/* Amount */}
                          <td className="px-4 py-3 font-display font-700 text-white" style={{ fontWeight: 700 }}>
                            {fmt(inv.amount)}
                          </td>
                          {/* Due date */}
                          <td className="px-4 py-3">
                            <p className="text-white">{fmtDate(inv.due_date)}</p>
                            {days !== null && (
                              <p className="text-[#ff6b6b] text-xs">{days}d overdue</p>
                            )}
                          </td>
                          {/* Status */}
                          <td className="px-4 py-3">
                            <span
                              className="text-xs px-2.5 py-1 rounded-full font-display"
                              style={{ background: st.bg, color: st.color, fontWeight: 700 }}
                            >
                              {st.label}
                            </span>
                          </td>
                          {/* Reminders */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-[#64748b]">
                                {TONE_LABEL[inv.reminder_tone]} tone
                              </span>
                              <div className="flex gap-1">
                                {inv.reminder_schedules.map((s) => (
                                  <span
                                    key={s}
                                    className="text-[10px] px-1.5 py-0.5 rounded font-display"
                                    style={{
                                      background: inv.reminders_sent.includes(s) ? "rgba(0,230,118,0.12)" : "rgba(0,200,255,0.08)",
                                      color: inv.reminders_sent.includes(s) ? "#00e676" : "#00c8ff",
                                      fontWeight: 600,
                                    }}
                                  >
                                    {SCHEDULE_LABEL[s]}
                                    {inv.reminders_sent.includes(s) ? " ✓" : ""}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </td>
                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {inv.status !== "paid" && (
                                <button
                                  onClick={() => onMarkPaid(inv.id)}
                                  className="text-xs px-2.5 py-1.5 rounded-lg transition-all font-display"
                                  style={{
                                    background: "rgba(0,230,118,0.1)",
                                    border: "1px solid rgba(0,230,118,0.2)",
                                    color: "#00e676",
                                    fontWeight: 600,
                                  }}
                                >
                                  Mark Paid
                                </button>
                              )}
                              {deleteConfirm === inv.id ? (
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => { onDelete(inv.id); setDeleteConfirm(null); }}
                                    className="text-xs px-2 py-1.5 rounded-lg"
                                    style={{ background: "rgba(255,107,107,0.15)", color: "#ff6b6b", border: "1px solid rgba(255,107,107,0.25)" }}
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirm(null)}
                                    className="text-xs px-2 py-1.5 rounded-lg text-[#64748b]"
                                    style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setDeleteConfirm(inv.id)}
                                  className="p-1.5 rounded-lg transition-all text-[#475569] hover:text-[#ff6b6b]"
                                  title="Delete invoice"
                                >
                                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                                    <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {filtered.map((inv) => {
                  const st = STATUS_CONFIG[inv.status];
                  const days = inv.status === "overdue" ? daysOverdue(inv.due_date) : null;
                  return (
                    <div
                      key={inv.id}
                      className="rounded-xl p-4"
                      style={{
                        background: "#0f1628",
                        border: `1px solid ${inv.status === "overdue" ? "rgba(255,107,107,0.15)" : "rgba(0,200,255,0.08)"}`,
                      }}
                    >
                      {/* Top row */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center font-display text-sm flex-shrink-0"
                            style={{ background: "rgba(0,200,255,0.08)", color: "#00c8ff", fontWeight: 700 }}
                          >
                            {inv.customer_name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-white font-500 text-sm truncate">{inv.customer_name}</p>
                            <p className="text-[#475569] text-xs truncate">{inv.customer_email}</p>
                          </div>
                        </div>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-display flex-shrink-0"
                          style={{ background: st.bg, color: st.color, fontWeight: 700 }}
                        >
                          {st.label}
                        </span>
                      </div>

                      {/* Mid row */}
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-display font-800 text-white text-lg" style={{ fontWeight: 800 }}>
                            {fmt(inv.amount)}
                          </p>
                          <p className="text-[#64748b] text-xs">
                            Due {fmtDate(inv.due_date)}
                            {days !== null && <span className="text-[#ff6b6b] ml-1">({days}d overdue)</span>}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[#64748b] text-xs mb-1">{TONE_LABEL[inv.reminder_tone]} tone</p>
                          <div className="flex gap-1 justify-end">
                            {inv.reminder_schedules.map((s) => (
                              <span
                                key={s}
                                className="text-[10px] px-1.5 py-0.5 rounded font-display"
                                style={{
                                  background: inv.reminders_sent.includes(s) ? "rgba(0,230,118,0.12)" : "rgba(0,200,255,0.08)",
                                  color: inv.reminders_sent.includes(s) ? "#00e676" : "#00c8ff",
                                  fontWeight: 600,
                                }}
                              >
                                {SCHEDULE_LABEL[s]}{inv.reminders_sent.includes(s) ? " ✓" : ""}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-2">
                        {inv.status !== "paid" && (
                          <button
                            onClick={() => onMarkPaid(inv.id)}
                            className="flex-1 text-xs py-2 rounded-lg font-display transition-all"
                            style={{
                              background: "rgba(0,230,118,0.1)",
                              border: "1px solid rgba(0,230,118,0.2)",
                              color: "#00e676",
                              fontWeight: 700,
                            }}
                          >
                            ✓ Mark Paid
                          </button>
                        )}
                        {deleteConfirm === inv.id ? (
                          <div className="flex gap-1 flex-1">
                            <button
                              onClick={() => { onDelete(inv.id); setDeleteConfirm(null); }}
                              className="flex-1 text-xs py-2 rounded-lg"
                              style={{ background: "rgba(255,107,107,0.15)", color: "#ff6b6b", border: "1px solid rgba(255,107,107,0.25)" }}
                            >
                              Confirm Delete
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="text-xs px-3 py-2 rounded-lg text-[#64748b]"
                              style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(inv.id)}
                            className="text-xs px-3 py-2 rounded-lg text-[#475569] hover:text-[#ff6b6b] transition-colors"
                            style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
