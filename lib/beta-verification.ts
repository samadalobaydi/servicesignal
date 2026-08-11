import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Founding-beta email verification.
 *
 * ServiceSignal verifies the applicant's address ONCE, before any account
 * exists. The account is then created already-confirmed, which is what removes
 * the second, generic Supabase confirmation email from the journey.
 *
 * Server-only. Every function here expects a service-role client:
 * beta_verifications has RLS enabled with no policies, so an anon client can
 * read and write precisely nothing.
 */

/** 32 bytes of CSPRNG output, base64url. ~256 bits — not guessable. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256, hex.
 *
 * Only the hash is stored. The raw token exists in the emailed link and
 * nowhere else, so a database disclosure yields no usable verification links.
 * A plain hash (not bcrypt) is correct here: the input is 256 bits of
 * randomness, so there is no dictionary to attack and no need for a slow KDF.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time compare, for anywhere two hashes are checked directly. */
export function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** How long a verification link stays valid. */
export const VERIFICATION_TTL_HOURS = 48;

/** Guessing budget per issued row before it is refused outright. */
const MAX_ATTEMPTS = 10;

export interface BetaVerificationRow {
  id: string;
  beta_signup_email: string;
  business_name: string | null;
  token_hash: string;
  expires_at: string;
  verified_at: string | null;
  claimed_at: string | null;
  consumed_at: string | null;
  superseded_at: string | null;
  attempts: number;
}

/**
 * How long a provisioning claim is honoured before another attempt may take
 * it. Long enough that a slow Auth call is not overtaken; short enough that a
 * crashed request does not lock the applicant out for long.
 */
export const CLAIM_TTL_SECONDS = 90;

/**
 * Every outcome a token lookup can have.
 *
 * `invalid` deliberately covers "no such token", "superseded" and
 * "too many attempts" alike. Distinguishing them would let a caller learn
 * something about tokens they do not hold.
 */
export type TokenOutcome =
  | { status: "valid"; row: BetaVerificationRow }
  | { status: "expired" }
  | { status: "consumed" }
  | { status: "invalid" };

/**
 * Marks every currently-active verification for an address as superseded.
 *
 * "Active" is exactly what the partial unique index treats as active —
 * unconsumed and not already superseded — so the two can never disagree about
 * which rows are in play.
 */
async function supersedeActive(admin: SupabaseClient, email: string) {
  return admin
    .from("beta_verifications")
    .update({ superseded_at: new Date().toISOString() })
    .eq("beta_signup_email", email)
    .is("consumed_at", null)
    .is("superseded_at", null);
}

/**
 * Issues a token for an applicant, superseding any earlier live one.
 *
 * Returns the RAW token for the email link. It is never persisted and never
 * logged; the caller must put it straight into the link and forget it.
 */
export async function issueVerification(
  admin: SupabaseClient,
  params: { email: string; businessName: string | null }
): Promise<{ token: string } | null> {
  const email = params.email.trim().toLowerCase();
  const token = generateToken();

  // Any previous live token for this address stops working the moment a new
  // one is issued, so a forwarded old email cannot be used alongside a new one.
  const { error: supersedeError } = await supersedeActive(admin, email);

  if (supersedeError) {
    console.error("[beta-verification] Could not supersede prior tokens:", supersedeError.message);
    return null;
  }

  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_HOURS * 3600 * 1000);

  const insert = () =>
    admin.from("beta_verifications").insert({
      beta_signup_email: email,
      business_name: params.businessName?.trim() || null,
      token_hash: hashToken(token),
      expires_at: expiresAt.toISOString(),
    });

  let { error } = await insert();

  // 23505 against beta_verifications_one_active_per_email means a concurrent
  // re-issue inserted its own active row between our supersede and our insert.
  // Both requests superseded, both tried to insert, and the index let only one
  // through — which is exactly what it is for.
  //
  // Re-supersede (this time catching the row the winner just created) and try
  // once more. One retry is enough: a second collision would need another
  // concurrent issue in the same few milliseconds, and looping on a unique
  // violation is how a hot spin gets written by accident.
  if (error?.code === "23505") {
    const { error: resupersedeError } = await supersedeActive(admin, email);
    if (resupersedeError) {
      console.error(
        "[beta-verification] Could not re-supersede after a concurrent issue:",
        resupersedeError.message
      );
      return null;
    }
    ({ error } = await insert());
  }

  if (error) {
    console.error("[beta-verification] Could not issue token:", error.message);
    return null;
  }

  return { token };
}

