/**
 * The single rule for cleaning and validating a business name.
 *
 * Three places need to agree on this: signup validation (client), the profile
 * seed from auth metadata (server) and the repair path (server). A shared pure
 * function is the only way "the same 100-character rule" can be true of all
 * three — duplicating the logic is how the limits drift apart.
 *
 * Why it matters at all: the business name is what identifies the sender to
 * the customer. lib/email-templates.ts puts it in the subject line, the
 * opening line and the sign-off. Without it a reminder reads as though it came
 * from nobody.
 *
 * NOTE: this deliberately REJECTS an over-long value rather than truncating
 * it. Silently shortening someone's registered business name would put a
 * corrupted name in front of their customers.
 *
 * (app/api/profile's PUT handler still slices to 100 on direct edits. That is
 * pre-existing behaviour on a different path and is out of scope here; this
 * module governs signup, seeding and repair.)
 */

export const BUSINESS_NAME_MAX = 100;

export type BusinessNameError = "required" | "too_long";

export interface BusinessNameResult {
  /** The cleaned value, present only when valid. */
  value?: string;
  /** Why it was rejected, present only when invalid. */
  error?: BusinessNameError;
}

/**
 * Trims, then validates. Accepts `unknown` so it can be pointed straight at
 * `user.user_metadata.business_name`, which is untyped JSON and may be
 * anything — including a number, an object or a value set by a crafted
 * signUp call that never passed through our client validation.
 */
export function cleanBusinessName(input: unknown): BusinessNameResult {
  if (typeof input !== "string") return { error: "required" };

  const trimmed = input.trim();
  if (!trimmed) return { error: "required" };
  if (trimmed.length > BUSINESS_NAME_MAX) return { error: "too_long" };

  return { value: trimmed };
}

/** The cleaned value, or null when the input is unusable. For server paths. */
export function cleanBusinessNameOrNull(input: unknown): string | null {
  return cleanBusinessName(input).value ?? null;
}

/** True when a stored profile value is absent or blank and should be repaired. */
export function isBusinessNameBlank(current: unknown): boolean {
  return typeof current !== "string" || current.trim() === "";
}

export const BUSINESS_NAME_MESSAGES: Record<BusinessNameError, string> = {
  required: "Please enter your business name.",
  too_long: `Business name must be ${BUSINESS_NAME_MAX} characters or fewer.`,
};
