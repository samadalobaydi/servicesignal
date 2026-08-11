"use client";

import { useState, useEffect, Fragment } from "react";
import Link from "next/link";
import InvoiceRowMenu from "./InvoiceRowMenu";
import type { Invoice, ReminderLog } from "@/types";
import { formatCurrency, formatDate, daysOverdueLabel } from "@/lib/invoices";
import { getDueStatusLabel } from "@/lib/date-status";
import { prepareEligibility } from "@/lib/reminder-schedule";
import InvoiceActivityLog, { HistoryToggle } from "./InvoiceActivityLog";
import { useDashboard } from "./DashboardProvider";
import ChannelPickerModal from "./ChannelPickerModal";
import { dismissReminder } from "@/lib/reminders";

function reminderStateLabel(invoice: Invoice, hasPending: boolean): { text: string; color: string; pill?: boolean } {
  // "Ready for review", not "ready to send": the owner has not seen the
  // message yet, and the row no longer offers a way to send without doing so.
  if (hasPending) return { text: "Ready for review", color: "var(--dash-amber)", pill: true };
  const sentCount = invoice.reminders_sent?.length ?? 0;
  const total = invoice.reminder_schedules?.length ?? 0;
  if (total === 0) return { text: "No reminders set", color: "var(--dash-text-muted)" };
  const eligibility = prepareEligibility(invoice.reminder_schedules, invoice.reminders_sent ?? [], invoice.due_date);
  const canPrepare = !!eligibility.schedule;
  if (sentCount === 0 && canPrepare) return { text: "Ready to chase", color: "var(--dash-accent-strong)" };
  if (canPrepare) return { text: `${sentCount} of ${total} reminders sent`, color: "var(--dash-accent-strong)" };
  // Not eligible yet is NOT the same as finished — before the stricter
  // eligibility rule this branch mislabelled a future invoice "All reminders
  // sent". Say when the first reminder becomes available instead.
  if (eligibility.blockedReason === "not_yet_due" && eligibility.eligibleFrom) {
    return { text: `First reminder from ${formatDate(eligibility.eligibleFrom)}`, color: "var(--dash-text-muted)" };
  }
  return { text: "All reminders sent", color: "var(--dash-green)" };
}

function StatusBadge({ status }: { status: Invoice["status"] }) {
  const map = {
    overdue: { label: "Overdue", bg: "var(--dash-red-soft)", color: "var(--dash-red)" },
    unpaid:  { label: "Unpaid",  bg: "var(--dash-accent-soft)", color: "var(--dash-accent-strong)" },
    paid:    { label: "Paid",    bg: "var(--dash-green-soft)", color: "var(--dash-green)" },
  };
  const c = map[status];
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs" style={{ background: c.bg, color: c.color, fontWeight: 600 }}>
      {c.label}
    </span>
  );
}

interface ActiveChasingListProps {
  invoices: Invoice[];
  pendingReminderInvoiceIds: Set<string>;
  onPrepareReminder: (invoiceId: string) => Promise<{ success: boolean; message: string }>;
  onMarkPaid: (id: string) => void;
  /** invoice_id → every reminder_logs.status, for delete/archive eligibility. */
  reminderStatusesByInvoice: Record<string, string[]>;
  onEditInvoice: (invoice: Invoice) => void;
  onDeleteInvoice: (invoice: Invoice) => Promise<boolean>;
  onArchiveInvoice: (invoice: Invoice) => Promise<boolean>;
}

