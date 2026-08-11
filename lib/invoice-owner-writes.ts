import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Trusted, owner-scoped writes to `invoices`.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * Migration 012 revokes UPDATE and DELETE on public.invoices from
 * `authenticated`. Verified production state before 012: both `anon` AND
 * `authenticated` held table-level DELETE, INSERT, REFERENCES, SELECT,
 * TRIGGER, TRUNCATE and UPDATE. RLS scoped those to the owner's own rows —
 * but "your row" is not the same as "a safe change to your row". A customer
 * could set `status = 'paid'`, rewrite `reminders_sent`, or blank
 * `archived_at` straight from the browser, bypassing every lifecycle rule.
 *
 * So the small number of legitimate UPDATEs move here, behind the service-role
 * client, and each one carries its own ownership predicate.
 *
 * ── OWNERSHIP, WITHOUT RLS ───────────────────────────────────────────────
 *
 * service_role BYPASSES RLS. That protection is gone here, so it is replaced
 * explicitly: every statement is `.eq("id", invoiceId).eq("user_id", userId)`,
 * and `userId` is always derived from a server-verified session — never from a
 * request body. A mismatched pair updates zero rows.
 *
 * These functions do NOT decide policy. Edit, delete and archive have their
 * own lifecycle services; this module only carries the three narrow state
 * transitions that were previously done from a browser-role client.
 */

export interface OwnerWriteResult {
  ok: boolean;
  /** True when the invoice exists and belongs to the caller. */
  matched: boolean;
}

/** Shared shape: update, scoped to (id, user_id), and report whether a row matched. */
async function scopedUpdate(
  admin: SupabaseClient,
  invoiceId: string,
  userId: string,
  patch: Record<string, unknown>
): Promise<OwnerWriteResult> {
  const { data, error } = await admin
    .from("invoices")
    .update(patch)
    .eq("id", invoiceId)
    // service_role bypasses RLS, so this predicate IS the ownership check.
    .eq("user_id", userId)
    .select("id");

  if (error) {
    console.error(`[invoice-owner-write] ${Object.keys(patch).join(",")} failed: ${error.message}`);
    return { ok: false, matched: false };
  }
  return { ok: true, matched: (data?.length ?? 0) > 0 };
}

/** Mark Paid. The paid kill switch itself lives with the caller. */
export function markInvoicePaidForOwner(
  admin: SupabaseClient, invoiceId: string, userId: string, paidAt: string
): Promise<OwnerWriteResult> {
  return scopedUpdate(admin, invoiceId, userId, { status: "paid", paid_at: paidAt });
}

/** Escalation workflow state, set by /api/invoices/actions. */
export function setEscalationForOwner(
  admin: SupabaseClient, invoiceId: string, userId: string, escalation: string
): Promise<OwnerWriteResult> {
  return scopedUpdate(admin, invoiceId, userId, { escalation_status: escalation });
}

/** Records that a schedule checkpoint has been dispatched. */
export function setRemindersSentForOwner(
  admin: SupabaseClient, invoiceId: string, userId: string, remindersSent: string[]
): Promise<OwnerWriteResult> {
  return scopedUpdate(admin, invoiceId, userId, { reminders_sent: remindersSent });
}

/**
 * Dismisses unsent drafts for an invoice — the paid kill switch.
 *
 * Also moved off the browser role: reminder_logs writes are not revoked by
 * 012, but this belongs beside the transition that causes it, and doing it
 * with the same trusted client keeps the pair together.
 */
export async function dismissPendingForOwner(
  admin: SupabaseClient, invoiceId: string, userId: string
): Promise<boolean> {
  const { error } = await admin
    .from("reminder_logs")
    .update({ status: "dismissed" })
    .eq("invoice_id", invoiceId)
    .eq("user_id", userId)
    .eq("status", "pending");
  if (error) console.error(`[invoice-owner-write] dismiss failed: ${error.message}`);
  return !error;
}
