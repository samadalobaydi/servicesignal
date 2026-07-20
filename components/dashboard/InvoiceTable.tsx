"use client";

import { useState } from "react";
import type { Invoice, EscalationStatus } from "@/types";
import {
  formatCurrency,
  formatDate,
  daysOverdueLabel,
  SCHEDULE_LABELS,
  refreshStatuses,
} from "@/lib/invoices";
import { scheduleToPrepare } from "@/lib/reminder-schedule";
import {
  computeLifecycleState,
  escalationStatusLabel,
  latestActionRowSummary,
  actionTypeColor,
  type InvoiceLifecycleState,
} from "@/lib/escalation";
import type { InvoiceAction } from "@/types";

interface InvoiceTableProps {
  invoices: Invoice[];
  onMarkPaid: (id: string) => void;
  onDelete: (id: string) => void;
  onPrepareReminder: (invoiceId: string) => Promise<{ success: boolean; message: string }>;
  pendingReminderInvoiceIds: Set<string>;
  latestSentMap: Record<string, string>;
  latestActionMap: Record<string, InvoiceAction>;
  onNextStep: (invoice: Invoice) => void;
}

function StatusBadge({ status }: { status: Invoice["status"] }) {
  const config = {
    paid:    { label: "Paid",    bg: "rgba(0,230,118,0.1)",   border: "rgba(0,230,118,0.25)",   color: "#00e676" },
    unpaid:  { label: "Unpaid",  bg: "rgba(0,200,255,0.08)",  border: "rgba(0,200,255,0.2)",    color: "#00c8ff" },
    overdue: { label: "Overdue", bg: "rgba(255,107,107,0.1)", border: "rgba(255,107,107,0.25)", color: "#ff6b6b" },
  }[status];

  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded font-display text-xs"
      style={{ background: config.bg, border: `1px solid ${config.border}`, color: config.color, fontWeight: 800, letterSpacing: "0.06em" }}
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
    <span className="text-xs font-display" style={{ color: config.color, fontWeight: 700 }}>
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
            className="text-xs px-2 py-1 rounded"
            title={sent ? `${SCHEDULE_LABELS[s]} — sent` : `${SCHEDULE_LABELS[s]} — pending`}
            style={{
              background: sent ? "rgba(0,230,118,0.14)" : "rgba(255,255,255,0.09)",
              border: `1px solid ${sent ? "rgba(0,230,118,0.32)" : "rgba(255,255,255,0.18)"}`,
              color: sent ? "#1aff8c" : "#aab6c8",
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 600,
            }}
          >
            {sent ? "✓" : "○"} {SCHEDULE_LABELS[s].replace(" overdue", "")}
          </span>
        );
      })}
    </div>
  );
}

/**
 * A small summary chip shown on the row when the invoice has a recorded
 * latest action (Call logged, Promised to pay, Disputed, etc.).
 */
