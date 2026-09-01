/**
 * UK mobile numbers, normalised to E.164 for SMS dispatch.
 *
 * Pure. No network, no provider, no environment — so every accepted and
 * rejected shape is checkable in isolation, which matters because the failure
 * mode here is a text message to the wrong person.
 *
 * ── WHY THIS REFUSES MORE THAN IT ACCEPTS ─────────────────────────────────
 *
 * The invoice form's validator is deliberately permissive (UK_MOBILE_PATTERN
 * in lib/invoice-form.ts accepts 7–15 digits with punctuation) because
 * rejecting a real number a customer typed costs more than it prevents. That
 * is the right rule for STORAGE.
 *
 * It is the wrong rule for DISPATCH. Twilio needs one exact string, and a
 * number that is merely plausible produces either a hard provider rejection or
 * — worse — a message delivered to a real person who is not this customer. So
 * this module converts only the shapes it can prove, and names its refusals.
 *
 * NOTHING IS INVENTED. No country code is guessed, no international prefix is
 * stripped to "make it work", and a non-UK number is refused rather than
 * coerced. If a number cannot be established it fails before the network.
 */

export type PhoneProblem =
  /** Absent, or nothing but punctuation. Historical rows carry null here. */
  | "missing"
  /** Contains characters that are not digits, spaces or +()-. */
  | "malformed"
  /** A valid-looking number, but not a United Kingdom one. */
  | "not_uk"
  /** A UK number that is not a mobile — a landline cannot receive SMS. */
  | "not_mobile"
  /** UK, mobile-shaped, wrong number of digits. */
  | "wrong_length";

export type NormalisedPhone =
  | { ok: true; e164: string }
  | { ok: false; problem: PhoneProblem };

/**
 * Separators people actually type, and nothing else.
 *
 * Deliberately NOT a blanket /\D/g strip: that would silently turn
 * "07700 900000 ext 12" into a different, valid-looking number. Anything
 * outside this set makes the value malformed rather than cleanable.
 */
const SEPARATORS = /[\s().-]/g;

/** UK mobile: 07 + 9 digits nationally, +447 + 9 digits internationally. */
const UK_MOBILE_NATIONAL = /^07\d{9}$/;
const UK_MOBILE_E164 = /^\+447\d{9}$/;

/** Any UK number in international form, mobile or not. */
const UK_E164_ANY = /^\+44\d{7,10}$/;

/**
 * Normalises a stored customer phone number for SMS dispatch.
 *
 * Accepts, and proves equivalent:
 *   07700 900000      national, spaced
 *   07700900000       national, bare
 *   +44 7700 900000   international, spaced
 *   +447700900000     international, bare
 *   00447700900000    international, 00 prefix
 *   (07700) 900-000   punctuated
 *
 * All five produce "+447700900000".
 */
export function normaliseUkMobile(raw: string | null | undefined): NormalisedPhone {
  if (typeof raw !== "string") return { ok: false, problem: "missing" };

  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, problem: "missing" };

  const compact = trimmed.replace(SEPARATORS, "");
  if (!compact) return { ok: false, problem: "missing" };

  // A leading + is the only non-digit permitted, and only in first position.
  if (!/^\+?\d+$/.test(compact)) return { ok: false, problem: "malformed" };

  // 00 is the international access prefix. Rewritten to + rather than removed,
  // so the country-code checks below see one canonical form.
  const canonical = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;

  // ── International form ──────────────────────────────────────────────────
  if (canonical.startsWith("+")) {
    if (!canonical.startsWith("+44")) {
      // A real number, for somewhere else. NOT coerced: dropping a foreign
      // country code and prepending +44 is how a message reaches a stranger.
      return { ok: false, problem: "not_uk" };
    }
    if (UK_MOBILE_E164.test(canonical)) return { ok: true, e164: canonical };
    // UK, but the subscriber part does not begin 7 — a landline or service
    // number. Shaped correctly, cannot receive SMS.
    if (UK_E164_ANY.test(canonical)) return { ok: false, problem: "not_mobile" };
    return { ok: false, problem: "wrong_length" };
  }

  // ── National form ───────────────────────────────────────────────────────
  //
  // A bare "44…" is deliberately NOT treated as a country code. "447700900000"
  // and "07700900000" are both eleven-to-twelve digits, and guessing between
  // them is exactly the coercion this module refuses to do. Only an explicit
  // + or 00 declares an international number.
  if (canonical.startsWith("0")) {
    if (UK_MOBILE_NATIONAL.test(canonical)) {
      return { ok: true, e164: `+44${canonical.slice(1)}` };
    }
    // 01/02/03 are UK landline ranges; 08/09 are service numbers.
    if (/^0[12389]\d{7,9}$/.test(canonical)) return { ok: false, problem: "not_mobile" };
    return { ok: false, problem: "wrong_length" };
  }

  // No leading 0, no +. Not a form this product can attribute to a country.
  return { ok: false, problem: "not_uk" };
}

/**
 * Customer-facing wording. No provider names, no error codes, no jargon —
 * every one of these is shown to a tradesperson looking at their own invoice.
 */
export const PHONE_PROBLEM_MESSAGE: Record<PhoneProblem, string> = {
  missing: "This invoice has no mobile number. Add one to send this reminder.",
  malformed: "This customer's mobile number can't be read. Check it on the invoice.",
  not_uk: "This customer's mobile number isn't a UK number. ServiceSignal sends UK SMS only.",
  not_mobile: "This customer's number isn't a mobile, so it can't receive a text.",
  wrong_length: "This customer's mobile number doesn't look complete. Check it on the invoice.",
};
