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
  /** The resolved customer-facing sender identity — business_name OR personal_name, whichever the account chose. Never the account's login/contact email. See lib/sender-identity.ts. */
  senderName: string;
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

function toneClosing(tone: ReminderTone, senderName: string): string {
  switch (tone) {
    case "friendly":
      return `Thanks so much,\n${senderName}`;
    case "firm":
      return `Thank you,\n${senderName}`;
    case "final":
      return `Regards,\n${senderName}`;
  }
}

// ── Subject & body computed from live due-status ────────────────────────────

/**
 * "Payment reminder from <identity>[ — <invoice reference>]" — the identity
 * that resolveSenderIdentity() produced, never the raw account/login email
 * (that was the exact defect this rewrite closes: the old subject read
 * "Overdue invoice reminder from musao...@gmail.com" whenever the resolved
 * name fell through to the account email upstream).
 *
 * The reference is appended only when the invoice has one (migration 007;
 * absent on older invoices) — omitting it rather than printing a dangling
 * "— " keeps every subject a clean sentence regardless of data age.
 */
function subjectLine(
  tone: ReminderTone,
  status: DueStatus,
  senderName: string,
  reference: string | null
): string {
  const ref = reference ? ` — ${reference}` : "";

  // Final reminders always use the final-notice subject when overdue.
  if (tone === "final" && status.kind === "overdue") {
    return `Final payment reminder from ${senderName}${ref}`;
  }
  switch (status.kind) {
    case "upcoming":
      return `Upcoming payment reminder from ${senderName}${ref}`;
    case "due_today":
      return `Payment reminder from ${senderName}${ref} (due today)`;
    case "overdue":
      return `Payment reminder from ${senderName}${ref}`;
  }
}

/**
 * The single "what is owed and when" sentence.
 *
 * Previously two separate sentences — "...invoice X." then "The outstanding
 * balance of Y was due on Z." — which read like two fields from a statement
 * stitched together rather than one thing a person wrote, and "outstanding
 * balance of" is the kind of account-servicing phrase this product
 * deliberately avoids. Merged into one flowing sentence per the reviewed
 * wording direction: "I'm following up on invoice X for Y, which was due on
 * Z." Every combination of null reference and null job description still
 * produces a clean sentence with no dangling punctuation.
 */
function openingFactSentence(
  tone: ReminderTone,
  status: DueStatus,
  reference: string | null,
  job: string | null,
  amountStr: string,
  dueStr: string
): string {
  const lead =
    tone === "friendly"
      ? "Just following up on"
      : tone === "final"
      ? "This is a final notice regarding"
      : "I'm following up on";

  const what =
    reference && job
      ? `invoice ${reference} for ${job}`
      : reference
      ? `invoice ${reference}`
      : job
      ? `your invoice for ${job}`
      : "your unpaid invoice";

  switch (status.kind) {
    case "upcoming":
      return `${lead} ${what} for ${amountStr}, due on ${dueStr}.`;
    case "due_today":
      return `${lead} ${what} for ${amountStr}, due today.`;
    case "overdue":
      // The explicit due date, not a calculated day-count — "which was due
      // on 25 Aug 2026", never "12 days overdue". A relative count is only
      // ever as fresh as the moment it was generated; this reminder's
      // content is composed once and stored (lib/reminder-content.ts) and
      // may be read or approved well after that, so a day-count baked in at
      // generation time can go stale or read as inconsistent. The explicit
      // date is true for as long as the message exists. This applies to
      // every tone alike — "final" is firmer through `lead` and the closing
      // request, not through a bigger number.
      return `${lead} ${what} for ${amountStr}, which was due on ${dueStr}.`;
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
    : " If you need the payment details again, just reply to this email.";

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
  const { tone, customerName, senderName, amount, dueDate, paymentLink } = params;

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
  const closing = toneClosing(tone, senderName);
  const subject = subjectLine(tone, status, senderName, reference);

  // ── One flowing paragraph, not stacked fields ──────────────────────────
  //
  // The old message opened with "This is a reminder from <business>." — which
  // the sign-off already says, and which the From line already says. It has
  // been dropped: repeating the sender three times is what made the message
  // read as machine-assembled.
  const bodyParagraph = [
    openingFactSentence(tone, status, reference, job, amountStr, dueStr),
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
          <p style="font-size:11px;color:#999999;margin-top:16px;">Sent via ServiceSignal on behalf of ${escapeHtml(senderName)}</p>
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
