import type { InvoiceFormData, InvoiceInsert } from "@/types";
import { parseAmount } from "@/lib/invoice-input";

/**
 * The dashboard's Add Invoice payload, as a pure function.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * It was built inline inside DashboardProvider.handleAddInvoice, where nothing
 * could reach it: the payload lived in a React callback, so the one piece of
 * logic capable of corrupting a saved invoice had no test at all. It shipped a
 * defect that made EVERY Add Invoice fail on the deployed Preview, and every
 * local gate stayed green.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 *
 * The amount was read with `parseFloat(data.amount)`.
 *
 * The invoice form's amount field is a TEXT input that formats on blur via
 * formatAmountOnBlur → formatAmount, which is an Intl currency formatter. So
 * by the time the form is submitted the stored value is "£1,500.00", and:
 *
 *     parseFloat("£1,500.00")           === NaN
 *     JSON.stringify({ amount: NaN })   === '{"amount":null}'
 *
 * PostgREST therefore sent amount = null into a NOT NULL column and the insert
 * was rejected. Validation passed first, because validateInvoiceForm uses
 * parseAmount — which handles the symbol and the separators. Two different
 * parsers for one field, and only one of them was correct.
 *
 * parseAmount is that one. It is the same function the onboarding creation
 * path already used (lib/invoice-write.ts), so the two surfaces now agree by
 * construction rather than by coincidence.
 */
export function buildInvoiceInsert(data: InvoiceFormData): InvoiceInsert | null {
  // parseAmount, NOT parseFloat. See above — this single call is the fix.
  const amount = parseAmount(data.amount);

  // Returns null rather than sending NaN. The caller shows the save error and
  // nothing reaches the database; previously an unparseable amount became a
  // null column value and failed as an opaque constraint violation instead.
  if (amount === null) return null;

  return {
    // Migration 007 columns. Spread so an unset field is ABSENT from the
    // insert rather than an explicit null on every row — matching
    // lib/invoice-write.ts and the nullable columns verified in production.
    ...(data.invoice_reference.trim() ? { invoice_reference: data.invoice_reference.trim() } : {}),
    ...(data.job_description.trim() ? { job_description: data.job_description.trim() } : {}),
    customer_name: data.customer_name.trim(),
    customer_email: data.customer_email.trim(),
    customer_phone: data.customer_phone.trim(),
    amount,
    due_date: data.due_date,
    payment_link: data.payment_link.trim(),
    reminder_tone: data.reminder_tone,
    reminder_schedules: data.reminder_schedules,
    // NOT SENT, deliberately: status, reminders_sent, escalation_status,
    // paid_at, archived_at, id, created_at, user_id. Every one is owned by a
    // database default or a later trusted transition — see 013's whitelist.
    //
    // Nothing here consults the founding-beta allowance, and nothing should.
    // The allowance governs whether a reminder may be SENT; it has no bearing
    // on whether an invoice may exist. A customer at 10 / 10 must still be
    // able to record what they are owed.
  };
}
