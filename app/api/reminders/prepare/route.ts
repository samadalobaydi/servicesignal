import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { prepareEligibility } from "@/lib/reminder-schedule";
import type { Invoice } from "@/types";
import { formatDate } from "@/lib/invoices";

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
      { success: false, message: "This invoice has already been marked paid. Reminders are stopped." },
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

  // Eligibility: selected, unsent AND reached. A schedule whose checkpoint is
  // still in the future is NOT preparable — see lib/reminder-schedule.ts.
  const eligibility = prepareEligibility(
    invoice.reminder_schedules,
    invoice.reminders_sent ?? [],
    invoice.due_date
  );

  if (!eligibility.schedule) {
    // 409, never 500: this is a legitimate state, not a failure.
    const message =
      eligibility.blockedReason === "all_sent"
        ? "All reminders for this invoice have already been sent."
        : eligibility.eligibleFrom
          ? `No reminder is due yet for this invoice. The next one can be prepared from ${formatDate(eligibility.eligibleFrom)}.`
          : "No reminder is due for this invoice yet.";

    return NextResponse.json(
      {
        success: false,
        message,
        blockedReason: eligibility.blockedReason,
        eligibleFrom: eligibility.eligibleFrom,
      },
      { status: 409 }
    );
  }

  const schedule = eligibility.schedule;

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
        {
          success: true,
          message: "A reminder is already waiting for approval.",
          alreadyPending: true,
          reminderId: existing.id,
          invoiceId: invoice.id,
        },
        { status: 200 }
      );
    }

    // Dismissed and failed reminders must never block a fresh prepare.
    // reminder_logs has UNIQUE(invoice_id, schedule), so instead of inserting
    // a duplicate we revive the existing row back to 'pending' — same
    // approval flow, no schema change, and history stays intact because the
    // dismissal/failure already appeared in the activity feed at the time.
    if (existing.status === "dismissed" || existing.status === "failed") {
      const { error: reviveError } = await supabase
        .from("reminder_logs")
        .update({
          status: "pending",
          error_message: null,
          sent_at: null,
          email_to: invoice.customer_email,
        })
        .eq("id", existing.id);

      if (reviveError) {
        console.error("[prepare-reminder] Failed to revive reminder:", reviveError.message);
        return NextResponse.json(
          { success: false, message: "Failed to prepare reminder." },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Reminder prepared and added to the approval queue.",
        reminderId: existing.id,
        invoiceId: invoice.id,
      });
    }

    // status === "sent" — the genuine business rule: this exact scheduled
    // reminder already went to the customer and shouldn't be duplicated.
    return NextResponse.json(
      { success: false, message: "This reminder has already been sent." },
      { status: 409 }
    );
  }

  // Build a subject for display (full email is rebuilt at send time)
  const subject = `Reminder: invoice from your business`;

  // Insert the pending reminder. user_id explicitly set from the session —
  // RLS would block any other value, and the table requires user_id NOT NULL.
  // .select() so the caller receives the reminder id — onboarding needs the
  // exact identity to build its resume URL rather than guessing.
  const { data: inserted, error: insertError } = await supabase
    .from("reminder_logs")
    .insert({
      invoice_id: invoice.id,
      user_id: user.id,
      schedule,
      status: "pending",
      email_to: invoice.customer_email,
      subject,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      // Race with a concurrent prepare: the UNIQUE(invoice_id, schedule)
      // constraint fired. `existing` was null on this path, so re-read the
      // row the other request created rather than referencing it.
      const { data: raced } = await supabase
        .from("reminder_logs")
        .select("id")
        .eq("invoice_id", invoice.id)
        .eq("schedule", schedule)
        .maybeSingle();

      return NextResponse.json(
        {
          success: true,
          message: "A reminder is already waiting for approval.",
          alreadyPending: true,
          reminderId: raced?.id ?? null,
          invoiceId: invoice.id,
        },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { success: false, message: "Failed to prepare reminder." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: "Reminder prepared and added to the approval queue.",
    reminderId: inserted?.id ?? null,
    invoiceId: invoice.id,
  });
}
