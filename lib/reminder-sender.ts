import type { SupabaseClient } from "@supabase/supabase-js";
import { getResendClient } from "@/lib/resend";
import type { ReminderSchedule } from "@/types";

/**
 * Sends a reminder email via Resend and updates reminder_logs +
 * invoices.reminders_sent accordingly. Used by the cron route when
 * profile.reminder_mode === 'auto'.
 *
 * Fails gracefully if RESEND_API_KEY is missing — marks the log
 * 'failed' with a clear error_message rather than throwing.
 */
export async function sendAndUpdateLog(params: {
  supabase: SupabaseClient;
  logId: string;
  to: string;
  replyTo?: string;
  /**
   * The resolved sender identity's From header (reminderFromHeader() —
   * lib/sender-identity.ts), built by the caller from the SAME strict
   * identity it already resolved to reach this call. Never the generic
   * REMINDER_FROM constant: this is the second real send path (alongside
   * Approve/Retry), and a hardcoded "ServiceSignal" From here would
   * contradict a body/subject that correctly names the resolved identity.
   */
  from: string;
  subject: string;
  html: string;
  text: string;
  invoiceId: string;
  schedule: ReminderSchedule;
}): Promise<boolean> {
  const { supabase, logId, to, replyTo, from, subject, html, text, invoiceId, schedule } = params;

  const resend = getResendClient();

  if (!resend) {
    await supabase
      .from("reminder_logs")
      .update({ status: "failed", error_message: "RESEND_API_KEY not configured" })
      .eq("id", logId);
    return false;
  }

  try {
    const { error: sendError } = await resend.emails.send({
      from,
      to,
      replyTo,
      subject,
      html,
      text,
    });

    if (sendError) {
      await supabase
        .from("reminder_logs")
        .update({ status: "failed", error_message: sendError.message })
        .eq("id", logId);
      return false;
    }

    await supabase
      .from("reminder_logs")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", logId);

    const { data: invoiceRow } = await supabase
      .from("invoices")
      .select("reminders_sent")
      .eq("id", invoiceId)
      .single();

    const currentSent: ReminderSchedule[] = invoiceRow?.reminders_sent ?? [];
    if (!currentSent.includes(schedule)) {
      await supabase
        .from("invoices")
        .update({ reminders_sent: [...currentSent, schedule] })
        .eq("id", invoiceId);
    }

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown send error";
    await supabase
      .from("reminder_logs")
      .update({ status: "failed", error_message: message })
      .eq("id", logId);
    return false;
  }
}
