/**
 * The one server-side invoice write.
 *
 * Both the payload coercion and the insert live here so that any route which
 * creates an invoice does it identically. What a route DOES vary is policy —
 * specifically whether reminder eligibility is required — and that decision is
 * made by the route in server code, never taken from the request body. A
 * client-supplied "please enforce eligibility" flag would be worth nothing,
 * since the client that wants to skip the check simply omits it.
 *
 * Server-only: callers pass an authenticated Supabase server client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice, InvoiceFormData } from "@/types";
import { parseAmount } from "@/lib/invoice-input";
import {
  validateInvoiceForm,
  normaliseInvoiceForm,
  type InvoiceFormErrors,
} from "@/lib/invoice-form";

/**
 * Coerces an untrusted JSON body into the shape the shared validator expects.
 *
 * Every field is type-checked rather than cast. A missing customer_name must
 * fail validation with a message, not throw on `.trim()` and become a 500.
 */
export function coerceInvoiceForm(body: Partial<InvoiceFormData>): InvoiceFormData {
  return {
    invoice_reference: typeof body.invoice_reference === "string" ? body.invoice_reference : "",
    job_description: typeof body.job_description === "string" ? body.job_description : "",
    customer_name: typeof body.customer_name === "string" ? body.customer_name : "",
    customer_email: typeof body.customer_email === "string" ? body.customer_email : "",
    customer_phone: typeof body.customer_phone === "string" ? body.customer_phone : "",
    amount: typeof body.amount === "string" ? body.amount : "",
    due_date: typeof body.due_date === "string" ? body.due_date : "",
    payment_link: typeof body.payment_link === "string" ? body.payment_link : "",
    reminder_tone: body.reminder_tone ?? "firm",
    reminder_schedules: Array.isArray(body.reminder_schedules) ? body.reminder_schedules : [],
  };
}

export type InvoiceWriteResult =
  | { ok: true; invoice: Invoice }
  | { ok: false; reason: "invalid"; errors: InvoiceFormErrors }
  | { ok: false; reason: "failed"; message: string };

/**
 * Validates with the SAME module the browser used, then inserts.
 *
 * `requireOnboardingFields` is the route's decision, and it now governs FIELDS
 * only. A `requireReminderEligibility` option used to sit beside it and let
 * onboarding refuse an invoice whose first reminder was not yet due; it has
 * been removed, because recording an invoice due next month is legitimate on
 * every surface. When the reminder becomes preparable is decided after the
 * write, by prepareEligibility(), and it changes what the customer is shown —
 * never whether their invoice may be saved.
 */
export async function createInvoiceForUser(
  supabase: SupabaseClient,
  form: InvoiceFormData,
  options: { requireOnboardingFields?: boolean } = {}
): Promise<InvoiceWriteResult> {
  const errors = validateInvoiceForm(form, {
    requireOnboardingFields: options.requireOnboardingFields,
  });
  if (Object.keys(errors).length > 0) {
    return { ok: false, reason: "invalid", errors };
  }

  const clean = normaliseInvoiceForm(form);

  // user_id is never accepted from the caller. The table's DEFAULT auth.uid()
  // sets it and the RLS insert policy independently enforces the same thing,
  // so a body-supplied id cannot be honoured even if one were passed.
  const { data, error } = await supabase
    .from("invoices")
    .insert({
      // Empty string -> null. The column is nullable, and "no reference
      // recorded" is null, not "". Spread so an unset field is simply absent
      // from the insert rather than an explicit null on every row.
      ...(clean.invoice_reference ? { invoice_reference: clean.invoice_reference } : {}),
      ...(clean.job_description ? { job_description: clean.job_description } : {}),
      customer_name: clean.customer_name,
      customer_email: clean.customer_email,
      customer_phone: clean.customer_phone,
      // Already validated above, so parseAmount cannot return null here.
      // Stored as a plain number of pounds — never the formatted "£" string.
      amount: parseAmount(clean.amount) as number,
      due_date: clean.due_date,
      payment_link: clean.payment_link,
      reminder_tone: clean.reminder_tone,
      reminder_schedules: clean.reminder_schedules,
      // NO status, NO reminders_sent. This runs on the SESSION client
      // (app/api/onboarding/invoices uses getSupabaseServer), so it executes as
      // `authenticated` — the same role migration 013 restricts. Naming either
      // column would fail with "permission denied for column".
    })
    .select()
    .single();

  if (error || !data) {
    return { ok: false, reason: "failed", message: error?.message ?? "No row returned." };
  }

  return { ok: true, invoice: data as Invoice };
}
