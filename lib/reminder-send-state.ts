import { createHash } from "crypto";

/**
 * The reminder send lifecycle — as pure, testable logic.
 *
 * Kept free of Supabase and Resend deliberately: these are the rules that
 * decide whether a real email reaches a real customer, and they should be
 * checkable without a database or a network.
 *
 * THE HONEST LIMIT, stated once and not oversold anywhere else: exactly-once
 * delivery across a database and a third-party provider is not achievable. Two
 * systems cannot commit atomically. What this model provides is:
 *
 *   - one logical approval per attempt
 *   - at-most-once provider submission per attempt, via Resend's Idempotency-Key
 *   - atomic internal claiming, so two requests cannot both submit
 *   - a truthful split between KNOWN failure and UNKNOWN outcome
 *   - a truthful split between "we never submitted it" and "the provider took
 *     it and could not deliver it"
 *   - no automatic retry after an ambiguous or accepted-but-undelivered result
 */

export type ReminderSendStatus =
  | "pending"
  | "sending"
  | "sent"
  | "dismissed"
  | "failed"
  | "delivery_unknown"
  | "undelivered";

/**
 * Statuses a new send attempt may claim from.
 *
 * `failed` is included, and that inclusion is deliberate: `failed` now means
 * ONLY a definite PRE-ACCEPTANCE rejection — the provider certainly never took
 * the message — so sending again cannot produce a second copy.
 *
 * Excluded, and each for its own reason:
 *
 *   sending           another request owns the active attempt.
 *   sent              already delivered to the provider and recorded.
 *   dismissed         the owner chose not to send it.
 *   delivery_unknown  Resend may already have accepted it. Reconciliation, not
 *                     a button.
 *   undelivered       Resend DID accept it and delivery then failed (bounce,
 *                     complaint, suppression). Sending again would be a second
 *                     submission to an address the provider has already told us
 *                     is bad — it needs a fresh owner decision on a corrected
 *                     recipient, not a retry of the same message.
 */
export const CLAIMABLE_STATUSES: readonly ReminderSendStatus[] = ["pending", "failed"];

export function isClaimable(status: ReminderSendStatus): boolean {
  return CLAIMABLE_STATUSES.includes(status);
}

/**
 * How long one attempt may hold the `sending` lease before it is considered
 * abandoned. Generous: a slow provider call must never be overtaken.
 */
export const SEND_LEASE_SECONDS = 120;

export function isStaleSendingLease(
  startedAtISO: string | null,
  now: Date = new Date()
): boolean {
  if (!startedAtISO) return true;
  return now.getTime() - new Date(startedAtISO).getTime() > SEND_LEASE_SECONDS * 1000;
}

// ── Submission outcome: did the provider ACCEPT the request? ────────────────

/**
 * Classifies the result of the `emails.send` CALL — a question purely about
 * SUBMISSION, never about delivery.
 *
 *   rejected  the provider certainly did NOT take the message — validation
 *             error, bad API key, malformed sender. Safe to attempt again.
 *   accepted  the provider confirmed and returned an id.
 *   unknown   we never learned the outcome. Timeout, dropped socket, or a
 *             database write that failed AFTER acceptance. The customer may
 *             already have the email. NOT safe to attempt again.
 *
 * Anything unrecognised falls to `unknown`, because guessing "rejected" on an
 * ambiguous error is exactly how a customer gets emailed twice.
 */
export type ProviderOutcome = "accepted" | "rejected" | "unknown";

/** Resend error codes that mean the request was definitively not accepted. */
const DEFINITELY_REJECTED = new Set([
  "validation_error",
  "missing_api_key",
  "restricted_api_key",
  "invalid_api_key",
  "invalid_from_address",
  "invalid_parameter",
  "missing_required_field",
  "invalid_attachment",
  "invalid_access",
  "invalid_region",
  "not_found",
  "method_not_allowed",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
  "rate_limit_exceeded",
  "security_error",
]);

/**
 * `concurrent_idempotent_requests` and `invalid_idempotent_request` are NOT
 * rejections. They mean another request with this key is in flight or already
 * completed — so the message may well be on its way. Treated as unknown.
 */
export function classifyProviderError(code: string | null | undefined): ProviderOutcome {
  if (!code) return "unknown";
  if (DEFINITELY_REJECTED.has(code)) return "rejected";
  return "unknown";
}

/** The status a SUBMISSION outcome should be persisted as. */
export function statusForOutcome(outcome: ProviderOutcome): ReminderSendStatus {
  switch (outcome) {
    case "accepted":
      return "sent";
    case "rejected":
      return "failed";
    case "unknown":
      return "delivery_unknown";
  }
}

