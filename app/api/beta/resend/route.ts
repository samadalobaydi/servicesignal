import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { reissueVerification } from "@/lib/beta-verification";
import { sendBetaAccessEmail, firstNameFrom } from "@/lib/beta-access-email";
import { checkSignupRateLimit, clientIpFrom } from "@/lib/signup-rate-limit";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/beta/resend — send a replacement verification link.
 *
 * ── WHAT THIS ENDPOINT DELIBERATELY DOES NOT DO ───────────────────────────
 *
 * It never looks up Supabase Auth, never reports whether an account exists,
 * and returns no account state of any kind. The applicant has already told the
 * UI they are still setting up; that is the only intent this needs, and asking
 * Auth would turn a public endpoint into an account-existence oracle — the
 * exact thing the reused-email screen was designed to avoid.
 *
 * ── WHY AN UNKNOWN ADDRESS LOOKS LIKE A SUCCESSFUL ONE ────────────────────
 *
 * `not_eligible` covers "never applied", "already used to create an account"
 * and "expired long ago" — and it answers with the same `sent` shape a real
 * resend produces, with no email sent. Distinguishing them would let anyone
 * probe which addresses are mid-setup.
 *
 * The real applicant never meets that branch: they arrived here from an
 * `already_listed` submission, so they are eligible by construction and get a
 * genuine send, a genuine cooldown, or a genuine failure. The generic answer
 * costs them nothing and costs a prober everything.
 *
 * ── ABUSE ─────────────────────────────────────────────────────────────────
 *
 * Two independent limits, neither client-side:
 *   per address — the atomic claim inside reissueVerification
 *   per network — the existing durable signup limiter, reused rather than
 *                 reinvented, so a single IP cannot cycle addresses
 */
export async function POST(request: NextRequest) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    console.error("[beta/resend] Admin client unavailable — check SUPABASE_SERVICE_ROLE_KEY.");
    return NextResponse.json(
      { success: false, state: "failed", message: FAILED_MESSAGE },
      { status: 503, headers: NO_STORE }
    );
  }

  let email = "";
  try {
    const body = (await request.json()) as { email?: unknown };
    if (typeof body.email === "string") email = body.email.trim().toLowerCase();
  } catch {
    /* handled by the emptiness check below */
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // Shaped like the generic answer: a malformed address must not be
    // distinguishable from an ineligible one.
    return NextResponse.json(
      { success: true, state: "sent", message: SENT_MESSAGE },
      { headers: NO_STORE }
    );
  }

  // Network-level abuse control, reusing the durable limiter that already
  // guards signup. `degraded` (migration 004 unavailable) fails CLOSED here:
  // unlike a signup there is no lead to preserve, so declining to send is the
  // safe answer rather than becoming an open relay.
  const rate = await checkSignupRateLimit(admin, clientIpFrom(request.headers));
  if (rate.degraded || !rate.ok) {
    return NextResponse.json(
      { success: false, state: "cooldown", message: COOLDOWN_MESSAGE },
      { status: 429, headers: NO_STORE }
    );
  }

  const outcome = await reissueVerification(admin, email);

  if (outcome.status === "cooldown") {
    return NextResponse.json(
      {
        success: false,
        state: "cooldown",
        retryAfterSeconds: outcome.retryAfterSeconds,
        message: COOLDOWN_MESSAGE,
      },
      { status: 429, headers: NO_STORE }
    );
  }

  if (outcome.status === "error") {
    return NextResponse.json(
      { success: false, state: "failed", message: FAILED_MESSAGE },
      { status: 503, headers: NO_STORE }
    );
  }

  if (outcome.status === "not_eligible") {
    // Generic, and no email leaves the building. See the note above.
    return NextResponse.json(
      { success: true, state: "sent", message: SENT_MESSAGE },
      { headers: NO_STORE }
    );
  }

  const sent = await sendBetaAccessEmail({
    to: email,
    // The stored name is not needed for a resend greeting, and reading it back
    // would be another round trip for nothing.
    firstName: firstNameFrom(""),
    // The URL is built by the hardened resolver inside sendBetaAccessEmail —
    // there is deliberately no second URL-building path, and nothing
    // request-derived can influence the destination.
    token: outcome.token,
  });

  if (!sent) {
    // The provider refused. Put the applicant back where they were: their
    // previous link works again and their next attempt is not spent.
    await outcome.restore();
    console.error(`[beta/resend] send failed; previous token restored for ${email}`);
    return NextResponse.json(
      { success: false, state: "failed", message: FAILED_MESSAGE },
      { status: 503, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    { success: true, state: "sent", message: SENT_MESSAGE },
    { headers: NO_STORE }
  );
}

/** Customer-facing copy. No provider names, no error detail, no environment. */
const SENT_MESSAGE = "If that address is waiting to be verified, a new link is on its way.";
const COOLDOWN_MESSAGE =
  `A verification link was sent recently. Please wait a moment before requesting another.`;
const FAILED_MESSAGE = "We couldn't send the verification email just now. Please try again shortly.";

