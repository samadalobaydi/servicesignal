/**
 * Everything about an invoice form that is NOT React.
 *
 * Two surfaces now collect an invoice: the dashboard drawer (AddInvoiceForm)
 * and the onboarding first-invoice step. They must agree on the field rules,
 * the presets and the error wording, or a value the dashboard accepts will be
 * rejected during onboarding and the user will reasonably conclude the product
 * is broken. Shared constants are the only way that agreement survives a later
 * edit to one of the two.
 *
 * Pure functions and plain data only — no hooks, no JSX, no "use client". This
 * module is therefore importable from server components and route handlers,
 * which matters because the API should eventually validate with the same rules
 * the browser used rather than a hand-written copy of them.
 */

import type { InvoiceFormData, ReminderSchedule, ReminderTone } from "@/types";
import { parseAmount, isValidIsoDate } from "@/lib/invoice-input";

/**
 * A blank form. Its schedules deliberately match the Standard preset, so the
 * preset shown as selected on open is genuinely the one in effect.
 */
export const EMPTY_INVOICE_FORM: InvoiceFormData = {
  invoice_reference: "",
  job_description: "",
  customer_name: "",
  customer_email: "",
  customer_phone: "",
  amount: "",
  due_date: "",
  payment_link: "",
  reminder_tone: "firm",
  reminder_schedules: ["due_today", "overdue_3_days", "overdue_7_days"],
};

export interface ToneOption {
  value: ReminderTone;
  label: string;
  desc: string;
  color: string;
}

export const TONE_OPTIONS: readonly ToneOption[] = [
  { value: "friendly", label: "Friendly", desc: "Polite nudge, good faith", color: "#059669" },
  { value: "firm",     label: "Firm",     desc: "Professional & direct",    color: "#0891b2" },
  { value: "final",    label: "Final",    desc: "Urgent, last reminder",    color: "#dc2626" },
];

export type PresetKey = "light" | "standard" | "firm" | "custom";

export interface PresetOption {
  key: PresetKey;
  title: string;
  subtitle: string;
  summary?: string;
  badge?: string;
  /** Absent on "custom", which preserves whatever the user has picked. */
  schedules?: readonly ReminderSchedule[];
}

export const PRESETS: readonly PresetOption[] = [
  {
    key: "light", title: "Light", subtitle: "Friendly nudge",
    summary: "On the due date, then 7 days overdue",
    schedules: ["due_today", "overdue_7_days"],
  },
  {
    key: "standard", title: "Standard", subtitle: "Balanced follow-up", badge: "Recommended",
    summary: "On the due date, then 3 and 7 days overdue",
    schedules: ["due_today", "overdue_3_days", "overdue_7_days"],
  },
  {
    key: "firm", title: "Firm", subtitle: "For stubborn late payers",
    summary: "3 days before, on the due date, then 3, 7 and 14 days overdue",
    schedules: ["before_due_3_days", "due_today", "overdue_3_days", "overdue_7_days", "overdue_14_days"],
  },
  { key: "custom", title: "Custom schedule", subtitle: "Choose reminder days manually" },
];

/**
 * Which preset a set of schedules corresponds to, or "custom" when it matches
 * none of them.
 *
 * Order-insensitive: toggleSchedule appends, so a user who unticks and reticks
 * a day ends up with the right set in the wrong order. Comparing as sets means
 * that still reads as "Standard" rather than silently falling to "Custom".
 */
export function presetForSchedules(schedules: readonly ReminderSchedule[]): PresetKey {
  for (const preset of PRESETS) {
    if (!preset.schedules) continue;
    if (preset.schedules.length !== schedules.length) continue;
    if (preset.schedules.every((s) => schedules.includes(s))) return preset.key;
  }
  return "custom";
}

/** Field-keyed validation messages. Empty object means valid. */
export type InvoiceFormErrors = Partial<Record<keyof InvoiceFormData, string>>;

/** Longest reference we will store. Generous — references vary wildly. */
export const INVOICE_REFERENCE_MAX = 40;
export const JOB_DESCRIPTION_MAX = 200;

/**
 * ── `requireReminderEligibility` HAS BEEN REMOVED ─────────────────────────
 *
 * It required the invoice's schedule to produce a reminder that could be
 * prepared TODAY, and onboarding was the only caller. Its error read:
 *
 *   "This schedule's first reminder isn't due until 22 August. Pick an
 *    earlier reminder day, or an invoice that's already due, so you can see
 *    a reminder now."
 *
 * That is the product asking the customer to change real data — the invoice
 * they chose, or the plan they wanted — so the flow could show itself off. A
 * legitimate customer joining with an invoice due next week has done nothing
 * wrong, and there is nothing to correct.
 *
 * The option is deleted rather than merely unset, so it cannot be switched
 * back on without deliberately reintroducing it. Whether a reminder can be
 * prepared right now is still a real question — it is simply asked AFTER the
 * invoice is saved, by prepareEligibility(), and it decides which outcome
 * screen the customer sees. It no longer decides whether their invoice is
 * allowed to exist.
 */
