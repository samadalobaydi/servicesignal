/**
 * Onboarding state, and the one server-side way to ask who the user is.
 *
 * Several boundaries need the same answer to "is there a verified user, and
 * where are they up to?": the /onboarding page, the dashboard layout, the
 * onboarding status API and the onboarding invoice route. Writing that lookup
 * separately in each is how one of them ends up trusting an unverified session
 * or reading a column that has since been renamed.
 *
 * Server-only. Imports next/headers via getSupabaseServer, so it must never be
 * pulled into a client component.
 */

import { getSupabaseServer } from "@/lib/supabase-server";

/** See supabase/sql/005_onboarding_status.sql for what each value means. */
export const ONBOARDING_STATUSES = ["required", "skipped", "completed", "exempt"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export function isOnboardingStatus(value: unknown): value is OnboardingStatus {
  return typeof value === "string" && (ONBOARDING_STATUSES as readonly string[]).includes(value);
}

/**
 * Postgres 42703 is `undefined_column`. PostgREST answers PGRST204 when a
 * column is missing from its schema cache and PGRST205 for a missing table —
 * both are what an unapplied migration looks like through the REST layer,
 * including the window after the migration runs but before the cache reloads.
 *
 * Closed and exhaustive by design. Anything not on this list is unexpected,
 * and unexpected failures must never be reinterpreted as a statement about a
 * user's onboarding state.
 */
const MIGRATION_ABSENT_CODES = new Set(["42703", "PGRST204", "PGRST205"]);

export function isMigrationAbsentError(error: { code?: string | null } | null): boolean {
  return !!error?.code && MIGRATION_ABSENT_CODES.has(error.code);
}

export interface VerifiedUser {
  id: string;
  email: string | null;
  /** From auth metadata, which is populated at signUp before confirmation. */
  businessNameFromMetadata: string | null;
}

/**
 * The result of asking for onboarding state.
 *
 * A discriminated union, and the discriminant is load-bearing. An earlier
 * version returned `status: "exempt"` alongside a `source` field for the two
 * failure cases — but `exempt` is a factual claim that a user predates
 * onboarding, and a network timeout is not evidence of that. Any consumer that
 * read `.status` without also reading `.source` would silently treat a
 * database outage as a settled exemption, and could persist it.
 *
 * Now the status field does not exist unless a profile row was actually read.
 * Getting at a status requires narrowing to `ready` first, so the mistake is
 * unavailable rather than merely discouraged.
 */
export type OnboardingContext =
  | {
      /** A profile row was read (or its absence positively established). */
      kind: "ready";
      user: VerifiedUser;
      status: OnboardingStatus;
      businessName: string | null;
      /** True when no profile row exists yet — a genuinely new account. */
      isNewProfile: boolean;
    }
  | {
      /** Migration 005 is not applied. Onboarding is dormant. */
      kind: "migration_absent";
      user: VerifiedUser;
      businessName: null;
    }
  | {
      /** Unexpected failure. The status is UNKNOWN — not exempt, not anything. */
      kind: "error";
      user: VerifiedUser;
      businessName: null;
      code: string | null;
    }
  | {
      /**
       * A row was read, but its onboarding_status is not one of the four
       * approved values.
       *
       * Deliberately NOT normalised to `exempt`. A value outside the
       * vocabulary means something is wrong — a bad migration, a manual edit,
       * a future status this build predates, or a CHECK constraint that was
       * never applied. Quietly rewriting that as "this user is exempt" would
       * convert evidence of corruption into a confident claim, and would let
       * the corrupt value survive because nothing ever reports it.
       */
      kind: "invalid_status";
      user: VerifiedUser;
      businessName: string | null;
      /** The offending value, for logs only — never shown to the user. */
      rawStatus: unknown;
    };

/**
 * Which status changes a client may cause, keyed by the CURRENT stored value.
 *
 * Enforced server-side against the status actually in the database, never
 * against one the client asserts. Two rules carry the weight:
 *
 *   completed and exempt are TERMINAL. Nothing a client sends can move an
 *   account out of them. Allowing completed → skipped would let a stray
 *   request un-finish a setup that really happened; allowing exempt → anything
 *   would let a long-standing account be dragged into a first-run flow.
 *
 *   required and skipped may both reach completed, which is what makes "I'll
 *   do this later" a genuine pause rather than a dead end.
 *
 * skipped → skipped is permitted as an idempotent no-op. It is not a state
 * change, and rejecting it would turn a double-click, a retry after a dropped
 * response, or a reload into an error message about a write that had already
 * succeeded.
 */
export const ALLOWED_TRANSITIONS: Record<OnboardingStatus, readonly OnboardingStatus[]> = {
  required: ["skipped", "completed"],
  skipped: ["skipped", "completed"],
  completed: [],
  exempt: [],
};

export function isAllowedTransition(from: OnboardingStatus, to: OnboardingStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Non-null only when a real, valid status was read. No synthetic fallback. */
export function statusOf(context: OnboardingContext): OnboardingStatus | null {
  return context.kind === "ready" ? context.status : null;
}

/**
 * Whether onboarding state can be read AND written right now.
 *
 * False for every kind that is not `ready`. The flow must not begin when this
 * is false: a user could otherwise create an invoice and prepare a reminder,
 * then discover at the final step that finishing cannot be recorded — real
 * work done, no way to bank it.
 */
export function isOnboardingAvailable(context: OnboardingContext): boolean {
  return context.kind === "ready";
}

/**
 * Whether the dashboard must divert this user into first-run setup.
 *
 * Branches on `kind` first. Both failure kinds fail OPEN to the dashboard: a
 * missing migration means the feature does not exist yet, and an unexpected
 * error means we do not know — neither is grounds for trapping someone in a
 * flow. Only a genuinely-read `required` diverts.
 *
 * `skipped` does not divert. Someone who chose "I'll do this later" and was
 * then forced back would have been told their choice was respected and shown
 * otherwise. They can still return to /onboarding themselves at any time.
 */
export function shouldRedirectToOnboarding(context: OnboardingContext): boolean {
  if (context.kind !== "ready") return false;
  return context.status === "required";
}

/**
 * What /onboarding should render.
 *
 *   "flow"        — required or skipped. Skipped resumes: that is the approved
 *                   rule, and refusing it would make "I'll do this later" a
 *                   one-way door.
 *   "all_set"     — completed or exempt. Nothing to do.
 *   "unavailable" — state cannot be read or written.
 *
 * An earlier version ran the flow for the failure kinds, on the reasoning that
 * a deliberate visit deserves the flow. That was wrong, and the objection is
 * concrete: the flow's last act is to record completion, so starting it when
 * the status column cannot be written invites someone to type in a real
 * invoice and have a real reminder prepared, only to be told at the end that
 * none of it could be banked. Failing before any work is asked for is the
 * honest order.
 */
export type OnboardingView = "flow" | "all_set" | "unavailable";

export function onboardingView(context: OnboardingContext): OnboardingView {
  if (context.kind !== "ready") return "unavailable";
  return context.status === "required" || context.status === "skipped" ? "flow" : "all_set";
}

export async function getVerifiedContext(): Promise<OnboardingContext | null> {
  const supabase = getSupabaseServer();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  // Unconfirmed email is not a verified user. Supabase may issue a session
  // before confirmation depending on project settings, so this is checked
  // explicitly rather than assumed.
  if (!user.email_confirmed_at) return null;

  const metadataName = user.user_metadata?.business_name;
  const verified: VerifiedUser = {
    id: user.id,
    email: user.email ?? null,
    businessNameFromMetadata: typeof metadataName === "string" ? metadataName : null,
  };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("business_name, onboarding_status")
    .eq("user_id", user.id)
    .maybeSingle();

  // 1. Column or table missing: migration 005 is not applied. Expected on an
  //    environment that is current with code but not with migrations, so this
  //    is a warning rather than an error.
  if (isMigrationAbsentError(profileError)) {
    console.warn(
      `[onboarding] onboarding_status unavailable for user ${user.id} ` +
      `(${profileError!.code}). Run supabase/sql/005_onboarding_status.sql. ` +
      `Onboarding is dormant; dashboard access is unaffected.`
    );
    return { kind: "migration_absent", user: verified, businessName: null };
  }

  // 2. Anything else — network, auth, RLS, malformed query, or genuinely
  //    unexpected. No status is returned at all, so nothing downstream can
  //    read one, report one or write one back.
  if (profileError) {
    console.error(
      `[onboarding] Unexpected profile query failure for user ${user.id} ` +
      `(code ${profileError.code ?? "none"}): ${profileError.message}. ` +
      `Onboarding status is UNKNOWN — not treating this as an exemption.`
    );
    return {
      kind: "error",
      user: verified,
      businessName: null,
      code: profileError.code ?? null,
    };
  }

  // 3. The query succeeded and there is no row. The column therefore exists,
  //    and no profile means a genuinely new account.
  if (!profile) {
    return {
      kind: "ready",
      user: verified,
      status: "required",
      businessName: null,
      isNewProfile: true,
    };
  }

  const businessName =
    typeof profile.business_name === "string" ? profile.business_name : null;

  // 4. A row whose status is outside the approved vocabulary. Surfaced, not
  //    normalised — see the `invalid_status` member above.
  if (!isOnboardingStatus(profile.onboarding_status)) {
    console.error(
      `[onboarding] Invalid onboarding_status for user ${user.id}: ` +
      `${JSON.stringify(profile.onboarding_status)}. Expected one of ` +
      `${ONBOARDING_STATUSES.join(", ")}. Onboarding is unavailable for this ` +
      `account until the stored value is corrected.`
    );
    return {
      kind: "invalid_status",
      user: verified,
      businessName,
      rawStatus: profile.onboarding_status,
    };
  }

  // 5. An ordinary, valid row.
  return {
    kind: "ready",
    user: verified,
    status: profile.onboarding_status,
    businessName,
    isNewProfile: false,
  };
}
