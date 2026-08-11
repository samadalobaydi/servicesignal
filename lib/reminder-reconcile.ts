import {
  isStaleSendingLease,
  classifyProviderEvent,
  statusForProviderEvent,
  SEND_LEASE_SECONDS,
  type ReminderSendStatus,
} from "./reminder-send-state";

/**
 * Reconciliation — the operational counterpart to `delivery_unknown`.
 *
 * Without this, `delivery_unknown` is a dead end and a reminder abandoned
 * mid-send stays `sending` forever.
 *
 * WHAT IT WILL NEVER DO
 *
 * It never sends. It never allocates an idempotency key. It never returns a row
 * to `pending`. All three would risk a second email to a real customer, which
 * is the exact failure this whole lifecycle exists to prevent. It only ever
 * ASKS the provider what happened, using an id we already stored, and records
 * the answer.
 *
 * THREE POPULATIONS
 *
 *   1. stale `sending`      a request claimed the row and never came back —
 *                           crash, timeout, deploy mid-flight. Moved to
 *                           `delivery_unknown`, never back to `pending`.
 *   2. `delivery_unknown`   with a provider id: ask, and settle it.
 *   3. `undelivered` whose last provider event is NON-terminal (queued,
 *                    scheduled, delivery_delayed): ask again, because a delayed
 *                    message may still be delivered. Parked in `undelivered`
 *                    meanwhile so it can never be quietly reported as sent and
 *                    can never be retried.
 *
 * A row with NO provider id cannot be resolved this way and stays
 * `delivery_unknown` for manual reconciliation. Replaying the send with the
 * same key would be the only alternative and is deliberately NOT done: Resend's
 * idempotency window is not documented in the installed SDK, so a replay after
 * expiry would deliver a duplicate.
 *
 * IDEMPOTENT AND OVERLAP-SAFE. Every write is a conditional UPDATE guarded on
 * the status the row was read at, so a second concurrent run finds nothing to
 * change rather than double-applying. Cron delivery is explicitly best-effort
 * and may fire the same schedule twice (Vercel documents this), so that
 * property is required, not a nicety.
 */

export interface ReconcileRow {
  id: string;
  status: ReminderSendStatus;
  sendStartedAt: string | null;
  providerMessageId: string | null;
  providerLastEvent: string | null;
}

export type ProviderLookupResult =
  | { ok: true; lastEvent: string | null; createdAt: string | null }
  | { ok: false; reason: string };

export interface ProviderLookup {
  get(providerMessageId: string): Promise<ProviderLookupResult>;
}

export interface ReconcileDb {
  listStaleSending(limit: number): Promise<ReconcileRow[]>;
  listUnknownWithProviderId(limit: number): Promise<ReconcileRow[]>;
  listUnresolvedUndelivered(limit: number): Promise<ReconcileRow[]>;
  /** Conditional: only if the row is STILL `sending`. */
  markUnknown(input: { id: string; note: string; at: string }): Promise<boolean>;
  /** Conditional: only if the row is still at `fromStatus`. */
  applyProviderEvent(input: {
    id: string;
    fromStatus: ReminderSendStatus;
    nextStatus: ReminderSendStatus;
    event: string;
    /** Set only when the event resolves to `sent`. */
    sentAt: string | null;
    note: string | null;
    at: string;
  }): Promise<boolean>;
  /** Records that we asked and learned nothing conclusive. Never changes status. */
  touchReconciled(input: {
    id: string;
    event: string | null;
    at: string;
  }): Promise<boolean>;
}

export interface ReconcileDeps {
  db: ReconcileDb;
  /** null when RESEND_API_KEY is absent. Phase 1 still runs; phases 2–3 do not. */
  provider: ProviderLookup | null;
  now?: () => Date;
  maxRowsPerRun?: number;
}

export interface ReconcileSummary {
  scanned: number;
  staleSendingFound: number;
  movedToUnknown: number;
  resolvedSent: number;
  resolvedUndelivered: number;
  stillUnknown: number;
  stillInFlight: number;
  errors: string[];
}

export const DEFAULT_MAX_ROWS_PER_RUN = 50;

export { SEND_LEASE_SECONDS };