export interface ValidateOptions {
  /** Injectable for tests and for deterministic server-side checking. */
  today?: Date;
  /**
   * Require the fields onboarding collects but the dashboard does not.
   *
   * Separate from requireReminderEligibility because they answer different
   * questions: eligibility is about the SCHEDULE, this is about which FIELDS
   * are mandatory. The dashboard must keep accepting invoices with no
   * reference — thousands may already exist without one.
   */
  requireOnboardingFields?: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Deliberately permissive.
 *
 * Accepts UK mobiles as people actually write them — 07700 900000,
 * +447700900000, 07700-900-000 — and does NOT reject international numbers,
 * because a UK trade can legitimately have an overseas customer. It checks
 * shape, not country: 7 to 15 digits after optional +, spaces, hyphens and
 * brackets are ignored. A stricter pattern would reject real numbers, which
 * costs more than it prevents.
 */
const UK_MOBILE_PATTERN = /^\+?[\d\s()-]{7,20}$/;

export function validateInvoiceForm(
  form: InvoiceFormData,
  options: ValidateOptions = {}
): InvoiceFormErrors {
  const errors: InvoiceFormErrors = {};

  if (!form.customer_name.trim()) errors.customer_name = "Name is required";

  if (!form.customer_email.trim()) errors.customer_email = "Email is required";
  else if (!EMAIL_PATTERN.test(form.customer_email.trim()))
    errors.customer_email = "Enter a valid email";

  // parseAmount, NOT parseFloat. The field formats to "£1,500.00" on blur, and
  // parseFloat("£1,500.00") is NaN while parseFloat("1,500") is 1 — either
  // would reject or silently mangle a perfectly good amount.
  if (parseAmount(form.amount) === null)
    errors.amount = "Enter an amount greater than £0";

  // Required, and a real calendar date — but NOTHING about where it sits
  // relative to today. A due date in the future is ordinary, correct data.
  if (!form.due_date) errors.due_date = "Due date is required";
  else if (!isValidIsoDate(form.due_date)) errors.due_date = "Enter a valid date as dd/mm/yyyy";

  if (form.reminder_schedules.length === 0)
    errors.reminder_schedules = "Pick at least one reminder";

  // Checked against the trimmed value, because the input the user actually
  // submits is trimmed before saving.
  const link = form.payment_link.trim();
  if (link && !link.startsWith("https://"))
    errors.payment_link = "Enter a valid payment link starting with https://";

  if (form.invoice_reference.trim().length > INVOICE_REFERENCE_MAX)
    errors.invoice_reference = `Invoice reference must be ${INVOICE_REFERENCE_MAX} characters or fewer.`;

  if (form.job_description.trim().length > JOB_DESCRIPTION_MAX)
    errors.job_description = `Job description must be ${JOB_DESCRIPTION_MAX} characters or fewer.`;

  // Onboarding-only requirements. Applied nowhere else, so the dashboard form
  // keeps accepting the invoices it always has.
  //
  // NOTE what is NOT here any more: a due-date restriction. Onboarding used to
  // demand an already-overdue invoice so it could guarantee an immediate
  // reminder preview. Both surfaces now accept any real due date, and the
  // difference between them is only which fields are mandatory.
  if (options.requireOnboardingFields) {
    if (!form.invoice_reference.trim())
      errors.invoice_reference = "Invoice reference is required";

    if (!form.customer_phone.trim())
      errors.customer_phone = "Mobile number is required";
    else if (!UK_MOBILE_PATTERN.test(form.customer_phone.trim()))
      errors.customer_phone = "Enter a valid mobile number";
  }

  return errors;
}

/** Trims the free-text fields. The form state itself stays exactly as typed. */
export function normaliseInvoiceForm(form: InvoiceFormData): InvoiceFormData {
  return {
    ...form,
    invoice_reference: form.invoice_reference.trim(),
    job_description: form.job_description.trim(),
    customer_name: form.customer_name.trim(),
    customer_email: form.customer_email.trim(),
    customer_phone: form.customer_phone.trim(),
    payment_link: form.payment_link.trim(),
  };
}
