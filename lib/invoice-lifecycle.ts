import type { ReminderSendStatus } from "./reminder-send-state";
import { consumesAllowance } from "./beta-allowance";

/**
 * INVOICE LIFECYCLE — edit, delete, archive.
 *
 * Pure rules, no database, no React. Every destructive decision in the product
 * is made here and enforced twice: once by these functions on the server, and
 * once by a BEFORE DELETE trigger in migration 012 that does not trust them.
 *
 * ── THE AUDIT THAT SHAPED THIS ───────────────────────────────────────────
 *
 * The dependency chain hanging off one invoice:
 *
 *   invoices
 *     └── reminder_logs (invoice_id)              ← FK behaviour NOT visible
 *           ├── reminder_channel_messages          on delete cascade  (010)
 *           └── reminder_allowance_slots           on delete cascade  (011)
 *
 * The `invoices` and `reminder_logs` tables predate migration 003 and their
 * DDL is not in this repository, so the ON DELETE behaviour of
 * reminder_logs.invoice_id CANNOT be established from source. That single
 * unknown is the most dangerous fact in this feature:
 *
 *   IF it cascades  — deleting an invoice deletes its reminder_logs rows,
 *                     which cascades to reminder_allowance_slots, which
 *                     REFUNDS consumed Founding Beta allowance. Ten sends,
 *                     delete, ten more. The hard cap is gone.
 *   IF it does not  — the delete raises a foreign-key error for any invoice
 *                     that ever had a reminder.
 *
 * So nothing here relies on cascade in either direction. Eligibility is
 * decided explicitly, dependents are removed explicitly and in order, and the
 * database refuses an ineligible delete regardless of what the application
 * believes.
 */

/**
 * Reminder states that make an invoice permanently un-deletable.
 *
 * The three consuming states, because a slot exists and deleting the row would
 * hand the unit back — see beta-allowance.ts. Plus `sending`, which is not
 * consuming but IS in flight: a provider submission is happening right now,
 * and removing the invoice underneath it would destroy the row the send is
 * about to write its outcome to.
 */
export const UNDELETABLE_REMINDER_STATUSES: readonly ReminderSendStatus[] = [
  "sent",
  "delivery_unknown",
  "undelivered",
  "sending",
];

export function blocksDeletion(status: string): boolean {
  return (UNDELETABLE_REMINDER_STATUSES as readonly string[]).includes(status);
}

/** A reminder is dispatched history — archive territory, never deletable. */
export function isDispatched(status: string): boolean {
  return consumesAllowance(status);
}

/** Exactly one attempt is mid-flight. Everything is refused, briefly. */
export function isInFlight(statuses: readonly string[]): boolean {
  return statuses.includes("sending");
}

export type LifecycleAction = "delete" | "archive";

export interface InvoiceLifecycleFacts {
  /** Every reminder_logs.status for this invoice. */
  reminderStatuses: readonly string[];
  /** invoices.archived_at — migration 012. */
  archivedAt: string | null;
}

export type LifecycleDecision =
  | { allowed: true; action: LifecycleAction }
  | { allowed: false; reason: "in_flight" }
  | { allowed: false; reason: "already_archived" };

/**
 * Which removal action this invoice is eligible for.
 *
 * ONE of delete or archive, never both offered at once — a menu showing both
 * makes the customer decide a question the system already knows the answer to,
 * and the wrong answer is unrecoverable.
 *
 *   no dispatched reminder  → delete. Nothing was ever sent; there is no
 *                             history worth preserving and no allowance to
 *                             protect.
 *   any dispatched reminder → archive. A customer received something. That
 *                             record, and the allowance it consumed, outlive
 *                             the owner's wish to tidy their list.
 */
export function removalFor(facts: InvoiceLifecycleFacts): LifecycleDecision {
  if (isInFlight(facts.reminderStatuses)) return { allowed: false, reason: "in_flight" };
  if (facts.archivedAt) return { allowed: false, reason: "already_archived" };

  const dispatched = facts.reminderStatuses.some(isDispatched);
  return { allowed: true, action: dispatched ? "archive" : "delete" };
}

/** A hard delete is permitted only when NOTHING blocks it. */
export function canHardDelete(facts: InvoiceLifecycleFacts): boolean {
  return !facts.reminderStatuses.some(blocksDeletion);
}

// ── Editing ────────────────────────────────────────────────────────────────

/**
 * The invoice fields that appear inside generated reminder content.
 *
 * Changing any of these makes an unsent prepared reminder WRONG — it would go
 * out quoting a figure, a date, a name or a payment link the invoice no longer
 * says. Changing anything else (the tone, the schedule set) does not alter a
 * message that has already been composed.
 *
 * `customer_email` and `customer_phone` are here for a second reason as well:
 * they are the recipient targets. A stale prepared reminder would be delivered
 * to the OLD address after the owner corrected it.
 */