export async function reconcileReminders(
  deps: ReconcileDeps
): Promise<ReconcileSummary> {
  const now = deps.now ?? (() => new Date());
  const limit = deps.maxRowsPerRun ?? DEFAULT_MAX_ROWS_PER_RUN;

  const summary: ReconcileSummary = {
    scanned: 0,
    staleSendingFound: 0,
    movedToUnknown: 0,
    resolvedSent: 0,
    resolvedUndelivered: 0,
    stillUnknown: 0,
    stillInFlight: 0,
    errors: [],
  };

  // ── Phase 1: abandoned `sending` → `delivery_unknown` ───────────────────
  let sendingRows: ReconcileRow[] = [];
  try {
    sendingRows = await deps.db.listStaleSending(limit);
  } catch (err) {
    summary.errors.push(`sending scan: ${errText(err)}`);
  }

  for (const row of sendingRows) {
    summary.scanned++;
    // Re-checked here as well as in the query: the lease is the rule, and it
    // belongs in code that a test can drive with a fixed clock.
    if (!isStaleSendingLease(row.sendStartedAt, now())) continue;

    summary.staleSendingFound++;
    try {
      const changed = await deps.db.markUnknown({
        id: row.id,
        note: "Send attempt did not complete; outcome unconfirmed.",
        at: now().toISOString(),
      });
      if (changed) summary.movedToUnknown++;
    } catch (err) {
      summary.errors.push(`stale ${row.id}: ${errText(err)}`);
    }
  }

  if (!deps.provider) {
    summary.errors.push("Provider lookup unavailable; unresolved rows left as-is.");
    return summary;
  }

  // ── Phase 2: settle `delivery_unknown` from the provider ────────────────
  await settle(deps, summary, "delivery_unknown", () =>
    deps.db.listUnknownWithProviderId(limit)
  );

  // ── Phase 3: re-ask about accepted-but-unresolved rows ──────────────────
  // A `delivery_delayed` message may still be delivered. It sits in
  // `undelivered` — truthful, and not claimable — until the provider gives a
  // terminal answer.
  await settle(deps, summary, "undelivered", () =>
    deps.db.listUnresolvedUndelivered(limit)
  );

  return summary;
}

async function settle(
  deps: ReconcileDeps,
  summary: ReconcileSummary,
  fromStatus: ReminderSendStatus,
  list: () => Promise<ReconcileRow[]>
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const provider = deps.provider!;

  let rows: ReconcileRow[] = [];
  try {
    rows = await list();
  } catch (err) {
    summary.errors.push(`${fromStatus} scan: ${errText(err)}`);
    return;
  }

  for (const row of rows) {
    summary.scanned++;

    // Defensive: the queries filter on this, but a row without a provider id
    // can only be settled by a human. Never by replaying a send.
    if (!row.providerMessageId) {
      summary.stillUnknown++;
      continue;
    }

    let lookup: ProviderLookupResult;
    try {
      lookup = await provider.get(row.providerMessageId);
    } catch (err) {
      // Never let one row stop the run.
      summary.errors.push(`lookup ${row.id}: ${errText(err)}`);
      summary.stillUnknown++;
      continue;
    }

    if (!lookup.ok) {
      // Could not ask. Leave it uncertain — never downgrade to a guess.
      summary.stillUnknown++;
      continue;
    }

    const event = lookup.lastEvent;
    const eventClass = classifyProviderEvent(event);
    const nextStatus = statusForProviderEvent(event);

    if (!nextStatus) {
      // `in_flight` or `unrecognised`. The provider DID return a record, which
      // itself proves acceptance — so a `delivery_unknown` row that gets here
      // is promoted out of "we don't know if we submitted" and into
      // "we submitted, delivery not yet resolved".
      if (fromStatus === "delivery_unknown" && eventClass === "in_flight") {
        try {
          const changed = await deps.db.applyProviderEvent({
            id: row.id,
            fromStatus,
            nextStatus: "undelivered",
            event: event as string,
            sentAt: null,
            note: `Provider accepted this message; delivery not yet resolved (${event}).`,
            at: now().toISOString(),
          });
          if (changed) summary.stillInFlight++;
        } catch (err) {
          summary.errors.push(`park ${row.id}: ${errText(err)}`);
        }
        continue;
      }

      try {
        await deps.db.touchReconciled({ id: row.id, event, at: now().toISOString() });
      } catch (err) {
        summary.errors.push(`touch ${row.id}: ${errText(err)}`);
      }
      if (eventClass === "in_flight") summary.stillInFlight++;
      else summary.stillUnknown++;
      continue;
    }

    try {
      const changed = await deps.db.applyProviderEvent({
        id: row.id,
        fromStatus,
        nextStatus,
        event: event as string,
        sentAt: nextStatus === "sent" ? lookup.createdAt ?? now().toISOString() : null,
        note:
          nextStatus === "sent"
            ? null
            : `Provider accepted this reminder but delivery was unsuccessful (${event}).`,
        at: now().toISOString(),
      });

      if (!changed) continue; // another run got there first — correct, not an error
      if (nextStatus === "sent") summary.resolvedSent++;
      else summary.resolvedUndelivered++;
    } catch (err) {
      summary.errors.push(`resolve ${row.id}: ${errText(err)}`);
    }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}