function LatestActionChip({ action }: { action: InvoiceAction }) {
  const color = actionTypeColor(action.action_type);
  const summary = latestActionRowSummary(action.action_type);
  const when = new Date(action.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <div className="flex flex-col gap-0.5 items-start">
      <span
        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg"
        style={{ background: `${color}14`, border: `1px solid ${color}40`, color, fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        {summary}
      </span>
      {action.note && (
        <span className="text-sm" style={{ color: "#9aa7bd" }}>“{action.note}”</span>
      )}
      <span className="text-xs" style={{ color: "#7d8a9e" }}>{when}</span>
    </div>
  );
}

/**
 * Renders the right reminder/escalation action or status for an invoice row.
 * Covers every state so the user never hits a dead end. When a latest action
 * exists it is summarised directly on the row, with a secondary button to
 * view full history / add an update.
 */
function ReminderAction({
  invoice,
  hasPending,
  finalReminderSentAt,
  latestAction,
  onPrepare,
  onNextStep,
}: {
  invoice: Invoice;
  hasPending: boolean;
  finalReminderSentAt: string | null;
  latestAction: InvoiceAction | null;
  onPrepare: (invoiceId: string) => Promise<{ success: boolean; message: string }>;
  onNextStep: (invoice: Invoice) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (invoice.status === "paid") return null;

  const canPrepare = !!scheduleToPrepare(
    invoice.reminder_schedules ?? [],
    invoice.reminders_sent ?? [],
    invoice.due_date
  );

  const state: InvoiceLifecycleState = computeLifecycleState({
    invoice,
    hasPending,
    canPrepare,
    finalReminderSentAt,
  });

  const secondaryLabel = latestAction ? "Add Update" : "View History";

  // ── Explicit escalation states (user-set: promised/disputed/paused/written off) ──
  if (state === "promised" || state === "disputed" || state === "paused" || state === "written_off") {
    return (
      <div className="flex flex-col gap-1.5 items-start">
        {latestAction ? (
          <LatestActionChip action={latestAction} />
        ) : (
          <span
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg"
            style={(() => {
              const c: Record<EscalationStatus, string> = { active: "#9aa7bd", promised: "#00e676", disputed: "#ffbd2e", paused: "#9aa7bd", written_off: "#ff6b6b" };
              const color = c[invoice.escalation_status];
              return { background: `${color}14`, border: `1px solid ${color}40`, color, fontFamily: "'DM Sans', sans-serif", fontWeight: 600 };
            })()}
          >
            {escalationStatusLabel(invoice.escalation_status)}
          </span>
        )}
        <button
          onClick={() => onNextStep(invoice)}
          className="text-sm font-display transition-colors"
          style={{ color: "#9aa7bd", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: "2px" }}
        >
          {secondaryLabel}
        </button>
      </div>
    );
  }

  if (state === "has_pending") {
    return (
      <div className="flex flex-col gap-1.5 items-start">
        <span
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg"
          style={{ background: "rgba(255,189,46,0.08)", border: "1px solid rgba(255,189,46,0.25)", color: "#ffbd2e", fontFamily: "'DM Sans', sans-serif" }}
          title="A reminder for this invoice is waiting in the approval queue above"
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#ffbd2e" }} />
          Reminder ready — see queue above
        </span>
        {latestAction && <LatestActionChip action={latestAction} />}
      </div>
    );
  }

  if (state === "no_reminders_set") {
    return (
      <div className="flex flex-col gap-1.5 items-start">
        <span className="text-sm" style={{ color: "#9aa7bd" }}>No reminders set</span>
        {latestAction && <LatestActionChip action={latestAction} />}
      </div>
    );
  }

  if (state === "can_prepare") {
    const next = scheduleToPrepare(invoice.reminder_schedules, invoice.reminders_sent ?? [], invoice.due_date)!;
    const handlePrepare = async () => {
      setBusy(true);
      setNote(null);
      const result = await onPrepare(invoice.id);
      if (!result.success) setNote(result.message);
      setBusy(false);
    };
    return (
      <div className="flex flex-col gap-1.5 items-start">
        <button
          onClick={handlePrepare}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-display transition-colors whitespace-nowrap"
          style={{ background: "rgba(0,200,255,0.1)", border: "1px solid rgba(0,200,255,0.25)", color: "#00c8ff", fontWeight: 700, letterSpacing: "0.04em", opacity: busy ? 0.6 : 1 }}
          title={`Prepare a "${SCHEDULE_LABELS[next]}" reminder — it will appear in the approval queue, not send straight away`}
        >
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
            <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {busy ? "Preparing..." : "Prepare Reminder"}
        </button>
        {note && <span className="text-sm" style={{ color: "#c2ccdb" }}>{note}</span>}
        {latestAction && <LatestActionChip action={latestAction} />}
      </div>
    );
  }

  if (state === "waiting_after_final") {
    return (
      <div className="flex flex-col gap-1.5 items-start">
        {latestAction ? (
          <LatestActionChip action={latestAction} />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: "#00e676" }}>
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
              <path d="M5 13l4 4L19 7" stroke="#00e676" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Final reminder sent — waiting for payment
          </span>
        )}
        <button
          onClick={() => onNextStep(invoice)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-display transition-colors whitespace-nowrap"
          style={{ background: "rgba(0,200,255,0.1)", border: "1px solid rgba(0,200,255,0.25)", color: "#00c8ff", fontWeight: 700, letterSpacing: "0.04em" }}
        >
          {latestAction ? secondaryLabel : "Choose Action"}
        </button>
      </div>
    );
  }

  // state === "action_needed"
  return (
    <div className="flex flex-col gap-1.5 items-start">
      {latestAction ? (
        <LatestActionChip action={latestAction} />
      ) : (
        <span
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg"
          style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff6b6b", fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}
        >
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#ff6b6b" }} />
          No payment after final reminder
        </span>
      )}
      <button
        onClick={() => onNextStep(invoice)}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-display transition-colors whitespace-nowrap"
        style={{ background: "rgba(255,189,46,0.12)", border: "1px solid rgba(255,189,46,0.35)", color: "#ffbd2e", fontWeight: 700, letterSpacing: "0.04em" }}
      >
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
          <path d="M13 7l5 5m0 0l-5 5m5-5H6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {latestAction ? secondaryLabel : "Choose Action"}
      </button>
    </div>
  );
}

// ── Mobile card ──────────────────────────────────────────────────────────────
function InvoiceCard({ invoice, onMarkPaid, onDelete, onPrepareReminder, hasPending, finalReminderSentAt, latestAction, onNextStep }: {
  invoice: Invoice;
  onMarkPaid: (id: string) => void;
  onDelete: (id: string) => void;
  onPrepareReminder: (invoiceId: string) => Promise<{ success: boolean; message: string }>;
  hasPending: boolean;
  finalReminderSentAt: string | null;
  latestAction: InvoiceAction | null;
  onNextStep: (invoice: Invoice) => void;
}) {
  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{
        background: "#1c2436",
        border: `1px solid ${invoice.status === "overdue" ? "rgba(255,107,107,0.15)" : "rgba(255,255,255,0.10)"}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-white text-base truncate" style={{ fontWeight: 700 }}>
            {invoice.customer_name}
          </p>
          <p className="text-xs truncate" style={{ color: "#a3b0c4" }}>{invoice.customer_email}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-display text-white" style={{ fontWeight: 800, fontSize: "1.1rem" }}>
            {formatCurrency(invoice.amount)}
          </p>
          <StatusBadge status={invoice.status} />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs" style={{ color: "#a3b0c4" }}>
        <span>Due {formatDate(invoice.due_date)}</span>
        <span
          className="font-display"
          style={{ fontWeight: 600, color: invoice.status === "overdue" ? "#ff6b6b" : invoice.status === "paid" ? "#00e676" : "#c2ccdb" }}
        >
          {daysOverdueLabel(invoice)}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <ToneBadge tone={invoice.reminder_tone} />
        <span style={{ color: "#7d8a9e" }}>·</span>
        <ReminderPips invoice={invoice} />
      </div>

      {/* Reminder action / status */}
      <ReminderAction invoice={invoice} hasPending={hasPending} finalReminderSentAt={finalReminderSentAt} latestAction={latestAction} onPrepare={onPrepareReminder} onNextStep={onNextStep} />

      <div className="flex gap-2 pt-1">
        {invoice.status !== "paid" && (
          <button
            onClick={() => onMarkPaid(invoice.id)}
            className="flex-1 py-2.5 rounded-lg text-sm font-display font-700 transition-colors"
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
      <p className="text-sm mb-6" style={{ color: "#a3b0c4" }}>Add your first unpaid invoice to get started</p>
      <button onClick={onAdd} className="btn-primary" style={{ padding: "0.6rem 1.5rem", fontSize: "0.9rem" }}>
        Add Your First Invoice
      </button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function InvoiceTable({
  invoices,
  onMarkPaid,
  onDelete,
  onPrepareReminder,
  pendingReminderInvoiceIds,
  latestSentMap,
  latestActionMap,
  onNextStep,
}: InvoiceTableProps) {
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
          <InvoiceCard
            key={inv.id}
            invoice={inv}
            onMarkPaid={onMarkPaid}
            onDelete={onDelete}
            onPrepareReminder={onPrepareReminder}
            hasPending={pendingReminderInvoiceIds.has(inv.id)}
            finalReminderSentAt={latestSentMap[inv.id] ?? null}
            latestAction={latestActionMap[inv.id] ?? null}
            onNextStep={onNextStep}
          />
        ))}
      </div>

      {/* ── Desktop: table ── */}
      <div
        className="hidden md:block rounded-xl overflow-hidden"
        style={{ border: "1px solid rgba(255,255,255,0.10)" }}
      >
        <table className="w-full">
          <thead>
            <tr style={{ background: "#10162a", borderBottom: "1px solid rgba(255,255,255,0.10)" }}>
              {["Customer", "Amount", "Due Date", "Status", "Reminders", "Actions"].map((h) => (
                <th
                  key={h}
                  className="text-left px-5 py-3.5 font-display text-sm uppercase tracking-wide"
                  style={{ color: "#9aa7bd", fontWeight: 600, letterSpacing: "0.1em" }}
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
                  background: i % 2 === 0 ? "#1c2436" : "#1a2133",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                  borderLeft: inv.status === "overdue" ? "2px solid rgba(255,107,107,0.4)" : "2px solid transparent",
                }}
              >
                {/* Customer */}
                <td className="px-5 py-4">
                  <p className="text-base text-white font-medium">{inv.customer_name}</p>
                  <p className="text-sm" style={{ color: "#9aa7bd" }}>{inv.customer_email}</p>
                  {inv.customer_phone && (
                    <p className="text-sm" style={{ color: "#9aa7bd" }}>{inv.customer_phone}</p>
                  )}
                </td>

                {/* Amount */}
                <td className="px-5 py-4">
                  <p className="font-display text-white" style={{ fontWeight: 700, fontSize: "1.05rem" }}>
                    {formatCurrency(inv.amount)}
                  </p>
                </td>

                {/* Due date */}
                <td className="px-5 py-4">
                  <p className="text-sm" style={{ color: "#c2ccdb" }}>{formatDate(inv.due_date)}</p>
                  <p
                    className="text-xs font-display mt-0.5"
                    style={{
                      fontWeight: 600,
                      color: inv.status === "overdue" ? "#ff6b6b" : inv.status === "paid" ? "#00e676" : "#a3b0c4",
                    }}
                  >
                    {daysOverdueLabel(inv)}
                  </p>
                </td>

                {/* Status */}
                <td className="px-5 py-4">
                  <StatusBadge status={inv.status} />
                </td>

                {/* Reminders */}
                <td className="px-5 py-4">
                  <div className="flex items-center gap-1.5 mb-1">
                    <ToneBadge tone={inv.reminder_tone} />
                  </div>
                  <ReminderPips invoice={inv} />
                  <div className="mt-2">
                    <ReminderAction
                      invoice={inv}
                      hasPending={pendingReminderInvoiceIds.has(inv.id)}
                      finalReminderSentAt={latestSentMap[inv.id] ?? null}
                      latestAction={latestActionMap[inv.id] ?? null}
                      onPrepare={onPrepareReminder}
                      onNextStep={onNextStep}
                    />
                  </div>
                </td>

                {/* Actions */}
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    {inv.status !== "paid" && (
                      <button
                        onClick={() => onMarkPaid(inv.id)}
                        className="px-3.5 py-2 rounded-lg text-sm font-display transition-colors whitespace-nowrap"
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
                      <span className="text-xs" style={{ color: "#9aa7bd" }}>
                        {inv.paid_at ? `Paid ${formatDate(inv.paid_at)}` : "Paid"}
                      </span>
                    )}
                    <button
                      onClick={() => onDelete(inv.id)}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: "#9aa7bd" }}
                      title="Delete invoice"
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#ff6b6b")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#9aa7bd")}
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

      <p className="text-sm text-center mt-5" style={{ color: "#7d8a9e" }}>
        {sorted.length} invoice{sorted.length !== 1 ? "s" : ""} total
      </p>
    </div>
  );
}
