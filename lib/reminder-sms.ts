import type { ReminderTone, ReminderSchedule } from "@/types";
import { getInvoiceDueStatus } from "./date-status";
import { formatCurrency } from "./invoices";
import { greetingName } from "./email-templates";

/**
 * The SMS reminder generator.
 *
 * Written from the same factual context as buildReminderEmail — same invoice,
 * same tone, same live due-status — but NOT derived from it. An SMS is not a
 * truncated email: it has no subject, no sign-off block, no paragraphs, and a
 * recipient who will read it on a lock screen. Truncating the email would
 * produce a message that trails off mid-sentence, which is worse than useless
 * when it is chasing money.
 *
 * WHAT IT WILL NEVER SAY
 *
 * It never claims ServiceSignal processes, holds, detects or monitors payment,
 * and it never invents a payment method. When no payment link is stored it does
 * not guess at "your usual method" — it asks the customer to reply for details,
 * which is true regardless of how the business actually takes money.
 *
 * IDENTIFICATION. SMS has no From header the recipient can inspect, so the
 * business name is carried in the message body itself. Without it the customer
 * receives a demand for money from an unknown number, which is
 * indistinguishable from a scam.
 */

export interface BuildReminderSmsParams {
  tone: ReminderTone;
  schedule: ReminderSchedule;
  customerName: string;
  businessName: string;
  amount: number;
  /** ISO date. */
  dueDate: string;
  paymentLink?: string | null;
  invoiceReference?: string | null;
  jobDescription?: string | null;
}

/**
 * A defensive upper bound on a STORED reminder, not a claim about SMS.
 *
 * Deliberately NOT 160: that number is only correct for a single GSM-7 segment,
 * and concatenated messages and UCS-2 encoding both make it wrong. ServiceSignal
 * has no segment calculator, so this file states no segment count anywhere.
 * 480 is roughly three GSM-7 segments — generous for a generated reminder, tight
 * enough that an accidental paste of a whole email is refused.
 */
export const SMS_MAX_LENGTH = 480;

/** How the message refers to the invoice. Grammar, not stacked fields. */
function invoicePhrase(reference: string | null, job: string | null): string {
  const ref = reference?.trim();
  const work = job?.trim();
  if (ref && work) return `invoice ${ref} for ${work}`;
  if (ref) return `invoice ${ref}`;
  if (work) return `your invoice for ${work}`;
  return "your invoice";
}

/** The timing clause, computed live from the due date — never from the label. */
function timingPhrase(dueDate: string, now: Date): string {
  const status = getInvoiceDueStatus(dueDate, now);
  switch (status.kind) {
    case "upcoming":
      return "is due shortly";
    case "due_today":
      return "is due today";
    case "overdue":
      return status.days === 1
        ? "was due yesterday"
        : `is now ${status.days} days overdue`;
  }
}

/**
 * The closing ask.
 *
 * With a link: the URL appears bare. SMS clients linkify a plain URL reliably;
 * wrapping it in punctuation is the most common way to break that.
 * Without a link: an offer to send details, never an assumption about how the
 * business is paid.
 */
function paymentPhrase(tone: ReminderTone, paymentLink: string | null): string {
  const link = paymentLink?.trim();

  if (link) {
    switch (tone) {
      case "friendly": return `You can pay here: ${link}`;
      case "firm": return `Please arrange payment here: ${link}`;
      case "final": return `Please pay here to avoid further action: ${link}`;
    }
  }

  switch (tone) {
    case "friendly":
      return "Please arrange payment when you can. Reply if you need the payment details again.";
    case "firm":
      return "Please arrange payment at your earliest convenience. Reply if you need the payment details resent.";
    case "final":
      return "Please arrange payment now. Reply if you need the payment details resent.";
  }
}

function openingPhrase(tone: ReminderTone, customerName: string): string {
  const name = greetingName(customerName);
  switch (tone) {
    case "friendly": return `Hi ${name},`;
    case "firm": return `Hi ${name},`;
    case "final": return `${name},`;
  }
}

/**
 * Builds the SMS body.
 *
 * Shape: greeting, who it is from, what is owed and when it was due, then the
 * payment ask. Four short sentences — a trade's customer should understand it
 * from the notification preview without opening it.
 */
export function buildReminderSms(
  params: BuildReminderSmsParams,
  now: Date = new Date()
): string {
  const {
    tone, customerName, businessName, amount, dueDate,
    paymentLink = null, invoiceReference = null, jobDescription = null,
  } = params;

  const opening = openingPhrase(tone, customerName);
  const subject = invoicePhrase(invoiceReference, jobDescription);
  const timing = timingPhrase(dueDate, now);
  const money = formatCurrency(amount);
  const ask = paymentPhrase(tone, paymentLink);

  // The business name leads the factual sentence: on SMS it is the only thing
  // identifying the sender.
  // Kept deliberately tight. "The balance of X is now N days overdue" became
  // "X ... is now N days overdue" — the words removed carried no information a
  // customer needs, and on SMS every clause costs the reader attention on a
  // lock screen.
  return [
    opening,
    `${businessName} here about ${subject}.`,
    `${money} ${timing}.`,
    ask,
  ].join(" ");
}

export type SmsValidationProblem = "empty" | "too_long";

/** Validates a customer-edited SMS body. Shared by the API and the editor. */
export function validateSmsBody(body: string): SmsValidationProblem | null {
  const trimmed = body.trim();
  if (!trimmed) return "empty";
  if (trimmed.length > SMS_MAX_LENGTH) return "too_long";
  return null;
}

export const SMS_VALIDATION_MESSAGE: Record<SmsValidationProblem, string> = {
  empty: "The message can't be empty.",
  too_long: `Please keep the message under ${SMS_MAX_LENGTH} characters.`,
};
