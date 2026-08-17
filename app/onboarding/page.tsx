import { getVerifiedContext, onboardingView, statusOf } from "@/lib/onboarding";
import { isBusinessNameBlank } from "@/lib/business-name";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { OnboardingAllSet } from "@/components/onboarding/OnboardingAllSet";
import { OnboardingUnavailable } from "@/components/onboarding/OnboardingUnavailable";
import { OnboardingAccountNotReady } from "@/components/onboarding/OnboardingAccountNotReady";

export const metadata = { title: "Set up ServiceSignal" };

// Reads the session cookie, so it must never be statically rendered.
export const dynamic = "force-dynamic";

/**
 * First-run setup.
 *
 * A server component that resolves identity once and hands the client the
 * answers it already has. This is what enforces the rule that onboarding never
 * asks for information ServiceSignal already holds: the business name captured
 * at signup arrives as a prop, so the first step confirms it rather than
 * requesting it again.
 *
 * WHO SEES THE FLOW (see shouldRunOnboardingFlow):
 *
 *   required   → run it. The ordinary first-run case.
 *   skipped    → run it. A skipped user who navigates here deliberately is
 *                resuming, and refusing them would make "I'll do this later"
 *                a one-way door. Finishing moves them skipped → completed.
 *   completed  → all-set state, with a way back to the dashboard.
 *   exempt     → all-set state. Nothing was skipped, so there is nothing to
 *                resume; the flow would ask an established user to re-confirm
 *                details they have been using for months.
 *
 * Every non-`ready` kind — migration absent, unexpected error, or a stored
 * status outside the vocabulary — shows the unavailable state instead. The
 * flow ends by recording completion, so it must not begin when that record
 * cannot be written; otherwise a user types a real invoice, has a real
 * reminder prepared, and is told at the last step that none of it counted.
 *
 * This holds for `migration_absent` too. The live schema is unresolved, so
 * that kind is one failed read rather than a proven absence — see
 * onboardingView. To inspect the flow on a Preview, open /onboarding directly.
 */
export default async function OnboardingPage() {
  const context = await getVerifiedContext();

  // NOT redirect("/login?next=/onboarding").
  //
  // middleware already guarantees a session on this route, so /login would
  // bounce straight back to /dashboard — see OnboardingAccountNotReady for the
  // full loop. Explained rather than redirected, and no onboarding status is
  // claimed, because none was read.
  if (!context) return <OnboardingAccountNotReady />;

  const view = onboardingView(context);

  // Inert page: no form, no invoice write, no reminder preparation, and no
  // claim about a status we could not read. The specific cause is in the
  // server log, not in the response.
  if (view === "unavailable") return <OnboardingUnavailable />;
  if (view === "all_set") return <OnboardingAllSet status={statusOf(context)} />;

  // The profile row wins when it exists; signup metadata is the fallback for
  // the window before the profile has been created.
  //
  // NOTE the order. The stored profile value is authoritative and must never
  // be displaced by beta metadata — metadata is a snapshot from signup, the
  // profile is what the user may since have edited.
  const businessName =
    (context.kind === "ready" ? context.businessName : null) ??
    context.user.businessNameFromMetadata ??
    "";

  // Whether the business-name step is needed AT ALL, decided here on the
  // server from the canonical value rather than in the client.
  //
  // ROOT CAUSE of the redundant screen: OnboardingFlow initialised
  // `useState<1|2|3>(1)` unconditionally, so step 1 always rendered even when
  // initialBusinessName already held a valid name. The name appeared
  // pre-filled — which is exactly what the tester saw with "test1" — and the
  // user was asked to confirm something ServiceSignal already had. The fix is
  // this condition, not hiding the step.
  const needsBusinessName = isBusinessNameBlank(businessName);

  return (
    <OnboardingFlow
      initialBusinessName={businessName}
      needsBusinessName={needsBusinessName}
      email={context.user.email ?? ""}
      resuming={statusOf(context) === "skipped"}
    />
  );
}
