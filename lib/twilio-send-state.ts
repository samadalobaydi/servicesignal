import type { ProviderOutcome } from "./reminder-send-state";

/**
 * Twilio submission semantics — deliberately NOT Resend's.
 *
 * ── WHY THE EMAIL CLASSIFIER IS NOT REUSED ────────────────────────────────
 *
 * classifyProviderError() in reminder-send-state.ts matches Resend's STRING
 * codes ("validation_error", "rate_limit_exceeded", …). Twilio returns NUMERIC
 * codes in a completely disjoint namespace. Passing a Twilio failure through
 * the email classifier matches nothing, falls to `unknown`, and parks the
 * reminder in delivery_unknown — a non-claimable state needing manual
 * reconciliation. Every SMS failure, however trivial, would strand a reminder.
 *
 * So the sets below are Twilio's own, and the default is still `unknown`,
 * because guessing "rejected" on an unrecognised error is how a customer gets
 * texted twice.
 *
 * ── ACCEPTANCE IS NOT DELIVERY ────────────────────────────────────────────
 *
 * A successful create returns status `queued` or `accepted`. That means Twilio
 * has taken the message, NOT that a handset received it. Carrier rejection
 * arrives minutes later and is invisible here. Nothing in this module claims
 * otherwise, and `sent` on a channel row means "the provider accepted it".
 */

/**
 * Twilio error codes that mean the message was CERTAINLY not accepted.
 *
 * Each is a validation or authorisation refusal raised before any handset is
 * involved, so a later attempt cannot produce a second message.
 *
 *   20003  authenticate — bad credentials
 *   20404  resource not found — wrong Account SID
 *   20422  invalid parameter
 *   20429  too many requests — rate limited, nothing queued
 *   21211  invalid 'To' number
 *   21408  permission to send to this region not enabled
 *   21606  'From' not a valid, SMS-capable sender
 *   21610  recipient has replied STOP — an opt-out we must honour
 *   21611  queue full for this sender
 *   21612  unreachable route
 *   21614  'To' is not a mobile number
 *   21617  body exceeds the provider maximum
 *   30032  toll-free/sender not verified
 *   63038  daily message cap reached
 */
const DEFINITELY_REJECTED = new Set([
  20003, 20404, 20422, 20429,
  21211, 21408, 21606, 21610, 21611, 21612, 21614, 21617,
  30032, 63038,
]);

/**
 * Statuses a freshly created Message may carry that mean Twilio HAS it.
 *
 * `sending` and `sent` are included because a fast create can return them; all
 * four are downstream of acceptance. `failed` and `undelivered` are absent —
 * those describe DELIVERY and are resolved by reconciliation, not here.
 */
const ACCEPTED_STATUSES = new Set(["queued", "accepted", "scheduled", "sending", "sent"]);

export function isAcceptedTwilioStatus(status: string | null | undefined): boolean {
  return !!status && ACCEPTED_STATUSES.has(status);
}

/**
 * Classifies the outcome of the Message-create CALL.
 *
 * `httpStatus` participates because Twilio's own 5xx responses carry no useful
 * code: a 503 may or may not have enqueued the message, and that is the
 * textbook ambiguous case.
 */
export function classifyTwilioError(
  code: number | null | undefined,
  httpStatus?: number | null
): ProviderOutcome {
  if (typeof code === "number" && DEFINITELY_REJECTED.has(code)) return "rejected";

  // A 4xx WITHOUT a recognised code is still a client-side refusal: Twilio
  // rejects malformed requests before queuing. 429 is excluded — it is already
  // enumerated above, and treating the whole 4xx band as rejected would be too
  // coarse for it.
  if (typeof httpStatus === "number" && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429) {
    return "rejected";
  }

  // 5xx, a timeout, a dropped socket, or an unrecognised code. The message may
  // be queued. Never retried automatically.
  return "unknown";
}

/**
 * Whether an unrecognised code should be treated as retryable. It should not —
 * exported so a test can pin the default rather than infer it.
 */
export function isDefinitelyRejectedTwilioCode(code: number): boolean {
  return DEFINITELY_REJECTED.has(code);
}

// ── Delivery reconciliation ─────────────────────────────────────────────────

/**
 * What a Twilio Message resource's `status` says about DELIVERY.
 *
 * A DIFFERENT question from classifyTwilioError above, which is about
 * SUBMISSION. Conflating the two is the defect migration 009's model was built
 * to avoid on the email side: a carrier rejection must never be folded into a
 * claimable `failed`, or a bounce would trigger a second submission with no
 * fresh owner decision.
 *
 *   delivered    the carrier accepted it — delivered, or read (WhatsApp/RCS).
 *   undelivered  Twilio accepted it and delivery did not succeed: undelivered,
 *                failed, or canceled.
 *   in_flight    accepted and not yet resolved — queued, accepted, sending,
 *                scheduled, or `sent` (handed to the carrier, no receipt yet).
 *                NOT terminal, so reconciliation re-asks.
 *   unrecognised a status this code does not know. Never guessed at.
 *
 * `sent` is IN FLIGHT for SMS, which is the opposite of its meaning for email.
 * Resend's `sent` means dispatched to the receiving mail server and is treated
 * as delivered; Twilio's means handed to the carrier with delivery still
 * pending, and a handset receipt may still say undelivered. Reading it as
 * success would report a message the customer never got.
 */
export type TwilioDeliveryClass = "delivered" | "undelivered" | "in_flight" | "unrecognised";

const DELIVERED = new Set(["delivered", "read"]);
const UNDELIVERED = new Set(["undelivered", "failed", "canceled", "cancelled"]);
const IN_FLIGHT = new Set(["queued", "accepted", "scheduled", "sending", "sent"]);

export function classifyTwilioDelivery(
  status: string | null | undefined
): TwilioDeliveryClass {
  if (!status) return "unrecognised";
  if (DELIVERED.has(status)) return "delivered";
  if (UNDELIVERED.has(status)) return "undelivered";
  if (IN_FLIGHT.has(status)) return "in_flight";
  return "unrecognised";
}

/**
 * The channel status a delivery result resolves to, or null to leave the row
 * where it is.
 *
 * `in_flight` and `unrecognised` both return null: neither is a conclusion, and
 * writing one would either claim a delivery that has not happened or invent a
 * failure from a status we do not understand.
 */
export function channelStatusForTwilioDelivery(
  status: string | null | undefined
): "sent" | "undelivered" | null {
  switch (classifyTwilioDelivery(status)) {
    case "delivered":
      return "sent";
    case "undelivered":
      // `undelivered` is NOT claimable — see CHANNEL_CLAIMABLE_STATUSES. Twilio
      // definitely accepted this message, so another attempt at the same number
      // is a second submission, not a retry. It needs a corrected recipient and
      // a fresh owner decision.
      return "undelivered";
    default:
      return null;
  }
}
