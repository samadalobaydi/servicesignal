/**
 * The single rule for cleaning and validating a personal sender name.
 *
 * Mirrors lib/business-name.ts exactly — same reasoning, same limits — for
 * the alternative identity an account can choose to sign reminders with.
 * A shared pure function is the only way signup-adjacent validation, the
 * onboarding step, and Settings can agree on the same rule without drifting.
 *
 * NOTE: this deliberately REJECTS an over-long value rather than truncating
 * it, for the same reason business names are never truncated: silently
 * shortening someone's name would put a corrupted identity in front of
 * their customers.
 *
 * (app/api/profile's PUT handler still slices to 100 on direct edits,
 * matching business_name's own pre-existing PUT-path behaviour.)
 */

export const PERSONAL_NAME_MAX = 100;

export type PersonalNameError = "required" | "too_long";

export interface PersonalNameResult {
  /** The cleaned value, present only when valid. */
  value?: string;
  /** Why it was rejected, present only when invalid. */
  error?: PersonalNameError;
}

/** Trims, then validates. Accepts `unknown` for the same reason cleanBusinessName does — untyped input at a boundary. */
export function cleanPersonalName(input: unknown): PersonalNameResult {
  if (typeof input !== "string") return { error: "required" };

  const trimmed = input.trim();
  if (!trimmed) return { error: "required" };
  if (trimmed.length > PERSONAL_NAME_MAX) return { error: "too_long" };

  return { value: trimmed };
}

/** The cleaned value, or null when the input is unusable. For server paths. */
export function cleanPersonalNameOrNull(input: unknown): string | null {
  return cleanPersonalName(input).value ?? null;
}

/** True when a stored profile value is absent or blank. */
export function isPersonalNameBlank(current: unknown): boolean {
  return typeof current !== "string" || current.trim() === "";
}

export const PERSONAL_NAME_MESSAGES: Record<PersonalNameError, string> = {
  required: "Please enter your name.",
  too_long: `Name must be ${PERSONAL_NAME_MAX} characters or fewer.`,
};
