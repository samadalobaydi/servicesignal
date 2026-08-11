import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveBusinessName } from "@/lib/reminder-approval";
import {
  currentContent,
  originalContent,
  validateEmailEdit,
  EMAIL_VALIDATION_MESSAGE,
  type ReminderFacts,
  type ReminderChannel,
} from "@/lib/reminder-content";
import { validateSmsBody, SMS_VALIDATION_MESSAGE, SMS_MAX_LENGTH } from "@/lib/reminder-sms";
import { loadStoredContent, saveChannelEdit } from "@/lib/reminder-channel-store";
import type { ReminderSchedule, ReminderTone } from "@/types";

/**
 * GET  /api/reminders/[id]/content — the current SMS + email pair.
 * PATCH /api/reminders/[id]/content — save an edit, or restore the original.
 *
 * OWNERSHIP is the caller's own session throughout: RLS on reminder_logs and on
 * reminder_channel_messages means another account's reminder simply does not
 * exist, and user_id is matched explicitly as well.
 *
 * SENDS NOTHING. No Resend client is imported here and no reminder status is
 * touched. Editing a reminder must never be able to deliver one.
 */

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

const SELECT =
  "id, status, schedule, email_to, invoice_id, " +
  "invoices!inner(customer_name, customer_email, customer_phone, amount, due_date, " +
  "payment_link, reminder_tone, invoice_reference, job_description)";

interface Loaded {
  reminderId: string;
  status: string;
  facts: ReminderFacts;
  emailTo: string;
  phone: string | null;
  replyTo: string | null;
}

async function load(
  supabase: ReturnType<typeof getSupabaseServer>,
  reminderId: string,
  userId: string,
  userEmail: string | null
): Promise<Loaded | null> {
  const { data, error } = await supabase
    .from("reminder_logs")
    .select(SELECT)
    .eq("id", reminderId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as {
    id: string;
    status: string;
    schedule: ReminderSchedule;
    email_to: string | null;
    invoices: {
      customer_name: string;
      customer_email: string;
      customer_phone: string | null;
      amount: number;
      due_date: string;
      payment_link: string | null;
      reminder_tone: ReminderTone;
      invoice_reference: string | null;
      job_description: string | null;
    };
  };

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name")
    .eq("user_id", userId)
    .maybeSingle();

  const businessName = resolveBusinessName(profile?.business_name, userEmail);

  return {
    reminderId: row.id,
    status: row.status,
    emailTo: row.email_to ?? row.invoices.customer_email,
    phone: row.invoices.customer_phone,
    replyTo: userEmail,
    facts: {
      tone: row.invoices.reminder_tone,
      schedule: row.schedule,
      customerName: row.invoices.customer_name,
      businessName,
      amount: row.invoices.amount,
      dueDate: row.invoices.due_date,
      paymentLink: row.invoices.payment_link,
      invoiceReference: row.invoices.invoice_reference,
      jobDescription: row.invoices.job_description,
    },
  };
}

/** The response shape both verbs return, so the client has one parser. */
async function respond(
  supabase: ReturnType<typeof getSupabaseServer>,
  loaded: Loaded
) {
  const stored = await loadStoredContent(supabase, loaded.reminderId);
  const current = currentContent(stored, loaded.facts);
  const originals = originalContent(stored);

  return NextResponse.json(
    {
      success: true,
      reminderId: loaded.reminderId,
      status: loaded.status,
      /** True when this reminder predates migration 010 — editing is refused. */
      legacy: current.legacy,
      email: {
        to: loaded.emailTo,
        from: loaded.facts.businessName,
        deliveredBy: "ServiceSignal",
        repliesTo: loaded.replyTo,
        subject: current.email.subject,
        body: current.email.body,
        edited: current.email.edited,
        canRestore: current.email.edited && originals.email !== null,
      },
      sms: {
        to: loaded.phone,
        body: current.sms.body,
        edited: current.sms.edited,
        canRestore: current.sms.edited && originals.sms !== null,
        maxLength: SMS_MAX_LENGTH,
      },
    },
    { headers: NO_STORE }
  );
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401, headers: NO_STORE });
  }

  const loaded = await load(supabase, params.id, user.id, user.email ?? null);
  if (!loaded) {
    return NextResponse.json({ success: false, message: "Reminder not found." }, { status: 404, headers: NO_STORE });
  }
  return respond(supabase, loaded);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401, headers: NO_STORE });
  }

  let body: { channel?: string; action?: string; subject?: string; body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request body." }, { status: 400, headers: NO_STORE });
  }

  const channel = body.channel === "sms" || body.channel === "email" ? (body.channel as ReminderChannel) : null;
  const action = body.action === "restore" ? "restore" : body.action === "save" ? "save" : null;
  if (!channel || !action) {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400, headers: NO_STORE });
  }

  const loaded = await load(supabase, params.id, user.id, user.email ?? null);
  if (!loaded) {
    return NextResponse.json({ success: false, message: "Reminder not found." }, { status: 404, headers: NO_STORE });
  }

  // A reminder that has left the approval queue is not editable. Allowing an
  // edit after sending would let the record disagree with what the customer
  // actually received.
  if (loaded.status !== "pending" && loaded.status !== "failed") {
    return NextResponse.json(
      { success: false, message: "This reminder can no longer be edited." },
      { status: 409, headers: NO_STORE }
    );
  }

  const stored = await loadStoredContent(supabase, params.id);
  if (!stored.email && !stored.sms) {
    return NextResponse.json(
      {
        success: false,
        message: "This reminder was prepared before editing was available and can't be edited.",
      },
      { status: 409, headers: NO_STORE }
    );
  }

  let editedSubject: string | null = null;
  let editedBody: string | null = null;

  if (action === "save") {
    const text = typeof body.body === "string" ? body.body : "";

    if (channel === "sms") {
      const problem = validateSmsBody(text);
      if (problem) {
        return NextResponse.json(
          { success: false, message: SMS_VALIDATION_MESSAGE[problem] },
          { status: 400, headers: NO_STORE }
        );
      }
      // An edit identical to the original is stored as "unedited", so the UI
      // stops claiming a change the owner reverted by hand.
      editedBody = text.trim() === (stored.sms?.generatedBody ?? "").trim() ? null : text.trim();
    } else {
      const subject = typeof body.subject === "string" ? body.subject : "";
      const problem = validateEmailEdit({ subject, body: text });
      if (problem) {
        return NextResponse.json(
          { success: false, message: EMAIL_VALIDATION_MESSAGE[problem] },
          { status: 400, headers: NO_STORE }
        );
      }
      editedSubject = subject.trim() === (stored.email?.generatedSubject ?? "").trim() ? null : subject.trim();
      editedBody = text.trim() === (stored.email?.generatedBody ?? "").trim() ? null : text.trim();
    }
  }
  // action === "restore" leaves both null, which is exactly what restore means:
  // drop the edit. The original is already stored and is never rewritten.

  const saved = await saveChannelEdit(supabase, {
    reminderLogId: params.id,
    channel,
    editedSubject,
    editedBody,
    at: new Date().toISOString(),
  });

  if (!saved.ok) {
    console.error(`[reminder-content] save failed for ${params.id}/${channel}: ${saved.error}`);
    return NextResponse.json(
      { success: false, message: "We couldn't save that change. Please try again." },
      { status: 500, headers: NO_STORE }
    );
  }

  // Return the FULL refreshed pair, so the client never has to guess what the
  // server now holds — and so any concurrent change is reflected immediately.
  return respond(supabase, loaded);
}
