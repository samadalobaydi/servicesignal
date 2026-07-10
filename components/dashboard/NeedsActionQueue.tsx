"use client";

import { useState } from "react";
import type { Invoice, InvoiceAction } from "@/types";
import { formatCurrency, formatDate, daysOverdueLabel } from "@/lib/invoices";
import {
  computeLifecycleState,
  latestActionRowSummary,
  type InvoiceLifecycleState,
} from "@/lib/escalation";
import { scheduleToPrepare } from "@/lib/reminder-schedule";
import InvoiceActivityLog, { HistoryToggle } from "./InvoiceActivityLog";

function cardSummary(
  invoice: Invoice,
  state: InvoiceLifecycleState,
  latestAction: InvoiceAction | null
): { whatHappened: string; whatNeeded: string; accent: string; accentSoft: string } {
  const tones: Record<string, { accent: string; soft: string }> = {
    red:   { accent: "var(--dash-red)", soft: "var(--dash-red-soft)" },
    green: { accent: "var(--dash-green)", soft: "var(--dash-green-soft)" },
    amber: { accent: "var(--dash-amber)", soft: "var(--dash-amber-soft)" },
    grey:  { accent: "var(--dash-text-muted)", soft: "var(--dash-card-muted)" },
    blue:  { accent: "var(--dash-accent-strong)", soft: "var(--dash-accent-soft)" },
  };
  if (latestAction) {
    const map: Record<string, string> = {
      call_logged: "blue", promised_to_pay: "green", disputed: "amber",
      paused: "grey", final_notice: "blue", written_off: "red", marked_paid: "green",
    };
    const t = tones[map[latestAction.action_type] ?? "blue"];
    return {
      whatHappened: latestActionRowSummary(latestAction.action_type),
      whatNeeded: state === "action_needed" ? "Decide the next step" : "Review or update",
      accent: t.accent, accentSoft: t.soft,
    };
  }
  switch (state) {
    case "action_needed": return { whatHappened: "No payment after the final reminder", whatNeeded: "Choose how to escalate", accent: tones.red.accent, accentSoft: tones.red.soft };
    case "promised":      return { whatHappened: "Customer promised to pay", whatNeeded: "Follow up on the promise", accent: tones.green.accent, accentSoft: tones.green.soft };
    case "disputed":      return { whatHappened: "Invoice is disputed", whatNeeded: "Resolve the dispute", accent: tones.amber.accent, accentSoft: tones.amber.soft };
    case "paused":        return { whatHappened: "Chasing is paused", whatNeeded: "Resume when ready", accent: tones.grey.accent, accentSoft: tones.grey.soft };
    case "written_off":   return { whatHappened: "Invoice written off", whatNeeded: "Archived — reopen if needed", accent: tones.red.accent, accentSoft: tones.red.soft };
    default:              return { whatHappened: "Needs review", whatNeeded: "Choose an action", accent: tones.blue.accent, accentSoft: tones.blue.soft };
  }
}

interface NeedsActionQueueProps {
  invoices: Invoice[];
  pendingReminderInvoiceIds: Set<string>;
  latestSentMap: Record<string, string>;
  latestActionMap: Record<string, InvoiceAction>;
  onChooseAction: (invoice: Invoice) => void;
}

