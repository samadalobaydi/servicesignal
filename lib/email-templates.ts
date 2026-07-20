import type { ReminderTone, ReminderSchedule } from "@/types";
import { getInvoiceDueStatus, type InvoiceDueStatus } from "./date-status";
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

/**
 * The due-status of an invoice, computed live from due_date vs today's
 * Europe/London date via the canonical source of truth (lib/date-status.ts).
 * This — not the schedule name — drives all wording.
 */
type DueStatus = InvoiceDueStatus;

function resolveDueStatus(dueDate: string): DueStatus {
  return getInvoiceDueStatus(dueDate);
}

// ── Tone-specific greeting / closing (unchanged) ────────────────────────────

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

// ── Subject & body computed from live due-status ────────────────────────────

function subjectLine(
  tone: ReminderTone,
  status: DueStatus,
  businessName: string
): string {
  // Final reminders always use the final-notice subject when overdue.
  if (tone === "final" && status.kind === "overdue") {
    return `Final reminder: overdue invoice from ${businessName}`;
  }
  switch (status.kind) {
    case "upcoming":
      return `Upcoming invoice from ${businessName}`;
    case "due_today":
      return `Invoice due today — ${businessName}`;
    case "overdue":
      return `Overdue invoice reminder from ${businessName}`;
  }
}

/**
 * The core sentence describing the invoice's status. Always derived from the
 * live due-status and the actual due date — never from the schedule name.
 */
function statusSentence(
  tone: ReminderTone,
  status: DueStatus,
  amountStr: string,
  dueStr: string
): string {
  // Final reminder, overdue: spell out the exact days overdue.
  if (tone === "final" && status.kind === "overdue") {
    return `This is a final notice. Your invoice for ${amountStr} is now ${status.days} ${status.days === 1 ? "day" : "days"} overdue. It was originally due on ${dueStr} and remains unpaid.`;
  }

  switch (status.kind) {
    case "upcoming":
      return `Your invoice for ${amountStr} is due in ${status.days} ${status.days === 1 ? "day" : "days"} (${dueStr}).`;
    case "due_today":
      return `Your invoice for ${amountStr} is due today (${dueStr}).`;
    case "overdue":
      return `Your invoice for ${amountStr} is now ${status.days} ${status.days === 1 ? "day" : "days"} overdue. It was due on ${dueStr} and remains unpaid. Please arrange payment as soon as possible.`;
  }
}

/** Wraps the status sentence with light tone-specific framing. */
function toneBody(
  tone: ReminderTone,
  status: DueStatus,
  amountStr: string,
  dueStr: string
): string {
  const core = statusSentence(tone, status, amountStr, dueStr);

  // Final tone already reads as a complete notice.
  if (tone === "final") return core;

  // The overdue sentence already ends with a payment request, so don't
  // append a second one — just add a light friendly softener if applicable.
  if (status.kind === "overdue") {
    return tone === "friendly"
      ? `${core} If it's already on its way, please ignore this note.`
      : core;
  }

  switch (tone) {
    case "friendly":
      return `${core} No stress if it's already on its way — this is just a gentle reminder in case it slipped through.`;
    case "firm":
      return `${core} Please arrange payment at your earliest convenience.`;
  }
}

// ── Main builder ──────────────────────────────────────────────────────────

export function buildReminderEmail(params: BuildReminderEmailParams): ReminderEmailContent {
  const { tone, customerName, businessName, amount, dueDate, paymentLink } = params;

  const amountStr = formatCurrency(amount);
  const dueStr = formatDate(dueDate);

  // Status is computed live from the due date vs today (Europe/London),
  // NOT from params.schedule — that only reflects when the reminder was queued.
  const status = resolveDueStatus(dueDate);

  const opening = toneOpening(tone, customerName);
  const body = toneBody(tone, status, amountStr, dueStr);
  const closing = toneClosing(tone, businessName);
  const subject = subjectLine(tone, status, businessName);

  const fromLine = `This is a reminder from ${businessName}.`;

  const paymentLine = paymentLink
    ? `\n\nYou can pay securely using this link: ${paymentLink}`
    : "";

  const text = `${opening}\n\n${fromLine}\n\n${body}${paymentLine}\n\n${closing}`;

  const paymentHtml = paymentLink
    ? `<p style="margin:20px 0 12px 0;font-size:15px;color:#1a1a1a;line-height:1.6;">You can pay securely using the button below.</p>
                <p style="margin:0 0 12px 0;"><a href="${escapeHtml(paymentLink)}" style="display:inline-block;background:#0ea5c4;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Pay Now</a></p>
                <p style="margin:0 0 8px 0;font-size:12px;color:#666666;line-height:1.5;">If the button doesn&#39;t work, copy and paste this link: ${escapeHtml(paymentLink)}</p>`
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
