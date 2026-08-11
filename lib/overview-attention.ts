import type { Invoice, ReminderLog } from "@/types";
import { scheduleToPrepare } from "./reminder-schedule";
import { getDaysOverdue, getInvoiceDueStatus } from "./date-status";

/**
 * What needs the owner's attention right now — ONE item per invoice.
 *
 * WHY THIS EXISTS
 *
 * The Overview previously built its attention list from three independent
 * counts: invoices needing a decision, reminders awaiting approval, and overdue
 * invoices. Those sets overlap, so a single overdue invoice with a prepared
 * reminder produced two bullets —
 *
 *     "1 reminder awaiting your approval"
 *     "1 overdue invoice to chase"
 *
 * — both linking to the same page, describing the same next action, for the
 * same invoice. Add the KPI row and the navigation cards and one invoice was
 * represented four times. A dashboard that inflates one job into four problems
 * is worse than one that says nothing.
 *
 * The fix is not better wording. It is deciding, per invoice, what the single
 * next action actually is, and saying only that.
 *
 * Pure and free of React so the precedence rules are unit-testable.
 */

export type AttentionKind =
  | "send_failed"
  | "reminder_ready"
  | "needs_decision"
  | "overdue_no_reminder";

export interface AttentionItem {
  invoiceId: string;
  kind: AttentionKind;
  customerName: string;
  invoiceReference: string | null;
  amount: number;
  /** Days past the due date. 0 when not yet overdue. */
  daysOverdue: number;
  /**
   * Live urgency context for the metadata line — "3 days overdue", "Due
   * today", or null.
   *
   * Null is deliberate and load-bearing. A failed send or a prepared reminder
   * can exist on an invoice that is not yet due (the `before_due_3_days`
   * checkpoint), and writing "0 days overdue" there would be a fabricated
   * state. When there is no honest urgency to report, the row says nothing.
   */
  urgencyLabel: string | null;
  /** The reminder this item is about, when there is one. */
  reminderId: string | null;
  /** Where the action button goes. Always a real destination. */
  href: string;
  /** The verb on the button. Never "View", "Manage" or "Open". */
  actionLabel: string;
}

/**
 * Precedence, most urgent first.
 *
 *   send_failed         something went wrong on a real send attempt. It sits
 *                       above everything because the owner believes a customer
 *                       was contacted and may not have been.
 *   reminder_ready      work is already done and waiting on one decision. This
 *                       outranks "overdue" deliberately: for an overdue invoice
 *                       WITH a prepared reminder, approving it IS the chase, so
 *                       telling the owner to also "chase" it would be the same
 *                       job twice.
 *   needs_decision      the schedule is exhausted or the invoice is escalated;
 *                       ServiceSignal has nothing left to prepare.
 *   overdue_no_reminder overdue with nothing prepared and a checkpoint reached,
 *                       so preparing one is the genuine next step.
 */
const PRECEDENCE: AttentionKind[] = [
  "send_failed",
  "reminder_ready",
  "needs_decision",
  "overdue_no_reminder",
];

/** Reminder states that mean a send attempt did not cleanly succeed. */
const UNRESOLVED_SEND = new Set(["failed", "delivery_unknown", "undelivered"]);

export interface AttentionInput {
  invoices: Invoice[];
  /** status = 'pending' — prepared and awaiting approval. */
  pendingReminders: ReminderLog[];
  /** Everything else: sent, dismissed, failed, delivery_unknown, undelivered. */
  reminderHistory: ReminderLog[];
  /** Invoice ids the dashboard has already classified as needing a decision. */
  needsDecisionInvoiceIds: Set<string>;
  now?: Date;
}

