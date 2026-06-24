import type { ReminderTone, ReminderSchedule } from "@/types";
import { scheduleTimingPhrase } from "./reminder-schedule";
import { formatCurrency, formatDate } from "./invoices";

export interface ReminderEmailContent {
  subject: string;
  html: string;
  text: string;
}

interface BuildReminderEmailParams {
  tone: ReminderTone;
  schedule: ReminderSchedule;
  customerName: string;
  businessName: string;   // profile.business_name, falls back to user email upstream
  amount: number;
  dueDate: string;        // ISO date
  paymentLink?: string;
}

// ── Tone-specific copy ──────────────────────────────────────────────────────

function toneOpening(tone: ReminderTone, customerName: string): string {
  switch (tone) {
    case "friendly":
      return `Hi ${customerName}, just a friendly note from us.`;
    case "firm":
      return `Hi ${customerName},`;
    case "final":
      return `Dear ${customerName},`;
  }
}

function toneBody(tone: ReminderTone, timingPhrase: string, amountStr: string, dueStr: string): string {
  switch (tone) {
    case "friendly":
      return `Just a quick heads up that your invoice for ${amountStr} ${timingPhrase} (due ${dueStr}). No stress if it's already on its way — this is just a gentle reminder in case it slipped through.`;
    case "firm":
      return `This is a reminder that your invoice for ${amountStr} ${timingPhrase} (due ${dueStr}). Please arrange payment at your earliest convenience.`;
    case "final":
      return `This is a final notice. Your invoice for ${amountStr} ${timingPhrase} (originally due ${dueStr}) remains unpaid. Please settle this invoice as soon as possible to avoid further action.`;
  }
}

function toneClosing(tone: ReminderTone, businessName: string): string {
  switch (tone) {
    case "friendly":
      return `Thanks so much,\n${businessName}`;
    case "firm":
      return `Thank you,\n${businessName}`;
    case "final":
      return `Regards,\n${businessName}`;
  }
}

function subjectLine(tone: ReminderTone, schedule: ReminderSchedule, businessName: string): string {
  if (schedule === "before_due_3_days") {
    return `Upcoming invoice from ${businessName}`;
  }
  if (schedule === "due_today") {
    return `Invoice due today — ${businessName}`;
  }
  if (tone === "final") {
    return `Final reminder: overdue invoice from ${businessName}`;
  }
  return `Reminder: invoice overdue — ${businessName}`;
}

// ── Main builder ──────────────────────────────────────────────────────────

export function buildReminderEmail(params: BuildReminderEmailParams): ReminderEmailContent {
  const { tone, schedule, customerName, businessName, amount, dueDate, paymentLink } = params;

  const amountStr = formatCurrency(amount);
  const dueStr = formatDate(dueDate);
  const timingPhrase = scheduleTimingPhrase(schedule);

  const opening = toneOpening(tone, customerName);
  const body = toneBody(tone, timingPhrase, amountStr, dueStr);
  const closing = toneClosing(tone, businessName);
  const subject = subjectLine(tone, schedule, businessName);

  const fromLine = `This is a reminder from ${businessName}.`;

  const paymentLine = paymentLink
    ? `\n\nYou can pay here: ${paymentLink}`
    : "";

  const text = `${opening}\n\n${fromLine}\n\n${body}${paymentLine}\n\n${closing}`;

  const paymentHtml = paymentLink
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(paymentLink)}" style="display:inline-block;background:#00c8ff;color:#05080f;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;">Pay Now</a></p>`
    : "";

  const html = `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1a1a1a;">${escapeHtml(opening)}</p>
                <p style="margin:0 0 16px 0;font-size:13px;color:#666666;">${escapeHtml(fromLine)}</p>
                <p style="margin:0 0 8px 0;font-size:15px;color:#1a1a1a;line-height:1.6;">${escapeHtml(body)}</p>
                ${paymentHtml}
                <p style="margin:24px 0 0 0;font-size:15px;color:#1a1a1a;white-space:pre-line;">${escapeHtml(closing)}</p>
              </td>
            </tr>
          </table>
          <p style="font-size:11px;color:#999999;margin-top:16px;">Sent via ServiceSignal on behalf of ${escapeHtml(businessName)}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();

  return { subject, html, text };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
