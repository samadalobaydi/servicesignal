import "server-only";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Durable rate limiting for POST /api/signup.
 *
 * Backed by the `signup_attempts` table (see supabase/sql/004_signup_rate_limit.sql)
 * rather than process memory. The app runs on serverless functions: an
 * in-process counter resets on every cold start and is not shared between
 * concurrent instances, so it would look like protection without being any.
 * This is deliberately a shared, persistent store.
 *
 * FAIL-CLOSED ON EMAIL, OPEN ON CAPTURE
 * -------------------------------------
 * If the limiter cannot do its job — table missing because the migration has
 * not been run, Supabase unreachable, query error — `ok` is false and
 * `degraded` is true. The caller must then still SAVE the signup (never lose a
 * lead) but must NOT SEND EMAIL. That way an unverified environment can never
 * become an open relay, while a visitor's details are still captured.
 *
 * Privacy: the raw IP is never stored or logged. Only a salted SHA-256 hash
 * is written, so the table cannot be used to identify a visitor.
 */

/** Attempts permitted per IP within the window. */
export const RATE_LIMIT_MAX = 5;
/** Rolling window, in minutes. */
export const RATE_LIMIT_WINDOW_MINUTES = 60;

export interface RateLimitResult {
  /** True when the request may proceed to sending email. */
  ok: boolean;
  /** True when the limiter itself could not run — caller must not send email. */
  degraded: boolean;
  /** Attempts already recorded in the window (0 when degraded). */
  used: number;
}

/**
 * Best-effort client IP. Vercel sets x-forwarded-for; the left-most entry is
 * the original client. Falls back to a constant so a missing header buckets
 * everyone together rather than silently disabling the limit.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

function hashIp(ip: string): string {
  // A bare SHA-256 of an IPv4 address is trivially reversible by brute force
  // (2^32 candidates), so the hash must be salted. SIGNUP_HASH_SALT is
  // preferred; the service-role key is a server-only fallback so the limiter
  // still works before that variable is added.
  const salt =
    process.env.SIGNUP_HASH_SALT?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/**
 * Records this attempt and reports whether the caller is within its allowance.
 * Never throws — every failure path returns `degraded: true`.
 */
export async function checkSignupRateLimit(
  supabase: SupabaseClient | null,
  ip: string
): Promise<RateLimitResult> {
  if (!supabase) {
    return { ok: false, degraded: true, used: 0 };
  }

  const ipHash = hashIp(ip);
  const since = new Date(
    Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
  ).toISOString();

  try {
    const { count, error: countError } = await supabase
      .from("signup_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);

    if (countError) {
      // Most likely cause: migration 004 has not been run yet.
      console.error(
        "[rate-limit] signup_attempts unavailable — email sending suppressed. " +
          "Run supabase/sql/004_signup_rate_limit.sql. Reason:",
        countError.message
      );
      return { ok: false, degraded: true, used: 0 };
    }

    const used = count ?? 0;

    // Record the attempt regardless of the outcome, so a caller who is already
    // over the limit cannot reset their window by continuing to try.
    const { error: insertError } = await supabase
      .from("signup_attempts")
      .insert({ ip_hash: ipHash });

    if (insertError) {
      console.error("[rate-limit] attempt not recorded:", insertError.message);
      return { ok: false, degraded: true, used };
    }

    return { ok: used < RATE_LIMIT_MAX, degraded: false, used };
  } catch (err) {
    console.error(
      "[rate-limit] unexpected failure — email sending suppressed:",
      err instanceof Error ? err.message : "unknown error"
    );
    return { ok: false, degraded: true, used: 0 };
  }
}
