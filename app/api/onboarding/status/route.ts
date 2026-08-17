import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import {
  getVerifiedContext,
  isAllowedTransition,
  isOnboardingStatus,
  statusOf,
  type OnboardingStatus,
} from "@/lib/onboarding";
import { cleanBusinessNameOrNull } from "@/lib/business-name";
import { isUuid } from "@/lib/onboarding-handoff";
import { prepareEligibility } from "@/lib/reminder-schedule";

/**
 * Reads and writes the caller's own onboarding status.
 *
 * Only two transitions are accepted — `skipped` and `completed` — and only
 * from the user's own session. `required` and `exempt` are set by the
 * migration and by profile creation; letting a client write them would allow
 * an account to put itself back into a first-run flow, or out of one it has
 * not done.
 */

const WRITABLE: readonly OnboardingStatus[] = ["skipped", "completed"];

/**
 * Per-user data behind a session cookie: never prerendered, never stored by a
 * shared cache. `force-dynamic` stops Next from treating this as static; the
 * explicit Cache-Control stops any CDN or proxy in front of it from holding a
 * response and serving one account's reminder to another.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET() {
  const context = await getVerifiedContext();
  if (!context) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401, headers: NO_STORE });
  }
  // statusOf() is null unless a profile row was genuinely read, so a database
  // failure reports `null` here rather than inventing an exemption.
  return NextResponse.json({
    success: true,
    status: statusOf(context),
    unavailable: context.kind !== "ready" ? context.kind : undefined,
    businessName: context.businessName ?? context.user.businessNameFromMetadata,
  }, { headers: NO_STORE });
}

export async function PATCH(request: Request) {
  const context = await getVerifiedContext();
  if (!context) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401, headers: NO_STORE });
  }

  let body: {
    status?: string;
    business_name?: string;
    invoice_id?: string;
    reminder_id?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request body." }, { status: 400, headers: NO_STORE });
  }

  if (!isOnboardingStatus(body.status) || !WRITABLE.includes(body.status)) {
    return NextResponse.json(
      { success: false, message: "Status must be 'skipped' or 'completed'." },
      { status: 400 }
    );
  }

  // ── Transition check ────────────────────────────────────────────────────
  //
  // Against the CURRENT status as read from the database, not one the client
  // supplied. getVerifiedContext has already refused anything but a `ready`
  // kind with a valid stored value, so `current` is a real state.
  const current = statusOf(context);
  if (!current) {
    // Migration absent, unexpected error, or a corrupt stored value. No write
    // is attempted, because we do not know what we would be moving from.
    return NextResponse.json(
      { success: false, message: "Setup isn't available right now. Please try again later." },
      { status: 503 }
    );
  }

  if (!isAllowedTransition(current, body.status)) {
    console.warn(
      `[api/onboarding/status] Rejected transition ${current} -> ${body.status} ` +
      `for user ${context.user.id}.`
    );
    // completed and exempt are terminal, so this is the honest answer rather
    // than an error: their setup is already settled.
    return NextResponse.json(
      { success: false, message: "Your setup is already up to date.", status: current },
      { status: 409 }
    );
  }

  const supabase = getSupabaseServer();

  // ── Evidence for `completed` ────────────────────────────────────────────
  //
  // `completed` is a claim that the user reached the end of the flow with a
  // real invoice and a real prepared reminder. Accepting the word on its own
  // would let any authenticated caller mark themselves complete — including
  // one who never opened onboarding — and would let a UI bug record success
  // after a failed write. So the client must name what it produced, and the
  // server checks that it exists and belongs to them.
  //
  // `skipped` requires no evidence: it is a claim about a DECISION, not an
  // outcome, and the user is entitled to make it at any point.
  if (body.status === "completed") {
    if (!isUuid(body.invoice_id)) {
      return NextResponse.json(
        { success: false, message: "Setup could not be confirmed. Please try again." },
        { status: 400 }
      );
    }

    // ── THE SECOND FORM OF EVIDENCE ─────────────────────────────────────
    //
    // An invoice whose first checkpoint has not been reached produces no
    // reminder, so there is no reminder to name. Requiring one would have left
    // a customer who joined with an invoice due next week permanently
    // `required` — sent back to onboarding on every dashboard visit, with a
    // completed setup and no way to record it.
    //
    // The evidence rule is widened, NOT relaxed. The client says only "this
    // invoice"; the server re-derives eligibility from the STORED due date and
    // schedules using the same function the prepare route uses. So a caller
    // cannot skip the review by omitting reminder_id — if the invoice is in
    // fact eligible, that path is refused and the reminder pair is demanded as
    // before.
    if (!body.reminder_id) {
      const { data: invoice, error: invoiceError } = await supabase
        .from("invoices")
        .select("id, due_date, reminder_schedules, reminders_sent")
        .eq("id", body.invoice_id)
        .eq("user_id", context.user.id)
        .maybeSingle();

      if (invoiceError) {
        console.error(
          `[api/onboarding/status] Invoice lookup failed for user ${context.user.id}: ` +
          invoiceError.message
        );
        return NextResponse.json(
          { success: false, message: "We couldn't confirm your setup. Please try again." },
          { status: 500 }
        );
      }

      // Same answer for "does not exist" and "is not yours", so this cannot be
      // used to probe another account's invoice ids.
      if (!invoice) {
        return NextResponse.json(
          { success: false, message: "Setup could not be confirmed. Please try again." },
          { status: 422 }
        );
      }

      const eligibility = prepareEligibility(
        invoice.reminder_schedules ?? [],
        invoice.reminders_sent ?? [],
        invoice.due_date
      );
      if (eligibility.schedule) {
        console.warn(
          `[api/onboarding/status] Refused reminder-less completion for user ` +
          `${context.user.id}: invoice ${body.invoice_id} is eligible now.`
        );
        // ── WHY THIS ONE REFUSAL IS MACHINE-READABLE ────────────────────
        //
        // The check is unchanged and still absolute: an eligible invoice can
        // never be completed without its reminder. But this refusal is
        // RECOVERABLE and every other one is not — the invoice crossed its
        // first checkpoint between being created and this request, most
        // obviously over midnight. `reason` lets the client respond to that
        // specifically, by taking the customer into the preparation and
        // review it should now be offering, instead of showing a dead end.
        //
        // No enumeration risk: reaching this line already required the
        // invoice to belong to the caller. "Not found" and "not yours" both
        // return above, with no reason and the identical message — so the two
        // still cannot be told apart, and nothing about another account is
        // observable either way.
        return NextResponse.json(
          {
            success: false,
            reason: "eligible_now",
            message: "Setup could not be confirmed. Please try again.",
          },
          { status: 422 }
        );
      }
      // Falls through to the status write below. Nothing was prepared and
      // nothing was sent — the daily job will reach this invoice on its own
      // checkpoint, exactly as it would for one added from the dashboard.
    } else {
      if (!isUuid(body.reminder_id)) {
        return NextResponse.json(
          { success: false, message: "Setup could not be confirmed. Please try again." },
          { status: 400 }
        );
      }

      // One query, joined through invoices, under the user's own session.
      // reminder_logs carries user_id AND invoice_id, so this pins all three
      // relationships at once: the reminder is the user's, the invoice is the
      // user's, and the reminder belongs to that invoice. RLS independently
      // scopes both tables to auth.uid(), so a forged id from another account
      // returns no row rather than someone else's data.
      const { data: evidence, error: evidenceError } = await supabase
        .from("reminder_logs")
        .select("id, status, invoice_id, invoices!inner(id, status)")
        .eq("id", body.reminder_id)
        .eq("invoice_id", body.invoice_id)
        .eq("user_id", context.user.id)
        .maybeSingle();

      if (evidenceError) {
        console.error(
          `[api/onboarding/status] Evidence lookup failed for user ${context.user.id}: ` +
          evidenceError.message
        );
        return NextResponse.json(
          { success: false, message: "We couldn't confirm your setup. Please try again." },
          { status: 500 }
        );
      }

      // No row means the pairing is wrong, one of them does not exist, the
      // invoice was deleted (the inner join drops it), or neither is theirs.
      // All are answered identically so the endpoint cannot be used to probe
      // which ids exist on other accounts.
      if (!evidence) {
        console.warn(
          `[api/onboarding/status] Rejected completion for user ${context.user.id}: ` +
          `reminder ${body.reminder_id} / invoice ${body.invoice_id} did not resolve.`
        );
        return NextResponse.json(
          { success: false, message: "Setup could not be confirmed. Please try again." },
          { status: 422 }
        );
      }

      // Which reminder states count as a finished onboarding.
      //
      // `pending` is the expected one: prepared, waiting for review, nothing
      // sent. That is exactly what the flow promises.
      //
      // `sent` also counts. Between finishing the form and this request the user
      // may legitimately have approved the reminder themselves in another tab —
      // the approval route is the only path that sets `sent`, and it enforces
      // its own eligibility and approval checks. Refusing completion there would
      // punish someone for having engaged MORE than the flow asked. It remains
      // true that this endpoint sends nothing.
      //
      // `dismissed` and `failed` do not count. Dismissed means the user threw
      // the reminder away, and failed means it never got out — neither is the
      // reviewable outcome onboarding exists to deliver.
      const ACCEPTABLE = new Set(["pending", "sent"]);
      if (!ACCEPTABLE.has(evidence.status)) {
        console.warn(
          `[api/onboarding/status] Rejected completion for user ${context.user.id}: ` +
          `reminder ${body.reminder_id} has status '${evidence.status}'.`
        );
        return NextResponse.json(
          {
            success: false,
            message:
              "That reminder is no longer waiting for review, so setup can't be marked complete.",
          },
          { status: 409 }
        );
      }
    }
  }

  // The business name may be confirmed in the same step that finishes
  // onboarding, so it is written in the same request rather than forcing a
  // second round-trip that could half-succeed.
  // onboarding_status_at records WHEN the state last changed. Written in the
  // same statement as the status so the two can never disagree — a separate
  // update could fail on its own and leave a timestamp describing a
  // transition that did not happen.
  const update: Record<string, unknown> = {
    onboarding_status: body.status,
    onboarding_status_at: new Date().toISOString(),
  };
  if (body.business_name !== undefined) {
    const cleaned = cleanBusinessNameOrNull(body.business_name);
    if (!cleaned) {
      return NextResponse.json(
        { success: false, message: "Please enter your business name." },
        { status: 400 }
      );
    }
    update.business_name = cleaned;
  }

  // UPDATE, deliberately not upsert.
  //
  // An earlier version upserted, to cover a user finishing onboarding before
  // the dashboard had ever created their profile row. That was wrong: the
  // upsert would have created a profile containing nothing but user_id and
  // onboarding_status, silently bypassing every guarantee GET /api/profile
  // provides — business_name seeding from auth metadata, the blank-name
  // repair, terms/privacy acceptance, table defaults and the welcome-email
  // trigger. The result would have been a permanently incomplete profile and
  // a customer-facing reminder signed by nobody, and because the row now
  // existed, the canonical creation path would never run to fix it.
  //
  // The profile is instead guaranteed by the canonical path: OnboardingFlow
  // calls GET /api/profile before this route can be reached. There is exactly
  // one place that creates a profile, and it is not here.
  const { data: updated, error } = await supabase
    .from("profiles")
    .update(update)
    .eq("user_id", context.user.id)
    .select("user_id");

  if (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Could not save your setup progress. If this persists, the onboarding_status column may not exist yet.",
        detail: error.message,
      },
      { status: 500 }
    );
  }

  // Zero rows means no profile exists. Reported honestly rather than returning
  // success for a write that stored nothing — a false success here is what
  // would send the user back to a dashboard that immediately returns them to
  // onboarding, forever.
  if (!updated || updated.length === 0) {
    console.error(
      `[api/onboarding/status] No profile row for user ${context.user.id}; ` +
      `status was NOT saved. GET /api/profile should have created it first.`
    );
    return NextResponse.json(
      {
        success: false,
        message: "Your account setup isn't ready yet. Please reload and try again.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true, status: body.status }, { headers: NO_STORE });
}
