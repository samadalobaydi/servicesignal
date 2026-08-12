import type { SupabaseClient } from "@supabase/supabase-js";
import { betaAllowance, allowanceExhausted } from "@/lib/beta-allowance";

/**
 * Is this account's founding-beta allowance spent?
 *
 * ── ONE DEFINITION, REUSED — NOT A SECOND ONE ─────────────────────────────
 *
 * The count comes from `reminder_allowance_slots`, the same enforcement ledger
 * `fetchAllowanceUsed` reads for the header indicator, and the verdict comes
 * from the same `betaAllowance` + `allowanceExhausted` pair the UI uses. This
 * module adds a server-side reader, not a new rule.
 *
 * ── THIS IS UX PROTECTION, NOT THE CAP ────────────────────────────────────
 *
 * The authoritative cap is `claim_reminder_allowance` at SEND time: an atomic,
 * race-safe slot claim inside the database (migration 011). Nothing here
 * replaces it, and nothing here is safe to rely on for enforcement — the count
 * is read outside any transaction and can be stale by the time it is used.
 *
 * Its only job is to stop ServiceSignal creating a draft it already knows it
 * cannot send.
 *
 * ── AND IT FAILS OPEN, DELIBERATELY ───────────────────────────────────────
 *
 * If the ledger cannot be read, `known` is false and the caller must NOT
 * block. A pre-flight that fails closed would refuse legitimate work on a
 * transient database error — and it would be refusing on behalf of a cap that
 * is still enforced properly further down. Failing open costs at most one
 * prepared draft that the send-time claim then declines; failing closed costs
 * the customer a reminder they were entitled to.
 */
export interface AllowancePreflight {
  /** False when the ledger could not be read. Callers must not block. */
  known: boolean;
  exhausted: boolean;
  used: number | null;
  allowance: number | null;
}

const UNKNOWN: AllowancePreflight = {
  known: false, exhausted: false, used: null, allowance: null,
};

export async function allowancePreflight(
  supabase: SupabaseClient
): Promise<AllowancePreflight> {
  const { count, error } = await supabase
    .from("reminder_allowance_slots")
    .select("reminder_log_id", { count: "exact", head: true });

  if (error || count === null || count === undefined) {
    // Logged, not thrown: the caller carries on and the send-time claim still
    // holds the line.
    console.warn("[allowance-preflight] ledger unreadable; not blocking", error?.message);
    return UNKNOWN;
  }

  const allowance = betaAllowance(count);
  return {
    known: true,
    exhausted: allowanceExhausted(allowance),
    used: allowance.used,
    allowance: allowance.allowance,
  };
}

/**
 * The refusal a user-triggered prepare returns when the allowance is spent.
 *
 * A product-capability answer, not an error: 409, a named state the browser can
 * branch on, and copy that says what is true. No upgrade promise — there is no
 * billing destination in this product.
 */
export const ALLOWANCE_EXHAUSTED_STATE = "allowance_exhausted";

export function allowanceExhaustedMessage(used: number | null, allowance: number | null): string {
  const fraction = used !== null && allowance !== null ? `${used} of ${allowance}` : "all";
  return `You've used ${fraction} founding beta reminders, so new reminders can't be prepared right now. Your invoices are unaffected.`;
}
