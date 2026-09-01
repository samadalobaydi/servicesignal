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
import { dismissReminder } from "@/lib/reminders";
import { useBetaAllowance } from "./BetaAllowanceContext";
import { allowanceExhausted } from "@/lib/beta-allowance";
import { reminderStateLabel } from "@/lib/reminder-state-label";
import { statusBadgeFor } from "@/lib/status-badge";

function StatusBadge({ status }: { status: Invoice["status"] }) {
  const info = statusBadgeFor(status);
  if (!info) return null;
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs" style={{ background: info.bg, color: info.color, fontWeight: 600 }}>
      {info.label}
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
  /**
   * invoice_id → "Email sent · SMS failed". Optional so any caller that has not
   * been updated keeps exactly the pre-SMS rendering.
   */
  partialByInvoice?: Record<string, string>;
  onEditInvoice: (invoice: Invoice) => void;
  onDeleteInvoice: (invoice: Invoice) => Promise<boolean>;
  onArchiveInvoice: (invoice: Invoice) => Promise<boolean>;
}

function ChaseRowAction({ invoice, hasPending, pendingReminder, onPrepareReminder, onMarkPaid, onAfterAction, menu, allowanceSpent }: {
  allowanceSpent: boolean;
  menu?: React.ReactNode;
  invoice: Invoice;
  hasPending: boolean;
  pendingReminder: ReminderLog | null;
  onPrepareReminder: (invoiceId: string) => Promise<{ success: boolean; message: string }>;
  onMarkPaid: (id: string) => void;
  onAfterAction: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ title: string; detail?: string } | null>(null);
  // Guards Mark Paid against an accidental click — see markPaid() below.
  // Same shape as InvoiceRowMenu's confirming state: a plain boolean flip,
  // no new state model.
  const [confirmingPaid, setConfirmingPaid] = useState(false);
  const canPrepare = !!prepareEligibility(invoice.reminder_schedules ?? [], invoice.reminders_sent ?? [], invoice.due_date).schedule;

  // Escape closes it, matching InvoiceRowMenu's confirm step. Outside-click
  // is handled by the backdrop's own onClick below — a real modal, not an
  // anchored popover, so there is no ref-containment check to get wrong.
  useEffect(() => {
    if (!confirmingPaid) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setConfirmingPaid(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmingPaid]);

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
  // ── PREPARE CALLS THE ROUTE DIRECTLY — NO CHANNEL PICKER ────────────────
  //
  // A modal used to sit here ("Choose reminder channels" → "Preview
  // Reminder" → "Prepare Selected") offering a choice between Email-only and
  // Email+SMS. It was removed, not just relabelled: POST /api/reminders/
  // prepare has always created BOTH channel rows unconditionally — the
  // modal's selection was never wired to anything server-side, so choosing
  // "Email only" and choosing "Email + SMS" produced byte-identical results.
  // One founding-beta reminder is the SMS+email pair, and the product no
  // longer has a UI that suggests otherwise.
  const prepare = async () => {
    setBusy(true); setNote(null);
    const r = await onPrepareReminder(invoice.id);
    if (r.success) {
      setNote(null);
      await onAfterAction();
    } else {
      setNote({ title: r.message });
    }
    setBusy(false);
  };

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
    <div className="flex flex-col items-end gap-1.5 w-full">
      {/* Matches the cell above: one row from lg, compact wrap below it.
          Both levels must agree, or the outer stays rigid while the inner
          reflows and the alignment breaks. */}
      <div className="flex items-center gap-2 justify-end flex-wrap lg:flex-nowrap">
        {/* HIDDEN, not disabled. A greyed-out primary button invites a click
            and explains nothing; the row's state column already says
            "Reminder limit reached". Everything else on the row — Mark Paid,
            the lifecycle menu, history — stays exactly as it was, because the
            invoice itself is unaffected. */}
        {!hasPending && canPrepare && !allowanceSpent && (
          <button onClick={prepare} disabled={busy} className="dash-btn whitespace-nowrap" style={{ padding: "0.5rem 0.9rem", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Preparing…" : "Prepare Reminder"}
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
        {/* ── MARK PAID ────────────────────────────────────────────────────
            NEUTRAL, not green. Green is the colour of the RESULTING state
            (the Paid badge, the Paid Invoices page) — using it on the
            ACTION that produces that state made the button read as an
            outcome rather than a decision. dash-btn-ghost's own default
            (neutral grey, matching Dismiss) is used unmodified: no new
            colour introduced, no inline override needed.
            Guarded by a confirm step: this is a one-way lifecycle
            transition (see lib/invoice-lifecycle-service.ts), so a
            misclick here is not a free undo the way most row actions are. */}
        <button
          onClick={() => setConfirmingPaid(true)}
          className="dash-btn-ghost whitespace-nowrap"
          style={{ padding: "0.5rem 0.9rem" }}
        >
          Mark Paid
        </button>
        {confirmingPaid && (
          // A CENTRED MODAL, not an anchored popover. The popover version
          // (position: absolute; left: 0 off the button) rendered off the
          // right edge of the viewport whenever Mark Paid sat mid-row on a
          // real dashboard width — a fixed anchor cannot know how much room
          // is actually to its right, and a flip/shift calculation needs a
          // measured element a plain CSS rule can't provide. This is a
          // one-way lifecycle transition, consequential enough to warrant
          // the same centred-dialog treatment NextStepModal already uses
          // elsewhere in this dashboard — reused verbatim (fixed inset-0
          // backdrop + fixed inset-0 flex-center layer), so it is correct
          // at every viewport width by construction, not by a breakpoint
          // that only covers the widths someone thought to test.
          <>
            <div
              className="fixed inset-0 z-50"
              style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(3px)" }}
              onClick={() => setConfirmingPaid(false)}
            />
            <div
              className="fixed inset-0 z-50 flex items-center justify-center px-4"
              onClick={() => setConfirmingPaid(false)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Confirm mark paid"
                className="w-full max-w-sm rounded-2xl p-5"
                style={{ background: "#ffffff", border: "1px solid var(--dash-border)", boxShadow: "var(--dash-shadow-lg)" }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Names the customer AND the amount — the two facts that
                    make "are you sure" answerable at a glance, not just
                    "confirm this row". */}
                <p className="ss-markpaid-confirm-body">
                  Mark {invoice.customer_name}&rsquo;s {formatCurrency(invoice.amount)} invoice as paid?
                </p>
                <div className="ss-markpaid-confirm-actions">
                  <button
                    type="button"
                    className="dash-btn"
                    onClick={() => { setConfirmingPaid(false); onMarkPaid(invoice.id); }}
                  >
                    Mark Paid
                  </button>
                  <button
                    type="button"
                    className="dash-btn-ghost"
                    onClick={() => setConfirmingPaid(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
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
  reminderStatusesByInvoice, partialByInvoice = {}, onEditInvoice, onDeleteInvoice, onArchiveInvoice,
}: ActiveChasingListProps) {
  // ── IS THERE CAPACITY TO SEND ANOTHER REMINDER? ────────────────────────
  //
  // The SAME source the header indicator uses: the reminder_allowance_slots
  // ledger via BetaAllowanceContext, judged by the same allowanceExhausted().
  // No second definition of "10 reminders used".
  //
  // Null while the count is in flight, and null is treated as NOT spent — so
  // a slow read never hides a legitimate action. The server pre-flight and the
  // atomic send-time claim both sit behind this, so the cost of being briefly
  // optimistic here is at most one refused prepare.
  const allowance = useBetaAllowance();
  const allowanceSpent = allowance !== null && allowanceExhausted(allowance);

  const [openLogId, setOpenLogId] = useState<string | null>(null);
  const toggleLog = (id: string) => setOpenLogId((cur) => (cur === id ? null : id));
  const { reminders, refetchAfterReminderAction } = useDashboard();
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
          const rs = reminderStateLabel(inv, pendingReminderInvoiceIds.has(inv.id), allowanceSpent, partialByInvoice[inv.id] ?? null);
          return (
            <div key={inv.id} className="dash-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                {/* "Payment link added" used to live here as a bare hint with
                    no way to see or use the link. It now lives in the
                    expanded history panel, where the actual URL and a Copy
                    action are shown — see InvoiceActivityLog's
                    PaymentLinkBlock. */}
                <div className="min-w-0">
                  <p className="text-base truncate" style={{ fontWeight: 650, color: "var(--dash-text)" }}>{inv.customer_name}</p>
                  <p className="text-sm truncate" style={{ color: "var(--dash-text-muted)" }}>{inv.customer_email}</p>
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
              {/* ── ONLY ACTIONABLE/ABNORMAL STATES STAY ON THE ROW ──────────
                  Normal future scheduling (Ready to chase, X of Y sent, All
                  reminders sent, First reminder from...) no longer has its
                  own permanent slot — it lives in the expandable history
                  below as "Next reminder scheduled". rs.pill is exactly the
                  boundary: Partially sent / Ready for review / Reminder
                  limit reached are the states worth interrupting the row
                  for. */}
              {rs.pill && (
                <span className={`dash-state-pill dash-state-pill--${rs.tone ?? "amber"} self-start`}>
                  {rs.text}
                </span>
              )}
              {rs.pill && rs.detail && (
                <p className="text-xs mt-0.5" style={{ color: "var(--dash-text-muted)" }}>{rs.detail}</p>
              )}
              <ChaseRowAction allowanceSpent={allowanceSpent} invoice={inv} hasPending={pendingReminderInvoiceIds.has(inv.id)} pendingReminder={pendingFor(inv.id)} onPrepareReminder={onPrepareReminder} onMarkPaid={onMarkPaid} onAfterAction={refetchAfterReminderAction} menu={
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
      {/* NOT overflow-hidden.
          Two separate things were being clipped by it: the actions column when
          the row menu made that column wider than the space left over, and the
          row menu's own dropdown, which is position:absolute and cannot escape
          an ancestor's overflow clip no matter what its z-index is. A scroll
          container would fix the first and keep breaking the second, so the
          card no longer clips at all and the table is made to fit instead.
          The rounded corners the clip used to provide are applied to the
          header cells directly. */}
      <div className="hidden md:block dash-card">
        {/* table-fixed, so column widths come from the header rather than from
            each column's widest unbreakable word. Under the previous auto
            layout a single long customer email set a floor for the Customer
            column, the actions column asked for the width of five nowrap
            controls, and the sum simply exceeded the card. */}
        <table className="w-full table-fixed">
          <thead>
            <tr style={{ background: "var(--dash-card-muted)", borderBottom: "1px solid var(--dash-border)" }}>
              {[
                // Explicit widths, because table-fixed distributes by these.
                // The actions column is sized for its real contents — Review
                // reminder + Dismiss + Mark Paid + the menu — instead of
                // competing with the text columns for whatever is left.
                // ROOT CAUSE OF THE ACTION PILE: the actions column was
                // allocated 25%, but Review reminder + Dismiss + Mark Paid +
                // the menu need roughly 375px, and 25% of the 1160px content
                // width is 290. Wrapping then "solved" it by stacking, which
                // is why the row looked broken. The text columns are the ones
                // with slack — they truncate — so the width moves to actions.
                //
                // "Reminder state" is GONE — it was a permanent column for
                // information that is mostly normal future scheduling
                // ("Ready to chase", "3 of 5 sent"). That now lives in the
                // expandable history as "Next reminder scheduled". The
                // genuinely actionable/abnormal states (Partially sent,
                // Ready for review, Reminder limit reached) moved into the
                // actions cell itself, right above the buttons — see below.
                //
                // The FIRST column is new: a narrow, fixed-width disclosure
                // column, ahead of Customer. It previously lived stacked
                // under the customer name/email inside that cell — sharing
                // space with "Payment link added" and making the cell tall
                // and untidy. A conventional expandable-table-row layout
                // gives the toggle its own column instead.
                ["", "w-[4%]"], ["Customer", "w-[22%]"], ["Amount", "w-[9%]"], ["Due", "w-[13%]"],
                ["Status", "w-[9%]"], ["", "w-[43%]"],
              ].map(([h, w], i) => {
                // Padding built per-column rather than appended-and-overridden:
                // two Tailwind utility classes of equal specificity (px-6 vs
                // px-0) do not reliably override by className string order —
                // whichever rule Tailwind emitted later in the stylesheet wins,
                // not whichever appears later in the string. One padding class
                // per column avoids the conflict outright.
                const isDisclosure = i === 0;
                const isActions = i === 5;
                const padding = isDisclosure ? "px-0" : "px-6";
                const align = isActions ? "text-right" : isDisclosure ? "text-center" : "text-left";
                const corner = isDisclosure ? "rounded-tl-[14px]" : isActions ? "rounded-tr-[14px]" : "";
                return (
                  <th
                    key={h || `col-${i}`}
                    className={`${align} ${w} ${padding} py-3.5 text-xs uppercase ${corner}`}
                    style={{ color: "var(--dash-text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}
                  >
                    {isDisclosure ? <span className="sr-only">Expand row</span> : h}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((inv) => {
              const rs = reminderStateLabel(inv, pendingReminderInvoiceIds.has(inv.id), allowanceSpent, partialByInvoice[inv.id] ?? null);
              return (
                <Fragment key={inv.id}>
                <tr style={{ borderTop: "1px solid var(--dash-border)" }}>
                  {/* ── DISCLOSURE, ITS OWN COLUMN ──────────────────────────
                      A conventional expandable-table-row layout: the toggle
                      leads the row rather than stacking under the customer
                      name/email, where it previously competed with
                      "Payment link added" for the same cramped space. */}
                  <td className="px-0 py-4 text-center">
                    <div className="flex justify-center">
                      <HistoryToggle open={openLogId === inv.id} onClick={() => toggleLog(inv.id)} />
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {/* truncate + title: a long email is one unbreakable word,
                        so without this it would still force the column wide.
                        The full value stays available on hover. */}
                    <p className="text-base truncate" title={inv.customer_name} style={{ fontWeight: 600, color: "var(--dash-text)" }}>{inv.customer_name}</p>
                    <p className="text-sm truncate" title={inv.customer_email} style={{ color: "var(--dash-text-muted)" }}>{inv.customer_email}</p>
                    {/* "Payment link added" used to live here as a bare hint
                        with no way to see or use the link. It now lives in
                        the expanded history panel — see
                        InvoiceActivityLog's PaymentLinkBlock, which shows
                        the actual URL with a Copy action. */}
                  </td>
                  <td className="px-6 py-4"><span style={{ fontWeight: 700, fontSize: "1.05rem", color: "var(--dash-text)" }}>{formatCurrency(inv.amount)}</span></td>
                  <td className="px-6 py-4">
                    <p className="text-sm whitespace-nowrap" style={{ color: "var(--dash-text)" }}>{formatDate(inv.due_date)}</p>
                    <p className="text-sm whitespace-nowrap" style={{ fontWeight: 500, color: inv.status === "overdue" ? "var(--dash-red)" : "var(--dash-text-muted)" }}>{getDueStatusLabel(inv.due_date)}</p>
                  </td>
                  <td className="px-6 py-4"><StatusBadge status={inv.status} /></td>
                  {/* px-4, not px-6: 16px of the cell's own padding is worth
                      more to the buttons than to the gutter. */}
                  <td className="px-4 py-4">
                    {/* ── ONLY ACTIONABLE/ABNORMAL STATES SURFACE HERE ──────
                        Same rule as the mobile card: rs.pill is the boundary
                        between "the owner needs to know this right now"
                        (Partially sent, Ready for review, Reminder limit
                        reached) and normal future scheduling, which no
                        longer has a permanent column and lives in the
                        expandable history instead. */}
                    {rs.pill && (
                      <div className="flex justify-end mb-2">
                        <span className={`dash-state-pill dash-state-pill--${rs.tone ?? "amber"}`}>
                          {rs.text}
                        </span>
                      </div>
                    )}
                    {rs.pill && rs.detail && (
                      <p className="text-xs text-right mb-2" style={{ color: "var(--dash-text-muted)" }}>{rs.detail}</p>
                    )}
                    {/* ONE ROW at desktop.
                        `lg:flex-nowrap` is the real fix — with the column
                        widened above, all four controls fit on a single line
                        from 1024px up, which is where this table is actually
                        read. Below lg the table is only just wider than the
                        card breakpoint, so wrapping there is a deliberate
                        compact treatment rather than overflow recovery.
                        justify-end keeps a two-action row aligned with a
                        four-action row. */}
                    <div className="flex items-center gap-2 justify-end flex-wrap lg:flex-nowrap">
                      <ChaseRowAction allowanceSpent={allowanceSpent} invoice={inv} hasPending={pendingReminderInvoiceIds.has(inv.id)} pendingReminder={pendingFor(inv.id)} onPrepareReminder={onPrepareReminder} onMarkPaid={onMarkPaid} onAfterAction={refetchAfterReminderAction} menu={
                <InvoiceRowMenu
                  invoice={inv}
                  reminderStatuses={reminderStatusesByInvoice[inv.id] ?? []}
                  onEdit={onEditInvoice}
                  onDelete={onDeleteInvoice}
                  onArchive={onArchiveInvoice}
                />
              } />
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
    </div>
  );
}
