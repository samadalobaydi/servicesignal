import { channelStatusForTwilioDelivery, classifyTwilioDelivery } from "./twilio-send-state";

/**
 * SMS delivery reconciliation — pure decision logic.
 *
 * ── WHAT THIS RESOLVES, AND WHAT IT MUST NEVER DO ────────────────────────
 *
 * A channel row reaches `sent` when Twilio ACCEPTED the message. That is not
 * delivery: carrier rejection arrives minutes later and is invisible at send
 * time. This decides what a later lookup means for that row.
 *
 * The one rule that matters: an outcome is only written when it is CERTAIN.
 * A message still in flight, a status we do not recognise, or a lookup that
 * failed all leave the row exactly where it is, to be re-asked next run.
 * Turning any of those into a claimable `failed` would let a reconciliation
 * pass trigger a second text to a customer who already has one.
 */

export type SmsReconcileAction =
  /** Certain: the carrier delivered it. */
  | { kind: "resolve"; status: "sent"; event: string }
  /**
   * Certain: Twilio accepted it and delivery did not succeed. Written as
   * `undelivered`, which is NOT claimable — another attempt at the same number
   * would be a second submission, not a retry.
   */
  | { kind: "resolve"; status: "undelivered"; event: string; note: string }
  /** Not terminal. Left alone; the next run re-asks. */
  | { kind: "in_flight"; event: string }
  /** We could not ask, or did not understand the answer. Left alone. */
  | { kind: "ambiguous"; note: string };

export interface SmsLookup {
  ok: boolean;
  found: boolean;
  status: string | null;
  errorCode: number | null;
  message: string;
}

export function decideSmsReconcile(lookup: SmsLookup): SmsReconcileAction {
  // The lookup itself failed — network, auth, Twilio 5xx. This says nothing
  // about the message, so nothing is written.
  if (!lookup.ok) {
    return { kind: "ambiguous", note: `Twilio lookup failed: ${lookup.message}` };
  }

  // Twilio has no such message. Deliberately NOT read as a failure: a SID we
  // hold and Twilio does not is a bookkeeping problem, and writing
  // `undelivered` from it would be inventing a delivery outcome.
  if (!lookup.found) {
    return { kind: "ambiguous", note: "Twilio has no record of this message SID" };
  }

  const resolved = channelStatusForTwilioDelivery(lookup.status);

  if (resolved === "sent") {
    return { kind: "resolve", status: "sent", event: lookup.status! };
  }

  if (resolved === "undelivered") {
    return {
      kind: "resolve",
      status: "undelivered",
      event: lookup.status!,
      // Twilio's code is kept for the LOG only. Nothing here reaches a
      // customer-facing string.
      note: lookup.errorCode
        ? `Carrier reported ${lookup.status} (Twilio ${lookup.errorCode})`
        : `Carrier reported ${lookup.status}`,
    };
  }

  if (classifyTwilioDelivery(lookup.status) === "in_flight") {
    return { kind: "in_flight", event: lookup.status! };
  }

  return { kind: "ambiguous", note: `Unrecognised Twilio status: ${lookup.status ?? "none"}` };
}

/**
 * Channel rows worth asking about: accepted, with a SID, not yet terminal.
 *
 * THIS IS A READ FILTER AND NOTHING ELSE. It answers "which rows should this run
 * look at", and it must never be used as the guard on a WRITE — see
 * `applyIfUnchanged` below for why a broad allowed-status set is not stale-write
 * protection.
 */
export const SMS_RECONCILE_STATUSES: readonly string[] = ["sent"];

// ── The reconciliation pass ─────────────────────────────────────────────────

/**
 * The exact row state that was read BEFORE the Twilio lookup.
 *
 * ── WHY EVERY ONE OF THESE FIELDS IS IN THE GUARD ────────────────────────
 *
 * A reconciliation result describes one provider attempt at one moment. Between
 * reading the row and writing the answer there is a network round-trip to
 * Twilio, and overlapping cron runs are the normal case, not the exotic one. So
 * the write must apply ONLY if the row still represents the same thing it did
 * when it was read.
 *
 *   status               a retry or another reconciliation moved the lifecycle
 *   providerMessageId    a different attempt — the answer is about a dead SID
 *   sendAttemptCount     the stronger attempt identity: it changes on every
 *                        claim even when the SID is reused or still null
 *   providerLastEvent    another run already recorded a different provider event
 *   lastReconciledAt     another run already reconciled this row at all
 *
 * The last two are what make this correct rather than merely careful. Consider
 * two overlapping runs on a row already at `sent`: run B learns `delivered` and
 * writes it; run A, holding an older snapshot, learns `sending`. Status,
 * SID and attempt count are all UNCHANGED by run B's write — a guard built from
 * those three alone still matches, and run A regresses a terminal event back to
 * an in-flight one. Comparing the event and the reconciliation timestamp closes
 * that, because every reconciliation write moves at least one of them.
 *
 * If two runs somehow agree on every guarded column, they are writing the same
 * thing, and the write is idempotent.
 */
export interface SmsChannelSnapshot {
  id: string;
  status: string;
  providerMessageId: string;
  sendAttemptCount: number;
  providerLastEvent: string | null;
  lastReconciledAt: string | null;
}

