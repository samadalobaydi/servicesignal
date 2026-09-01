import { createHash } from "crypto";
import type { ReminderTone, ReminderSchedule } from "@/types";
import { buildReminderEmail } from "./email-templates";
import { buildReminderSms } from "./reminder-sms";

/**
 * The reviewed-content model for a multi-channel reminder.
 *
 * WHY THIS REPLACES LIVE RECOMPOSITION
 *
 * Until now the message existed nowhere: it was rebuilt by buildReminderEmail
 * at preview time and again at send time, and the Note 41 guarantee — that the
 * message reviewed is the message sent — came from that determinism plus a hash
 * over the recomposed result.
 *
 * That is a sound guarantee, and it is also the exact reason a customer could
 * not edit their reminder: an edit has nowhere to live, and the send path would
 * recompose over the top of it. Making editing real therefore means moving the
 * source of truth from "recompute it" to "read the stored version" — and the
 * guarantee has to survive that move, not be traded away for the feature.
 *
 * IT COMES OUT STRONGER, NOT WEAKER. The old model proved "the same inputs
 * still produce the same output". The new model proves something more direct:
 * the exact bytes the owner approved are the exact bytes handed to the
 * provider. Invoice edits, tone changes and due-date rollover all still
 * invalidate a review — not because recomposition drifts, but because saving
 * new content mints a new version hash and every prior approval is bound to the
 * old one.
 *
 * THE VERSION RULES
 *
 *   1. ServiceSignal generates the original for each channel. It is written
 *      once and never rewritten.
 *   2. A customer edit is stored SEPARATELY. The original is untouched.
 *   3. The CURRENT version of a channel is the edit when one exists, otherwise
 *      the original.
 *   4. The version hash covers the current content of BOTH channels, so an SMS
 *      edit invalidates an approval taken over the old pair just as an email
 *      edit does. Approval is for the reviewed pair, not for one channel.
 *   5. Restore clears the edit. It returns the stored original verbatim; it
 *      never calls a generator, so a restored message cannot silently differ
 *      from the one first shown because a due date rolled over in between.
 *   6. Legacy reminders created before this model have no stored content. They
 *      fall back to live composition and are explicitly marked so, rather than
 *      being back-filled with a message nobody reviewed.
 */

// ── Stored shape ────────────────────────────────────────────────────────────

export type ReminderChannel = "email" | "sms";

export interface StoredEmailContent {
  generatedSubject: string;
  generatedBody: string;
  /** null when the owner has not edited this channel. */
  editedSubject: string | null;
  editedBody: string | null;
}

export interface StoredSmsContent {
  generatedBody: string;
  editedBody: string | null;
}

export interface StoredReminderContent {
  email: StoredEmailContent | null;
  sms: StoredSmsContent | null;
}

/** What the customer will actually receive, per channel. */
export interface CurrentEmailContent {
  subject: string;
  body: string;
  edited: boolean;
}

export interface CurrentSmsContent {
  body: string;
  edited: boolean;
}

export interface CurrentReminderContent {
  email: CurrentEmailContent;
  sms: CurrentSmsContent;
  /**
   * True when this reminder predates stored content and the values above were
   * composed live. Surfaced so the UI can decline to offer editing rather than
   * appearing to save into a row with nowhere to store it.
   */
  legacy: boolean;
}

// ── Generation ──────────────────────────────────────────────────────────────

export interface ReminderFacts {
  tone: ReminderTone;
  schedule: ReminderSchedule;
  customerName: string;
  /** The resolved customer-facing sender identity — business_name OR personal_name, whichever the account chose. Never the account's login/contact email. */
  senderName: string;
  amount: number;
  dueDate: string;
  paymentLink?: string | null;
  invoiceReference?: string | null;
  jobDescription?: string | null;
}

