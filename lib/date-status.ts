/**
 * ── Invoice date status: the SINGLE SOURCE OF TRUTH ──────────────────────────
 *
 * Every overdue number and due-status label in the app — dashboard cards,
 * tables, the Reminders Awaiting Approval card, and the reminder emails —
 * must come from these functions.
 *
 * Rules enforced here:
 *  - "Today" is a Europe/London calendar date (no UTC drift).
 *  - Overdue days are always computed live from invoice.due_date vs today.
 *  - Never derived from reminder_logs.created_at, a stored schedule name,
 *    a reminder number, or any hardcoded value.
 */

/**
 * Returns "today" as a Date fixed to midnight UTC of the current
 * Europe/London calendar date. Using the London calendar date means the
 * day rolls over at UK midnight (GMT or BST), not at UTC midnight.
 */
export function getTodayLondonDate(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00Z`);
}

/**
 * Whole-day difference between today (Europe/London) and the due date.
 * Positive  = overdue by that many days.
 * Zero      = due today.
 * Negative  = due in that many days.
 */
export function getDaysFromDue(dueDateISO: string, now: Date = new Date()): number {
  const due = new Date(dueDateISO);
  due.setUTCHours(0, 0, 0, 0);

  const today = getTodayLondonDate(now);
  today.setUTCHours(0, 0, 0, 0);

  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((today.getTime() - due.getTime()) / msPerDay);
}

/**
 * Days an invoice is overdue (0 if due today or not yet due).
 * Never negative — for "due in N days" use getDaysFromDue directly.
 */
export function getDaysOverdue(dueDateISO: string, now: Date = new Date()): number {
  const diff = getDaysFromDue(dueDateISO, now);
  return diff > 0 ? diff : 0;
}

/** The live due-status of an invoice, computed from due_date vs today. */
export type InvoiceDueStatus =
  | { kind: "upcoming"; days: number }   // due in `days` days
  | { kind: "due_today" }
  | { kind: "overdue"; days: number };   // overdue by `days` days

export function getInvoiceDueStatus(dueDateISO: string, now: Date = new Date()): InvoiceDueStatus {
  const diff = getDaysFromDue(dueDateISO, now);
  if (diff > 0) return { kind: "overdue", days: diff };
  if (diff === 0) return { kind: "due_today" };
  return { kind: "upcoming", days: Math.abs(diff) };
}

/**
 * A short human label for the current due status, used on dashboard rows/cards.
 * e.g. "6 days overdue", "Due today", "Due in 3 days".
 */
export function getDueStatusLabel(dueDateISO: string, now: Date = new Date()): string {
  const status = getInvoiceDueStatus(dueDateISO, now);
  switch (status.kind) {
    case "overdue":
      return `${status.days} ${status.days === 1 ? "day" : "days"} overdue`;
    case "due_today":
      return "Due today";
    case "upcoming":
      return `Due in ${status.days} ${status.days === 1 ? "day" : "days"}`;
  }
}

/** Compact variant for tight table cells: "6d overdue", "Due today", "Due in 3d". */
export function getDueStatusLabelShort(dueDateISO: string, now: Date = new Date()): string {
  const status = getInvoiceDueStatus(dueDateISO, now);
  switch (status.kind) {
    case "overdue":   return `${status.days}d overdue`;
    case "due_today": return "Due today";
    case "upcoming":  return `Due in ${status.days}d`;
  }
}