export default function NeedsActionQueue({
  invoices, pendingReminderInvoiceIds, latestSentMap, latestActionMap, onChooseAction,
}: NeedsActionQueueProps) {
  const [openLogId, setOpenLogId] = useState<string | null>(null);
  const toggleLog = (id: string) => setOpenLogId((cur) => (cur === id ? null : id));
  if (invoices.length === 0) {
    return (
      <div className="dash-card p-12 text-center">
        <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: "var(--dash-green-soft)", color: "var(--dash-green)" }}>
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <p style={{ fontSize: "1.05rem", fontWeight: 650, color: "var(--dash-text)" }}>Nothing needs action</p>
        <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)" }}>When an invoice runs out of reminders or gets flagged, it appears here as a clear next step.</p>
      </div>
    );
  }

  const order: Record<string, number> = { action_needed: 0, disputed: 1, promised: 2, paused: 3, written_off: 4 };
  const withState = invoices.map((inv) => {
    const canPrepare = !!scheduleToPrepare(inv.reminder_schedules ?? [], inv.reminders_sent ?? [], inv.due_date);
    const state = computeLifecycleState({
      invoice: inv,
      hasPending: pendingReminderInvoiceIds.has(inv.id),
      canPrepare,
      finalReminderSentAt: latestSentMap[inv.id] ?? null,
    });
    return { inv, state };
  }).sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));

  return (
    <div className={withState.length === 1 ? "grid grid-cols-1 max-w-xl gap-5" : "grid grid-cols-1 lg:grid-cols-2 gap-5"}>
      {withState.map(({ inv, state }) => {
        const latestAction = latestActionMap[inv.id] ?? null;
        const summary = cardSummary(inv, state, latestAction);
        const archived = state === "written_off";
        const urgent = state === "action_needed";
        return (
          <div
            key={inv.id}
            className="dash-card flex flex-col gap-4 p-5"
            style={{
              borderLeft: `3px solid ${summary.accent}`,
              opacity: archived ? 0.78 : 1,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p style={{ fontWeight: 650, fontSize: "1.1rem", color: "var(--dash-text)" }}>{inv.customer_name}</p>
                <p className="text-sm truncate" style={{ color: "var(--dash-text-muted)" }}>{inv.customer_email}</p>
                {inv.customer_phone && <p className="text-sm truncate" style={{ color: "var(--dash-text-soft)" }}>{inv.customer_phone}</p>}
              </div>
              <div className="text-right flex-shrink-0">
                <p style={{ fontWeight: 700, fontSize: "1.35rem", color: "var(--dash-text)", letterSpacing: "-0.01em" }}>{formatCurrency(inv.amount)}</p>
                <p className="text-sm" style={{ color: inv.status === "overdue" ? "var(--dash-red)" : "var(--dash-text-muted)", fontWeight: 500 }}>{daysOverdueLabel(inv)}</p>
              </div>
            </div>

            <div className="rounded-lg p-3.5" style={{ background: summary.accentSoft }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: summary.accent }} />
                <span className="text-xs uppercase" style={{ color: summary.accent, fontWeight: 600, letterSpacing: "0.05em" }}>What happened</span>
              </div>
              <p className="text-sm" style={{ color: "var(--dash-text)", fontWeight: 600 }}>{summary.whatHappened}</p>
              {latestAction?.note && <p className="text-sm mt-1" style={{ color: "var(--dash-text-muted)" }}>&ldquo;{latestAction.note}&rdquo;</p>}
              <p className="text-sm mt-2.5" style={{ color: "var(--dash-text-muted)" }}>
                <span style={{ color: summary.accent, fontWeight: 600 }}>Next:</span> {summary.whatNeeded}
              </p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm" style={{ color: "var(--dash-text-soft)" }}>Due {formatDate(inv.due_date)}</span>
              <button
                onClick={() => onChooseAction(inv)}
                className={urgent ? "dash-btn" : "dash-btn-ghost"}
                style={urgent
                  ? { padding: "0.55rem 1.1rem", background: "var(--dash-amber)" }
                  : { padding: "0.55rem 1.1rem", color: "var(--dash-accent-strong)", borderColor: "var(--dash-border-strong)" }}
              >
                {latestAction ? "Update Action" : "Choose Action"}
              </button>
            </div>
            <div className="self-start"><HistoryToggle open={openLogId === inv.id} onClick={() => toggleLog(inv.id)} /></div>
            {openLogId === inv.id && <InvoiceActivityLog invoiceId={inv.id} />}
          </div>
        );
      })}
    </div>
  );
}
