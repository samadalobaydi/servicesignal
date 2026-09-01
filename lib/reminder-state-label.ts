import type { Invoice } from "@/types";
import { formatDate } from "@/lib/invoices";
import { prepareEligibility } from "@/lib/reminder-schedule";

/**
 * Decides what Active Chasing's row should say about an invoice's reminder
 * state — and, via `pill`, whether that belongs on the row at all.
 *
 * ── WHY THIS IS A PLAIN .ts MODULE, NOT INLINE IN THE .tsx COMPONENT ──────
 *
 * This project's test runner (`node --test` over the source directly, no
 * Babel/SWC/esbuild step) can type-strip a `.ts` file but cannot transform
 * JSX — importing a `.tsx` file into a test would fail on the JSX syntax in
 * the rest of that file. Pulling this pure decision out of
 * ActiveChasingList.tsx is what makes it possible to test the pill/non-pill
 * split — the exact rule the removed "Reminder state" column used to
 * render permanently — without a browser.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────
 *
 * `pill: true` marks the states actionable or abnormal enough to stay
 * visible on the row even after the permanent column was removed
 * (Partially sent, Ready for review, Reminder limit reached). Everything
 * else is normal future scheduling, and now lives only in the expandable
 * history as "Next reminder scheduled" — see lib/invoice-activity.ts.
 */
export interface ReminderStateLabel {
  text: string;
  color: string;
  pill?: boolean;
  tone?: "amber" | "slate" | "red";
  detail?: string;
}

export function reminderStateLabel(
  invoice: Invoice,
  hasPending: boolean,
  allowanceSpent: boolean,
  /**
   * "Email sent · SMS failed", when this invoice's latest reminder got one
   * channel through and not the other. Null in every other case.
   */
  partialSummary: string | null = null
): ReminderStateLabel {
  // ── PARTIAL SEND OUTRANKS EVERYTHING BELOW ──────────────────────────────
  //
  // THE BUG THIS FIXES. reminder_logs.status is `sent` when the email was
  // accepted and the SMS was rejected — correctly, because something reached
  // the customer and a unit is spent. But this row read the parent alone and
  // rendered "1 of 3 reminders sent", so the owner believed their customer had
  // been texted when they had not.
  //
  // Placed FIRST because it is the only state here describing something that
  // went wrong on a real send. It sits above "Ready for review" for the same
  // reason Needs Attention ranks send_failed above everything.
  if (partialSummary) {
    return {
      text: "Partially sent",
      color: "var(--dash-red)",
      pill: true,
      tone: "red",
      // Plain words. Never a provider name or an error code.
      detail: partialSummary,
    };
  }
  // "Ready for review", not "ready to send": the owner has not seen the
  // message yet, and the row no longer offers a way to send without doing so.
  // Amber is correct here: a draft is genuinely waiting on the owner.
  if (hasPending) return { text: "Ready for review", color: "var(--dash-amber)", pill: true, tone: "amber" };
  const sentCount = invoice.reminders_sent?.length ?? 0;
  const total = invoice.reminder_schedules?.length ?? 0;
  if (total === 0) return { text: "No reminders set", color: "var(--dash-text-muted)" };
  const eligibility = prepareEligibility(invoice.reminder_schedules, invoice.reminders_sent ?? [], invoice.due_date);
  const canPrepare = !!eligibility.schedule;

  // ── ALLOWANCE SPENT ───────────────────────────────────────────────────
  //
  // Only replaces the states that would otherwise INVITE preparation. An
  // invoice that is not yet eligible, or has finished its schedule, already
  // says something more specific and keeps saying it.
  //
  // Deliberately checked AFTER hasPending: a reminder prepared before the cap
  // was reached is still reviewable and still sendable against the slot it
  // already holds, so it must keep reading "Ready for review".
  //
  // Light navy, matching the header's "Limit reached" — this is a capacity
  // fact about the account, not a fault with the invoice.
  if (allowanceSpent && canPrepare) {
    // SLATE, not amber. Reaching the founding-beta cap is a capacity fact
    // about the account, not a warning about this invoice — the same reading
    // as the Overview header's "Limit reached", and it reuses that badge's
    // tokens rather than introducing another blue.
    return { text: "Reminder limit reached", color: "var(--dash-navy)", pill: true, tone: "slate" };
  }

  if (sentCount === 0 && canPrepare) return { text: "Ready to chase", color: "var(--dash-accent-strong)" };
  if (canPrepare) return { text: `${sentCount} of ${total} reminders sent`, color: "var(--dash-accent-strong)" };
  // Not eligible yet is NOT the same as finished — before the stricter
  // eligibility rule this branch mislabelled a future invoice "All reminders
  // sent". Say when the first reminder becomes available instead.
  if (eligibility.blockedReason === "not_yet_due" && eligibility.eligibleFrom) {
    return { text: `First reminder from ${formatDate(eligibility.eligibleFrom)}`, color: "var(--dash-text-muted)" };
  }
  return { text: "All reminders sent", color: "var(--dash-green)" };
}
