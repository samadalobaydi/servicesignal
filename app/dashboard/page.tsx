"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useDashboard } from "@/components/dashboard/DashboardProvider";
import StatsCards from "@/components/dashboard/StatsCards";
import InvoiceStatusChart from "@/components/dashboard/InvoiceStatusChart";
import { formatCurrency } from "@/lib/invoices";
import { OnboardingHandoff } from "@/components/dashboard/OnboardingHandoff";
import FirstInvoiceActivation from "@/components/dashboard/FirstInvoiceActivation";
import { isFirstRunOverview } from "@/lib/overview-first-run";
import {
  buildAttentionItems,
  attentionDescription,
  attentionTone,
  type AttentionItem,
} from "@/lib/overview-attention";
import { buildUpcomingItems, upcomingRelative } from "@/lib/overview-upcoming";

/**
 * Overview.
 *
 * WHAT THE PAGE ANSWERS, IN ORDER
 *
 *   KPI row               what is the money picture?
 *   Needs your attention  what should I do next, and where?
 *   Coming up             what will need me next? (only when true)
 *   Invoice status        how is the portfolio distributed?
 *
 * Each section has exactly one job.
 *
 * WHAT WAS REMOVED, AND WHY
 *
 * PASS 1 — four navigation cards (Active Chasing / Needs Action / Paid /
 * Settings). Every one was a link the permanent sidebar already provides,
 * wrapped around a count shown elsewhere on the same screen.
 *
 * PASS 2 — Recent activity. Its three most common entries were "Reminder
 * prepared for review" (already stated, more usefully and with an action
 * attached, in Needs your attention), "Invoice added" (a thing the owner did
 * themselves, with no decision hanging off it) and "Marked paid" (likewise).
 * A log answers "what happened?"; Overview exists to answer "what now?".
 * With a handful of events it also rendered as a tall card mostly full of
 * white. The activity data and helpers are untouched — this is a
 * page-composition decision, not a system deletion.
 *
 * Neither removal was backfilled. The space is the improvement.
 */

const TONE_COLOUR = {
  red: "var(--dash-red)",
  amber: "var(--dash-amber)",
  blue: "var(--dash-accent-strong)",
} as const;

/** The status word beside each item — so state never depends on colour alone. */
const KIND_LABEL: Record<AttentionItem["kind"], string> = {
  send_failed: "Needs resolving",
  reminder_ready: "Ready to review",
  needs_decision: "Needs a decision",
  overdue_no_reminder: "Overdue",
};

/** How many items to show before deferring to the full list. */
const MAX_ATTENTION_ROWS = 5;

/** Coming up is context, not a queue. Four is enough to be useful. */
const MAX_UPCOMING_ROWS = 4;

/** "11 Aug", read as a UTC calendar date so the day never slips a timezone. */
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
}

