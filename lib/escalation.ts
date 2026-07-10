import type { Invoice, InvoiceActionType, EscalationStatus } from "@/types";

/**
 * Hours after the final reminder's sent_at before an unpaid invoice is
 * considered "action needed". MVP rule — change this one constant to adjust.
 */
export const ACTION_NEEDED_HOURS = 48;

/**
 * The reminder lifecycle / escalation state of an invoice, used by the UI
 * to decide what to show on the row. This is derived, not stored (except
 * escalation_status which is stored and takes precedence).
 */
export type InvoiceLifecycleState =
  | "paid"
  | "no_reminders_set"
  | "has_pending"
  | "can_prepare"
  | "waiting_after_final"   // all sent, final reminder recent, still waiting
  | "action_needed"         // all sent, final reminder old enough, still unpaid
  | "promised"
  | "disputed"
  | "paused"
  | "written_off";

interface ComputeStateParams {
  invoice: Invoice;
  hasPending: boolean;
  canPrepare: boolean;       // is there an unsent schedule we could still send?
  finalReminderSentAt: string | null; // sent_at of the most recent sent reminder
  now?: Date;
}

/**
 * Computes the single lifecycle state to show for an invoice row.
 * Order of precedence is important:
 *   1. paid wins over everything
 *   2. an explicit escalation_status the user set (promised/disputed/paused/
 *      written_off) takes precedence over the automatic reminder states
 *   3. a pending reminder in the approval queue
 *   4. a reminder we can still prepare/send
 *   5. all reminders sent → waiting vs action-needed based on the 48h rule
 */
export function computeLifecycleState({
  invoice,
  hasPending,
  canPrepare,
  finalReminderSentAt,
  now = new Date(),
}: ComputeStateParams): InvoiceLifecycleState {
  if (invoice.status === "paid") return "paid";

  // Explicit, user-set escalation states take precedence over auto states
  switch (invoice.escalation_status) {
    case "promised":    return "promised";
    case "disputed":    return "disputed";
    case "paused":      return "paused";
    case "written_off": return "written_off";
    case "active":      break; // fall through to automatic states
  }

  if (hasPending) return "has_pending";

  if (!invoice.reminder_schedules || invoice.reminder_schedules.length === 0) {
    return "no_reminders_set";
  }

  if (canPrepare) return "can_prepare";

  // All reminders sent. Decide waiting vs action-needed using the 48h rule.
  if (finalReminderSentAt) {
    const sentMs = new Date(finalReminderSentAt).getTime();
    const hoursSince = (now.getTime() - sentMs) / (1000 * 60 * 60);
    if (hoursSince >= ACTION_NEEDED_HOURS) return "action_needed";
    return "waiting_after_final";
  }

  // No timestamp available but nothing left to prepare — treat as waiting.
  return "waiting_after_final";
}

/** Maps a modal action choice to the escalation_status it should set (if any). */
export function escalationStatusForAction(
  action: InvoiceActionType
): EscalationStatus | null {
  switch (action) {
    case "promised_to_pay": return "promised";
    case "disputed":        return "disputed";
    case "paused":          return "paused";
    case "written_off":     return "written_off";
    case "call_logged":     return null; // history only, no state change
    case "final_notice":    return "active"; // stays active — a reminder is prepared
    case "marked_paid":     return null; // handled via invoice status, not escalation
  }
}

/** Human-readable label for an action type, for the activity timeline. */
export function actionTypeLabel(action: InvoiceActionType): string {
  switch (action) {
    case "call_logged":     return "Call logged";
    case "promised_to_pay": return "Customer promised to pay";
    case "disputed":        return "Invoice disputed";
    case "paused":          return "Chasing paused";
    case "final_notice":    return "Final notice prepared";
    case "written_off":     return "Invoice written off";
    case "marked_paid":     return "Marked as paid";
  }
}

/** Human-readable label for an escalation status, for chips/badges. */
export function escalationStatusLabel(status: EscalationStatus): string {
  switch (status) {
    case "active":      return "Active";
    case "promised":    return "Promised to pay";
    case "disputed":    return "Disputed";
    case "paused":      return "Chasing paused";
    case "written_off": return "Written off";
  }
}

/**
 * Short summary shown directly on the invoice row for the latest action.
 * Mirrors the exact wording required by the escalation UX spec.
 */
export function latestActionRowSummary(action: InvoiceActionType): string {
  switch (action) {
    case "call_logged":     return "Call logged — still awaiting payment";
    case "promised_to_pay": return "Promised to pay";
    case "disputed":        return "Disputed";
    case "paused":          return "Chasing paused";
    case "final_notice":    return "Final notice prepared — awaiting approval";
    case "written_off":     return "Written off";
    case "marked_paid":     return "Marked as paid";
  }
}

/** Accent colour for each action type, used on the row summary chip. */
export function actionTypeColor(action: InvoiceActionType): string {
  switch (action) {
    case "call_logged":     return "#00c8ff";
    case "promised_to_pay": return "#00e676";
    case "disputed":        return "#ffbd2e";
    case "paused":          return "#9aa7bd";
    case "final_notice":    return "#00c8ff";
    case "written_off":     return "#ff6b6b";
    case "marked_paid":     return "#00e676";
  }
}
