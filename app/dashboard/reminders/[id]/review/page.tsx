import Link from "next/link";
import { loadReminderReview } from "@/lib/reminder-review";
import { ReminderReviewPanel } from "@/components/dashboard/ReminderReviewPanel";

export const metadata = { title: "Review reminder — ServiceSignal" };

// Reads the session and live reminder state, so it must never be cached.
export const dynamic = "force-dynamic";

/**
 * The final review before a real email reaches a real customer.
 *
 * A SERVER component that loads and composes everything itself. Ownership is
 * never decided in the browser: loadReminderReview reads under the caller's own
 * session, so another user's reminder returns "not found" — indistinguishable
 * from one that does not exist, which is what stops this page confirming
 * whether someone else's reminder is real.
 *
 * Rendering this page performs NO writes. Opening it, refreshing it, or
 * navigating back to it cannot send anything; only the explicit action inside
 * ReminderReviewPanel can, and that posts to the protected approval route.
 */
export default async function ReminderReviewPage({
  params,
}: {
  params: { id: string };
}) {
  const result = await loadReminderReview(params.id);

  if (!result.ok) {
    return (
      <div className="space-y-6">
        <h1 style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--dash-text)", letterSpacing: "-0.02em" }}>
          Reminder unavailable
        </h1>
        <div className="dash-card p-6">
          <p className="text-sm" style={{ color: "var(--dash-text-muted)", lineHeight: 1.6 }}>
            We couldn&rsquo;t find that reminder on your account. It may have been
            dismissed, or the link may be out of date.
          </p>
          <Link
            href="/dashboard/chasing"
            className="dash-btn inline-flex mt-5"
            style={{ padding: "0.55rem 1rem", fontSize: "0.9rem" }}
          >
            Back to Active Chasing
          </Link>
        </div>
      </div>
    );
  }

  return <ReminderReviewPanel data={result.data} />;
}