export default function OverviewPage() {
  const {
    stats, reminders, reminderHistory, buckets,
    liveInvoices, loading,
  } = useDashboard();

  // ── What needs attention ────────────────────────────────────────────────
  //
  // One item per invoice, chosen by precedence — see lib/overview-attention.ts.
  // The three overlapping counts this replaced could describe a single invoice
  // as two separate problems.
  const needsDecisionIds = new Set(buckets.needs_action.map((i) => i.id));
  const attention = buildAttentionItems({
    invoices: liveInvoices,
    pendingReminders: reminders,
    reminderHistory,
    needsDecisionInvoiceIds: needsDecisionIds,
  });
  const visibleAttention = attention.slice(0, MAX_ATTENTION_ROWS);

  // ── What is coming ──────────────────────────────────────────────────────
  //
  // Only ever the NEXT checkpoint per invoice, only when it is genuinely in
  // the future, and only when the daily job's own preconditions are met — see
  // lib/overview-upcoming.ts. An invoice already listed above appears here
  // only for a later checkpoint, never for the same one.
  const upcoming = buildUpcomingItems({
    invoices: liveInvoices,
    pendingReminders: reminders,
    reminderHistory,
  });
  const visibleUpcoming = upcoming.slice(0, MAX_UPCOMING_ROWS);

  // The ONE condition — see lib/overview-first-run.ts. Not "£0 unpaid", not
  // "nothing overdue", not "no reminders yet": an account can be all of those
  // and still be a working account that would be insulted by an activation
  // screen.
  const firstRun = isFirstRunOverview(liveInvoices);

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <OnboardingHandoff />
      </Suspense>

      <div>
        <h1 style={{ fontSize: "1.85rem", fontWeight: 700, color: "var(--dash-text)", letterSpacing: "-0.02em" }}>
          Overview
        </h1>
        {/* "Here's what needs your attention today." sat directly above a
            heading reading "Needs your attention", so the page introduced
            itself with the name of one of its own sections. This wording
            describes the whole page and leaves that heading its meaning. */}
        <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)" }}>
          Your invoices and reminders at a glance.
        </p>
      </div>

      {/* ── First run: zero invoices ─────────────────────────────────────
          Everything below is a truthful report about nothing until an invoice
          exists — four £0.00 cards, an empty attention list, a hidden Coming
          up and an empty donut. Together they make a working product look
          broken on the one screen where a new customer decides whether it is.
          One activation card instead, and nothing invented to fill the space
          the others left. */}
      {!loading && firstRun ? (
        <FirstInvoiceActivation />
      ) : (
        <>
          <StatsCards
            totalUnpaid={stats.totalUnpaid}
            overdueCount={stats.overdueCount}
            awaitingApproval={reminders.length}
            paidThisMonth={stats.paidThisMonth}
          />

          {/* ── Needs your attention — the core of the page ──────────────── */}
          <section className="dash-card dash-section" aria-labelledby="attention-h">
            <div className="flex items-center justify-between gap-3">
              <h2 id="attention-h" style={{ fontSize: "1.05rem", fontWeight: 650, color: "var(--dash-text)" }}>
                Needs your attention
              </h2>
              {attention.length > MAX_ATTENTION_ROWS && (
                <Link href="/dashboard/chasing" className="text-sm" style={{ color: "var(--dash-accent-strong)", fontWeight: 600 }}>
                  View all {attention.length} →
                </Link>
              )}
            </div>

            {visibleAttention.length === 0 ? (
              /* Calm, not celebratory. Nothing to do is a normal state, not an
                 achievement worth a fanfare. */
              <div className="mt-3">
                <p className="text-sm" style={{ color: "var(--dash-text)", fontWeight: 600 }}>
                  You&apos;re all caught up
                </p>
                <p className="text-sm mt-1" style={{ color: "var(--dash-text-muted)" }}>
                  No reminders need your attention right now.
                </p>
              </div>
            ) : (
              <ul className="dash-attn-list">
                {visibleAttention.map((item) => {
                  const tone = attentionTone(item.kind);
                  return (
                    <li key={item.invoiceId}>
                      <Link
                        href={item.href}
                        className="dash-attn-row"
                        style={{
                          textDecoration: "none",
                          // Drives the left rule and the tag text from one
                          // place, so a tone can never be half-applied.
                          ["--attn-tone" as string]: TONE_COLOUR[tone],
                        }}
                      >
                        <span className="dash-attn-tag">{KIND_LABEL[item.kind]}</span>

                        <span className="dash-attn-body">
                          {/* Customer first and largest — the row is about a
                              person you are owed money by, not about a state. */}
                          <span className="dash-attn-who">
                            {item.customerName}
                          </span>
                          <span className="dash-attn-meta">
                            {item.invoiceReference && <>{item.invoiceReference}{" · "}</>}
                            <span className="dash-attn-amount">{formatCurrency(item.amount)}</span>
                            {/* Live from due_date vs today, and omitted rather
                                than faked when the invoice is not yet due. */}
                            {item.urgencyLabel && <>{" · "}{item.urgencyLabel}</>}
                            {" · "}{attentionDescription(item)}
                          </span>
                        </span>

                        <span className="dash-attn-action">
                          {item.actionLabel}
                          <svg width="15" height="15" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── Coming up ────────────────────────────────────────────────────
              Rendered ONLY when there is a real future checkpoint. There is no
              empty state here by design: "No upcoming reminders" is a bordered
              box that costs vertical space to tell the owner nothing. Absence
              is the better answer. */}
          {visibleUpcoming.length > 0 && (
            <section className="dash-card dash-section" aria-labelledby="upcoming-h">
              <h2 id="upcoming-h" style={{ fontSize: "1.05rem", fontWeight: 650, color: "var(--dash-text)" }}>
                Coming up
              </h2>

              <ul className="dash-up-list">
                {visibleUpcoming.map((item) => (
                  <li key={`${item.invoiceId}-${item.schedule}`} className="dash-up-row">
                    <span className="dash-up-date">
                      <span className="dash-up-day">{shortDate(item.date)}</span>
                      <span className="dash-up-rel">{upcomingRelative(item.daysAway)}</span>
                    </span>
                    <span className="dash-up-body">
                      <span className="dash-up-who">
                        {item.customerName}
                        {item.invoiceReference && (
                          <span style={{ color: "var(--dash-text-soft)", fontWeight: 400 }}>
                            {" · "}{item.invoiceReference}
                          </span>
                        )}
                      </span>
                      <span className="dash-up-what">{item.description}</span>
                    </span>
                  </li>
                ))}
              </ul>

              {upcoming.length > MAX_UPCOMING_ROWS && (
                <p className="dash-up-more">
                  and {upcoming.length - MAX_UPCOMING_ROWS} more after that
                </p>
              )}

              {/* Said once, here, instead of on every row — and it is the
                  whole point of the section. SMS and email, equally, are
                  prepared for review. Nothing goes out on its own. */}
              <p className="dash-up-note">
                ServiceSignal prepares the SMS and email on the date shown and holds
                them for your review. Nothing is sent without your approval.
              </p>
            </section>
          )}

          {/* Full width now that Recent activity has gone. The donut is
              unchanged in size — the extra width goes to the breakdown, which
              becomes three columns at lg instead of three stacked rows. */}
          <InvoiceStatusChart />
        </>
      )}
    </div>
  );
}
