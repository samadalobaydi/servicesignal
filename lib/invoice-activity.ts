import type { Invoice, ReminderLog } from "@/types";
import { formatCurrency, formatDate } from "@/lib/invoices";
import { prepareEligibility } from "@/lib/reminder-schedule";
import {
  partiallySentFromStatuses,
  partialSendSummary,
  type ChannelStatuses,
} from "@/lib/reminder-aggregate";

/**
 * The pure, testable half of the per-invoice activity timeline.
 *
 * ── WHY THIS WAS PULLED OUT OF THE COMPONENT ──────────────────────────────
 *
 * InvoiceActivityLog.tsx previously built its entries inline, hardcoding
 * "Email reminder sent" regardless of whether SMS also sent — the exact
 * defect a real Stage B run caught: a reminder that dispatched BOTH channels
 * was described as if only one had. That is a logic bug, not a rendering
 * bug, and logic bugs belong in something a test can call directly. Every
 * other place in this codebase that decides "what actually happened per
 * channel" (Active Chasing, the review page) is already a pure function over
 * ChannelStatuses for the same reason.
 */

export interface ActivityEntry {
  key: string;
  when: string;
  label: string;
  color: string;
  detail?: string;
  /**
   * True when `when` is a plain calendar date (YYYY-MM-DD) with no real
   * time-of-day meaning — as opposed to every other entry's `when`, which is
   * a genuine timestamp (created_at/sent_at). Rendering both the same way
   * with a time-of-day formatter produces a value like "28 Aug 2026 at
   * 01:00" for a date that was never anything but midnight UTC — an
   * artefact of formatting, not a real scheduled time. See the
   * "Next reminder scheduled" entry below, the only one that sets this.
   */
  dateOnly?: boolean;
}

/**
 * The raw shape DashboardProvider actually carries — plain strings straight
 * off a Supabase row. Narrowed to the domain type ChannelStatuses only at
 * the boundary where a value is genuinely compared against a known
 * ReminderSendStatus, via asChannelStatuses() below.
 */
type RawChannelStatuses = Partial<Record<"email" | "sms", string>>;

function asChannelStatuses(statuses: RawChannelStatuses | undefined): ChannelStatuses {
  return (statuses ?? {}) as ChannelStatuses;
}

/** True when this reminder's channel rows show SMS was ever part of the pair. */
function hasSmsChannel(statuses: RawChannelStatuses | undefined): boolean {
  return Boolean(statuses?.sms);
}

/** Label for a just-prepared reminder — both channels, or the legacy email-only shape. */
function preparedLabel(statuses: RawChannelStatuses | undefined): string {
  return hasSmsChannel(statuses) ? "SMS and email reminder prepared" : "Email reminder prepared";
}

/**
 * Label (and colour) for a reminder whose parent status is `sent`.
 *
 * `sent` at the parent covers three genuinely different customer outcomes —
 * both channels through, one channel through, or (legacy) only email ever
 * existed — and conflating them is exactly the bug this file exists to fix.
 * partiallySentFromStatuses/partialSendSummary are the SAME functions Active
 * Chasing's "Partially sent" pill and the review page's partial banner use,
 * so this can never describe a partial send differently than they do.
 */
function sentLabel(statuses: RawChannelStatuses | undefined): { label: string; color: string } {
  const normalised = asChannelStatuses(statuses);
  if (partiallySentFromStatuses(normalised)) {
    return { label: `${partialSendSummary(normalised)}`, color: "var(--dash-red)" };
  }
  if (statuses?.email === "sent" && statuses?.sms === "sent") {
    return { label: "SMS and email reminder sent", color: "var(--dash-green)" };
  }
  if (statuses?.email === "sent" && !statuses?.sms) {
    // Legacy reminder, prepared before migration 010 — no SMS row ever existed.
    return { label: "Email reminder sent", color: "var(--dash-green)" };
  }
  // Defensive fallback — reached only if a `sent` reminder's channel rows are
  // missing or unreadable. Truthful without a channel to name.
  return { label: "Reminder sent", color: "var(--dash-green)" };
}

