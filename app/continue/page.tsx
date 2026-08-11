import { redirect } from "next/navigation";
import { getVerifiedContext, statusOf } from "@/lib/onboarding";

export const metadata = { title: "ServiceSignal" };

// Decides from live session + status, so it must never be cached.
export const dynamic = "force-dynamic";

/**
 * /continue — the Welcome email's "Open ServiceSignal" destination.
 *
 * WHY THIS EXISTS
 *
 * The Welcome CTA previously pointed straight at /onboarding. That is right
 * for someone who has not started, and wrong for everyone else: a user who
 * finished setup a week ago and re-opens the email would be dropped back into
 * first-run setup, which reads as though their work was lost.
 *
 * This route renders nothing. It resolves the user's ACTUAL onboarding status
 * at click time and forwards them, so one durable link stays correct however
 * long the email sits in an inbox.
 *
 * It reuses the existing onboarding status model rather than inventing a
 * parallel one — there is exactly one source of truth for "where is this user
 * up to", and it is lib/onboarding.ts.
 */
export default async function ContinuePage() {
  const context = await getVerifiedContext();

  // Signed out, or signed in as an unverified account. Send them through
  // login with a return path, so they land here again afterwards and the
  // status decision is made for whoever actually signs in — never for the
  // account that happened to be in the browser.
  if (!context) redirect("/login?next=/continue");

  const status = statusOf(context);

  switch (status) {
    // Not started, or explicitly paused. Both resume setup: someone clicking
    // "Open ServiceSignal" from the Welcome email while still mid-setup wants
    // to carry on, and /onboarding itself handles finding their saved invoice.
    case "required":
    case "skipped":
      redirect("/onboarding");

    // Finished, or predates onboarding entirely. Active Chasing is where their
    // invoices actually live — not Needs Action, which is for exceptions.
    case "completed":
    case "exempt":
      redirect("/dashboard/chasing");

    // Status could not be read (migration absent, unexpected error, corrupt
    // value). The dashboard is the safe destination: it is where an
    // established user expects to land, and its own gate re-checks the status
    // rather than trusting this decision.
    default:
      redirect("/dashboard");
  }
}
