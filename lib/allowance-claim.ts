import { FOUNDING_BETA_ALLOWANCE } from "./beta-allowance";

/**
 * The allowance CLAIM — the enforcement half of the Founding Beta cap.
 *
 * lib/beta-allowance.ts owns the domain semantics that everything shares: the
 * limit, what counts as consumed, clamping, remaining, exhaustion, and the
 * words. This module owns the one thing that cannot live in a UI helper — the
 * concurrency-safe reservation — behind a port, so the approval service can be
 * driven without a database.
 *
 * The port is deliberately narrow. `claim` and `release` are the only two
 * operations, and neither takes a count: the caller never gets to decide
 * whether there is room, because a caller that decides is a caller that races.
 * Postgres decides. See supabase/sql/011_reminder_allowance.sql.
 */

export type AllowanceOutcome =
  /** This request reserved a unit. It is responsible for releasing it on a definite failure. */
  | "claimed"
  /** This reminder already held a unit — a retry, a duplicate request, a re-submit. Free. */
  | "already_held"
  /** No unit was available. Nothing may be sent. */
  | "exhausted";

export interface AllowanceClaim {
  outcome: AllowanceOutcome;
  used: number;
  allowance: number;
}

/**
 * Failure to REACH the allowance store, as distinct from being out of
 * allowance. These must never be conflated: telling a customer they have used
 * all ten reminders because a database call failed is a lie that costs them
 * their remaining credits.
 */
export interface AllowanceUnavailable {
  error: string;
}

export type AllowanceResult = AllowanceClaim | AllowanceUnavailable;

export function isAllowanceUnavailable(r: AllowanceResult): r is AllowanceUnavailable {
  return (r as AllowanceUnavailable).error !== undefined;
}

export interface AllowanceStore {
  /**
   * Atomically reserve one unit for this logical reminder.
   *
   * MUST be idempotent per reminderLogId — a second call for the same reminder
   * returns `already_held` and reserves nothing further.
   */
  claim(reminderLogId: string): Promise<AllowanceResult>;
  /** Return a reserved unit. Only ever called after a definite pre-acceptance failure. */
  release(reminderLogId: string): Promise<void>;
}

/** The machine-readable state the API returns when the cap is reached. */
export const ALLOWANCE_EXHAUSTED_STATE = "allowance_exhausted";

/**
 * Returned when the allowance store cannot be reached — including when
 * migration 011 has not yet been applied and the function does not exist.
 *
 * The send path FAILS CLOSED on this. An allowance cap that silently stops
 * applying when a database call fails is not a cap; it is a cap-shaped
 * comment. A refusal is recoverable in a way an over-sent reminder is not.
 */
export const ALLOWANCE_UNAVAILABLE_STATE = "allowance_unavailable";

/**
 * 402 Payment Required, deliberately.
 *
 * Not 403: nothing about this is a permissions problem, and the owner has done
 * nothing wrong. Not 429: they are not sending too fast. 402 is the one status
 * that means "this is a billing state", which is exactly what it is, and it
 * lets a client distinguish the cap from every other refusal without parsing
 * prose.
 */
export const ALLOWANCE_EXHAUSTED_STATUS = 402;
export const ALLOWANCE_UNAVAILABLE_STATUS = 503;

export interface AllowanceRefusal {
  status: number;
  body: Record<string, unknown> & { success: boolean; message: string };
}

/**
 * The customer-facing refusal. Says what happened and what would change it,
 * and nothing about tables, functions or constraints.
 *
 * No CTA URL is included. ServiceSignal has no billing destination yet, and a
 * server handing out a link to a page that does not exist is worse than a
 * server that says plainly what is needed.
 */
export function allowanceExhaustedRefusal(
  used: number,
  allowance: number = FOUNDING_BETA_ALLOWANCE
): AllowanceRefusal {
  return {
    status: ALLOWANCE_EXHAUSTED_STATUS,
    body: {
      success: false,
      state: ALLOWANCE_EXHAUSTED_STATE,
      used,
      allowance,
      message:
        `You've used all ${allowance} Founding Beta reminders. ` +
        `Upgrade to continue sending SMS and email reminders.`,
    },
  };
}

export function allowanceUnavailableRefusal(): AllowanceRefusal {
  return {
    status: ALLOWANCE_UNAVAILABLE_STATUS,
    body: {
      success: false,
      state: ALLOWANCE_UNAVAILABLE_STATE,
      message:
        "We couldn't check your reminder allowance, so nothing was sent. " +
        "Please try again in a moment.",
    },
  };
}
