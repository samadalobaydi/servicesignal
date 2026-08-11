"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDashboard } from "./DashboardProvider";
import { resolveHandoff, handoffMessage } from "@/lib/onboarding-handoff";

/**
 * The banner shown once, at the top of the dashboard, after onboarding hands
 * off with ?invoice=&reminder=.
 *
 * Renders nothing at all unless the URL names records this account actually
 * has — so an ordinary dashboard visit, a stale bookmark or a deleted invoice
 * all produce no banner rather than an error the user cannot act on.
 *
 * Not dismissible, and deliberately so: it disappears on the next navigation
 * because the query string does, which means there is no dismissal state to
 * store and nothing that can get stuck on screen.
 */
export function OnboardingHandoff({
  /**
   * The review queue mounts this with the link off: "Review it" pointing at
   * the page you are already on is a dead control.
   */
  showReviewLink = true,
}: { showReviewLink?: boolean } = {}) {
  const params = useSearchParams();
  const { liveInvoices, reminders } = useDashboard();

  const invoiceId = params.get("invoice");
  const reminderId = params.get("reminder");

  const target = useMemo(
    () =>
      resolveHandoff(
        invoiceId,
        reminderId,
        liveInvoices.map((i) => i.id),
        reminders.map((r) => r.id)
      ),
    [invoiceId, reminderId, liveInvoices, reminders]
  );

  if (target.tier === "none") return null;

  const invoice = liveInvoices.find((i) => i.id === target.invoiceId);
  if (!invoice) return null;

  const message = handoffMessage(target.tier, invoice.customer_name);
  if (!message) return null;

  return (
    <div
      role="status"
      className="mb-5 rounded-xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3"
      style={{
        background: "var(--dash-accent-soft)",
        border: "1px solid var(--dash-accent)",
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm" style={{ fontWeight: 650, color: "var(--dash-accent-strong)" }}>
          {message.title}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "#475569", lineHeight: 1.5 }}>
          {message.detail}
        </p>
      </div>

      {target.tier === "exact" && showReviewLink && (
        <Link
          href="/dashboard/needs-action"
          className="dash-btn flex-shrink-0 justify-center"
          style={{ padding: "0.5rem 0.9rem", fontSize: "0.85rem" }}
        >
          Review it
        </Link>
      )}
    </div>
  );
}
