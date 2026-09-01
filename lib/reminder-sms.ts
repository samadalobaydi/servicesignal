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
  /** The resolved customer-facing sender identity — business_name OR personal_name, whichever the account chose. Never the account's login/contact email. */
  senderName: string;
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

/**
 * The single "what is owed and when" sentence — this is the SMS's second
 * sentence, after the greeting+identity line, not a mid-sentence fragment.
 *
 * The reference stands alone ("INV003 for £1,500 is 9 days overdue"), not
 * prefixed with "Invoice" — one fewer word costs nothing in clarity (the
 * reference format itself already reads as an invoice number) and every
 * character matters once a message is one GSM-7 unit from a second segment.
 * Only when there is NO reference does "Your invoice" appear, so the
 * sentence is never bare of a subject.
 */
function factSentence(reference: string | null, job: string | null, amountStr: string, timing: string): string {
  const ref = reference?.trim();
  const work = job?.trim();

  // A comma before the amount, not another "for", whenever job description
  // already used "for" — "INV003 for the boiler repair for £50" reads as a
  // stutter; "INV003 for the boiler repair, £50 ..." does not.
  if (ref && work) return `${ref} for ${work}, ${amountStr} ${timing}.`;
  if (ref) return `${ref} for ${amountStr} ${timing}.`;
  if (work) return `Your invoice for ${work}, ${amountStr} ${timing}.`;
  return `Your invoice for ${amountStr} ${timing}.`;
}

/**
 * SMS-only display formatting: drops an unnecessary ".00" for a whole-pound
 * amount ("£1,500.00" -> "£1,500"), keeps real pence ("£1,500.50" stays as
 * is). Display only — formatCurrency() (lib/invoices.ts), the email
 * template, and every stored/accounting value are untouched; the underlying
 * number's precision is never altered, only how this one channel renders it.
 */
function formatCurrencyForSms(amount: number): string {
  const full = formatCurrency(amount);
  return full.endsWith(".00") ? full.slice(0, -3) : full;
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
        : `is ${status.days} days overdue`;
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
      case "firm": return `Please pay here: ${link}`;
      case "final": return `Please pay here to avoid further action: ${link}`;
    }
  }

  switch (tone) {
    case "friendly":
      return "Please pay when you can. Reply if you need payment details.";
    case "firm":
      return "Please pay at your earliest convenience. Reply if you need payment details.";
    case "final":
      return "Please pay now. Reply if you need payment details.";
  }
}

/** Greeting AND identity in one sentence — SMS has no From header, so this is the only place the sender is named. */
function openingPhrase(tone: ReminderTone, customerName: string, senderName: string): string {
  const name = greetingName(customerName);
  const greet = tone === "final" ? `${name},` : `Hi ${name},`;
  return `${greet} this is ${senderName}.`;
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
    tone, customerName, senderName, amount, dueDate,
    paymentLink = null, invoiceReference = null, jobDescription = null,
  } = params;

  const opening = openingPhrase(tone, customerName, senderName);
  const timing = timingPhrase(dueDate, now);
  const money = formatCurrencyForSms(amount);
  const fact = factSentence(invoiceReference, jobDescription, money, timing);
  const ask = paymentPhrase(tone, paymentLink);

  // Three sentences: greeting+identity, the fact (what/how much/when), then
  // the ask. Kept deliberately tight — every clause costs the reader
  // attention on a lock screen.
  return [opening, fact, ask].join(" ");
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
