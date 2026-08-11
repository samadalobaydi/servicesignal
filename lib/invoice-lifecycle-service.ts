import {
  removalFor,
  canHardDelete,
  changedContentFields,
  editConsequence,
  isInFlight,
  IN_FLIGHT_MESSAGE,
  type EditableInvoiceSnapshot,
  type PendingReminderFacts,
} from "./invoice-lifecycle";

/**
 * The invoice lifecycle SERVICE — edit, delete, archive.
 *
 * Same shape as lib/reminder-approval.ts: every decision here, the database
 * and the content generator injected as ports, so the rules are drivable by a
 * test without a network. The routes are thin adapters.
 *
 * ── THE VERIFIED FACT THIS IS BUILT AROUND ───────────────────────────────
 *
 *   reminder_logs.invoice_id references invoices(id) ON DELETE CASCADE
 *   — verified on main — PRODUCTION, 2026-08-10.
 *
 * So one DELETE on invoices cascades through reminder_logs into
 * reminder_channel_messages (010) and reminder_allowance_slots (011). A single
 * unguarded delete erases dispatched history and refunds consumed allowance.
 *
 * Eligibility is therefore checked BEFORE any destructive statement, and
 * migration 012's BEFORE DELETE trigger refuses it again at the database. The
 * service check gives the customer a typed, explicable refusal; the trigger is
 * what makes the guarantee true.
 */

export type LifecycleOutcome =
  | "updated"
  | "deleted"
  | "archived"
  | "not_found"
  | "forbidden"
  | "in_flight"
  | "delete_not_allowed"
  | "invoice_archived"
  | "invalid"
  | "database_unavailable";

export interface LifecycleResult {
  status: number;
  body: Record<string, unknown> & { success: boolean; message: string };
  outcome: LifecycleOutcome;
}

export interface ReminderFact {
  id: string;
  status: string;
  ownerEdited: boolean;
}

export interface LifecycleInvoice extends EditableInvoiceSnapshot {
  id: string;
  userId: string;
  archivedAt: string | null;
}

export interface RefreshChannel {
  channel: "email" | "sms";
  subject: string | null;
  body: string;
}

export interface LifecycleDb {
  /** MUST be scoped to the caller. Returns null for another user's invoice. */
  loadInvoice(id: string, userId: string): Promise<LifecycleInvoice | null>;
  /** Every reminder_logs row for this invoice, with whether its draft was hand-edited. */
  loadReminders(invoiceId: string, userId: string): Promise<ReminderFact[]>;
  /**
   * Compose both channels from the PROPOSED invoice values, without writing
   * anything. Returns null if the content cannot be built — in which case
   * nothing is committed at all.
   */
  composeRefresh(
    invoiceId: string, userId: string, reminderId: string, patch: EditableInvoiceSnapshot
  ): Promise<RefreshChannel[] | null>;
  /**
   * ONE TRANSACTION: lock, re-check in-flight, update the invoice, replace the
   * unsent reminder's content, invalidate its review. All or nothing.
   */
  commitEdit(input: {
    invoiceId: string; userId: string;
    patch: EditableInvoiceSnapshot;
    reminderId: string | null;
    channels: RefreshChannel[] | null;
  }): Promise<"updated" | "in_flight" | "not_found" | "reminder_changed" | "invoice_archived" | "error">;
  deleteInvoice(id: string, userId: string): Promise<{ ok: boolean; refusedByDatabase?: boolean }>;
  /**
   * ONE TRANSACTION: lock, refuse if sending, set archived_at, stand down
   * unsent drafts. All or nothing — see archive_invoice_safely.
   */
  archiveInvoice(
    id: string, userId: string
  ): Promise<"archived" | "in_flight" | "not_found" | "error">;
}

export interface LifecycleDeps {
  db: LifecycleDb;
  userId: string;
  now?: () => Date;
  log?: (message: string) => void;
}