export function buildAttentionItems(input: AttentionInput): AttentionItem[] {
  const now = input.now ?? new Date();
  const items: AttentionItem[] = [];

  const pendingByInvoice = new Map<string, ReminderLog>();
  for (const r of input.pendingReminders) {
    if (!pendingByInvoice.has(r.invoice_id)) pendingByInvoice.set(r.invoice_id, r);
  }

  const unresolvedByInvoice = new Map<string, ReminderLog>();
  for (const r of input.reminderHistory) {
    if (UNRESOLVED_SEND.has(r.status) && !unresolvedByInvoice.has(r.invoice_id)) {
      unresolvedByInvoice.set(r.invoice_id, r);
    }
  }

  for (const invoice of input.invoices) {
    // A paid invoice is never an outstanding job, whatever else is attached to
    // it — marking paid is the kill switch for the whole lifecycle.
    if (invoice.status === "paid") continue;

    const daysOverdue = getDaysOverdue(invoice.due_date, now);
    const base = {
      invoiceId: invoice.id,
      customerName: invoice.customer_name,
      invoiceReference: invoice.invoice_reference ?? null,
      amount: invoice.amount,
      daysOverdue,
      urgencyLabel: urgencyFor(invoice.due_date, now),
    };

    const failed = unresolvedByInvoice.get(invoice.id);
    const pending = pendingByInvoice.get(invoice.id);

    // ── The precedence ladder. First match wins; there is no second item. ──
    if (failed) {
      items.push({
        ...base,
        kind: "send_failed",
        reminderId: failed.id,
        href: `/dashboard/reminders/${failed.id}/review`,
        actionLabel: "Resolve issue",
      });
      continue;
    }

    if (pending) {
      items.push({
        ...base,
        kind: "reminder_ready",
        reminderId: pending.id,
        // Straight to the reminder itself, not to the list it sits in. The
        // owner's next action is a decision about THIS message.
        href: `/dashboard/reminders/${pending.id}/review`,
        actionLabel: "Review reminders",
      });
      continue;
    }

    if (input.needsDecisionInvoiceIds.has(invoice.id)) {
      items.push({
        ...base,
        kind: "needs_decision",
        reminderId: null,
        href: "/dashboard/needs-action",
        actionLabel: "Choose next step",
      });
      continue;
    }

    // Overdue with nothing prepared. Only offered when a checkpoint has
    // genuinely been reached — otherwise "Prepare reminder" would be a button
    // the server refuses, which is worse than no button.
    const canPrepare = !!scheduleToPrepare(
      invoice.reminder_schedules ?? [],
      invoice.reminders_sent ?? [],
      invoice.due_date,
      now
    );

    if (daysOverdue > 0 && canPrepare) {
      items.push({
        ...base,
        kind: "overdue_no_reminder",
        reminderId: null,
        href: "/dashboard/chasing",
        actionLabel: "Prepare reminder",
      });
    }
  }

  // Most urgent kind first, then the most overdue, then the largest amount —
  // so the item most likely to cost the business money sits at the top.
  // ── THE RANKING RULE, IN ORDER ────────────────────────────────────────
  //
  //   1. Attention kind      — product urgency wins outright. A failed send
  //                            outranks a large overdue invoice, because the
  //                            two need different decisions and one is broken.
  //   2. Amount, descending  — among items needing the SAME decision, money is
  //                            what distinguishes them. A £150 invoice must not
  //                            sit above a £1,200 one when the choice is
  //                            identical; that was the previous behaviour.
  //   3. Days overdue, desc  — a genuine tiebreak for equal amounts.
  //
  // Deliberately three readable comparisons, not a weighted score: the owner
  // must be able to look at the list and understand why it is in this order.
  return items.sort((a, b) => {
    const byKind = PRECEDENCE.indexOf(a.kind) - PRECEDENCE.indexOf(b.kind);
    if (byKind !== 0) return byKind;
    if (b.amount !== a.amount) return b.amount - a.amount;
    return b.daysOverdue - a.daysOverdue;
  });
}

/**
 * Live urgency for the metadata line, derived from the due date against
 * today's Europe/London date — never from a schedule name, a reminder count or
 * anything stored. See lib/date-status.ts, the single source of truth.
 *
 *   overdue   → "1 day overdue" / "12 days overdue"
 *   due today → "Due today"
 *   upcoming  → null. "Due in 5 days" is not urgency; it is noise on a list
 *               whose entire purpose is things that need doing now.
 */
function urgencyFor(dueDateISO: string, now: Date): string | null {
  const status = getInvoiceDueStatus(dueDateISO, now);
  switch (status.kind) {
    case "overdue":
      return `${status.days} ${status.days === 1 ? "day" : "days"} overdue`;
    case "due_today":
      return "Due today";
    case "upcoming":
      return null;
  }
}

/** Plain-English description of the state, shown under the customer name. */
export function attentionDescription(item: AttentionItem): string {
  switch (item.kind) {
    case "send_failed":
      return "Last send attempt didn't complete";
    case "reminder_ready":
      // Both channels, named equally. Nothing here claims either has been sent.
      return "SMS and email reminders prepared";
    case "needs_decision":
      return "Reminder schedule finished — decide what happens next";
    case "overdue_no_reminder":
      // The day count lives in urgencyLabel on the metadata line above. It
      // used to be repeated here ("3 days overdue, no reminder prepared"),
      // which put the same number twice in one row.
      return "No reminder prepared yet";
  }
}

/** The short status word beside the customer. Paired with an icon, never colour alone. */
export function attentionTone(kind: AttentionKind): "red" | "amber" | "blue" {
  switch (kind) {
    case "send_failed": return "red";
    case "needs_decision": return "red";
    case "reminder_ready": return "blue";
    case "overdue_no_reminder": return "amber";
  }
}