function ChaseRowAction({ invoice, hasPending, pendingReminder, onRequestPrepare, onMarkPaid, onAfterAction, menu }: {
  menu?: React.ReactNode;
  invoice: Invoice;
  hasPending: boolean;
  pendingReminder: ReminderLog | null;
  onRequestPrepare: () => void;
  onMarkPaid: (id: string) => void;
  onAfterAction: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ title: string; detail?: string } | null>(null);
  const canPrepare = !!prepareEligibility(invoice.reminder_schedules ?? [], invoice.reminders_sent ?? [], invoice.due_date).schedule;

  // Whenever the row's active reminder changes or disappears (dismissed,
  // sent, refetched, or a new one prepared), any old row-level error is
  // stale by definition — clear it so it can't outlive the state it
  // described. This also covers the "back to Ready to chase" case.
  const pendingId = pendingReminder?.id ?? null;
  useEffect(() => {
    setNote(null);
  }, [pendingId]);

  // Final gate: technical stale-state messages are never user-facing.
  const STALE_TEXT = /already\s+(dismissed|failed|sent)/i;
  const noteVisible = note && !STALE_TEXT.test(note.title) && !STALE_TEXT.test(note.detail ?? "");

  /**
   * A 409 "already sent/dismissed" reply means our row state is stale (the
   * reminder changed elsewhere, e.g. via Overview). Resync silently instead
   * of showing a confusing blocked message.
   */
  const isStale = (message: string) => message.toLowerCase().includes("already");

  // sendNow() has been REMOVED. This row previously called approveReminder()
  // directly, which sent a real email to a real customer from a single click
  // without the owner ever seeing the message. Sending now lives only on
  // /dashboard/reminders/[id]/review, beside the content it will send.
  //
  // dismiss() stays: discarding a reminder sends nothing, and forcing a page
  // navigation to throw something away would be friction with no safety gain.
  const dismiss = async () => {
    if (!pendingReminder) return;
    setBusy(true); setNote(null);
    const r = await dismissReminder(pendingReminder.id);
    if (r.success || isStale(r.message)) {
      setNote(null);
      await onAfterAction();          // row resets to "Ready to chase" / Prepare Reminder
    } else {
      setNote({ title: r.message });
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2 justify-end">
        {!hasPending && canPrepare && (
          <button onClick={onRequestPrepare} disabled={busy} className="dash-btn whitespace-nowrap" style={{ padding: "0.5rem 0.9rem", opacity: busy ? 0.6 : 1 }}>
            Prepare Reminder
          </button>
        )}
        {hasPending && pendingReminder && (
          <>
            {/* A LINK, not a button with a handler. It navigates and sends
                nothing, so it is safe to middle-click or open in a new tab. */}
            <Link
              href={`/dashboard/reminders/${pendingReminder.id}/review`}
              className="dash-btn whitespace-nowrap"
              style={{ padding: "0.5rem 0.9rem" }}
            >
              Review reminder
            </Link>
            <button onClick={dismiss} disabled={busy} className="dash-btn-ghost whitespace-nowrap" style={{ padding: "0.5rem 0.9rem", opacity: busy ? 0.6 : 1 }}>
              Dismiss
            </button>
          </>
        )}
        <button onClick={() => onMarkPaid(invoice.id)} className="dash-btn-ghost whitespace-nowrap" style={{ padding: "0.5rem 0.9rem", color: "var(--dash-green)", borderColor: "#a7f3d0" }}>
          Mark Paid
        </button>
        {/* Management actions, far right and discreet — see InvoiceRowMenu. */}
        {menu}
      </div>
      {noteVisible && (
        <div
          className="w-full rounded-lg px-3 py-2 text-left"
          style={{ background: "var(--dash-red-soft)", border: "1px solid #fecaca" }}
        >
          <p className="text-xs" style={{ color: "var(--dash-red)", fontWeight: 600 }}>{note.title}</p>
          {note.detail && <p className="text-xs mt-0.5" style={{ color: "var(--dash-red)", opacity: 0.85 }}>{note.detail}</p>}
        </div>
      )}
    </div>
  );
}

export default function ActiveChasingList({
  invoices, pendingReminderInvoiceIds, onPrepareReminder, onMarkPaid,
  reminderStatusesByInvoice, onEditInvoice, onDeleteInvoice, onArchiveInvoice,
}: ActiveChasingListProps) {
  const [openLogId, setOpenLogId] = useState<string | null>(null);
  const toggleLog = (id: string) => setOpenLogId((cur) => (cur === id ? null : id));
  const { reminders, refetchAfterReminderAction } = useDashboard();
  const [pickerInvoice, setPickerInvoice] = useState<Invoice | null>(null);
  // Only a genuinely pending reminder controls the row's Send Now/Dismiss
  // state. Dismissed/failed/sent logs live in Invoice History only.
  const pendingFor = (invoiceId: string): ReminderLog | null =>
    reminders.find((r) => r.invoice_id === invoiceId && r.status === "pending") ?? null;
  const sorted = [...invoices].sort((a, b) => {
    if (a.status !== b.status) return a.status === "overdue" ? -1 : 1;
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  });

  if (sorted.length === 0) {
    return (
      <div className="dash-card p-12 text-center">
        <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: "var(--dash-green-soft)", color: "var(--dash-green)" }}>
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <p style={{ fontSize: "1.05rem", fontWeight: 650, color: "var(--dash-text)" }}>Nothing to chase right now</p>
        <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)" }}>All your active invoices are under control. New unpaid invoices appear here.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Mobile cards */}
      <div className="flex flex-col gap-3 md:hidden">
        {sorted.map((inv) => {
          const rs = reminderStateLabel(inv, pendingReminderInvoiceIds.has(inv.id));
          return (
            <div key={inv.id} className="dash-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base truncate" style={{ fontWeight: 650, color: "var(--dash-text)" }}>{inv.customer_name}</p>
                  <p className="text-sm truncate" style={{ color: "var(--dash-text-muted)" }}>{inv.customer_email}</p>
                  {inv.payment_link && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--dash-accent-strong)", fontWeight: 500 }}>Payment link added</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--dash-text)" }}>{formatCurrency(inv.amount)}</p>
                  <StatusBadge status={inv.status} />
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: "var(--dash-text-muted)" }}>Due {formatDate(inv.due_date)}</span>
                <span style={{ fontWeight: 600, color: inv.status === "overdue" ? "var(--dash-red)" : "var(--dash-text-muted)" }}>{daysOverdueLabel(inv)}</span>
              </div>
              {rs.pill ? (
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs whitespace-nowrap self-start" style={{ background: "var(--dash-amber-soft)", color: "var(--dash-amber)", fontWeight: 600 }}>
                  {rs.text}
                </span>
              ) : (
                <p className="text-sm" style={{ color: rs.color, fontWeight: 600 }}>{rs.text}</p>
              )}
              <ChaseRowAction invoice={inv} hasPending={pendingReminderInvoiceIds.has(inv.id)} pendingReminder={pendingFor(inv.id)} onRequestPrepare={() => setPickerInvoice(inv)} onMarkPaid={onMarkPaid} onAfterAction={refetchAfterReminderAction} menu={
                <InvoiceRowMenu
                  invoice={inv}
                  reminderStatuses={reminderStatusesByInvoice[inv.id] ?? []}
                  onEdit={onEditInvoice}
                  onDelete={onDeleteInvoice}
                  onArchive={onArchiveInvoice}
                />
              } />
              <HistoryToggle open={openLogId === inv.id} onClick={() => toggleLog(inv.id)} />
              {openLogId === inv.id && <InvoiceActivityLog invoiceId={inv.id} />}
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block dash-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr style={{ background: "var(--dash-card-muted)", borderBottom: "1px solid var(--dash-border)" }}>
              {["Customer", "Amount", "Due", "Status", "Reminder state", ""].map((h, i) => (
                <th key={h} className={`${i === 5 ? "text-right" : "text-left"} px-6 py-3.5 text-xs uppercase`} style={{ color: "var(--dash-text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((inv) => {
              const rs = reminderStateLabel(inv, pendingReminderInvoiceIds.has(inv.id));
              return (
                <Fragment key={inv.id}>
                <tr style={{ borderTop: "1px solid var(--dash-border)" }}>
                  <td className="px-6 py-4">
                    <p className="text-base" style={{ fontWeight: 600, color: "var(--dash-text)" }}>{inv.customer_name}</p>
                    <p className="text-sm" style={{ color: "var(--dash-text-muted)" }}>{inv.customer_email}</p>
                    {inv.payment_link && (
                      <p className="text-xs mt-0.5" style={{ color: "var(--dash-accent-strong)", fontWeight: 500 }}>Payment link added</p>
                    )}
                  </td>
                  <td className="px-6 py-4"><span style={{ fontWeight: 700, fontSize: "1.05rem", color: "var(--dash-text)" }}>{formatCurrency(inv.amount)}</span></td>
                  <td className="px-6 py-4">
                    <p className="text-sm whitespace-nowrap" style={{ color: "var(--dash-text)" }}>{formatDate(inv.due_date)}</p>
                    <p className="text-sm whitespace-nowrap" style={{ fontWeight: 500, color: inv.status === "overdue" ? "var(--dash-red)" : "var(--dash-text-muted)" }}>{getDueStatusLabel(inv.due_date)}</p>
                  </td>
                  <td className="px-6 py-4"><StatusBadge status={inv.status} /></td>
                  <td className="px-6 py-4">
                    {rs.pill ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs whitespace-nowrap" style={{ background: "var(--dash-amber-soft)", color: "var(--dash-amber)", fontWeight: 600 }}>
                        {rs.text}
                      </span>
                    ) : (
                      <span className="text-sm" style={{ color: rs.color, fontWeight: 600 }}>{rs.text}</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 justify-end flex-nowrap">
                      <ChaseRowAction invoice={inv} hasPending={pendingReminderInvoiceIds.has(inv.id)} pendingReminder={pendingFor(inv.id)} onRequestPrepare={() => setPickerInvoice(inv)} onMarkPaid={onMarkPaid} onAfterAction={refetchAfterReminderAction} menu={
                <InvoiceRowMenu
                  invoice={inv}
                  reminderStatuses={reminderStatusesByInvoice[inv.id] ?? []}
                  onEdit={onEditInvoice}
                  onDelete={onDeleteInvoice}
                  onArchive={onArchiveInvoice}
                />
              } />
                      <HistoryToggle open={openLogId === inv.id} onClick={() => toggleLog(inv.id)} />
                    </div>
                  </td>
                </tr>
                {openLogId === inv.id && (
                  <tr>
                    <td colSpan={6} className="px-6 pb-4">
                      <InvoiceActivityLog invoiceId={inv.id} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Channel picker — email uses the existing prepare flow; SMS is preview-only */}
      {pickerInvoice && (
        <ChannelPickerModal
          invoice={pickerInvoice}
          onClose={() => setPickerInvoice(null)}
          onPrepareEmail={onPrepareReminder}
        />
      )}
    </div>
  );
}
