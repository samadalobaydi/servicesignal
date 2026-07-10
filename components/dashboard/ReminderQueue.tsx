"use client";

import { useState } from "react";
import type { ReminderLog, ReminderMode } from "@/types";
import { formatCurrency, formatDate, SCHEDULE_LABELS } from "@/lib/invoices";
import { getDueStatusLabel } from "@/lib/date-status";
import { approveReminder, dismissReminder } from "@/lib/reminders";

interface ReminderQueueProps {
  reminders: ReminderLog[];
  reminderMode: ReminderMode;
  onChanged: () => void; // re-fetch after approve/dismiss
}

export default function ReminderQueue({ reminders, reminderMode, onChanged }: ReminderQueueProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // IDs optimistically hidden the instant their action succeeds, before the
  // parent refetch lands — makes the row disappear with no perceived lag.
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);

  const visibleReminders = reminders.filter((r) => !hiddenIds.includes(r.id));

  if (visibleReminders.length === 0) return null;

  const handleApprove = async (id: string) => {
    setBusyId(id);
    setError(null);
    const result = await approveReminder(id);
    if (result.success) {
      setHiddenIds((prev) => [...prev, id]); // hide immediately
    } else {
      setError(result.message);
    }
    setBusyId(null);
    onChanged(); // parent refetches reminders + invoices to confirm state
  };

  const handleDismiss = async (id: string) => {
    setBusyId(id);
    setError(null);
    const result = await dismissReminder(id);
    if (result.success) {
      setHiddenIds((prev) => [...prev, id]); // hide immediately
    } else {
      setError(result.message);
    }
    setBusyId(null);
    onChanged();
  };

  return (
    <div className="dash-card overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-5"
        style={{ borderBottom: "1px solid var(--dash-border)", background: "var(--dash-amber-soft)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "#fef3c7", color: "var(--dash-amber)" }}
          >
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h2 style={{ fontWeight: 650, fontSize: "1.02rem", color: "var(--dash-text)" }}>
              Reminders Awaiting Approval
            </h2>
            <p className="text-sm" style={{ color: "var(--dash-text-muted)" }}>
              {visibleReminders.length} reminder{visibleReminders.length !== 1 ? "s" : ""} ready to send
              {reminderMode === "approval" && " — review and approve below"}
            </p>
          </div>
        </div>
        <span
          className="text-xs px-2.5 py-1 rounded-md flex-shrink-0"
          style={{
            background: "#fef3c7",
            color: "var(--dash-amber)",
            fontWeight: 600,
          }}
        >
          {reminderMode === "auto" ? "Auto Mode" : "Approval Mode"}
        </span>
      </div>

      {error && (
        <div
          className="px-6 py-2.5 text-sm"
          style={{ background: "var(--dash-red-soft)", color: "var(--dash-red)" }}
        >
          {error}
        </div>
      )}

      {/* Reminder rows */}
      <div>
        {visibleReminders.map((r) => {
          const inv = r.invoice;
          const busy = busyId === r.id;
          return (
            <div
              key={r.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4"
              style={{ borderTop: "1px solid var(--dash-border)" }}
            >
              <div className="min-w-0">
                <p className="text-base font-medium" style={{ color: "var(--dash-text)" }}>
                  {inv?.customer_name ?? "Customer"}
                  {inv && (
                    <span className="ml-2" style={{ color: "var(--dash-text-muted)" }}>
                      {formatCurrency(inv.amount)}
                    </span>
                  )}
                </p>
                <p className="text-sm mt-1" style={{ color: "var(--dash-text-muted)" }}>
                  {inv ? getDueStatusLabel(inv.due_date) : SCHEDULE_LABELS[r.schedule]}
                  {inv && ` · Due ${formatDate(inv.due_date)}`}
                  {" · To "}{r.email_to}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleDismiss(r.id)}
                  disabled={busy}
                  className="dash-btn-ghost"
                  style={{ opacity: busy ? 0.5 : 1, padding: "0.5rem 0.9rem" }}
                >
                  Dismiss
                </button>
                <button
                  onClick={() => handleApprove(r.id)}
                  disabled={busy}
                  className="dash-btn"
                  style={{ opacity: busy ? 0.5 : 1, padding: "0.5rem 0.9rem" }}
                >
                  {busy ? "..." : "Send Now"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
