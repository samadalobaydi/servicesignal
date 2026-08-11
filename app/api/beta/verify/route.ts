import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { lookupToken, markVerified } from "@/lib/beta-verification";
import {
  BETA_CONTINUATION_COOKIE,
  continuationCookieOptions,
} from "@/lib/beta-continuation";

/**
 * GET /api/beta/verify?token=... — the target of the emailed "Verify your
 * email" button.
 *
 * A route handler rather than a page because it must SET A COOKIE, which a
 * server component cannot do. It validates, records the verification, moves
 * the token out of the URL and into an httpOnly cookie, then redirects to
 * /verify with only a coarse state word in the query string.
 *
 * That redirect is what keeps the raw token out of browser history, out of the
 * Referer header of anything the user clicks next, and out of any URL logging.
 *
 * SENDS NOTHING and CREATES NOTHING. It proves an address and hands the user
 * forward; the account is created later, by /api/beta/account, once a password
 * has been set.
 */

export const dynamic = "force-dynamic";

type State = "ok" | "expired" | "used" | "invalid";

function back(request: Request, state: State) {
  // Built from the REQUEST'S OWN ORIGIN, not from configuration.
  //
  // This is a same-app redirect, so the origin the user actually reached is by
  // definition the right one to send them back to — it cannot be misconfigured
  // and needs no environment variable. Config only has to be right for links
  // we put INTO emails, where there is no incoming request to learn from.
  return NextResponse.redirect(new URL(`/verify?state=${state}`, request.url));
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");

  if (!token) return back(request, "invalid");

  const admin = getSupabaseAdmin();
  if (!admin) {
    console.error("[beta/verify] Admin client unavailable — check SUPABASE_SERVICE_ROLE_KEY.");
    return back(request, "invalid");
  }

  const outcome = await lookupToken(admin, token);

  if (outcome.status === "expired") return back(request, "expired");
  if (outcome.status === "consumed") return back(request, "used");
  if (outcome.status === "invalid") return back(request, "invalid");

  // Idempotent: clicking the same live link twice verifies once and succeeds
  // both times, rather than the second click reading as a failure.
  await markVerified(admin, outcome.row.id);

  const response = back(request, "ok");
  response.cookies.set(BETA_CONTINUATION_COOKIE, token, continuationCookieOptions());
  return response;
}
