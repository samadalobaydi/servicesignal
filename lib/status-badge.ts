import type { Invoice } from "@/types";

/**
 * The Active Chasing status badge decision — pulled out of the component
 * (same reason as reminder-state-label.ts and invoice-activity.ts: this
 * project's `node --test` runner cannot import a .tsx file, so a decision
 * that stays inline is only checkable by grep).
 *
 * `null` for "overdue" is deliberate, not a missing case: the Due column
 * already states the date and "N days overdue" in red, so a same-row
 * "Overdue" badge repeated the identical fact a second time for the single
 * most common state on this page. Unpaid and Paid are not restated anywhere
 * else on the row, so they keep their badge.
 */
export interface StatusBadgeInfo {
  label: string;
  bg: string;
  color: string;
}

export function statusBadgeFor(status: Invoice["status"]): StatusBadgeInfo | null {
  if (status === "overdue") return null;
  const map: Record<Exclude<Invoice["status"], "overdue">, StatusBadgeInfo> = {
    unpaid: { label: "Unpaid", bg: "var(--dash-accent-soft)", color: "var(--dash-accent-strong)" },
    paid: { label: "Paid", bg: "var(--dash-green-soft)", color: "var(--dash-green)" },
  };
  return map[status];
}