export const REMINDER_CONTENT_FIELDS = [
  "customer_name",
  "customer_email",
  "customer_phone",
  "invoice_reference",
  "job_description",
  "amount",
  "due_date",
  "payment_link",
] as const;

export type ReminderContentField = (typeof REMINDER_CONTENT_FIELDS)[number];

export interface EditableInvoiceSnapshot {
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  invoice_reference: string | null;
  job_description: string | null;
  amount: number;
  due_date: string;
  payment_link: string;
}

/** Which content-bearing fields actually changed. Empty means the message still matches. */
export function changedContentFields(
  before: EditableInvoiceSnapshot,
  after: EditableInvoiceSnapshot
): ReminderContentField[] {
  return REMINDER_CONTENT_FIELDS.filter((f) => {
    const a = before[f];
    const b = after[f];
    // null and "" both mean "not recorded" for the two nullable columns.
    return (a ?? "") !== (b ?? "");
  });
}

export type EditConsequence =
  /** Nothing prepared, or nothing that appears in a message changed. */
  | { kind: "none" }
  /** A pending reminder exists and will be regenerated from the new details. */
  | { kind: "refresh_pending"; reminderId: string; ownerEdited: boolean }
  /** A send is happening right now. The edit is refused. */
  | { kind: "in_flight" };

export interface PendingReminderFacts {
  id: string;
  status: string;
  /** True when the owner hand-edited the SMS or the email of this draft. */
  ownerEdited: boolean;
}

/**
 * What saving this edit will do to reminders.
 *
 * ── THE INVARIANT THIS PROTECTS ──────────────────────────────────────────
 *
 * A customer must never change £1,500 to £1,200 while an unsent, already
 * composed reminder still says £1,500, and then approve it. The reviewed-token
 * model would not catch this on its own: the token is minted against a content
 * hash, so an edit invalidates the review — but the reminder would simply be
 * RE-REVIEWED and sent still quoting the old figure, because the stored
 * channel content is the source of truth at send time and it was never
 * touched.
 *
 * So the rule is not "warn the owner", it is "the stale draft cannot survive".
 *
 *   dispatched reminders   untouched, always. Their stored content is history:
 *                          if it said £1,500 when it went out, it says £1,500
 *                          forever, whatever the invoice says now.
 *   pending reminder       regenerated from the updated invoice.
 *   owner-edited pending   ALSO regenerated, and the owner is told plainly
 *                          that their wording will be replaced — silently
 *                          discarding someone's typing is worse than the
 *                          stale figure it prevents.
 *   sending                refused. Nothing may change under an active send.
 */
export function editConsequence(
  changed: readonly ReminderContentField[],
  pending: PendingReminderFacts | null,
  allStatuses: readonly string[]
): EditConsequence {
  if (isInFlight(allStatuses)) return { kind: "in_flight" };
  if (changed.length === 0) return { kind: "none" };
  if (!pending || pending.status !== "pending") return { kind: "none" };
  return { kind: "refresh_pending", reminderId: pending.id, ownerEdited: pending.ownerEdited };
}

// ── Customer-facing copy ───────────────────────────────────────────────────

export const IN_FLIGHT_MESSAGE =
  "This reminder is currently being sent. Try again in a moment.";

/** Shown before saving, and only when saving actually costs something. */
export function editWarning(consequence: EditConsequence): string | null {
  if (consequence.kind !== "refresh_pending") return null;
  return consequence.ownerEdited
    ? "This invoice has a reminder ready for review, and you have edited its wording. " +
        "Updating these details will rewrite the unsent reminder from the new invoice, " +
        "and your edits to it will be lost."
    : "This invoice has a reminder ready for review. Updating these details will " +
        "refresh the unsent reminder so it matches the invoice.";
}

export const DELETE_CONFIRM_TITLE = "Delete invoice?";
export const DELETE_CONFIRM_BODY =
  "This will permanently delete the invoice and any unsent reminders prepared for it. " +
  "This cannot be undone.";

export const ARCHIVE_CONFIRM_TITLE = "Archive invoice?";
/**
 * "Records", not "reminder history".
 *
 * The Archived page lists the invoice and its details; it does not yet browse
 * per-reminder delivery history. Promising history the customer cannot then
 * find would make Archive feel like a Delete that lies — which is the exact
 * trust problem the page was built to solve.
 */
export const ARCHIVE_CONFIRM_BODY =
  "It will leave Active Chasing and no further reminders will be prepared. " +
  "Its existing records will be kept, and you can find it under Archived.";
