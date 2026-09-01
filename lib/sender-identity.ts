/**
 * The ONE canonical customer-facing sender-identity resolver.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * A real customer received a reminder identifying the sender as
 * "musao...@gmail.com" — the account's own login email, in the subject, the
 * sign-off and the footer. That specific defect (an old two-argument
 * resolveBusinessName() that fell back to the account email) was fixed on
 * the send/prepare path earlier in this project.
 *
 * ── THE PRODUCT MODEL ────────────────────────────────────────────────────
 *
 * An account explicitly chooses ONE of two sender identities:
 *
 *   business — sender_identity = 'business', identity = business_name
 *   personal — sender_identity = 'personal', identity = personal_name
 *
 * There is no third choice, and the two never blend. A resolver that fell
 * back from one to the other — "Business selected but no business name? use
 * whatever personal name is lying around" — would be exactly the kind of
 * silent substitution that caused the original incident, just one field
 * over. So this resolver refuses outright whenever the SELECTED identity's
 * own name is blank, even if the other name happens to be populated.
 *
 * `sender_identity` is nullable and stays nullable forever for accounts that
 * have never made the choice (migration 014) — NULL is genuinely
 * unconfigured, never inferred from whichever name field happens to hold a
 * value, and never defaulted to either option.
 */

export type SenderIdentityKind = "business" | "personal";

/** The account's stored choice. NULL means genuinely unconfigured — never inferred. */
export type SenderIdentityPreference = SenderIdentityKind | null;

export interface SenderIdentity {
  kind: SenderIdentityKind;
  /** The exact string to show the customer — subject, sign-off, footer, SMS, and From display all use this unmodified. */
  senderName: string;
}

export interface SenderIdentityInput {
  preference: SenderIdentityPreference;
  businessName?: string | null;
  personalName?: string | null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolves the customer-facing identity strictly from the account's own
 * explicit preference — never a fallback chain.
 *
 *   preference === "business" → businessName if non-blank, else refuse
 *   preference === "personal" → personalName if non-blank, else refuse
 *   preference === null       → refuse (unconfigured; never guessed)
 *
 * NO CROSS-FALLBACK: a "business" preference never reads personalName, and a
 * "personal" preference never reads businessName, regardless of what either
 * field contains. There is also no email field anywhere in this function's
 * input — the account's login/contact email cannot reach this resolver at
 * all, structurally, not merely by convention.
 *
 * Callers that are about to send or store customer-facing content must
 * refuse outright on a null result.
 */
export function resolveSenderIdentity(input: SenderIdentityInput): SenderIdentity | null {
  if (input.preference === "business") {
    const senderName = clean(input.businessName);
    return senderName ? { kind: "business", senderName } : null;
  }
  if (input.preference === "personal") {
    const senderName = clean(input.personalName);
    return senderName ? { kind: "personal", senderName } : null;
  }
  return null;
}

/**
 * WHY a resolveSenderIdentity() refusal happened — for callers that need to
 * choose a specific, actionable message ("missing_sender_identity" is one
 * stable outcome code; this is the stable reason a client can switch on
 * instead of parsing free text). Every gate in this codebase (Prepare,
 * Approve, Retry, the dormant Auto path) computes this the same way, so the
 * three refusal messages can never drift into disagreeing about what
 * happened for the same underlying state.
 */
export type SenderIdentityMissingReason =
  | "preference_missing"
  | "business_name_missing"
  | "personal_name_missing";

export function senderIdentityMissingReason(input: SenderIdentityInput): SenderIdentityMissingReason {
  if (input.preference === "business") return "business_name_missing";
  if (input.preference === "personal") return "personal_name_missing";
  return "preference_missing";
}

/**
 * The one authored message per reason, parameterised only by the verb
 * ("preparing a reminder" vs "sending reminders") so Prepare and
 * Approve/Retry can each use their own natural phrasing without three
 * independently-hand-written copies of the same three sentences drifting
 * apart. This is the actual user-facing text — never a raw/thrown error
 * string — surfaced verbatim by the client as `result.message`.
 */
export function missingSenderIdentityMessage(reason: SenderIdentityMissingReason, verb: string): string {
  switch (reason) {
    case "preference_missing":
      return `Choose how customers should see you in Settings before ${verb}.`;
    case "business_name_missing":
      return `Add your business name in Settings before ${verb}.`;
    case "personal_name_missing":
      return `Add your name in Settings before ${verb}.`;
  }
}

/**
 * The one non-email placeholder this codebase shows on a screen that is
 * NOT a send gate. Never the login/account email.
 */
export const SENDER_DISPLAY_FALLBACK = "ServiceSignal";

/**
 * DISPLAY-ONLY resolution: never refuses. For any screen that is not itself
 * deciding whether to send or store customer-facing content — a preview, an
 * edit-refresh, a cron's placeholder subject on a row nothing dispatches
 * from directly.
 *
 * THIS MUST NEVER BE USED TO GATE A SEND. A caller about to compose content
 * that could reach a customer must call resolveSenderIdentity() and refuse
 * on null itself — this function's fallback to "ServiceSignal" is a display
 * convenience, never a substitute for the strict gate.
 */
export function resolveSenderIdentityForDisplay(input: SenderIdentityInput): string {
  return resolveSenderIdentity(input)?.senderName ?? SENDER_DISPLAY_FALLBACK;
}

/**
 * Strips characters that have no place in an RFC 5322 header display name —
 * most importantly CR/LF, which would otherwise let a business/personal name
 * inject extra header lines into an outgoing email. Applied defensively
 * regardless of what the mail provider itself does with the value.
 */
function sanitiseForHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * The visible From display name for a reminder email.
 *
 * The underlying address (reminders@servicesignal.app) never changes — only
 * the free-text display name portion does. DMARC/SPF/DKIM alignment is
 * evaluated against the From address's domain, not this string, so this
 * cannot break deliverability or provider configuration; it only changes
 * what the recipient's mail client shows as the sender's name.
 */
export function reminderFromHeader(senderName: string, fromAddress: string): string {
  const safeName = sanitiseForHeader(senderName);
  if (!safeName) return `ServiceSignal <${fromAddress}>`;

  // RFC 5322 quoted-string: required whenever the display name contains a
  // character that would otherwise be read as syntax (comma, angle bracket,
  // quote) — e.g. a business genuinely named `Smith, Jones & Co`.
  const needsQuoting = /[",<>]/.test(safeName);
  const displayName = needsQuoting ? `"${safeName.replace(/"/g, '\\"')}"` : safeName;

  return `${displayName} via ServiceSignal <${fromAddress}>`;
}