/**
 * Generates BOTH channel originals from one set of facts.
 *
 * Called exactly once per reminder, when it is prepared. Both channels are
 * generated together so they can never disagree about the invoice — an email
 * saying £1,240 beside an SMS saying £1,204 would be worse than having no SMS.
 */
export function generateReminderContent(facts: ReminderFacts, now: Date = new Date()): {
  email: { subject: string; body: string; html: string };
  sms: { body: string };
} {
  const { subject, text, html } = buildReminderEmail({
    tone: facts.tone,
    schedule: facts.schedule,
    customerName: facts.customerName,
    senderName: facts.senderName,
    amount: facts.amount,
    dueDate: facts.dueDate,
    paymentLink: facts.paymentLink || undefined,
    invoiceReference: facts.invoiceReference ?? null,
    jobDescription: facts.jobDescription ?? null,
  });

  return {
    email: { subject, body: text, html },
    sms: { body: buildReminderSms(facts, now) },
  };
}

// ── Current version resolution ──────────────────────────────────────────────

/**
 * Resolves what will be sent right now.
 *
 * `stored` missing entirely is the legacy path: compose live from facts, mark
 * it, and offer no editing. Deliberately NOT written back — a silent back-fill
 * would create "original" content the owner never saw and would make an old
 * reminder look edited when it is not.
 */
export function currentContent(
  stored: StoredReminderContent,
  facts: ReminderFacts,
  now: Date = new Date()
): CurrentReminderContent {
  if (!stored.email && !stored.sms) {
    const generated = generateReminderContent(facts, now);
    return {
      email: { subject: generated.email.subject, body: generated.email.body, edited: false },
      sms: { body: generated.sms.body, edited: false },
      legacy: true,
    };
  }

  const generated =
    !stored.email || !stored.sms ? generateReminderContent(facts, now) : null;

  const email: CurrentEmailContent = stored.email
    ? {
        subject: stored.email.editedSubject ?? stored.email.generatedSubject,
        body: stored.email.editedBody ?? stored.email.generatedBody,
        edited: stored.email.editedSubject !== null || stored.email.editedBody !== null,
      }
    : { subject: generated!.email.subject, body: generated!.email.body, edited: false };

  const sms: CurrentSmsContent = stored.sms
    ? {
        body: stored.sms.editedBody ?? stored.sms.generatedBody,
        edited: stored.sms.editedBody !== null,
      }
    : { body: generated!.sms.body, edited: false };

  return { email, sms, legacy: false };
}

/**
 * True when dispatching now would combine content generated under one
 * sender identity with a different, freshly-resolved current identity.
 *
 * A LEGACY reminder (no stored content at all) is never drifted: it composes
 * live from the current identity on every read, so there is nothing frozen
 * to disagree with it.
 *
 * A non-legacy reminder whose generation identity is unknown — NULL, because
 * it predates the column that records it — is treated as drifted. There is
 * nothing to compare against, and assuming agreement is exactly the silent
 * merge of old content with a new identity this check exists to prevent.
 */
export function identityHasDrifted(
  stored: StoredReminderContent,
  generatedSenderName: string | null,
  currentSenderName: string
): boolean {
  const legacy = !stored.email && !stored.sms;
  if (legacy) return false;
  return generatedSenderName !== currentSenderName;
}

/** The original, verbatim. Never regenerated. */
export function originalContent(
  stored: StoredReminderContent
): { email: { subject: string; body: string } | null; sms: { body: string } | null } {
  return {
    email: stored.email
      ? { subject: stored.email.generatedSubject, body: stored.email.generatedBody }
      : null,
    sms: stored.sms ? { body: stored.sms.generatedBody } : null,
  };
}

// ── Version hashing ─────────────────────────────────────────────────────────

/**
 * The fingerprint an approval is bound to.
 *
 * Covers the CURRENT content of both channels plus the recipient identities, so
 * every one of these invalidates a prior approval: editing the SMS, editing the
 * email subject, editing the email body, restoring either channel, or the
 * invoice changing underneath (which changes what a legacy reminder composes).
 *
 * Channel-labelled and length-prefixed so no two distinct pairs can collide by
 * shuffling text across the boundary between them.
 */
