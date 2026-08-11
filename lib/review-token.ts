import "server-only";
import { createHmac, timingSafeEqual, createHash } from "crypto";

/**
 * Server-signed review authorisation.
 *
 * WHY A PLAIN CONTENT HASH WAS NOT ENOUGH
 *
 * The previous version had the client post back a SHA-256 of the reviewed
 * content, and the route compared it against its own recomputation. That
 * catches content DRIFT, but it proves nothing about who computed it: the hash
 * is derivable from data the caller can already read, so a script could compute
 * it and approve without ever loading the review page. It also carried no user
 * binding and no expiry.
 *
 * This token is an HMAC the browser cannot forge. It binds four things at once:
 *
 *   user id      — a token issued to one account cannot approve another's
 *   reminder id  — a token for one reminder cannot approve a different one
 *   content hash — a token stops matching the moment the message changes
 *   expiry       — a token left open for hours stops working
 *
 * The secret never leaves the server. The browser receives only the opaque
 * token and cannot mint or alter one.
 *
 * WHAT THIS DOES AND DOES NOT CLAIM. It enforces the review WORKFLOW — approval
 * must come from a page this server issued, for this user, for this reminder,
 * for exactly this content, recently. It does not and cannot prove the owner
 * read every line. That distinction is deliberate and stated rather than
 * quietly overclaimed.
 */

/** How long a review authorisation stays valid. */
export const REVIEW_TOKEN_TTL_SECONDS = 30 * 60;

/**
 * The signing secret.
 *
 * REVIEW_TOKEN_SECRET when set; otherwise derived from the service-role key,
 * which is already a server-only secret that every deployment has. Deriving
 * rather than using it directly means this token cannot be confused with, or
 * replayed against, anything else that key protects.
 *
 * Throws when neither is available: a silent fallback to a constant would make
 * every token forgeable, which is worse than failing to boot.
 */
function signingSecret(): string {
  const explicit = process.env.REVIEW_TOKEN_SECRET?.trim();
  if (explicit) return explicit;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceKey) {
    return createHash("sha256").update(`ss-review-token::${serviceKey}`).digest("hex");
  }

  throw new Error(
    "[review-token] No signing secret available. Set REVIEW_TOKEN_SECRET or SUPABASE_SERVICE_ROLE_KEY."
  );
}

export interface ReviewTokenClaims {
  userId: string;
  reminderId: string;
  contentHash: string;
  /** Unix seconds. */
  issuedAt: number;
  expiresAt: number;
}

export type ReviewTokenFailure =
  | "malformed"
  | "bad_signature"
  | "expired"
  | "wrong_user"
  | "wrong_reminder"
  | "content_changed";

function payloadOf(claims: ReviewTokenClaims): string {
  // Fixed order and explicit separators, so no two distinct claim sets can
  // produce the same signing input.
  return [
    "v1",
    claims.userId,
    claims.reminderId,
    claims.contentHash,
    String(claims.issuedAt),
    String(claims.expiresAt),
  ].join("|");
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

/** Issues a token. Server-side only — called when rendering the review page. */
export function issueReviewToken(params: {
  userId: string;
  reminderId: string;
  contentHash: string;
  now?: Date;
}): string {
  const nowSec = Math.floor((params.now ?? new Date()).getTime() / 1000);
  const claims: ReviewTokenClaims = {
    userId: params.userId,
    reminderId: params.reminderId,
    contentHash: params.contentHash,
    issuedAt: nowSec,
    expiresAt: nowSec + REVIEW_TOKEN_TTL_SECONDS,
  };

  const payload = payloadOf(claims);
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(payload)}`;
}

/**
 * Verifies a token against what the server currently believes.
 *
 * Fails CLOSED on every branch: an unparseable token, a bad signature, a
 * different user, a different reminder, an expired window or changed content
 * all return a failure and no send occurs.
 */
export function verifyReviewToken(
  token: string | null | undefined,
  expected: { userId: string; reminderId: string; contentHash: string },
  now: Date = new Date()
): { ok: true; claims: ReviewTokenClaims } | { ok: false; reason: ReviewTokenFailure } {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }

  const [encoded, providedSig] = token.split(".");
  if (!encoded || !providedSig) return { ok: false, reason: "malformed" };

  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const parts = payload.split("|");
  if (parts.length !== 6 || parts[0] !== "v1") return { ok: false, reason: "malformed" };

  // Signature FIRST, before trusting any field inside the payload.
  const expectedSig = sign(payload);
  const a = Buffer.from(providedSig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  const claims: ReviewTokenClaims = {
    userId: parts[1],
    reminderId: parts[2],
    contentHash: parts[3],
    issuedAt: Number(parts[4]),
    expiresAt: Number(parts[5]),
  };

  if (!Number.isFinite(claims.expiresAt)) return { ok: false, reason: "malformed" };
  if (Math.floor(now.getTime() / 1000) > claims.expiresAt) {
    return { ok: false, reason: "expired" };
  }

  if (claims.userId !== expected.userId) return { ok: false, reason: "wrong_user" };
  if (claims.reminderId !== expected.reminderId) return { ok: false, reason: "wrong_reminder" };

  // The content changed since the token was issued. This is the stale-review
  // case: amount edited, due date rolled over, sender renamed, and so on.
  if (claims.contentHash !== expected.contentHash) {
    return { ok: false, reason: "content_changed" };
  }

  return { ok: true, claims };
}

/**
 * The idempotency key lives in lib/reminder-send-state.ts, not here.
 *
 * It is bound to the logical ATTEMPT NUMBER as well as the content, and the
 * attempt number is allocated by the atomic claim — so the key belongs with the
 * send lifecycle, and stays importable without this module's server-only guard.
 */
export { idempotencyKeyFor } from "./reminder-send-state";
