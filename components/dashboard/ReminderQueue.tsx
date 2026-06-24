"use client";

import { useState } from "react";
import type { ReminderLog, ReminderMode } from "@/types";
import { formatCurrency, formatDate, SCHEDULE_LABELS } from "@/lib/invoices";
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
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid rgba(255,189,46,0.2)", background: "#141a2b" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,189,46,0.04)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(255,189,46,0.1)", border: "1px solid rgba(255,189,46,0.25)" }}
          >
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="#ffbd2e" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h2 className="font-display text-white" style={{ fontWeight: 800, fontSize: "1rem", letterSpacing: "0.04em" }}>
              REMINDERS AWAITING APPROVAL
            </h2>
            <p className="text-xs" style={{ color: "#c2ccdb" }}>
              {visibleReminders.length} reminder{visibleReminders.length !== 1 ? "s" : ""} ready to send
              {reminderMode === "approval" && " — review and approve below"}
            </p>
          </div>
        </div>
        <span
          className="text-xs px-2.5 py-1 rounded font-display uppercase tracking-wide flex-shrink-0"
          style={{
            background: "rgba(255,189,46,0.1)",
            border: "1px solid rgba(255,189,46,0.25)",
            color: "#ffbd2e",
            fontWeight: 700,
            letterSpacing: "0.08em",
          }}
        >
          {reminderMode === "auto" ? "Auto Mode" : "Approval Mode"}
        </span>
      </div>

      {error && (
        <div
          className="px-5 py-2 text-xs"
          style={{ background: "rgba(255,107,107,0.08)", color: "#ff6b6b" }}
        >
          {error}
        </div>
      )}

      {/* Reminder rows */}
      <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
        {visibleReminders.map((r) => {
          const inv = r.invoice;
          const busy = busyId === r.id;
          return (
            <div
              key={r.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4"
              style={{ borderColor: "rgba(255,255,255,0.04)" }}
            >
              <div className="min-w-0">
                <p className="text-base text-white font-medium">
                  {inv?.customer_name ?? "Customer"}
                  {inv && (
                    <span className="ml-2" style={{ color: "#a3b0c4" }}>
                      {formatCurrency(inv.amount)}
                    </span>
                  )}
                </p>
                <p className="text-sm mt-1" style={{ color: "#a3b0c4" }}>
                  {SCHEDULE_LABELS[r.schedule]}
                  {inv && ` · Due ${formatDate(inv.due_date)}`}
                  {" · To "}{r.email_to}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleDismiss(r.id)}
                  disabled={busy}
                  className="px-3.5 py-2 rounded-lg text-sm font-display transition-colors"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#c2ccdb",
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  Dismiss
                </button>
                <button
                  onClick={() => handleApprove(r.id)}
                  disabled={busy}
                  className="px-3.5 py-2 rounded-lg text-sm font-display transition-colors"
                  style={{
                    background: "rgba(0,200,255,0.1)",
                    border: "1px solid rgba(0,200,255,0.25)",
                    color: "#00c8ff",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    opacity: busy ? 0.5 : 1,
                  }}
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
