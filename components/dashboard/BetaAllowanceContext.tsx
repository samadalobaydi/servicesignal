"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { fetchAllowanceUsed } from "@/lib/reminders";
import { betaAllowance, type BetaAllowance } from "@/lib/beta-allowance";

/**
 * The Founding Beta allowance, fetched ONCE for the whole shell.
 *
 * ── WHY A CONTEXT RATHER THAN A HOOK PER CHIP ────────────────────────────
 *
 * The indicator now renders in two places — the desktop header and the mobile
 * bar — because the desktop header is `hidden md:flex` and would otherwise
 * take the allowance off the page entirely on a phone. Two mounted components
 * calling the same hook would issue two COUNT queries on every dashboard load
 * for one number that cannot differ between them.
 *
 * One provider, one query, one model. The two chips are presentation.
 *
 * ── AND WHY THE MODEL LIVES HERE, NOT IN THE CHIP ────────────────────────
 *
 * `used` comes from lib/reminders.ts (the enforcement ledger) and is turned
 * into a BetaAllowance by lib/beta-allowance.ts (the domain rules: clamping,
 * remaining, exhaustion). Neither is reimplemented. A second component that
 * did its own arithmetic would be a second definition of "used" — exactly what
 * the enforcement work spent three passes eliminating.
 */
const BetaAllowanceContext = createContext<BetaAllowance | null>(null);

export function BetaAllowanceProvider({ children }: { children: ReactNode }) {
  const [used, setUsed] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllowanceUsed(getSupabaseBrowser()).then((n) => {
      if (!cancelled && n !== null) setUsed(n);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <BetaAllowanceContext.Provider value={used === null ? null : betaAllowance(used)}>
      {children}
    </BetaAllowanceContext.Provider>
  );
}

/**
 * Null until a verified count exists — including while the query is in flight
 * or has failed. Consumers render nothing rather than a plausible wrong
 * number: "10 remaining" shown because a query failed would tell someone at
 * their limit that they can still send.
 */
export function useBetaAllowance(): BetaAllowance | null {
  return useContext(BetaAllowanceContext);
}