/** Label for a reminder whose parent status is `failed` — every channel was rejected. */
function failedLabel(statuses: RawChannelStatuses | undefined): string {
  return hasSmsChannel(statuses) ? "SMS and email reminder failed to send" : "Email reminder failed to send";
}

export interface BuildActivityParams {
  invoice: Invoice | undefined;
  /** This invoice's pending reminders only — caller filters by invoice_id. */
  pendingForInvoice: ReminderLog[];
  /** This invoice's history reminders only — caller filters by invoice_id. */
  historyForInvoice: ReminderLog[];
  /**
   * Keyed by reminder id — the same map every other channel-aware surface
   * reads (DashboardProvider.channelStatuses). Typed as plain strings there
   * because it comes straight off a Supabase row; narrowed to ChannelStatuses
   * at the point of use below, where the values are genuinely one of the
   * known ReminderSendStatus strings.
   */
  channelStatuses: Record<string, Partial<Record<"email" | "sms", string>>>;
  now?: Date;
}

/**
 * Builds the full timeline: past activity, newest first, plus (when nothing
 * is currently pending and a future checkpoint remains) one line naming when
 * the next reminder becomes available.
 *
 * The "next reminder" entry deliberately carries a FUTURE `when` — sorting
 * newest-first therefore places it above yesterday's history, which is the
 * right reading order: what's coming, then what already happened. It is
 * omitted whenever a reminder is already pending (that is the row's own
 * "Ready for review" state, not something the collapsed history needs to
 * repeat) and whenever no future checkpoint remains (nothing selected, or
 * every selected schedule already sent).
 */
export function buildInvoiceActivityEntries({
  invoice,
  pendingForInvoice,
  historyForInvoice,
  channelStatuses,
  now = new Date(),
}: BuildActivityParams): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  if (invoice) {
    entries.push({
      key: "added",
      when: invoice.created_at,
      label: "Invoice added",
      color: "var(--dash-accent-strong)",
      detail: `${formatCurrency(invoice.amount)} invoice due ${formatDate(invoice.due_date)}`,
    });
    if (invoice.status === "paid" && invoice.paid_at) {
      entries.push({
        key: "paid",
        when: invoice.paid_at,
        label: "Invoice marked paid — future reminders stopped",
        color: "var(--dash-green)",
      });
    }
  }

  for (const r of pendingForInvoice) {
    entries.push({
      key: `prep-${r.id}`,
      when: r.created_at,
      label: preparedLabel(channelStatuses[r.id]),
      color: "var(--dash-accent-strong)",
    });
  }

  for (const r of historyForInvoice) {
    const statuses = channelStatuses[r.id];
    if (r.status === "sent") {
      const { label, color } = sentLabel(statuses);
      entries.push({ key: `sent-${r.id}`, when: r.sent_at ?? r.created_at, label, color });
    } else if (r.status === "dismissed") {
      entries.push({
        key: `dis-${r.id}`,
        when: r.created_at,
        label: "Reminder dismissed",
        color: "var(--dash-text-soft)",
      });
    } else if (r.status === "failed") {
      entries.push({
        key: `fail-${r.id}`,
        when: r.created_at,
        label: failedLabel(statuses),
        color: "var(--dash-red)",
      });
    }
  }

  // ── Next reminder, only when nothing is pending and one remains ─────────
  if (invoice && pendingForInvoice.length === 0) {
    const eligibility = prepareEligibility(
      invoice.reminder_schedules ?? [],
      invoice.reminders_sent ?? [],
      invoice.due_date,
      now
    );
    if (eligibility.blockedReason === "not_yet_due" && eligibility.eligibleFrom) {
      entries.push({
        key: "next",
        when: eligibility.eligibleFrom,
        label: `Next reminder scheduled — ${formatDate(eligibility.eligibleFrom)}`,
        color: "var(--dash-text-muted)",
        // eligibility.eligibleFrom is a bare YYYY-MM-DD (see
        // prepareEligibility in lib/reminder-schedule.ts) — a checkpoint
        // date, never a send time. Nothing in this Manual-beta product
        // dispatches anything automatically at any time of day; the date is
        // the whole fact.
        dateOnly: true,
      });
    }
  }

  return entries.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
}
