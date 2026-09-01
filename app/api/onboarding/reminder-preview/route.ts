import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getVerifiedContext } from "@/lib/onboarding";
import { isUuid } from "@/lib/onboarding-handoff";
import { buildReminderEmail } from "@/lib/email-templates";
import { resolveSenderIdentityForDisplay, SENDER_DISPLAY_FALLBACK } from "@/lib/sender-identity";
import type { ReminderSchedule, ReminderTone } from "@/types";

/**
 * GET /api/onboarding/reminder-preview?reminder=<uuid>
 *
 * The exact email a prepared reminder would send, without sending it.
 *
 * WHY THIS IS BUILT RATHER THAN READ
 *
 * reminder_logs does not store the email. Its `subject` column holds a
 * placeholder ("Reminder: invoice from your business") and there is no body
 * column at all — the real message is composed at send time by
 * buildReminderEmail, from the tone, the business name and the invoice's due
 * status computed live. Showing the stored subject would therefore be showing
 * the user something their customer will never receive.
 *
 * So this route composes it with the SAME builder and the SAME arguments the
 * approve route uses. What the user reviews is what would go out.
 *
 * SENDS NOTHING. No Resend client is imported here, no reminder status is
 * touched, and nothing is written. It is a read that renders.
 */
/**
 * Per-user data behind a session cookie: never prerendered, never stored by a
 * shared cache. `force-dynamic` stops Next from treating this as static; the
 * explicit Cache-Control stops any CDN or proxy in front of it from holding a
 * response and serving one account's reminder to another.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET(request: Request) {
  const context = await getVerifiedContext();
  if (!context) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401, headers: NO_STORE });
  }

  const reminderId = new URL(request.url).searchParams.get("reminder");
  if (!isUuid(reminderId)) {
    return NextResponse.json({ success: false, message: "Invalid reminder." }, { status: 400, headers: NO_STORE });
  }

  const supabase = getSupabaseServer();

  // RLS scopes reminder_logs and invoices to the caller, and user_id is
  // matched explicitly as well — another account's id simply returns no row.
  // The multi-line select string defeats supabase-js's literal-type inference,
  // so the row is narrowed explicitly below rather than left as an error union.
  const { data: reminderRow, error } = await supabase
    .from("reminder_logs")
    .select(
      "id, status, schedule, email_to, invoice_id, " +
      "invoices!inner(customer_name, customer_email, amount, due_date, payment_link, reminder_tone, invoice_reference, job_description)"
    )
    .eq("id", reminderId)
    .eq("user_id", context.user.id)
    .maybeSingle();

  if (error || !reminderRow) {
    return NextResponse.json({ success: false, message: "Reminder not found." }, { status: 404, headers: NO_STORE });
  }

  const reminder = reminderRow as unknown as {
    id: string;
    status: string;
    schedule: ReminderSchedule;
    email_to: string | null;
    invoice_id: string;
    invoices: unknown;
  };

  const invoice = reminder.invoices as {
    customer_name: string;
    customer_email: string;
    amount: number;
    due_date: string;
    payment_link: string | null;
    reminder_tone: ReminderTone;
    invoice_reference: string | null;
    job_description: string | null;
  };

  // The SAME canonical resolver the approve route uses (lib/sender-identity.ts),
  // reading the account's explicit preference, so the preview cannot show a
  // different sender identity from the one that would actually be used —
  // and, critically, can never show the account's own login email.
  const senderName = resolveSenderIdentityForDisplay({
    preference: context.kind === "ready" ? context.senderIdentity : null,
    businessName: context.businessName,
    personalName: context.kind === "ready" ? context.personalName : null,
  });

  const { subject, text } = buildReminderEmail({
    tone: invoice.reminder_tone,
    schedule: reminder.schedule,
    customerName: invoice.customer_name,
    senderName,
    amount: invoice.amount,
    dueDate: invoice.due_date,
    paymentLink: invoice.payment_link || undefined,
    invoiceReference: invoice.invoice_reference,
    jobDescription: invoice.job_description,
  });

  return NextResponse.json({
    success: true,
    reminderId: reminder.id,
    // A fixed platform-attribution label for the preview UI, never the raw
    // transport address and never the identity name repeated. The ACTUAL
    // send-time From header is built by reminderFromHeader() (see
    // dispatchChannels() in lib/reminder-approval.ts) — a send-time
    // concern, not preview text. Reply-To is set per-send to the owner's
    // account email (see approve/route.ts), so a customer replying reaches
    // the trade.
    deliveredBy: SENDER_DISPLAY_FALLBACK,
    repliesTo: context.user.email,
    invoiceId: reminder.invoice_id,
    status: reminder.status,
    to: reminder.email_to ?? invoice.customer_email,
    from: senderName,
    subject,
    invoiceReference: invoice.invoice_reference,
    // The plain-text rendering, not the HTML. It carries the identical wording
    // and can be shown as text without injecting markup into the page.
    body: text,
  }, { headers: NO_STORE });
}
