import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getResendClient, REMINDER_FROM } from "@/lib/resend";
import { buildReminderEmail } from "@/lib/email-templates";
import type { ReminderLog, ReminderSchedule } from "@/types";
import { prepareEligibility } from "@/lib/reminder-schedule";
import { formatDate } from "@/lib/invoices";

/**
 * POST /api/reminders/[id]/approve
 *
 * Sends a pending reminder email and marks it 'sent'.
 *
 * Security: uses lib/supabase-server.ts — the AUTHENTICATED USER's session
 * (anon key + cookies), NOT the service role key. RLS policies on
 * reminder_logs (select_own_reminder_logs, update_own_reminder_logs) mean:
 *  - .select() returns null if this reminder doesn't belong to the caller
 *  - .update() silently affects 0 rows if the caller doesn't own it
 * This makes cross-user approval impossible at the database level —
 * no manual user_id comparison needed, RLS is the enforcement.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabaseServer();

  // Confirm a valid session exists at all
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  // Fetch the reminder log — RLS ensures this is null if not owned by `user`
  const { data: log, error: fetchError } = await supabase
    .from("reminder_logs")
    .select("*, invoice:invoices(customer_name, amount, due_date, customer_email, payment_link, reminder_tone, status, reminder_schedules, reminders_sent)")
    .eq("id", params.id)
    .single();

  if (fetchError || !log) {
    return NextResponse.json({ success: false, message: "Reminder not found." }, { status: 404 });
  }

  const reminder = log as ReminderLog & {
    invoice: { customer_email: string };
  };

  // Sent and dismissed reminders can never be re-sent. A 'failed' reminder
  // IS retryable — the user can click Send Now again after a transient
  // failure without having to prepare a fresh reminder.
  if (reminder.status === "sent" || reminder.status === "dismissed") {
    return NextResponse.json(
      { success: false, message: `Reminder is already ${reminder.status}.` },
      { status: 409 }
    );
  }

  // ── Kill switch: never send reminders for a paid invoice ──────────────────
  // If the invoice was marked paid after this reminder was queued, block the
  // send, dismiss the stale reminder (so it leaves the queue without a
  // misleading "sent" log), and tell the user chasing has stopped.
  const invoiceStatus = (reminder.invoice as unknown as { status?: string })?.status;
  if (invoiceStatus === "paid") {
    await supabase
      .from("reminder_logs")
      .update({ status: "dismissed" })
      .eq("id", params.id);

    return NextResponse.json(
      { success: false, message: "This invoice has already been marked paid. Reminders are stopped." },
      { status: 409 }
    );
  }

  // ── Eligibility revalidation (v8.9.2) ────────────────────────────────────
  // The last gate before an email leaves the building. Rows queued under the
  // previous unsafe fallback — which could prepare a reminder whose checkpoint
  // was still weeks away — are NOT deleted, because that would destroy user
  // data to fix our bug. They are simply not sendable: this check refuses them
  // until the schedule genuinely comes due, at which point the same row sends
  // normally. Nothing about the email itself changes.
  const invoiceForEligibility = reminder.invoice as unknown as {
    due_date?: string;
    reminder_schedules?: ReminderSchedule[];
    reminders_sent?: ReminderSchedule[];
  };

  if (invoiceForEligibility?.due_date) {
    const eligibility = prepareEligibility(
      invoiceForEligibility.reminder_schedules ?? [reminder.schedule],
      invoiceForEligibility.reminders_sent ?? [],
      invoiceForEligibility.due_date
    );

    if (!eligibility.schedule) {
      return NextResponse.json(
        {
          success: false,
          message: eligibility.eligibleFrom
            ? `This reminder isn't due yet. It can be sent from ${formatDate(eligibility.eligibleFrom)}.`
            : "This reminder is no longer due to be sent.",
          blockedReason: eligibility.blockedReason,
          eligibleFrom: eligibility.eligibleFrom,
        },
        { status: 409 }
      );
    }
  }

  const resend = getResendClient();

  if (!resend) {
    console.error("[send-reminder] RESEND_API_KEY is missing — cannot send. Add it to .env.local (and Vercel).");
    await supabase
      .from("reminder_logs")
      .update({ status: "failed", error_message: "RESEND_API_KEY not configured" })
      .eq("id", params.id);

    return NextResponse.json(
      { success: false, message: "Email service is not configured." },
      { status: 503 }
    );
  }

  // Regenerate the full email body (html/text) using the same builder the
  // cron job uses — only the subject and recipient are stored on the log
  // row, so the full content is rebuilt here from the joined invoice data.
  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name")
    .eq("user_id", user.id)
    .maybeSingle();

  const businessName = profile?.business_name?.trim() || user.email || "ServiceSignal";

  const invoiceData = reminder.invoice as unknown as {
    customer_name: string;
    amount: number;
    due_date: string;
    payment_link: string | null;
    reminder_tone: "friendly" | "firm" | "final";
  };

  const { subject, html, text } = buildReminderEmail({
    tone: invoiceData.reminder_tone,
    schedule: reminder.schedule,
    customerName: invoiceData.customer_name,
    businessName,
    amount: invoiceData.amount,
    dueDate: invoiceData.due_date,
    paymentLink: invoiceData.payment_link || undefined,
  });

  try {
    const { error: sendError } = await resend.emails.send({
      from: REMINDER_FROM,
      to: reminder.email_to,
      replyTo: user.email,
      subject,
      html,
      text,
    });

    if (sendError) {
      // Safe to log: Resend error names/messages describe the problem
      // (e.g. domain not verified, invalid recipient) and contain no secrets.
      console.error(
        `[send-reminder] Resend rejected the send for reminder ${params.id}:`,
        sendError.name ?? "unknown_error",
        "-", sendError.message
      );

      await supabase
        .from("reminder_logs")
        .update({ status: "failed", error_message: sendError.message })
        .eq("id", params.id);

      return NextResponse.json(
        {
          success: false,
          message: sendError.message
            ? `Failed to send email: ${sendError.message}`
            : "Failed to send email.",
        },
        { status: 500 }
      );
    }

    // Mark sent — RLS update_own_reminder_logs allows this since user owns the row
    await supabase
      .from("reminder_logs")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", params.id);

    // Update invoices.reminders_sent — RLS update_own_invoices enforces ownership
    const { data: invoiceRow } = await supabase
      .from("invoices")
      .select("reminders_sent")
      .eq("id", reminder.invoice_id)
      .single();

    const currentSent: ReminderSchedule[] = invoiceRow?.reminders_sent ?? [];
    if (!currentSent.includes(reminder.schedule)) {
      await supabase
        .from("invoices")
        .update({ reminders_sent: [...currentSent, reminder.schedule] })
        .eq("id", reminder.invoice_id);
    }

    return NextResponse.json({ success: true, message: "Reminder sent." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[send-reminder] Unexpected error sending reminder ${params.id}:`, message);
    await supabase
      .from("reminder_logs")
      .update({ status: "failed", error_message: message })
      .eq("id", params.id);

    return NextResponse.json({ success: false, message: `Failed to send email: ${message}` }, { status: 500 });
  }
}
