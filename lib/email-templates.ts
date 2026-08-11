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
  /** Migration 007. Absent on every invoice created before it. */
  invoiceReference?: string | null;
  /** Migration 007. Optional context, e.g. "Boiler repair at 18 King Street". */
  jobDescription?: string | null;
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

// ── Greeting ────────────────────────────────────────────────────────────────

/**
 * The name to greet by: the first whitespace-separated token.
 *
 * "Abdul Alobaydi" reads better as "Hi Abdul" than "Hi Abdul Alobaydi", which
 * sounds like a form letter. Deliberately NOT clever — no title stripping, no
 * name-order detection, no library. Those get non-Western names wrong in ways
 * that are worse than being slightly formal.
 *
 * Falls back to the whole string when there is no space, which is what keeps
 * company names ("Oakfield Plumbing Ltd" -> "Oakfield") from being mangled
 * beyond recognition — and a single-word name is returned untouched.
 *
 * KNOWN LIMITATION, accepted: "Dr Smith" greets as "Dr". Rare enough, and the
 * alternative is a title list that will always be incomplete.
 */
export function greetingName(customerName: string): string {
  const trimmed = customerName.trim();
  if (!trimmed) return "there";
  const first = trimmed.split(/\s+/)[0];
  return first || trimmed;
}

function toneOpening(tone: ReminderTone, customerName: string): string {
  const name = greetingName(customerName);
  switch (tone) {
    case "friendly":
      return `Hi ${name},`;
    case "firm":
      return `Hi ${name},`;
    case "final":
      return `Dear ${name},`;
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
 * The opening line that names WHAT is being chased.
 *
 * Previously the invoice reference sat on its own orphaned line — "Invoice
 * INV-001 (kitchen work)" — floating between a redundant "This is a reminder
 * from X" sentence and the amount. Reading it back, the message was obviously
 * three database fields stacked up rather than something a person wrote.
 *
 * It now opens the sentence instead, so the reference and job description are
 * carried by grammar. Every combination of null reference and null job
 * description still produces a clean sentence with no dangling punctuation —
 * that is what the branching below is for, not decoration.
 */
function subjectSentence(
  tone: ReminderTone,
  reference: string | null,
  job: string | null
): string {
  const lead =
    tone === "friendly"
      ? "Just following up on"
      : tone === "final"
      ? "This is a final notice regarding"
      : "I'm following up on";

  if (reference && job) return `${lead} invoice ${reference} for ${job}.`;
  if (reference) return `${lead} invoice ${reference}.`;
  if (job) return `${lead} your invoice for ${job}.`;
  return `${lead} your unpaid invoice.`;
}

/**
 * The balance-and-date sentence, derived from the LIVE due status — never from
 * the schedule name, which only records when the reminder was queued.
 */
function balanceSentence(
  tone: ReminderTone,
  status: DueStatus,
  amountStr: string,
  dueStr: string
): string {
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

  switch (status.kind) {
    case "upcoming":
      return `The balance of ${amountStr} is due on ${dueStr}.`;
    case "due_today":
      return `The balance of ${amountStr} is due today, ${dueStr}.`;
    case "overdue":
      // Final states the age explicitly; the others keep it lighter. All three
      // name the amount and the original due date, which is the evidence the
      // recipient actually needs.
      return tone === "final"
        ? `The outstanding balance of ${amountStr} was due on ${dueStr} and is now ${days(status.days)} overdue.`
        : `The outstanding balance of ${amountStr} was due on ${dueStr}.`;
  }
}

/**
 * The closing request. This is where the three tones genuinely differ — if
 * they all asked in the same words, the tone setting would be decorative.
 *
 * None of them threaten, invoke legal process, or invent urgency. "Final" is
 * firmer and more explicit about the delay; it does not become a demand.
 */
function requestSentence(tone: ReminderTone, status: DueStatus, hasPayment: boolean): string {
  // NO-PAYMENT-LINK WORDING.
  //
  // This previously read "using your usual payment method", which asserts that
  // ServiceSignal knows how this business is paid. It does not: when no payment
  // link is stored, the product holds no payment information of any kind. The
  // customer may also have no idea what the "usual" method is — a first-time
  // customer certainly does not.
  //
  // The replacement asks for payment without claiming knowledge, and offers the
  // one thing that is always true: replying reaches the business, because
  // Reply-To is set to the owner's account address on every send.
  // Leading space, empty when there is no link, so every sentence below reads
  // correctly with or without it and none needs a second variant.
  const how = hasPayment ? " using the link below" : "";

  // Offered only when no link exists: it is the one route to payment details
  // that is always true, because Reply-To is set to the owner's own account
  // address on every send.
  const replyOffer = hasPayment
    ? ""
    : " If you need the payment details resent, just reply to this email.";

  if (status.kind === "upcoming") {
    switch (tone) {
      case "friendly":
        return `No action needed yet — just a heads-up so it doesn't catch you out.`;
      case "firm":
      case "final":
        return `Please arrange payment${how} by the due date.${replyOffer}`;
    }
  }

  switch (tone) {
    case "friendly":
      return `Please arrange payment${how} when you get a moment. If it's already on its way, please ignore this note.${replyOffer}`;
    case "firm":
      return `Please arrange payment${how} at your earliest convenience.${replyOffer}`;
    case "final":
      return `Please arrange payment${how} as soon as possible so we can close this off.${replyOffer}`;
  }
}

// ── Main builder ──────────────────────────────────────────────────────────

export function buildReminderEmail(params: BuildReminderEmailParams): ReminderEmailContent {
  const { tone, customerName, businessName, amount, dueDate, paymentLink } = params;

  // Both optional by construction: invoices predating migration 007 have
  // neither, and the reminder must read correctly without them rather than
  // printing an empty reference or a dangling "for ".
  const reference = params.invoiceReference?.trim() || null;
  const job = params.jobDescription?.trim() || null;

  const amountStr = formatCurrency(amount);
  const dueStr = formatDate(dueDate);

  // Status is computed live from the due date vs today (Europe/London),
  // NOT from params.schedule — that only reflects when the reminder was queued.
  const status = resolveDueStatus(dueDate);

  const opening = toneOpening(tone, customerName);
  const closing = toneClosing(tone, businessName);
  const subject = subjectLine(tone, status, businessName);

  // ── One flowing paragraph, not stacked fields ──────────────────────────
  //
  // The old message opened with "This is a reminder from <business>." — which
  // the sign-off already says, and which the From line already says. It has
  // been dropped: repeating the sender three times is what made the message
  // read as machine-assembled.
  const bodyParagraph = [
    subjectSentence(tone, reference, job),
    balanceSentence(tone, status, amountStr, dueStr),
    requestSentence(tone, status, !!paymentLink),
  ].join(" ");

  const paymentLine = paymentLink
    ? `\n\nPay here: ${paymentLink}`
    : "";

  const text = `${opening}\n\n${bodyParagraph}${paymentLine}\n\n${closing}`;

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
                <p style="margin:0 0 8px 0;font-size:15px;color:#1a1a1a;line-height:1.6;">${escapeHtml(bodyParagraph)}</p>
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
