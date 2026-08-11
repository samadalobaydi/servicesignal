/**
 * Resolving what the dashboard should open on after onboarding.
 *
 * Onboarding finishes by sending the user to
 * /dashboard?invoice=<uuid>&reminder=<uuid>. Naming the records explicitly is
 * the point: an earlier proposal was to infer the target by picking the oldest
 * unpaid invoice, which is wrong the moment an account has more than one — the
 * user would be shown a different invoice from the one they just typed in and
 * given no way to tell.
 *
 * The URL can still be stale (bookmarked, shared, or the record deleted since),
 * so resolution degrades in three tiers rather than failing:
 *
 *   1. exact     — both ids present and both records found. Open on them.
 *   2. invoice   — the invoice resolves but its reminder does not, usually
 *                  because preparation failed or the reminder was dismissed.
 *                  Open on the invoice and say the reminder isn't there.
 *   3. none      — nothing resolves. Show the ordinary dashboard with no
 *                  banner at all. A "we couldn't find it" message about a
 *                  link the user probably didn't click would be noise.
 *
 * Pure functions over data already loaded by the dashboard — no fetching, so
 * a stale link costs nothing.
 */

export type HandoffTier = "exact" | "invoice" | "none";

export interface HandoffTarget {
  tier: HandoffTier;
  invoiceId: string | null;
  reminderId: string | null;
}

const NONE: HandoffTarget = { tier: "none", invoiceId: null, reminderId: null };

/**
 * UUID shape check before anything is compared.
 *
 * Not security — RLS is what stops one account reading another's rows — but it
 * keeps an arbitrary query string from being echoed into the UI, and it means
 * a malformed link resolves to "none" rather than to a confusing partial.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function resolveHandoff(
  rawInvoiceId: string | null | undefined,
  rawReminderId: string | null | undefined,
  knownInvoiceIds: readonly string[],
  knownReminderIds: readonly string[]
): HandoffTarget {
  if (!isUuid(rawInvoiceId)) return NONE;
  if (!knownInvoiceIds.includes(rawInvoiceId)) return NONE;

  if (isUuid(rawReminderId) && knownReminderIds.includes(rawReminderId)) {
    return { tier: "exact", invoiceId: rawInvoiceId, reminderId: rawReminderId };
  }

  return { tier: "invoice", invoiceId: rawInvoiceId, reminderId: null };
}

/**
 * The banner wording for a resolved handoff.
 *
 * Tier 2 deliberately does not apologise or imply breakage: no reminder yet is
 * an ordinary state, and the invoice was still saved.
 */
export function handoffMessage(
  tier: HandoffTier,
  customerName: string
): { title: string; detail: string } | null {
  if (tier === "exact") {
    return {
      title: "Your first reminder is ready to review",
      detail: `We've prepared an email for ${customerName}. Nothing sends until you approve it.`,
    };
  }
  if (tier === "invoice") {
    return {
      title: `Invoice for ${customerName} saved`,
      detail:
        "No reminder is waiting yet — one will be prepared when the first reminder day is reached.",
    };
  }
  return null;
}
