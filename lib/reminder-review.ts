import "server-only";
import { getSupabaseServer } from "@/lib/supabase-server";
import { currentContent, contentVersionHash, type ReminderFacts } from "@/lib/reminder-content";
import { loadStoredContent } from "@/lib/reminder-channel-store";
import { prepareEligibility } from "@/lib/reminder-schedule";
import { SCHEDULE_LABELS } from "@/lib/invoices";
import {
  reviewAvailability,
  type ReminderSendStatus,
  type ReviewBlockedReason,
} from "@/lib/reminder-send-state";
import { issueReviewToken } from "@/lib/review-token";
import type { ReminderSchedule, ReminderTone, ReminderLogStatus } from "@/types";

/**
 * Everything the review page needs, composed server-side.
 *
 * WHY A SHARED LOADER RATHER THAN A CLIENT FETCH
 *
 * The review screen is the last thing an owner sees before a real email leaves
 * for a real customer. If it displayed one message and the send route composed
 * another, the review would be theatre. So it reads the SAME stored channel
 * content the send path reads, through the same currentContent() resolver and
 * the same business-name fallback as
 * app/api/reminders/[id]/approve/route.ts — the owner's saved edit when one
 * exists, and live composition only for legacy reminders.
 *
 * Nothing here is taken from the client: the reminder id arrives in the URL and
 * everything else is read from the database under the caller's own session, so
 * RLS makes another user's reminder simply not exist.
 *
 * Read-only by construction. This module performs no writes, so opening or
 * refreshing the review page cannot send, dismiss or alter anything.
 */

/**
 * Single source of truth in lib/reminder-send-state.ts, so the page and the
 * send route can never disagree about what a status means.
 */
export type ReviewUnavailable = ReviewBlockedReason;

export interface ReminderReviewData {
  reminderId: string;
  invoiceId: string;
  status: ReminderLogStatus;

  /** Recipient */
  customerName: string;
  customerEmail: string;
  /** Stored for the planned SMS channel. Displayed, never claimed as sent. */
  customerPhone: string | null;

  /** Sender */
  businessName: string;
  replyTo: string | null;

  /** Invoice */
  invoiceReference: string | null;
  jobDescription: string | null;
  amount: number;
  dueDate: string;
  paymentLink: string | null;

  /** Message — rebuilt by the canonical composer. */
  subject: string;
  body: string;
  tone: ReminderTone;
  schedule: ReminderSchedule;
  scheduleLabel: string;

  /** True only when the reminder can genuinely be approved right now. */
  approvable: boolean;
  blockedReason: ReviewUnavailable | null;
  /**
   * Server-SIGNED authorisation for this exact review.
   *
   * An HMAC binding user + reminder + content hash + expiry. The browser
   * relays it back on approval and cannot forge or alter one, so approval can
   * only come from a review page this server issued.
   */
  reviewToken: string;
  /** The fingerprint the token commits to. Shown for support/debugging only. */
  contentHash: string;
  /** Present once an attempt has run — the handle for reconciliation. */
  providerMessageId: string | null;
  /**
   * The last delivery event the provider reported, when there is one.
   *
   * Shown only to explain a blocked state truthfully — never presented as
   * general delivery tracking, which this product does not offer.
   */
  providerLastEvent: string | null;
  lastSendError: string | null;
}

