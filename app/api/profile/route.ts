import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { cleanBusinessNameOrNull, isBusinessNameBlank } from "@/lib/business-name";
import { sendWelcomeEmailIfNeeded } from "@/lib/welcome-email";
import { LEGAL_CONFIG } from "@/lib/legal";
import type { ProfileUpdate, ReminderTone, ReminderMode } from "@/types";
import { BETA_APPROVAL_ONLY } from "@/lib/beta-capabilities";

const VALID_TONES: ReminderTone[] = ["friendly", "firm", "final"];
const VALID_MODES: ReminderMode[] = ["approval", "auto"];

/**
 * GET /api/profile
 *
 * Returns the current user's profile row, creating it with defaults
 * if it doesn't exist yet (first dashboard load after signup).
 *
 * user_id is taken exclusively from the authenticated session —
 * never accepted from the client.
 */
export async function GET() {
  const supabase = getSupabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  const fetchResult = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const fetchError = fetchResult.error;
  // `let`, not `const`: the repair branch below may replace this with the
  // updated row so the response carries the seeded value immediately.
  let existing = fetchResult.data;

  if (fetchError) {
    console.error(`[api/profile] Profile fetch failed for user ${user.id}:`, fetchError.message);
    return NextResponse.json({ success: false, message: "Failed to load profile." }, { status: 500 });
  }

  if (existing) {
    // ── Repair ────────────────────────────────────────────────────────────
    // Accounts created before business_name travelled in auth metadata reach
    // here with nothing stored. Fill it ONLY when the profile value is absent
    // or blank AND the metadata holds something usable.
    //
    // The guard is what makes this safe to run on every profile read: once a
    // non-blank value exists — whether the user typed it at signup or edited
    // it later in Settings — this branch can never fire again, so metadata
    // can never overwrite a deliberate edit. Idempotent by construction.
    if (isBusinessNameBlank(existing.business_name)) {
      const seeded = cleanBusinessNameOrNull(user.user_metadata?.business_name);
      if (seeded) {
        const { data: repaired, error: repairError } = await supabase
          .from("profiles")
          .update({ business_name: seeded })
          .eq("user_id", user.id) // belt-and-braces; RLS already scopes this
          .select()
          .single();

        if (repairError) {
          // Non-fatal: the profile is still usable, and the next read retries.
          console.error(
            `[api/profile] business_name repair failed for user ${user.id}:`,
            repairError.message
          );
        } else if (repaired) {
          existing = repaired;
        }
      }
    }

    // Attempted on EVERY authenticated call, not just profile creation —
    // this is what makes a failed/timed-out send from an earlier request
    // retryable here, even though the profile already exists by now.
    // tryClaim() is a fast no-op once the row is 'sent' (the common case).
    // Defensive outer catch, independent of sendWelcomeEmailIfNeeded's own
    // internal try/catch — profile retrieval must succeed regardless.
    try {
      await sendWelcomeEmailIfNeeded(user.id, user.email, existing.business_name);
    } catch (err) {
      console.error(
        "[api/profile] Welcome-email side effect failed unexpectedly:",
        err instanceof Error ? err.message : "Unknown error"
      );
    }

    return NextResponse.json({ success: true, profile: existing });
  }

  // First load — create a default profile row.
  // user_id DEFAULT auth.uid() on the table — we don't pass it explicitly,
  // but RLS insert_own_profile policy requires auth.uid() = user_id regardless.
  //
  // v8.9.1 — ROOT CAUSE FIX for the missing-Welcome-email regression.
  //
  // Traced, not assumed: previously this was a single insert() call that,
  // when acceptedTerms was true (the normal case for every real signup),
  // included terms_accepted_at/terms_version/privacy_version in the SAME
  // atomic insert. If supabase/sql/003_terms_privacy_acceptance.sql had
  // not yet been run against the live database, that insert would fail
  // outright (the columns don't exist), insertError would be truthy, and
  // the function returned a 500 BEFORE ever reaching
  // sendWelcomeEmailIfNeeded() below — with the actual error never
  // logged anywhere, just converted into a generic message. That silent
  // failure explains every symptom reported: confirmation, auto sign-in,
  // and the dashboard redirect all succeed (none of them touch this
  // code), but the welcome email is never attempted at all.
  //
  // Fix: the core profile row (identical shape to before this feature
  // existed) is created first and always succeeds regardless of whether
  // the terms migration has run. Terms/privacy acceptance is now a
  // separate, best-effort step afterward — if it fails, it's logged
  // clearly (not swallowed) but does NOT prevent the Welcome trigger,
  // which is the one thing that must never be blocked by a newer,
  // optional feature's migration status.
  //
  // This does not add a second Welcome trigger, does not touch the
  // claim/confirm/fail architecture in lib/email-events.ts, and does not
  // change email_events at all — sendWelcomeEmailIfNeeded is still
  // called exactly once per branch, exactly as before. Idempotency and
  // retry behaviour are unaffected: tryClaim's own atomicity is what
  // prevents duplicates, not anything in this route.
  // ── Seed ────────────────────────────────────────────────────────────────
  // business_name comes from auth metadata, written at signUp. This is the
  // authoritative path: it works whether or not a session existed at signup,
  // so the email-confirmation flow no longer loses the name.
  //
  // Validated, not trusted: user_metadata is untyped JSON and could have been
  // set by a crafted signUp that bypassed the client. cleanBusinessNameOrNull
  // rejects non-strings, blanks and anything over 100 characters rather than
  // truncating, so an over-long name is dropped instead of being corrupted.
  // A null simply leaves the column null, exactly as before this change.
  const seededBusinessName = cleanBusinessNameOrNull(user.user_metadata?.business_name);

  const { data: created, error: insertError } = await supabase
    .from("profiles")
    .insert(seededBusinessName ? { business_name: seededBusinessName } : {})
    .select()
    .single();

  if (insertError) {
    console.error(
      `[api/profile] Profile creation failed for user ${user.id}:`,
      insertError.message
    );
    return NextResponse.json({ success: false, message: "Failed to create profile." }, { status: 500 });
  }

  const acceptedTerms = user.user_metadata?.terms_accepted === true;

  if (acceptedTerms) {
    const { error: termsError } = await supabase
      .from("profiles")
      .update({
        terms_accepted_at: new Date().toISOString(),
        terms_version: LEGAL_CONFIG.termsVersion,
        privacy_version: LEGAL_CONFIG.privacyVersion,
      })
      .eq("user_id", user.id);

    if (termsError) {
      // Deliberately non-fatal. Logged clearly so it's diagnosable —
      // most likely cause: the 003 migration hasn't been run yet.
      console.error(
        `[api/profile] Terms/privacy acceptance was NOT recorded for user ${user.id} ` +
        `(profile creation still succeeded): ${termsError.message}. ` +
        `If this mentions an unknown column, run supabase/sql/003_terms_privacy_acceptance.sql.`
      );
    }
  }

  try {
    await sendWelcomeEmailIfNeeded(user.id, user.email, created.business_name);
  } catch (err) {
    console.error(
      "[api/profile] Welcome-email side effect failed unexpectedly:",
      err instanceof Error ? err.message : "Unknown error"
    );
  }

  return NextResponse.json({ success: true, profile: created });
}

