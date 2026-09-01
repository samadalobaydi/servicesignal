import "server-only";
import { getSupabaseServer } from "@/lib/supabase-server";
import { currentContent, contentVersionHash, identityHasDrifted, type ReminderFacts } from "@/lib/reminder-content";
import { loadStoredContent, isTableAbsent } from "@/lib/reminder-channel-store";
import { prepareEligibility } from "@/lib/reminder-schedule";
import { SCHEDULE_LABELS } from "@/lib/invoices";
import { getDueStatusLabel } from "@/lib/date-status";
import { resolveSenderIdentity, resolveSenderIdentityForDisplay } from "@/lib/sender-identity";
import { isRegenerateEnabled } from "@/lib/regenerate-capability";
import {
  reviewAvailability,
  type ReminderSendStatus,
  type ReviewBlockedReason,
} from "@/lib/reminder-send-state";
import {
  channelRetryable,
  partiallySentFromStatuses,
  partialSendSummary,
  type ChannelStatuses,
} from "@/lib/reminder-aggregate";
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

  /** Sender — the resolved customer-facing identity, business_name OR personal_name. Never the login email. */
  senderName: string;
  replyTo: string | null;
  /**
   * True when a strictly-resolved sender identity IS configured but this
   * reminder's stored content was generated under a different one (or one
   * that predates generated_sender_name, unprovable). Approve/Retry refuse
   * with state "identity_drift" in exactly this condition — this flag lets
   * the page offer "Regenerate reminder" instead of leaving the owner to
   * discover it by clicking Approve and reading an error.
   */
  identityDrifted: boolean;
  /**
   * Whether the Regenerate ACTION should be offered at all — independent of
   * identityDrifted, which must keep driving the Approve-button refusal
   * whether or not this is true (see lib/regenerate-capability.ts). A
   * courtesy for the UI only: the API route enforces this gate itself and
   * does not trust this flag or anything else the browser sends.
   */
  regenerateEnabled: boolean;

  /** Invoice */
  invoiceReference: string | null;
  jobDescription: string | null;
  amount: number;
  dueDate: string;
  paymentLink: string | null;

  /** Message — rebuilt by the canonical composer. Both channels, always. */
  subject: string;
  body: string;
  /** The exact stored/composed SMS text — the same bytes buildReminderSms() produced. */
  smsBody: string;
  tone: ReminderTone;
  schedule: ReminderSchedule;
  scheduleLabel: string;
  /**
   * The invoice's LIVE due status ("3 days overdue", "Due today"), computed
   * independently of which schedule checkpoint fired. Shown alongside
   * scheduleLabel so a checkpoint name (which only exists at specific
   * day-offsets) never reads as contradicting the invoice's actual current
   * age — e.g. "On the due date" for an invoice that is genuinely 1 day
   * overdue, because there is no day+1 checkpoint in the model.
   */
  dueStatusLabel: string;

  /** True only when the reminder can genuinely be approved right now. */
  approvable: boolean;
  /** Per-channel truth, read from reminder_channel_messages. */
  channelStatuses: ChannelStatuses;
  /** One channel reached the provider and one did not. */
  partiallySent: boolean;
  /** "Email sent · SMS failed", or null. Plain words, never provider jargon. */
  partialSummary: string | null;
  /** The single channel a per-channel retry may attempt, or null. */
  retryableChannel: "email" | "sms" | null;
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
  const REVIEW_SELECT =
    "id, status, schedule, email_to, invoice_id, provider_message_id, " +
    "provider_last_event, last_send_error, generated_sender_name, " +
    "invoices!inner(customer_name, customer_email, customer_phone, amount, due_date, " +
    "payment_link, reminder_tone, status, reminder_schedules, reminders_sent, " +
    "invoice_reference, job_description)";

  let { data: row, error } = await supabase
    .from("reminder_logs")
    .select(REVIEW_SELECT)
    .eq("id", reminderId)
    .eq("user_id", user.id)
    .maybeSingle();

  // Migration 015 not applied here yet: degrade the same way
  // lib/approval-wiring.ts's loadApprovalReminder already does — never break
  // the review page over an unapplied migration. A missing
  // generated_sender_name reads as null, which the drift check below treats
  // as unprovable (identityDrifted true) for any non-legacy reminder, so the
  // Review page correctly offers regeneration rather than silently hiding
  // the state.
  if (error && isTableAbsent(error.code)) {
    const fallback = await supabase
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
    row = fallback.data
      ? ({ ...(fallback.data as unknown as Record<string, unknown>), generated_sender_name: null } as unknown as typeof row)
      : (fallback.data as unknown as typeof row);
    error = fallback.error;
  }

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
    generated_sender_name: string | null;
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

  // The SAME resolver contract the send route uses (resolveSenderIdentity,
  // via its display-only wrapper here), reading the account's EXPLICIT
  // preference — never inferred from whichever name field happens to be
  // populated. This page is display-only — never a send gate — so a
  // neutral placeholder stands in when the identity isn't resolvable yet;
  // it is never the account email, matching the send path's refusal to
  // ever use one as the customer-facing identity.
  const { data: profile } = await supabase
    .from("profiles")
    .select("sender_identity, business_name, personal_name")
    .eq("user_id", user.id)
    .maybeSingle();

  const senderName = resolveSenderIdentityForDisplay({
    preference: profile?.sender_identity ?? null,
    businessName: profile?.business_name,
    personalName: profile?.personal_name,
  });

  // The STRICT resolution, used ONLY to decide identityDrifted below — never
  // to gate this page's rendering (see the display-only reasoning above).
  // Distinct on purpose from missingSenderIdentity: an account with no
  // identity configured at all is a different, already-handled problem
  // (Approve refuses with state "missing_sender_identity"); this flag is
  // specifically "identity IS configured, but disagrees with what this
  // reminder's stored content was generated under".
  const strictIdentity = resolveSenderIdentity({
    preference: profile?.sender_identity ?? null,
    businessName: profile?.business_name,
    personalName: profile?.personal_name,
  });

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
    senderName,
    // Display-only, same as senderName above — strictIdentity is resolved
    // strictly (for identityDrifted) but reused here purely for wording;
    // null (unconfigured) falls back to the business-style SMS phrasing,
    // same as the display placeholder itself does.
    senderKind: strictIdentity?.kind ?? null,
    amount: invoice.amount,
    dueDate: invoice.due_date,
    paymentLink: invoice.payment_link,
    invoiceReference: invoice.invoice_reference,
    jobDescription: invoice.job_description,
  };
  const current = currentContent(storedContent, facts);
  const subject = current.email.subject;
  const text = current.email.body;
  const smsBody = current.sms.body;

  // True only when identity IS configured but disagrees with the identity
  // this reminder's stored content was generated under (or that generation
  // identity is unknown/predates the column) — the exact condition
  // lib/reminder-approval.ts's identityHasDrifted gate refuses on. Computed
  // here, at render time, so the page can offer "Regenerate reminder"
  // proactively instead of only after a failed Approve click.
  const identityDrifted = strictIdentity
    ? identityHasDrifted(storedContent, reminder.generated_sender_name, strictIdentity.senderName)
    : false;

  // The SAME hash the approve route computes — spanning both channels and the
  // recipient identities — so the token issued here is valid for exactly the
  // pair on screen and nothing else.
  const hash = contentVersionHash(current, {
    recipientEmail: reminder.email_to ?? invoice.customer_email,
    recipientPhone: invoice.customer_phone,
    senderName,
    replyTo: user.email ?? null,
  });

  // Why approval may be refused. Reported so the page can say something true
  // rather than showing an Approve button that the server would reject.
  //
  // The rule itself lives in lib/reminder-send-state.ts and is shared with the
  // send route, so the page can never offer an action the server refuses.
  const status = reminder.status as ReminderSendStatus;

  // Per-channel truth. The parent cannot express "email sent, SMS failed", so
  // this is read from reminder_channel_messages and folded by the same pure
  // helpers Active Chasing and Needs Attention use.
  const { data: channelRows } = await supabase
    .from("reminder_channel_messages")
    .select("channel, status")
    .eq("reminder_log_id", reminder.id);

  const channelStatuses = Object.fromEntries(
    ((channelRows ?? []) as { channel: string; status: string }[]).map((r) => [r.channel, r.status])
  ) as ChannelStatuses;

  const partiallySent = partiallySentFromStatuses(channelStatuses);
  const retryableChannel =
    (["email", "sms"] as const).find((c) => channelRetryable(channelStatuses, c)) ?? null;

  const { blockedReason, approvable } = reviewAvailability({
    status,
    partiallySent,
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
      senderName,
      replyTo: user.email ?? null,
      identityDrifted,
      regenerateEnabled: isRegenerateEnabled(),
      invoiceReference: invoice.invoice_reference,
      jobDescription: invoice.job_description,
      amount: invoice.amount,
      dueDate: invoice.due_date,
      paymentLink: invoice.payment_link,
      subject,
      body: text,
      smsBody,
      tone: invoice.reminder_tone,
      schedule: reminder.schedule,
      scheduleLabel: SCHEDULE_LABELS[reminder.schedule],
      dueStatusLabel: getDueStatusLabel(invoice.due_date),
      approvable,
      blockedReason,
      // What actually happened per channel, so the page can stop claiming both
      // were sent when one was not.
      channelStatuses,
      partiallySent,
      partialSummary: partialSendSummary(channelStatuses),
      /** The one channel a per-channel retry may attempt, or null. */
      retryableChannel,
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
