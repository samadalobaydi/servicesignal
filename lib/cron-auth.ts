import { timingSafeEqual } from "crypto";

/**
 * Cron request authorisation.
 *
 * VERCEL DOES NOT AUTHENTICATE CRON INVOCATIONS FOR YOU. A cron path is an
 * ordinary public URL that anyone on the internet can request. What Vercel does
 * is send the value of the project's CRON_SECRET environment variable as
 * `Authorization: Bearer <CRON_SECRET>` — and only if that variable is set.
 * Verifying it is the application's job, which is why this exists.
 *
 * FAILS CLOSED. With no secret configured, every request is rejected. The
 * alternative — running unauthenticated when misconfigured — would expose a
 * service-role database sweep to the public internet.
 *
 * Constant-time comparison, so a caller cannot recover the secret one byte at a
 * time from response timings.
 */
export function isAuthorisedCronRequest(
  authorizationHeader: string | null | undefined,
  secret: string | null | undefined
): boolean {
  const expected = secret?.trim();
  if (!expected) return false;
  if (!authorizationHeader) return false;

  const provided = Buffer.from(authorizationHeader, "utf8");
  const wanted = Buffer.from(`Bearer ${expected}`, "utf8");

  // timingSafeEqual throws on a length mismatch, which is itself a leak of
  // length only — unavoidable, and not sensitive for a fixed-format header.
  if (provided.length !== wanted.length) return false;
  return timingSafeEqual(provided, wanted);
}