export async function loadReminderReview(
  reminderId: string
): Promise<{ ok: true; data: ReminderReviewData } | { ok: false; reason: ReviewUnavailable }> {
  const supabase = getSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not_found" };

  // RLS scopes reminder_logs to the caller, and user_id is matched explicitly
  // as well. Another user's reminder returns no row — indistinguishable from a
  // reminder that does not exist, which is what stops this page confirming
  // whether someone else's reminder is real.
  const { data: row, error } = await supabase
    .from("reminder_logs")
    .select(
      "id, status, schedule, email_to, invoice_id, provider_message_id, " +
        "provider_last_event, last_send_error, " +
        "invoices!inner(customer_name, customer_email, customer_phone, amount, due_date, " +
        "payment_link, reminder_tone, status, reminder_schedules, reminders_sent, " +
        "invoice_reference, job_description)"
    )
    .eq("id", reminderId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !row) return { ok: false, reason: "not_found" };

  const reminder = row as unknown as {
    id: string;
    status: ReminderLogStatus;
    schedule: ReminderSchedule;
    email_to: string | null;
    invoice_id: string;
    provider_message_id: string | null;
    provider_last_event: string | null;
    last_send_error: string | null;
    invoices: {
      customer_name: string;
      customer_email: string;
      customer_phone: string | null;
      amount: number;
      due_date: string;
      payment_link: string | null;
      reminder_tone: ReminderTone;
      status: string;
      reminder_schedules: ReminderSchedule[] | null;
      reminders_sent: ReminderSchedule[] | null;
      invoice_reference: string | null;
      job_description: string | null;
    };
  };

  const invoice = reminder.invoices;

  // Same fallback chain the send route uses, so the sender name shown here is
  // the sender name that would actually be used.
  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name")
    .eq("user_id", user.id)
    .maybeSingle();

  const businessName = profile?.business_name?.trim() || user.email || "ServiceSignal";

  // ACTIVE CHASING READS THE SAME STORED VERSION THE SEND PATH WILL USE.
  //
  // Without this the owner could edit a reminder during onboarding and then be
  // shown the original generated wording here — reviewing one message and
  // approving another. The stored version wins; live composition is the
  // fallback for legacy reminders only.
  const storedContent = await loadStoredContent(supabase, reminderId);
  const facts: ReminderFacts = {
    tone: invoice.reminder_tone,
    schedule: reminder.schedule,
    customerName: invoice.customer_name,
    businessName,
    amount: invoice.amount,
    dueDate: invoice.due_date,
    paymentLink: invoice.payment_link,
    invoiceReference: invoice.invoice_reference,
    jobDescription: invoice.job_description,
  };
  const current = currentContent(storedContent, facts);
  const subject = current.email.subject;
  const text = current.email.body;

  // The SAME hash the approve route computes — spanning both channels and the
  // recipient identities — so the token issued here is valid for exactly the
  // pair on screen and nothing else.
  const hash = contentVersionHash(current, {
    recipientEmail: reminder.email_to ?? invoice.customer_email,
    recipientPhone: invoice.customer_phone,
    senderName: businessName,
    replyTo: user.email ?? null,
  });

  // Why approval may be refused. Reported so the page can say something true
  // rather than showing an Approve button that the server would reject.
  //
  // The rule itself lives in lib/reminder-send-state.ts and is shared with the
  // send route, so the page can never offer an action the server refuses.
  const status = reminder.status as ReminderSendStatus;

  const { blockedReason, approvable } = reviewAvailability({
    status,
    eligible: Boolean(
      prepareEligibility(
        invoice.reminder_schedules ?? [reminder.schedule],
        invoice.reminders_sent ?? [],
        invoice.due_date
      ).schedule
    ),
  });

  return {
    ok: true,
    data: {
      reminderId: reminder.id,
      invoiceId: reminder.invoice_id,
      status: reminder.status,
      customerName: invoice.customer_name,
      customerEmail: reminder.email_to ?? invoice.customer_email,
      customerPhone: invoice.customer_phone?.trim() || null,
      businessName,
      replyTo: user.email ?? null,
      invoiceReference: invoice.invoice_reference,
      jobDescription: invoice.job_description,
      amount: invoice.amount,
      dueDate: invoice.due_date,
      paymentLink: invoice.payment_link,
      subject,
      body: text,
      tone: invoice.reminder_tone,
      schedule: reminder.schedule,
      scheduleLabel: SCHEDULE_LABELS[reminder.schedule],
      approvable,
      blockedReason,
      reviewToken: issueReviewToken({
        userId: user.id,
        reminderId: reminder.id,
        contentHash: hash,
      }),
      contentHash: hash,
      providerMessageId: reminder.provider_message_id,
      providerLastEvent: reminder.provider_last_event,
      lastSendError: reminder.last_send_error,
    },
  };
}