// ── Delivery outcome: what happened AFTER the provider accepted it? ─────────

/**
 * A DIFFERENT question from the one above, and conflating the two was a real
 * defect in the previous implementation.
 *
 * `resend.emails.get(id)` returning a record is itself proof of acceptance: the
 * provider created an email object, so a submission definitely happened. Its
 * `last_event` therefore describes DELIVERY, and a delivery failure must never
 * be folded into `failed`, which is a claimable, retryable state meaning "we
 * never submitted anything". Doing so would let a bounce trigger a second
 * submission with no fresh owner decision.
 *
 *   delivered    the provider handed it on: delivered / opened / clicked, or
 *                `sent` (dispatched to the receiving mail server).
 *   undelivered  the provider accepted it and delivery did not succeed:
 *                bounced, complained, suppressed, or the provider's own
 *                terminal failure / cancellation.
 *   in_flight    accepted and not yet resolved — queued, scheduled, delayed.
 *                Not terminal, so reconciliation will ask again.
 *   unrecognised an event this code does not know. Never guessed at.
 */
export type ProviderEventClass = "delivered" | "undelivered" | "in_flight" | "unrecognised";

const DELIVERED_EVENTS = new Set(["delivered", "opened", "clicked", "sent"]);

const UNDELIVERED_EVENTS = new Set([
  "bounced",
  "complained",
  "suppressed",
  "failed",
  "canceled",
  "cancelled",
]);

/**
 * Non-terminal. A delayed message may still be delivered, so it is neither
 * reported as a success nor written off as a failure — reconciliation re-asks.
 */
const IN_FLIGHT_EVENTS = new Set(["queued", "scheduled", "delivery_delayed"]);

export function classifyProviderEvent(
  event: string | null | undefined
): ProviderEventClass {
  if (!event) return "unrecognised";
  if (DELIVERED_EVENTS.has(event)) return "delivered";
  if (UNDELIVERED_EVENTS.has(event)) return "undelivered";
  if (IN_FLIGHT_EVENTS.has(event)) return "in_flight";
  return "unrecognised";
}

export function isNonTerminalProviderEvent(event: string | null | undefined): boolean {
  return classifyProviderEvent(event) === "in_flight";
}

/**
 * The status a DELIVERY event resolves to, or null to leave the row where it
 * is. `in_flight` and `unrecognised` both return null: neither is a conclusion.
 */
export function statusForProviderEvent(
  event: string | null | undefined
): ReminderSendStatus | null {
  switch (classifyProviderEvent(event)) {
    case "delivered":
      return "sent";
    case "undelivered":
      return "undelivered";
    default:
      return null;
  }
}

// ── Idempotency: one key per LOGICAL ATTEMPT ────────────────────────────────

/**
 * The Idempotency-Key for one logical send attempt.
 *
 * Bound to three things, and each one is load-bearing:
 *
 *   reminderId     two reminders are never the same submission.
 *   contentHash    changed material content is a DIFFERENT message and must
 *                  never be suppressed as a duplicate of the old one.
 *   attemptNumber  a definite pre-acceptance rejection may be attempted again.
 *                  Reusing the key there could return the provider's cached
 *                  result for the failed request instead of actually
 *                  submitting, so a controlled new attempt gets a new key.
 *
 * Derived rather than random, so the SAME logical attempt always produces the
 * same key: a double-click, a browser retry and a duplicate request all
 * recompute it identically and Resend suppresses the duplicate.
 *
 * `attemptNumber` is allocated by the atomic claim (send_attempt_count + 1), so
 * a new key can only ever come into existence through a successful claim — and
 * `delivery_unknown` and `undelivered` are not claimable, which is what stops
 * an ambiguous or bounced outcome from ever getting a fresh key.
 */
export function idempotencyKeyFor(
  reminderId: string,
  contentHash: string,
  attemptNumber: number
): string {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error(`[idempotency] attemptNumber must be a positive integer, got ${attemptNumber}`);
  }
  const digest = createHash("sha256")
    .update(`ss-send::${reminderId}::${contentHash}::${attemptNumber}`)
    .digest("hex");
  return `ss-reminder-${digest.slice(0, 48)}`;
}

// ── Review-content integrity ────────────────────────────────────────────────

/**
 * Every input that can change what the customer receives.
 *
 * If a field can alter the rendered message, it belongs here — otherwise a
 * change to it would slip past review unnoticed.
 */
