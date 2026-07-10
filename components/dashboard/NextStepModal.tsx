"use client";

import { useState, useEffect } from "react";
import type { Invoice, InvoiceActionType, InvoiceAction } from "@/types";
import { formatCurrency, formatDate } from "@/lib/invoices";
import { actionTypeLabel } from "@/lib/escalation";
import { recordInvoiceAction, fetchInvoiceActions } from "@/lib/invoice-actions";

interface NextStepModalProps {
  invoice: Invoice;
  onClose: () => void;
  onActionRecorded: () => void; // parent refetches invoices/actions
  onPrepareReminder: (invoiceId: string) => Promise<{ success: boolean; message: string }>;
}

interface ActionChoice {
  type: InvoiceActionType;
  label: string;
  description: string;
  color: string;
  needsNote?: boolean;
}

const ACTION_CHOICES: ActionChoice[] = [
  { type: "call_logged",     label: "Log a call",            description: "Record that you called the customer", color: "#0891b2", needsNote: true },
  { type: "promised_to_pay", label: "Customer promised to pay", description: "Mark that they've agreed to pay", color: "#059669", needsNote: true },
  { type: "disputed",        label: "Invoice disputed",      description: "Customer is disputing this invoice", color: "#d97706", needsNote: true },
  { type: "final_notice",    label: "Send final notice",     description: "Prepare one more reminder in the approval queue", color: "#0891b2" },
  { type: "paused",          label: "Pause chasing",         description: "Stop chasing this invoice for now", color: "#64748b" },
  { type: "written_off",     label: "Mark as written off",   description: "Give up on collecting this invoice", color: "#dc2626", needsNote: true },
  { type: "marked_paid",     label: "Mark as paid",          description: "The customer has paid", color: "#059669" },
];

export default function NextStepModal({ invoice, onClose, onActionRecorded, onPrepareReminder }: NextStepModalProps) {
  const [selected, setSelected] = useState<ActionChoice | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<InvoiceAction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchInvoiceActions(invoice.id).then((actions) => {
      if (active) {
        setHistory(actions);
        setHistoryLoading(false);
      }
    });
    return () => { active = false; };
  }, [invoice.id]);

  const handleConfirm = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);

    const result = await recordInvoiceAction(invoice.id, selected.type, note || undefined);

    if (!result.success) {
      setError(result.message);
      setBusy(false);
      return;
    }

    // "Send final notice" also prepares a reminder through the existing flow
    if (selected.type === "final_notice") {
      await onPrepareReminder(invoice.id);
    }

    // Brief visible success confirmation, then close + refresh the row
    setBusy(false);
    setSaved(true);
    setTimeout(() => {
      onActionRecorded();
      onClose();
    }, 750);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(3px)" }}
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
        <div
          className="w-full max-w-lg rounded-2xl my-auto"
          style={{ background: "#ffffff", border: "1px solid var(--dash-border)", boxShadow: "var(--dash-shadow-lg)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--dash-border)" }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 style={{ fontWeight: 700, fontSize: "1.25rem", color: "var(--dash-text)", letterSpacing: "-0.01em" }}>
                  Choose next action
                </h3>
                <p className="text-sm mt-1" style={{ color: "var(--dash-text-muted)" }}>
                  {invoice.customer_name} · {formatCurrency(invoice.amount)} · due {formatDate(invoice.due_date)}
                </p>
              </div>
              <button onClick={onClose} className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity" style={{ color: "var(--dash-text-muted)" }}>
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          {/* Action choices */}
          <div className="px-6 py-5">
            <p className="text-xs uppercase mb-3" style={{ color: "var(--dash-text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>
              Choose an action
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ACTION_CHOICES.map((choice) => {
                const active = selected?.type === choice.type;
                return (
                  <button
                    key={choice.type}
                    onClick={() => { setSelected(choice); setNote(""); setError(null); }}
                    className="text-left p-3 rounded-xl border transition-all"
                    style={{
                      background: active ? `${choice.color}10` : "#ffffff",
                      borderColor: active ? choice.color : "var(--dash-border)",
                      boxShadow: active ? `0 0 0 1px ${choice.color}` : "none",
                    }}
                  >
                    <p className="text-sm" style={{ fontWeight: 650, color: active ? choice.color : "var(--dash-text)" }}>
                      {choice.label}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--dash-text-muted)", lineHeight: 1.4 }}>
                      {choice.description}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Optional note */}
            {selected?.needsNote && (
              <div className="mt-4">
                <label className="block text-sm mb-1.5" style={{ color: "var(--dash-text)", fontWeight: 600 }}>
                  Note (optional)
                </label>
                <textarea
                  className="dash-input w-full"
                  rows={2}
                  placeholder="Add any detail you want to remember…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  style={{ resize: "none" }}
                />
              </div>
            )}

            {error && (
              <div className="mt-3 rounded-lg px-4 py-2.5 text-sm" style={{ background: "var(--dash-red-soft)", border: "1px solid #fecaca", color: "var(--dash-red)" }}>
                {error}
              </div>
            )}

            <div className="flex gap-3 mt-5">
              <button onClick={onClose} className="dash-btn-ghost flex-1 justify-center">
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!selected || busy || saved}
                className="flex-1 justify-center"
                style={{
                  background: saved ? "var(--dash-green)" : selected ? "var(--dash-accent)" : "var(--dash-card-muted)",
                  color: saved || selected ? "#ffffff" : "var(--dash-text-soft)",
                  fontWeight: 600, fontSize: "0.9rem",
                  padding: "0.6rem 1.1rem", borderRadius: "9px", border: "none",
                  display: "inline-flex", alignItems: "center", gap: "0.4rem",
                  cursor: selected && !busy && !saved ? "pointer" : "default",
                  opacity: busy ? 0.7 : 1,
                }}
              >
                {saved ? "Saved ✓" : busy ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>

          {/* Activity history */}
          <div className="px-6 py-5" style={{ borderTop: "1px solid var(--dash-border)", background: "var(--dash-card-muted)", borderBottomLeftRadius: "16px", borderBottomRightRadius: "16px" }}>
            <p className="text-xs uppercase mb-3" style={{ color: "var(--dash-text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>
              Activity history
            </p>
            {historyLoading ? (
              <p className="text-sm" style={{ color: "var(--dash-text-soft)" }}>Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--dash-text-soft)" }}>No actions recorded yet.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {history.map((a) => (
                  <div key={a.id} className="flex items-start gap-2.5">
                    <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: "var(--dash-accent)" }} />
                    <div className="min-w-0">
                      <p className="text-sm" style={{ color: "var(--dash-text)", fontWeight: 500 }}>{actionTypeLabel(a.action_type)}</p>
                      {a.note && <p className="text-sm mt-0.5" style={{ color: "var(--dash-text-muted)" }}>{a.note}</p>}
                      <p className="text-xs mt-0.5" style={{ color: "var(--dash-text-soft)" }}>
                        {new Date(a.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