/**
 * The three outcomes of a guarded write, kept distinct on purpose.
 *
 * A conditional UPDATE that matches ZERO rows is not an error — PostgREST
 * reports `error === null` for it, which is exactly how a stale write came to be
 * counted as a delivery. `stale` and `error` therefore have to be different
 * answers, and neither of them may be counted as delivered or undelivered.
 */
export type SmsWriteResult =
  /** Exactly one row matched the snapshot and was updated. */
  | { kind: "applied" }
  /** Zero rows matched: another process changed the row first. Not an error. */
  | { kind: "stale" }
  /** The database refused the statement. Nothing is known about the row. */
  | { kind: "error"; message: string };

export interface SmsReconcileDb {
  /** Rows worth asking Twilio about, oldest-reconciled first. */
  listReconcilable(limit: number): Promise<SmsChannelSnapshot[]>;
  /**
   * Compare-and-set against the snapshot. Implementations MUST count the rows
   * actually matched and return `stale` for zero — never assume success from the
   * absence of an error.
   */
  applyIfUnchanged(args: {
    snapshot: SmsChannelSnapshot;
    patch: Record<string, unknown>;
  }): Promise<SmsWriteResult>;
}

export interface SmsReconcileProvider {
  lookup(providerMessageId: string): Promise<SmsLookup>;
}

export interface SmsReconcileSummary {
  checked: number;
  /** Confirmed delivered AND durably recorded. Never incremented on a CAS miss. */
  delivered: number;
  /** Confirmed undelivered AND durably recorded. Same rule. */
  undelivered: number;
  /** Checked but not resolved by THIS run, for any reason. */
  unresolved: number;
  /** Writes that matched zero rows because something else got there first. */
  stale: number;
  /** Writes the database refused. */
  errors: number;
}

/**
 * Phase 4 — SMS delivery reconciliation.
 *
 * THE PARENT IS NEVER TOUCHED. reminder_logs.status stays exactly where it is: a
 * carrier rejection on one channel does not change whether the reminder as a
 * whole reached the customer, and migration 011's dispatched-final trigger would
 * refuse the write anyway. Only the child row moves, and only via
 * `applyIfUnchanged`.
 *
 * NOTHING HERE RESENDS. `undelivered` is not a claimable status, so recording
 * one cannot cause a second text to a customer who may already have the first.
 */
export async function reconcileSmsChannels(
  deps: {
    db: SmsReconcileDb;
    provider: SmsReconcileProvider;
    limit: number;
    log?: (level: "warn" | "error", message: string) => void;
  },
  at: string
): Promise<SmsReconcileSummary> {
  const summary: SmsReconcileSummary = {
    checked: 0,
    delivered: 0,
    undelivered: 0,
    unresolved: 0,
    stale: 0,
    errors: 0,
  };

  const log = deps.log ?? (() => {});

  let rows: SmsChannelSnapshot[];
  try {
    rows = await deps.db.listReconcilable(deps.limit);
  } catch (err) {
    log("error", `[reconcile-sms] read failed: ${err instanceof Error ? err.message : "unknown"}`);
    summary.errors++;
    return summary;
  }

  for (const snapshot of rows) {
    summary.checked++;

    const lookup = await deps.provider.lookup(snapshot.providerMessageId);
    const action = decideSmsReconcile(lookup);

    if (action.kind === "resolve") {
      const patch: Record<string, unknown> = {
        status: action.status,
        provider_last_event: action.event,
        last_reconciled_at: at,
      };
      if (action.status === "undelivered") patch.last_send_error = action.note;

      const written = await deps.db.applyIfUnchanged({ snapshot, patch });

      if (written.kind === "error") {
        log("error", `[reconcile-sms] write failed for ${snapshot.id}: ${written.message}`);
        summary.errors++;
        summary.unresolved++;
      } else if (written.kind === "stale") {
        // The row moved under us. The Twilio answer we hold describes a snapshot
        // that no longer exists, so it is DISCARDED — not retried, not forced,
        // and above all not counted. Whatever changed the row knew more than we
        // did, and the next run will re-ask if there is still anything to ask.
        log(
          "warn",
          `[reconcile-sms] ${snapshot.id} changed during the Twilio lookup; ` +
            `the ${action.status} result was discarded as stale.`
        );
        summary.stale++;
        summary.unresolved++;
      } else if (action.status === "sent") {
        summary.delivered++;
      } else {
        summary.undelivered++;
      }
      continue;
    }

    // in_flight or ambiguous. No lifecycle change — only the reconciliation
    // timestamp, and the provider event when we learned one.
    //
    // THIS WRITE IS GUARDED IDENTICALLY. It is metadata, but metadata that a
    // terminal result may already have replaced: an unguarded update here is how
    // a late `sending` overwrites an earlier `delivered`.
    summary.unresolved++;

    const patch: Record<string, unknown> = { last_reconciled_at: at };
    if (action.kind === "in_flight") patch.provider_last_event = action.event;

    const touched = await deps.db.applyIfUnchanged({ snapshot, patch });

    if (touched.kind === "error") {
      log("error", `[reconcile-sms] touch failed for ${snapshot.id}: ${touched.message}`);
      summary.errors++;
    } else if (touched.kind === "stale") {
      log(
        "warn",
        `[reconcile-sms] ${snapshot.id} changed during the Twilio lookup; ` +
          `the non-terminal result was discarded rather than overwriting newer state.`
      );
      summary.stale++;
    }
  }

  return summary;
}