const refuse = (status: number, outcome: LifecycleOutcome, message: string, extra = {}): LifecycleResult => ({
  status,
  body: { success: false, state: outcome, message, ...extra },
  outcome,
});

/**
 * Not found and not-yours are the SAME answer, deliberately. loadInvoice is
 * scoped to the caller, so another user's invoice simply does not exist — and
 * this response cannot be used to confirm that it does.
 */
const NOT_FOUND = () => refuse(404, "not_found", "Invoice not found.");

// ── Edit ───────────────────────────────────────────────────────────────────

export interface EditRequest {
  invoiceId: string;
  patch: EditableInvoiceSnapshot;
  /**
   * The client has seen and accepted the consequence warning. Without it, an
   * edit that would destroy a prepared reminder is refused so the warning can
   * be shown — the confirmation is enforced by the server, not by the dialog.
   */
  acceptRefresh?: boolean;
  /**
   * Test-only: name a specific reminder for the refresh instead of the one
   * discovered from this invoice. Exists so the invoice-binding guarantee can
   * be exercised — production never sets it.
   */
  overrideReminderId?: string;
}

export async function editInvoice(
  deps: LifecycleDeps,
  request: EditRequest
): Promise<LifecycleResult> {
  const invoice = await deps.db.loadInvoice(request.invoiceId, deps.userId);
  if (!invoice) return NOT_FOUND();

  const reminders = await deps.db.loadReminders(invoice.id, deps.userId);
  const statuses = reminders.map((r) => r.status);

  // Checked before anything is written. Recipient details and amounts must not
  // change under an active provider submission.
  if (isInFlight(statuses)) return refuse(409, "in_flight", IN_FLIGHT_MESSAGE);

  const changed = changedContentFields(invoice, request.patch);
  const pending = reminders.find((r) => r.status === "pending") ?? null;
  const consequence = editConsequence(
    changed,
    pending ? ({ id: pending.id, status: pending.status, ownerEdited: pending.ownerEdited } as PendingReminderFacts) : null,
    statuses
  );

  // The warning is a server gate, not a UI courtesy: a direct API call that
  // skips the dialog is refused until it acknowledges the consequence.
  if (consequence.kind === "refresh_pending" && !request.acceptRefresh) {
    return refuse(409, "invalid", "This change will refresh an unsent reminder. Confirm to continue.", {
      requiresRefreshConfirmation: true,
      ownerEdited: consequence.ownerEdited,
    });
  }

  // ── ONE ATOMIC COMMIT ─────────────────────────────────────────────────
  //
  // Everything below this point either lands together or not at all.
  //
  // The content is composed FIRST, from the proposed values, and written
  // nowhere: if composition fails there is nothing to roll back because
  // nothing was ever written. Only once both channels are ready does the
  // single transaction run.
  let channels: RefreshChannel[] | null = null;
  if (consequence.kind === "refresh_pending") {
    channels = await deps.db.composeRefresh(
      invoice.id, deps.userId, consequence.reminderId, request.patch
    );
    if (!channels || channels.length === 0) {
      deps.log?.(`[invoice-edit] could not compose refresh for ${consequence.reminderId}`);
      return refuse(
        503,
        "database_unavailable",
        "We couldn't update this invoice. Nothing has been changed — please try again."
      );
    }
  }

  const committed = await deps.db.commitEdit({
    invoiceId: invoice.id,
    userId: deps.userId,
    patch: request.patch,
    reminderId: request.overrideReminderId
      ?? (consequence.kind === "refresh_pending" ? consequence.reminderId : null),
    channels,
  });

  // A send won the race inside the transaction. The invoice is UNCHANGED —
  // this is the whole point of doing it in one statement rather than three.
  if (committed === "in_flight") return refuse(409, "in_flight", IN_FLIGHT_MESSAGE);
  if (committed === "not_found") return NOT_FOUND();

  // Archived between the tab loading and Save. The Archived view is read only,
  // so this is a state change, not an error the owner caused.
  if (committed === "invoice_archived") {
    return refuse(409, "invoice_archived",
      "This invoice has been archived and can no longer be edited.");
  }

  // The draft was dismissed, failed or dispatched between the read and the
  // commit. Nothing was written; the owner reloads and tries again.
  if (committed === "reminder_changed") {
    return refuse(409, "invalid", "This invoice's reminder changed while you were editing. Reload and try again.", {
      requiresReload: true,
    });
  }

  if (committed !== "updated") {
    return refuse(
      503,
      "database_unavailable",
      "We couldn't update this invoice. Nothing has been changed — please try again."
    );
  }

  return {
    status: 200,
    body: {
      success: true,
      state: "updated",
      message: "Invoice updated.",
      refreshedReminder: consequence.kind === "refresh_pending",
    },
    outcome: "updated",
  };
}

