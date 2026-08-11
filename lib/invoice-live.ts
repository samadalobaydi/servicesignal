/**
 * "Live invoice" = not archived.
 *
 * ── WHY THIS IS FILTERED AT THE DATA BOUNDARY, NOT PER FEATURE ───────────
 *
 * Archiving has to remove an invoice from Active Chasing, the KPI totals,
 * Needs your attention, Coming up, Needs Action, the buckets, the invoice
 * counts, and the reminder paths. Adding `.is("archived_at", null)` to each of
 * those is nine places to be right and one place to forget, and the one that
 * gets forgotten is a silent bug: an archived invoice quietly still counts as
 * live debt, or still gets a reminder prepared.
 *
 * So the browser simply never receives archived invoices. fetchInvoices()
 * filters them, and every dashboard surface derives from that one array —
 * which means all of the above are correct by construction rather than by
 * nine separate memories.
 *
 * The server paths that do NOT go through fetchInvoices — the daily cron and
 * the manual prepare route — filter explicitly, and migration 012 adds a
 * BEFORE INSERT trigger so the cron's read-then-write race cannot slip a
 * reminder onto an invoice archived a moment ago.
 */
export function isLiveInvoice(invoice: { archived_at?: string | null }): boolean {
  return !invoice.archived_at;
}

/**
 * The zero-live-invoice semantic.
 *
 * An account whose only invoices are archived has zero LIVE invoices, and the
 * Overview first-run state is the correct thing to show it: there is nothing
 * to report and the next useful action is adding an invoice. The copy was
 * written to survive exactly this — "Add an invoice to get started", never
 * "Welcome" — so it stays true for someone who has been here a year and
 * archived everything.
 *
 * Archived rows are not deleted and not forgotten; they are simply not
 * operational. Calling such an account "new" would be the mistake, and the
 * copy already refuses to.
 */
export const ZERO_LIVE_INVOICES_IS_FIRST_RUN = true;
