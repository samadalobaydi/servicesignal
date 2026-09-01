"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { fetchAllowanceUsed } from "@/lib/reminders";
import { betaAllowance, type BetaAllowance } from "@/lib/beta-allowance";
import { createMountGuard } from "@/lib/mount-guard";

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

/**
 * A stable refetch function, separate from the value context above.
 *
 * WHY A SECOND CONTEXT RATHER THAN EXTENDING THE FIRST
 *
 * useBetaAllowance()'s return type is `BetaAllowance | null`, read directly
 * by every consumer (BetaAllowanceIndicator, ActiveChasingList) as the
 * allowance itself. Changing that shape to `{ allowance, refetch }` would
 * touch every call site for a capability most of them never need. A second,
 * independent context keeps the existing contract untouched and gives only
 * the one caller that needs it (the review page, right after a send) a way
 * to ask for a fresh read.
 *
 * Defaults to a no-op so a consumer rendered outside BetaAllowanceProvider
 * (there is none in practice, but defensively) never crashes calling it.
 */
const RefetchContext = createContext<() => Promise<void>>(async () => {});

export function BetaAllowanceProvider({ children }: { children: ReactNode }) {
  const [used, setUsed] = useState<number | null>(null);
  // Guards BOTH the mount-time load and every later refetch against setting
  // state after this provider has genuinely unmounted — see lib/mount-guard.ts
  // for why this is a re-armed guard object rather than a plain `useRef(false)`
  // that is only ever set to true: a ref set once by Strict Mode's first
  // (discarded) cleanup and never reset would leave every later load()
  // silently unable to apply its result, forever. This is the exact bug that
  // made the allowance header disappear.
  const guard = useRef(createMountGuard());

  // THE ONE QUERY CALL SITE. The mount-time load and every later refetch
  // (e.g. right after approving a send) both go through this single async
  // function, so fetchAllowanceUsed is still called from exactly one place
  // in the whole UI.
  const load = async () => {
    const n = await fetchAllowanceUsed(getSupabaseBrowser());
    if (guard.current.isMounted() && n !== null) setUsed(n);
  };

  useEffect(() => {
    guard.current.onMount();
    load();
    return () => guard.current.onCleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <BetaAllowanceContext.Provider value={used === null ? null : betaAllowance(used)}>
      <RefetchContext.Provider value={load}>
        {children}
      </RefetchContext.Provider>
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

/**
 * Re-runs the allowance count query and updates every consumer of
 * useBetaAllowance(). Call this after any action that could change usage —
 * today, that is exactly one place: approving a send.
 */
export function useRefetchBetaAllowance(): () => Promise<void> {
  return useContext(RefetchContext);
}