/**
 * PUT /api/profile
 *
 * Updates business_name, contact_email, contact_phone, default_tone,
 * and/or reminder_mode for the current user.
 *
 * user_id is never read from the request body — RLS update_own_profile
 * (auth.uid() = user_id) ensures the update only ever affects the
 * caller's own row, regardless of what's in the body.
 */
export async function PUT(request: NextRequest) {
  const supabase = getSupabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  let body: Partial<ProfileUpdate>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request body." }, { status: 400 });
  }

  const update: ProfileUpdate = {};

  if (typeof body.business_name === "string") {
    update.business_name = body.business_name.trim().slice(0, 100);
  }
  if (typeof body.contact_email === "string") {
    update.contact_email = body.contact_email.trim().slice(0, 200);
  }
  if (typeof body.contact_phone === "string") {
    update.contact_phone = body.contact_phone.trim().slice(0, 50);
  }
  if (body.default_tone && VALID_TONES.includes(body.default_tone)) {
    update.default_tone = body.default_tone;
  }
  if (body.reminder_mode) {
    // Reject rather than silently rewrite: a caller that asked for 'auto'
    // should be told it was refused, not quietly given something else.
    if (BETA_APPROVAL_ONLY && body.reminder_mode === "auto") {
      return NextResponse.json(
        {
          success: false,
          message:
            "Automatic sending is turned off during the founding beta. Every reminder waits for your approval.",
          fieldErrors: {
            reminder_mode:
              "Automatic sending is not available during the founding beta.",
          },
        },
        { status: 400 }
      );
    }
    if (VALID_MODES.includes(body.reminder_mode)) {
      update.reminder_mode = body.reminder_mode;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: false, message: "No valid fields to update." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(update)
    .eq("user_id", user.id) // belt-and-braces — RLS already enforces this
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, message: "Failed to update profile." }, { status: 500 });
  }

  return NextResponse.json({ success: true, profile: data });
}
