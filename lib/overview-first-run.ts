/**
 * Is the Overview in its first-run state?
 *
 * ONE CONDITION: the account holds no invoices. Nothing else.
 *
 * ── THE SIGNALS THIS DELIBERATELY CANNOT SEE ─────────────────────────────
 *
 * The function takes invoices and nothing else, so it is structurally unable
 * to consult any of the plausible-but-wrong proxies:
 *
 *   total unpaid = £0        a real account can invoice £0, or have every
 *                            invoice paid. It has done the thing this state
 *                            exists to teach.
 *   overdue = 0              an account chasing nothing today is not new.
 *   no reminder logs         an owner can add invoices and never prepare a
 *                            reminder. They still know what an invoice is.
 *   allowance used = 0       likewise, and it is a billing fact, not a
 *                            lifecycle one.
 *   profile age              a week-old account with invoices is populated; a
 *                            year-old account that deleted them is not new,
 *                            but has nothing to show.
 *
 * Every one of those would show an activation screen to somebody who has
 * already activated — the most patronising thing a dashboard can do.
 *
 * ── AND WHY IT IS NOT CALLED "isNewAccount" ──────────────────────────────
 *
 * Zero invoices does not mean new. An established customer can delete or
 * archive everything and land back here. That is why the copy this drives says
 * "Add an invoice to get started" rather than "Welcome!" — the state has to
 * read correctly for someone who has been using ServiceSignal for a year.
 */
export function isFirstRunOverview(invoices: readonly unknown[]): boolean {
  return invoices.length === 0;
}