export interface ReviewedContent {
  recipientEmail: string;
  senderName: string;
  replyTo: string | null;
  subject: string;
  body: string;
}

/**
 * A fingerprint of the reviewed message.
 *
 * Computed SERVER-SIDE on the review page and recomputed server-side at
 * approval. The client relays it inside a signed token but cannot forge a
 * useful one: the approval route compares against its OWN recomputation, so a
 * fabricated value simply fails to match and the send is refused.
 *
 * The body is included in full rather than a summary, so a due-date rollover
 * that rewords "1 day overdue" to "2 days overdue" invalidates the approval —
 * factually justified or not, the owner has not read that sentence.
 */
export function contentHash(content: ReviewedContent): string {
  const canonical = JSON.stringify([
    content.recipientEmail,
    content.senderName,
    content.replyTo ?? "",
    content.subject,
    content.body,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function contentMatches(a: ReviewedContent, b: ReviewedContent): boolean {
  return contentHash(a) === contentHash(b);
}

// ── User-facing state ───────────────────────────────────────────────────────

export type SendUiState =
  | "approvable"
  | "sending"
  | "sent"
  | "dismissed"
  | "not_eligible"
  | "retryable"
  | "delivery_unknown"
  | "undelivered"
  | "stale_review";

/**
 * Why the review page may refuse approval — and whether it may offer it.
 *
 * Pure, so the exact rule the review page renders and the approve route
 * enforces is one function that a test can drive across every status without a
 * database.
 *
 * ORDER MATTERS. Terminal and in-progress states answer first, because "this
 * was already sent" is more useful than "this isn't due yet". Eligibility is
 * checked before `retryable`, so a definitely-failed reminder whose checkpoint
 * has since passed is reported as not due rather than offered a retry the
 * route would refuse.
 */
export type ReviewBlockedReason =
  | "not_found"
  | "sent"
  | "dismissed"
  | "sending"
  | "delivery_unknown"
  | "undelivered"
  | "not_eligible"
  | "retryable";

export function reviewAvailability(input: {
  status: ReminderSendStatus;
  /** prepareEligibility(...).schedule !== null */
  eligible: boolean;
}): { blockedReason: ReviewBlockedReason | null; approvable: boolean } {
  const { status, eligible } = input;

  let blockedReason: ReviewBlockedReason | null = null;

  if (status === "sent") blockedReason = "sent";
  else if (status === "dismissed") blockedReason = "dismissed";
  else if (status === "sending") blockedReason = "sending";
  else if (status === "delivery_unknown") blockedReason = "delivery_unknown";
  else if (status === "undelivered") blockedReason = "undelivered";
  else if (!eligible) blockedReason = "not_eligible";
  else if (status === "failed") {
    // A NOTICE, not a block: a definite pre-acceptance rejection can genuinely
    // be attempted again, and the claim predicate accepts it.
    blockedReason = "retryable";
  }

  return {
    blockedReason,
    approvable:
      isClaimable(status) && (blockedReason === null || blockedReason === "retryable"),
  };
}

/** Distinct wording per state — never one generic error for all of them. */
export const SEND_STATE_COPY: Record<
  Exclude<SendUiState, "approvable">,
  { title: string; body: string }
> = {
  sending: {
    title: "This reminder is being sent",
    body: "Another attempt is already in progress. Give it a moment, then refresh.",
  },
  sent: {
    title: "This reminder has already been sent",
    body: "It was approved and sent to your customer. It can't be sent again.",
  },
  dismissed: {
    title: "This reminder was dismissed",
    body: "You chose not to send it. Nothing was sent to your customer.",
  },
  not_eligible: {
    title: "This reminder isn't due yet",
    body: "It will become ready to approve when its next scheduled checkpoint is reached.",
  },
  retryable: {
    title: "The last attempt didn't send",
    body: "Your customer was not emailed. You can review the message and try again.",
  },
  delivery_unknown: {
    title: "We couldn't confirm the delivery result",
    body:
      "Don't resend yet — your customer may already have received this. " +
      "Check the delivery status or contact support@servicesignal.app.",
  },
  undelivered: {
    title: "Accepted, but delivery was unsuccessful",
    body:
      "Resend accepted this reminder, but final delivery was unsuccessful. " +
      "Review the recipient details before preparing a new reminder — nothing " +
      "will be resent automatically.",
  },
  stale_review: {
    title: "This reminder changed since you reviewed it",
    body: "Reload the latest version before sending.",
  },
};