/** Looks a token up and classifies it. Does not mutate lifecycle state. */
export async function lookupToken(
  admin: SupabaseClient,
  rawToken: string
): Promise<TokenOutcome> {
  if (!rawToken || rawToken.length < 20) return { status: "invalid" };

  const { data, error } = await admin
    .from("beta_verifications")
    .select("*")
    .eq("token_hash", hashToken(rawToken))
    .maybeSingle();

  if (error) {
    console.error("[beta-verification] Lookup failed:", error.message);
    return { status: "invalid" };
  }
  if (!data) return { status: "invalid" };

  const row = data as BetaVerificationRow;

  // Order matters. `consumed` is reported before `expired` so a user who
  // already finished sees "already used" rather than a confusing expiry
  // message, and repeated clicks on a completed link read correctly.
  if (row.consumed_at) return { status: "consumed" };
  if (row.superseded_at) return { status: "invalid" };
  if (row.attempts >= MAX_ATTEMPTS) return { status: "invalid" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { status: "expired" };

  return { status: "valid", row };
}

/**
 * Marks a token verified. Idempotent — repeated clicks are not an error.
 *
 * Verification does NOT consume the token. The applicant still has to set a
 * password, and consuming here would leave them holding no evidence at the
 * step that actually creates the account.
 */
export async function markVerified(
  admin: SupabaseClient,
  rowId: string
): Promise<boolean> {
  const { error } = await admin
    .from("beta_verifications")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", rowId)
    .is("verified_at", null);

  if (error) {
    console.error("[beta-verification] Could not mark verified:", error.message);
    return false;
  }
  return true;
}

/**
 * Takes a short-lived provisioning lease.
 *
 * THE CROSS-SYSTEM BOUNDARY. Creating an account touches two systems that
 * share no transaction: this table in Postgres, and Supabase Auth. Something
 * must be written before the Auth call (or concurrent requests both create
 * accounts) and something must be written after (or a failure is
 * indistinguishable from success). A single `consumed_at` cannot do both jobs
 * — the previous version consumed BEFORE createUser, so any transient Auth
 * failure permanently stranded a verified applicant holding a dead link.
 *
 * So the lease is separate from the spend. This UPDATE matches only when the
 * row is unconsumed AND either unclaimed or holding a claim older than
 * CLAIM_TTL_SECONDS. Two simultaneous submissions therefore cannot both win,
 * and a crashed request leaves a claim that simply ages out.
 *
 * Returns whether THIS caller holds the lease.
 */
export async function claimForProvisioning(
  admin: SupabaseClient,
  rowId: string
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - CLAIM_TTL_SECONDS * 1000).toISOString();

  // Every condition is re-checked HERE, in the one atomic UPDATE, not
  // inherited from the earlier lookupToken() read. Between that read and this
  // write a concurrent re-issue could have superseded the row, or it could
  // have expired. Re-asserting them means the claim cannot be granted on a row
  // that stopped being claimable in the interim.
  const { data, error } = await admin
    .from("beta_verifications")
    .update({ claimed_at: new Date().toISOString() })
    .eq("id", rowId)
    .is("consumed_at", null)
    .is("superseded_at", null)
    .not("verified_at", "is", null)
    .gt("expires_at", new Date().toISOString())
    .or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`)
    .select("id");

  if (error) {
    console.error("[beta-verification] Could not claim for provisioning:", error.message);
    return false;
  }
  return !!data && data.length > 0;
}

/**
 * Releases a lease after a failure that left NO account behind.
 *
 * Called only on transient errors. Releasing after a success — or after any
 * outcome where an account might exist — would let a second request try to
 * create the same account again.
 */
export async function releaseClaim(admin: SupabaseClient, rowId: string): Promise<void> {
  const { error } = await admin
    .from("beta_verifications")
    .update({ claimed_at: null })
    .eq("id", rowId)
    .is("consumed_at", null);

  if (error) {
    // Not fatal: the claim ages out on its own. Logged because a persistent
    // failure here means retries are slower than they should be.
    console.error("[beta-verification] Could not release claim:", error.message);
  }
}

/**
 * Spends the token permanently. Called ONLY once the account is known to
 * exist — either just created, or reconciled as already existing.
 *
 * The `.is("consumed_at", null)` predicate keeps it idempotent: a repeat call
 * returns false rather than overwriting the original timestamp.
 */
export async function consumeToken(
  admin: SupabaseClient,
  rowId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("beta_verifications")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", rowId)
    .is("consumed_at", null)
    .select("id");

  if (error) {
    console.error("[beta-verification] Could not consume token:", error.message);
    return false;
  }
  return !!data && data.length > 0;
}

/** Records a failed attempt against a known row, bounding brute force. */
export async function recordAttempt(admin: SupabaseClient, rowId: string): Promise<void> {
  const { data } = await admin
    .from("beta_verifications")
    .select("attempts")
    .eq("id", rowId)
    .maybeSingle();

  const current = typeof data?.attempts === "number" ? data.attempts : 0;
  await admin.from("beta_verifications").update({ attempts: current + 1 }).eq("id", rowId);
}
