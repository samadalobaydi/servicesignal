import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardProvider } from "@/components/dashboard/DashboardProvider";
import DashboardChrome from "@/components/dashboard/DashboardChrome";
import { getVerifiedContext, shouldRedirectToOnboarding } from "@/lib/onboarding";

export const metadata: Metadata = {
  title: "Dashboard — ServiceSignal",
  description: "Manage your unpaid invoices and automated reminders.",
};

// Reads the session cookie, so it must never be statically rendered.
export const dynamic = "force-dynamic";

/**
 * The onboarding gate lives here rather than in middleware.
 *
 * Middleware runs on the Edge for every matched request and would need its own
 * Supabase client and its own profile query to know the status — a second
 * implementation of the same lookup, on the hot path of every navigation. The
 * layout already renders once per dashboard entry and can use the shared
 * helper, so the rule exists in exactly one place.
 *
 * Only `required` redirects. A user who skipped is deliberately left alone;
 * see lib/onboarding.ts. If no verified context exists, this defers to the
 * existing middleware auth redirect rather than duplicating that decision.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // shouldRedirectToOnboarding branches on the result KIND: both failure kinds
  // fail open to the dashboard, and only a genuinely-read `required` diverts.
  const context = await getVerifiedContext();
  if (context && shouldRedirectToOnboarding(context)) {
    redirect("/onboarding");
  }

  return (
    <DashboardProvider>
      <DashboardChrome>{children}</DashboardChrome>
    </DashboardProvider>
  );
}