// ── Delete ─────────────────────────────────────────────────────────────────

export async function deleteInvoiceLifecycle(
  deps: LifecycleDeps,
  invoiceId: string
): Promise<LifecycleResult> {
  const invoice = await deps.db.loadInvoice(invoiceId, deps.userId);
  // Idempotent: a second click on an already-deleted invoice is a 404, not a
  // corruption. Nothing destructive has run at this point.
  if (!invoice) return NOT_FOUND();

  const statuses = (await deps.db.loadReminders(invoice.id, deps.userId)).map((r) => r.status);

  if (isInFlight(statuses)) return refuse(409, "in_flight", IN_FLIGHT_MESSAGE);

  if (!canHardDelete({ reminderStatuses: statuses, archivedAt: invoice.archivedAt })) {
    return refuse(
      409,
      "delete_not_allowed",
      "This invoice has reminders that were already sent, so it can't be deleted. Archive it instead.",
      { useArchive: true }
    );
  }

  const result = await deps.db.deleteInvoice(invoice.id, deps.userId);

  if (!result.ok) {
    // The database guard refused. That means a reminder became dispatched or
    // in-flight between the check above and the statement — the race the
    // trigger exists for. Reported as the lifecycle refusal it is, not a 500.
    if (result.refusedByDatabase) {
      return refuse(
        409,
        "delete_not_allowed",
        "This invoice now has a reminder that has been sent, so it can't be deleted. Archive it instead.",
        { useArchive: true }
      );
    }
    return refuse(503, "database_unavailable", "We couldn't delete this invoice. Please try again.");
  }

  return {
    status: 200,
    body: { success: true, state: "deleted", message: "Invoice deleted." },
    outcome: "deleted",
  };
}

// ── Archive ────────────────────────────────────────────────────────────────

export async function archiveInvoiceLifecycle(
  deps: LifecycleDeps,
  invoiceId: string
): Promise<LifecycleResult> {
  // ── EVERY DECISION IS INSIDE THE TRANSACTION ──────────────────────────
  //
  // No pre-flight read, deliberately. Loading the invoice and its reminders
  // first, deciding, then archiving is the two-statement shape this replaced:
  // whatever it read could change before the write landed. The function locks
  // the invoice and every reminder, re-reads under those locks, and refuses or
  // commits — so there is nothing left for the application to get wrong.
  const outcome = await deps.db.archiveInvoice(invoiceId, deps.userId);

  if (outcome === "not_found") return NOT_FOUND();

  // A provider submission is already in flight. Nothing was archived and no
  // draft was stood down — the invoice is exactly as it was.
  if (outcome === "in_flight") return refuse(409, "in_flight", IN_FLIGHT_MESSAGE);

  if (outcome !== "archived") {
    return refuse(503, "database_unavailable", "We couldn't archive this invoice. Please try again.");
  }

  return {
    status: 200,
    body: { success: true, state: "archived", message: "Invoice archived." },
    outcome: "archived",
  };
}

/**
 * Which removal the UI should offer. Exported so the menu and the server agree
 * by construction rather than by two people remembering the same rule.
 */
export function removalActionFor(reminderStatuses: readonly string[], archivedAt: string | null) {
  return removalFor({ reminderStatuses, archivedAt });
}