export interface ReminderIdentity {
  recipientEmail: string;
  recipientPhone: string | null;
  senderName: string;
  replyTo: string | null;
}

export function contentVersionHash(
  content: CurrentReminderContent,
  identity: ReminderIdentity
): string {
  const parts = [
    "v2",
    identity.recipientEmail,
    identity.recipientPhone ?? "",
    identity.senderName,
    identity.replyTo ?? "",
    "email.subject", content.email.subject,
    "email.body", content.email.body,
    "sms.body", content.sms.body,
  ];
  const canonical = parts.map((p) => `${p.length}:${p}`).join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * HTML for an email body.
 *
 * When the owner has NOT edited, the generated HTML from buildReminderEmail is
 * used unchanged — the designed template, exactly as before.
 *
 * When they HAVE edited, their plain text is escaped and wrapped in the same
 * container styling. It cannot reuse the template, because the template builds
 * its markup from the invoice fields rather than from a body string, and
 * re-running it would send the generated wording instead of theirs — the exact
 * silent-substitution bug this whole model exists to prevent.
 */
export function emailHtmlForBody(body: string, generatedHtml: string, edited: boolean): string {
  if (!edited) return generatedHtml;

  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#0f172a;">${p.replace(/\n/g, "<br />")}</p>`)
    .join("");

  return `<div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">${paragraphs}</div>`;
}

// ── Edit operations (pure) ──────────────────────────────────────────────────

/**
 * Applies an email edit. Returns the NEW stored shape — the caller persists it.
 *
 * An edit that matches the original exactly is stored as null rather than as a
 * duplicate, so the reminder stops describing itself as "Edited" when the owner
 * has typed their way back to where they started.
 */
export function withEmailEdit(
  stored: StoredEmailContent,
  edit: { subject: string; body: string }
): StoredEmailContent {
  const subject = edit.subject.trim();
  const body = edit.body.trim();
  return {
    ...stored,
    editedSubject: subject === stored.generatedSubject.trim() ? null : subject,
    editedBody: body === stored.generatedBody.trim() ? null : body,
  };
}

export function withSmsEdit(stored: StoredSmsContent, body: string): StoredSmsContent {
  const trimmed = body.trim();
  return {
    ...stored,
    editedBody: trimmed === stored.generatedBody.trim() ? null : trimmed,
  };
}

/** Restore = drop the edit. The original is already stored and is not touched. */
export function withEmailRestored(stored: StoredEmailContent): StoredEmailContent {
  return { ...stored, editedSubject: null, editedBody: null };
}

export function withSmsRestored(stored: StoredSmsContent): StoredSmsContent {
  return { ...stored, editedBody: null };
}

// ── Email validation ────────────────────────────────────────────────────────

export type EmailValidationProblem = "subject_empty" | "body_empty" | "subject_too_long" | "body_too_long";

export const EMAIL_SUBJECT_MAX = 200;
export const EMAIL_BODY_MAX = 5000;

export function validateEmailEdit(edit: {
  subject: string;
  body: string;
}): EmailValidationProblem | null {
  if (!edit.subject.trim()) return "subject_empty";
  if (!edit.body.trim()) return "body_empty";
  if (edit.subject.trim().length > EMAIL_SUBJECT_MAX) return "subject_too_long";
  if (edit.body.trim().length > EMAIL_BODY_MAX) return "body_too_long";
  return null;
}

export const EMAIL_VALIDATION_MESSAGE: Record<EmailValidationProblem, string> = {
  subject_empty: "The subject can't be empty.",
  body_empty: "The message can't be empty.",
  subject_too_long: `Please keep the subject under ${EMAIL_SUBJECT_MAX} characters.`,
  body_too_long: `Please keep the message under ${EMAIL_BODY_MAX} characters.`,
};
