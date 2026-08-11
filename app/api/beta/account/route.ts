import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  lookupToken,
  consumeToken,
  claimForProvisioning,
  releaseClaim,
  recordAttempt,
} from "@/lib/beta-verification";
import {
  BETA_CONTINUATION_COOKIE,
  clearedContinuationCookieOptions,
} from "@/lib/beta-continuation";
import { cleanBusinessName, BUSINESS_NAME_MESSAGES } from "@/lib/business-name";
import { firstPasswordError } from "@/lib/password-policy";
import { LEGAL_CONFIG } from "@/lib/legal";

/**
 * POST /api/beta/account — creates a founding-beta account as ALREADY VERIFIED.
 *
 * THIS IS THE ROUTE THAT REMOVES THE SECOND EMAIL.
 *
 * The old journey verified the address twice: ServiceSignal's beta email
 * linked to /signup, and Supabase then sent its own generic confirmation from
 * supabase.auth.signUp. Here the address has already been proven by clicking a
 * ServiceSignal link, so the user is created with `email_confirm: true` and
 * Supabase sends nothing at all.
 *
 * WHAT AUTHORISES THAT CLAIM
 *
 * Not the client. The browser sends only a password and a business name. The
 * email comes from the verification row, found via an httpOnly cookie the page
 * cannot read, and that row must be live AND carry verified_at. A client
 * cannot assert an address, cannot assert "verified", and cannot reach this
 * path without having clicked a link delivered to the address in question.
 *
 * The service-role key is used ONLY here, on the server, and is never sent to
 * the browser. The password is passed straight to Supabase Auth and is never
 * logged, never stored outside it, and never written to any table.
 *
 * There is no longer any other way to create an account. /signup renders no
 * form without a verified invitation, and the client-side supabase.auth.signUp
 * call has been removed outright — so the generic Supabase confirmation email
 * has no code path left to fire from. Project-level email confirmation stays
 * ON, which keeps password reset and any future public signup path correct.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function POST(request: Request) {
  const token = cookies().get(BETA_CONTINUATION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { success: false, message: "Your setup link has expired. Please use the link in your email again." },
      { status: 401, headers: NO_STORE }
    );
  }

  let body: { password?: string; business_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid request body." },
      { status: 400, headers: NO_STORE }
    );
  }

  // The SAME policy the form displays, from the same module — see
  // lib/password-policy.ts. This route previously checked length alone while
  // the form showed five rules, so four of the ticks the user saw were never
  // verified by anything. The client is not an enforcement point; this is.
  const password = typeof body.password === "string" ? body.password : "";
  const passwordError = firstPasswordError(password);
  if (passwordError) {
    return NextResponse.json(
      { success: false, message: passwordError },
      { status: 400, headers: NO_STORE }
    );
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    console.error("[beta/account] Admin client unavailable — check SUPABASE_SERVICE_ROLE_KEY.");
    return NextResponse.json(
      { success: false, message: "We couldn't create your account. Please try again shortly." },
      { status: 500, headers: NO_STORE }
    );
  }

  const outcome = await lookupToken(admin, token);
  if (outcome.status !== "valid" || !outcome.row.verified_at) {
    return NextResponse.json(
      { success: false, message: "Your setup link is no longer valid. Please use the link in your email again." },
      { status: 401, headers: NO_STORE }
    );
  }

  const row = outcome.row;

  // The business name may be edited at setup — it is the applicant's own
  // detail, not a security claim — but it must still be valid. The verified
  // EMAIL is never taken from the client.
  const submitted = body.business_name ?? row.business_name ?? "";
  const cleaned = cleanBusinessName(submitted);
  if (cleaned.error) {
    await recordAttempt(admin, row.id);
    return NextResponse.json(
      { success: false, message: BUSINESS_NAME_MESSAGES[cleaned.error] },
      { status: 400, headers: NO_STORE }
    );
  }

  // ── Provisioning lease ───────────────────────────────────────────────
  //
  // Take a short-lived claim rather than consuming the token. This is the
  // cross-system boundary: beta_verifications lives in Postgres, the account
  // lives in Supabase Auth, and no transaction spans them. A claim is
  // reversible; consumption is not, and consuming first meant a transient Auth
  // failure permanently stranded a verified applicant.
  //
  // Only one concurrent request can hold the lease, so only one can reach
  // createUser. A crashed request's claim ages out and the applicant retries.
  const claimed = await claimForProvisioning(admin, row.id);
  if (!claimed) {
    return NextResponse.json(
      {
        success: false,
        message: "We're already setting up your account. Please wait a moment and try again.",
      },
      { status: 409, headers: NO_STORE }
    );
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: row.beta_signup_email,
    password,
    // The address was proven by the emailed link. This is what suppresses
    // Supabase's own confirmation email.
    email_confirm: true,
    // Same metadata shape the ordinary signup path writes, so the profile
    // seeding and repair in GET /api/profile work identically for beta users.
    user_metadata: {
      business_name: cleaned.value,
      terms_accepted: true,
      terms_version: LEGAL_CONFIG.termsVersion,
      privacy_version: LEGAL_CONFIG.privacyVersion,
    },
  });

  if (error || !data?.user) {
    const message = error?.message ?? "unknown error";

    // ── Reconciliation ─────────────────────────────────────────────────
    //
    // An account already exists for this address. That is the expected
    // outcome when a previous request created the user but failed before it
    // could consume the token — so it is treated as SUCCESS, not failure: the
    // desired end state (a confirmed account for this verified address) has
    // been reached. The token is consumed and the browser signs in normally,
    // which makes repeated submissions produce exactly one account.
    //
    // No enumeration risk. Reaching this line requires a verified, unconsumed
    // token for this exact address, which only its owner can hold. Nothing
    // here reveals anything about any OTHER address.
    if (/already|registered|exists/i.test(message)) {
      await consumeToken(admin, row.id);

      const reconciled = NextResponse.json(
        {
          success: true,
          reconciled: true,
          email: row.beta_signup_email,
        },
        { headers: NO_STORE }
      );
      reconciled.cookies.set(BETA_CONTINUATION_COOKIE, "", clearedContinuationCookieOptions());
      return reconciled;
    }

    // A genuine failure with NO account behind it. Release the lease so the
    // applicant can simply try again — their link stays live.
    await releaseClaim(admin, row.id);

    console.error(
      `[beta/account] createUser failed for token ${row.id} ` +
      `(${row.beta_signup_email}): ${message}. Claim released; the link is still valid.`
    );
    return NextResponse.json(
      { success: false, message: "We couldn't create your account. Please try again in a moment." },
      { status: 503, headers: NO_STORE }
    );
  }

  // The account exists. NOW the token is permanently spent. If this write
  // fails the account still exists, and a retry reconciles through the
  // already-exists path above rather than creating a second account.
  await consumeToken(admin, row.id);

  // The account exists and is confirmed. The browser now signs in with the
  // password it already holds — the profile row, welcome email and onboarding
  // status are all created by GET /api/profile on first authenticated load,
  // exactly as they are for an ordinary signup. Nothing is duplicated here.
  const response = NextResponse.json(
    { success: true, email: row.beta_signup_email },
    { headers: NO_STORE }
  );
  response.cookies.set(BETA_CONTINUATION_COOKIE, "", clearedContinuationCookieOptions());
  return response;
}
