import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { scheduleToPrepare } from "@/lib/reminder-schedule";
import type { Invoice } from "@/types";

/**
 * POST /api/reminders/prepare
 * Body: { invoice_id: string }
 *
 * Manually creates a single 'pending' reminder for an invoice, on demand,
 * regardless of cron timing. This is what powers the "Prepare Reminder"
 * button on an invoice row — so a user can chase an overdue invoice
 * immediately without needing to understand the cron schedule.
 *
 * SAFETY:
 *  - Uses the authenticated user's session (anon key + cookies). RLS on
 *    both invoices and reminder_logs enforces ownership — a user can only
 *    prepare reminders for their own invoices.
 *  - NEVER sends an email. Even in Auto mode, this endpoint only creates a
 *    'pending' row that then appears in the ReminderQueue for explicit
 *    approval. The manual button is always approval-based and safe.
 *  - Respects the UNIQUE(invoice_id, schedule) constraint — if a reminder
 *    for the chosen schedule already exists, it returns a clear message
 *    rather than duplicating.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  let body: { invoice_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request body." }, { status: 400 });
  }

  if (!body.invoice_id) {
    return NextResponse.json({ success: false, message: "Missing invoice_id." }, { status: 400 });
  }

  // Fetch the invoice — RLS returns null if it isn't owned by this user
  const { data: invoiceRow, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", body.invoice_id)
    .single();

  if (invoiceError || !invoiceRow) {
    return NextResponse.json({ success: false, message: "Invoice not found." }, { status: 404 });
  }

  const invoice = invoiceRow as Invoice;

  if (invoice.status === "paid") {
    return NextResponse.json(
      { success: false, message: "This invoice is already paid." },
      { status: 409 }
    );
  }

  if (!invoice.customer_email) {
    return NextResponse.json(
      { success: false, message: "This invoice has no customer email to send to." },
      { status: 409 }
    );
  }

  if (!invoice.reminder_schedules || invoice.reminder_schedules.length === 0) {
    return NextResponse.json(
      { success: false, message: "This invoice has no reminder schedules selected." },
      { status: 409 }
    );
  }

  // Choose which schedule to prepare based on how overdue the invoice is
  const schedule = scheduleToPrepare(
    invoice.reminder_schedules,
    invoice.reminders_sent ?? [],
    invoice.due_date
  );

  if (!schedule) {
    return NextResponse.json(
      { success: false, message: "All reminders for this invoice have already been sent." },
      { status: 409 }
    );
  }

  // Check for an existing reminder_log for this invoice + schedule
  const { data: existing } = await supabase
    .from("reminder_logs")
    .select("id, status")
    .eq("invoice_id", invoice.id)
    .eq("schedule", schedule)
    .maybeSingle();

  if (existing) {
    if (existing.status === "pending") {
      return NextResponse.json(
        { success: true, message: "A reminder is already waiting for approval.", alreadyPending: true },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { success: false, message: `This reminder was already ${existing.status}.` },
      { status: 409 }
    );
  }

  // Build a subject for display (full email is rebuilt at send time)
  const subject = `Reminder: invoice from your business`;

  // Insert the pending reminder. user_id explicitly set from the session —
  // RLS would block any other value, and the table requires user_id NOT NULL.
  const { error: insertError } = await supabase
    .from("reminder_logs")
    .insert({
      invoice_id: invoice.id,
      user_id: user.id,
      schedule,
      status: "pending",
      email_to: invoice.customer_email,
      subject,
    });

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json(
        { success: true, message: "A reminder is already waiting for approval.", alreadyPending: true },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { success: false, message: "Failed to prepare reminder." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, message: "Reminder prepared and added to the approval queue." });
}
