/**
 * Parsing and formatting for the two invoice fields a UK tradesperson is most
 * likely to type in an unexpected shape: the amount and the due date.
 *
 * Pure functions, no React, no DOM. That is deliberate — these are the places
 * where a silent bug becomes a wrong number in front of a real customer, so
 * they must be checkable in isolation. See the self-check at the bottom of
 * this file's companion script.
 */

// ── Amount ──────────────────────────────────────────────────────────────────

/**
 * Parses a typed amount into pounds.
 *
 * Accepts what people actually type: "1500", "1500.5", "1,500", "£1,500.00",
 * " 1500 ". Rejects anything else rather than guessing.
 *
 * THE COMMA IS THE DANGEROUS CASE. "1,500" must be 1500, never 1.5 and never
 * 15. parseFloat("1,500") returns 1 — it stops at the comma — so the separator
 * is stripped BEFORE parsing rather than after, and a bare parseFloat is never
 * used on raw input anywhere in this flow.
 *
 * Returns null for anything invalid, including zero and negatives: an invoice
 * for nothing is not something to chase.
 */
export function parseAmount(input: string): number | null {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  // Strip currency symbol, thousands separators and internal spaces. Nothing
  // else is removed, so stray letters still fail the shape test below.
  const stripped = trimmed.replace(/[£\s,]/g, "");

  // Digits, optionally one decimal point followed by 1-2 digits. Anchored, so
  // "12.345", "1.2.3", "12abc" and "" are all rejected rather than truncated.
  if (!/^\d+(\.\d{1,2})?$/.test(stripped)) return null;

  const value = Number(stripped);
  if (!Number.isFinite(value) || value <= 0) return null;

  // Round to whole pence. Number("0.1") + Number("0.2") style drift cannot
  // reach the database as a fraction of a penny.
  return Math.round(value * 100) / 100;
}

/** GBP for display: £1,500.00. Used on blur and in summaries, never stored. */
export function formatAmount(pounds: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pounds);
}

/**
 * What the field should show after the user leaves it.
 *
 * Returns the input unchanged when it cannot be parsed, so a typo stays on
 * screen for correction instead of being silently blanked.
 */
export function formatAmountOnBlur(input: string): string {
  const parsed = parseAmount(input);
  return parsed === null ? input : formatAmount(parsed);
}

/**
 * The value stored in the database — a plain number of pounds, matching the
 * existing `amount numeric` column. Never the formatted "£1,500.00" string.
 */
export function amountForStorage(input: string): number | null {
  return parseAmount(input);
}

// ── Due date ────────────────────────────────────────────────────────────────

/**
 * Dates are handled as plain calendar dates — never as instants.
 *
 * The database column is a DATE holding "YYYY-MM-DD", and lib/date-status.ts
 * compares it against today's Europe/London date. Passing a value through
 * `new Date("2026-07-29")` would parse it as UTC midnight, which in a
 * behind-UTC offset renders as the 28th. So the string is split on its
 * hyphens and never converted to a Date for display or comparison.
 */

/** "YYYY-MM-DD" → "dd/mm/yyyy". Empty string when the input is unusable. */
export function isoToUkDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return "";
  const [, y, m, d] = match;
  return `${d}/${m}/${y}`;
}

/**
 * "dd/mm/yyyy" → "YYYY-MM-DD", or null.
 *
 * Rejects impossible dates by round-tripping through UTC and checking the
 * parts survive: "31/02/2026" becomes 2 March and therefore fails, rather than
 * being silently accepted. UTC is used only for this validity check, never for
 * display, so no offset can shift the result.
 */
export function ukDateToIso(input: string): string | null {
  const match = /^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/.exec(input.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (year < 2000 || year > 2100) return null;

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Today in Europe/London as "YYYY-MM-DD". Locale-independent by construction. */
export function todayIsoLondon(): string {
  // en-CA gives ISO-ordered parts, so no manual re-assembly is needed and no
  // month/day transposition is possible.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export type DueDateProblem = "invalid" | "not_overdue";

/**
 * Onboarding requires a genuinely OVERDUE invoice.
 *
 * Not a arbitrary restriction: the flow's whole purpose is to end on a
 * reminder the user can look at, and a reminder can only be prepared once a
 * schedule checkpoint has been reached. Today's date is rejected along with
 * future dates — the earliest checkpoint the default schedule reaches is the
 * due date itself, but an invoice due today has nothing overdue about it yet
 * and reads as a mistake.
 */
export function checkOnboardingDueDate(iso: string): DueDateProblem | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "invalid";
  // String comparison is safe and exact on zero-padded ISO dates.
  return iso >= todayIsoLondon() ? "not_overdue" : null;
}
