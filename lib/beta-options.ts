/**
 * Allowed beta-signup select values.
 *
 * Two landing pages share POST /api/signup and the beta_signups table:
 *
 *  - v1 (components/BetaSignup.tsx) — trade-specific list, and both selects
 *    are OPTIONAL there, so empty values must remain valid.
 *  - v2 (components/v2/FoundingBetaSection.tsx) — broader list, and both
 *    selects are REQUIRED.
 *
 * The server accepts the union of both vocabularies so neither form can be
 * broken by the other, and rejects anything outside it so a manipulated
 * request cannot write arbitrary strings to the table.
 */

/** v1 landing page — existing values, unchanged. */
export const V1_BUSINESS_TYPES = [
  "Builder / General Contractor",
  "Electrician",
  "Plumber",
  "Decorator / Painter",
  "Landscaper / Gardener",
  "Cleaner",
  "Handyman",
  "HVAC / Gas Engineer",
  "Security / Alarm Installation",
  "Bathroom / Kitchen Fitter",
  "Window / Door Installer",
  "Roofer",
  "Construction Company",
  "Other Trade",
] as const;

export const V1_UNPAID_RANGES = [
  "Less than £500",
  "£500 – £2,000",
  "£2,000 – £5,000",
  "£5,000 – £10,000",
  "£10,000 – £25,000",
  "Over £25,000",
] as const;

/** v2 landing page — approved values. */
export const V2_BUSINESS_TYPES = [
  "Plumbing",
  "Electrical",
  "Building and construction",
  "Landscaping and gardening",
  "Cleaning",
  "Maintenance and repair",
  "Other trade",
  "Other local service business",
] as const;

export const V2_UNPAID_RANGES = [
  "Under £1,000",
  "£1,000–£5,000",
  "£5,001–£10,000",
  "More than £10,000",
  "Not sure / prefer not to say",
] as const;

/** Union accepted by the API. Note "Other Trade" (v1) and "Other trade" (v2)
 *  differ only by case — both are listed deliberately. */
export const ALLOWED_BUSINESS_TYPES: readonly string[] = [
  ...V1_BUSINESS_TYPES,
  ...V2_BUSINESS_TYPES,
];

export const ALLOWED_UNPAID_RANGES: readonly string[] = [
  ...V1_UNPAID_RANGES,
  ...V2_UNPAID_RANGES,
];

/** Which form sent the request. Absent/"v1" keeps the original, looser rules. */
export type SignupSource = "v1" | "v2";
