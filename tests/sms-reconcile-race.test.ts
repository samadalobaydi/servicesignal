process.env.REVIEW_TOKEN_SECRET ??= "test-review-token-secret";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  reconcileSmsChannels,
  SMS_RECONCILE_STATUSES,
  type SmsChannelSnapshot,
  type SmsLookup,
  type SmsReconcileDb,
  type SmsWriteResult,
} from "@/lib/sms-reconcile";

/**
 * RECONCILIATION RACE SAFETY.
 *
 * The cron overlaps with itself. A run reads a channel row, spends a network
 * round-trip asking Twilio about it, and comes back to a row that another run —
 * or a retry — may already have rewritten. Every test here is about that gap.
 *
 * ── THE TWO FLAWS THIS SUITE EXISTS TO PREVENT ────────────────────────────
 *
 * A LATE ANSWER OVERWRITING A NEWER ONE. The terminal branch was guarded on a
 * broad allowed-status SET (`.in("status", SMS_RECONCILE_STATUSES)`) and the
 * in-flight/ambiguous branch was guarded on nothing but the id. Both let a run
 * holding a stale snapshot write provider_last_event and last_reconciled_at over
 * a newer reconciliation's result.
 *
 * A CAS MISS COUNTED AS SUCCESS. A PostgREST conditional UPDATE that matches
 * ZERO rows reports `error === null`. Reading that as success incremented
 * `delivered` / `undelivered` for writes that never landed — the run reported
 * deliveries it had not recorded.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const code = (f: string) =>
  read(f)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const AT = "2026-08-19T12:00:00.000Z";

/** A row as stored — every column the guard compares, plus the ones it writes. */
interface Row {
  id: string;
  status: string;
  provider_message_id: string;
  provider_last_event: string | null;
  send_attempt_count: number;
  last_reconciled_at: string | null;
  last_send_error: string | null;
}

function makeRow(over: Partial<Row> = {}): Row {
  return {
    id: "row-1",
    status: "sent",
    provider_message_id: "SM_first",
    provider_last_event: "queued",
    send_attempt_count: 1,
    last_reconciled_at: null,
    last_send_error: null,
    ...over,
  };
}

/**
 * A database that applies the SAME compare-and-set the Supabase adapter does.
 *
 * The fake must be honest about the failure mode under test: a predicate that
 * matches nothing updates nothing and reports NO ERROR. A fake that returned
 * success for a zero-row write would hide the exact bug this suite pins.
 */
class FakeSmsDb implements SmsReconcileDb {
  rows: Row[];
  /** Runs after the lookup, before the write — the concurrency window. */
  duringLookup: (() => void) | null = null;
  writeError: string | null = null;
  readError: string | null = null;
  writes: { id: string; patch: Record<string, unknown>; result: string }[] = [];

  constructor(rows: Row[] = [makeRow()]) {
    this.rows = rows;
  }

  get(id = "row-1") {
    return this.rows.find((r) => r.id === id)!;
  }

  async listReconcilable(limit: number): Promise<SmsChannelSnapshot[]> {
    if (this.readError) throw new Error(this.readError);
    return this.rows
      .filter(
        (r) => SMS_RECONCILE_STATUSES.includes(r.status) && r.provider_message_id !== null
      )
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        status: r.status,
        providerMessageId: r.provider_message_id,
        providerLastEvent: r.provider_last_event,
        sendAttemptCount: r.send_attempt_count,
        lastReconciledAt: r.last_reconciled_at,
      }));
  }

  async applyIfUnchanged({
    snapshot,
    patch,
  }: {
    snapshot: SmsChannelSnapshot;
    patch: Record<string, unknown>;
  }): Promise<SmsWriteResult> {
    if (this.writeError) {
      this.writes.push({ id: snapshot.id, patch, result: "error" });
      return { kind: "error", message: this.writeError };
    }

    const matched = this.rows.filter(
      (r) =>
        r.id === snapshot.id &&
        r.status === snapshot.status &&
        r.provider_message_id === snapshot.providerMessageId &&
        r.send_attempt_count === snapshot.sendAttemptCount &&
        r.provider_last_event === snapshot.providerLastEvent &&
        r.last_reconciled_at === snapshot.lastReconciledAt
    );

    // Zero rows matched. No error — this is the case that used to be counted.
    if (matched.length === 0) {
      this.writes.push({ id: snapshot.id, patch, result: "stale" });
      return { kind: "stale" };
    }

    for (const row of matched) Object.assign(row, patch);
    this.writes.push({ id: snapshot.id, patch, result: "applied" });
    return { kind: "applied" };
  }
}

const lookups: Record<string, SmsLookup> = {
  delivered: { ok: true, found: true, status: "delivered", errorCode: null, message: "ok" },
  undelivered: { ok: true, found: true, status: "undelivered", errorCode: 30003, message: "ok" },
  sending: { ok: true, found: true, status: "sending", errorCode: null, message: "ok" },
  down: { ok: false, found: false, status: null, errorCode: null, message: "socket hang up" },
};

/** One run. `duringLookup` fires in the gap between the read and the write. */
function run(db: FakeSmsDb, lookup: SmsLookup, duringLookup?: () => void) {
  return reconcileSmsChannels(
    {
      db,
      provider: {
        async lookup() {
          duringLookup?.();
          return lookup;
        },
      },
      limit: 25,
    },
    AT
  );
}

// ── 1. The ordinary path still works ───────────────────────────────────────

test("1. an ordinary terminal reconciliation applies and is counted", async () => {
  const db = new FakeSmsDb();
  const summary = await run(db, lookups.delivered);

  assert.equal(summary.checked, 1);
  assert.equal(summary.delivered, 1);
  assert.equal(summary.undelivered, 0);
  assert.equal(summary.stale, 0);
  assert.equal(summary.errors, 0);

  const row = db.get();
  assert.equal(row.status, "sent");
  assert.equal(row.provider_last_event, "delivered");
  assert.equal(row.last_reconciled_at, AT);
  assert.equal(db.writes[0].result, "applied");
});

test("1b. an ordinary undelivered result records the carrier note", async () => {
  const db = new FakeSmsDb();
  const summary = await run(db, lookups.undelivered);

  assert.equal(summary.undelivered, 1);
  assert.equal(summary.delivered, 0);
  assert.equal(summary.stale, 0);

  const row = db.get();
  assert.equal(row.status, "undelivered");
  assert.match(row.last_send_error!, /Carrier reported undelivered/);
  // Twilio's numeric code is kept for the log only.
  assert.match(row.last_send_error!, /30003/);
});

// ── 2. Status changed under us ─────────────────────────────────────────────

test("2. a status change between read and write blocks the terminal write", async () => {
  const db = new FakeSmsDb();

  // Another process resolves the row while we are talking to Twilio.
  const summary = await run(db, lookups.delivered, () => {
    Object.assign(db.get(), {
      status: "undelivered",
      provider_last_event: "undelivered",
      last_reconciled_at: "2026-08-19T11:59:00.000Z",
    });
  });

  assert.equal(summary.checked, 1);
  assert.equal(summary.stale, 1);
  assert.equal(summary.unresolved, 1);
  // THE POINT: a discarded write is not a delivery.
  assert.equal(summary.delivered, 0);
  assert.equal(summary.undelivered, 0);
  assert.equal(summary.errors, 0, "a CAS miss is not a database error");

  // The newer state survived untouched.
  const row = db.get();
  assert.equal(row.status, "undelivered");
  assert.equal(row.provider_last_event, "undelivered");
  assert.equal(row.last_reconciled_at, "2026-08-19T11:59:00.000Z");
});

// ── 3. A different attempt ─────────────────────────────────────────────────

test("3. a changed provider message id blocks the write", async () => {
  const db = new FakeSmsDb();

  const summary = await run(db, lookups.delivered, () => {
    // A new attempt: different SID for the same row.
    db.get().provider_message_id = "SM_second";
  });

  assert.equal(summary.stale, 1);
  assert.equal(summary.delivered, 0);
  // The answer was about SM_first. It may not be recorded against SM_second.
  assert.equal(db.get().provider_last_event, "queued");
  assert.equal(db.get().last_reconciled_at, null);
});

test("3b. a changed send_attempt_count alone blocks the write", async () => {
  const db = new FakeSmsDb();

  // The stronger attempt identity: it moves on every claim even when the SID is
  // unchanged or has not been written yet.
  const summary = await run(db, lookups.delivered, () => {
    db.get().send_attempt_count = 2;
  });

  assert.equal(summary.stale, 1);
  assert.equal(summary.delivered, 0);
  assert.equal(db.get().provider_last_event, "queued");
});

// ── 4. A late in-flight answer vs an earlier terminal one ──────────────────

test("4. an in-flight result cannot overwrite terminal metadata", async () => {
  const db = new FakeSmsDb();

  // Run B resolved the row as undelivered while run A was asking Twilio, and
  // run A's answer is the older, non-terminal one.
  const summary = await run(db, lookups.sending, () => {
    Object.assign(db.get(), {
      status: "undelivered",
      provider_last_event: "undelivered",
      last_send_error: "Carrier reported undelivered",
      last_reconciled_at: "2026-08-19T11:59:00.000Z",
    });
  });

  assert.equal(summary.unresolved, 1);
  assert.equal(summary.stale, 1, "the in-flight branch is guarded too");

  const row = db.get();
  assert.equal(row.status, "undelivered");
  assert.equal(row.provider_last_event, "undelivered", "must NOT be dragged back to `sending`");
  assert.equal(row.last_send_error, "Carrier reported undelivered");
  assert.equal(row.last_reconciled_at, "2026-08-19T11:59:00.000Z");
});

test("4b. an ambiguous result cannot overwrite newer metadata either", async () => {
  const db = new FakeSmsDb();

  // A lookup failure says nothing about the message — and must not stamp
  // last_reconciled_at over a newer run's.
  const summary = await run(db, lookups.down, () => {
    Object.assign(db.get(), {
      provider_last_event: "delivered",
      last_reconciled_at: "2026-08-19T11:59:00.000Z",
    });
  });

  assert.equal(summary.unresolved, 1);
  assert.equal(summary.stale, 1);
  assert.equal(db.get().provider_last_event, "delivered");
  assert.equal(db.get().last_reconciled_at, "2026-08-19T11:59:00.000Z");
});

// ── 5. Overlapping cron runs, end to end ───────────────────────────────────

test("5. overlapping runs cannot regress a newer provider event", async () => {
  const db = new FakeSmsDb();

  // Both runs read the SAME row state.
  const snapshots = await db.listReconcilable(25);
  assert.equal(snapshots.length, 1);

  // Run B comes back first with the terminal answer and applies it. The row
  // stays at `sent` — only the event and the timestamp move, which is exactly
  // why status/SID/attempt-count alone are not a sufficient guard.
  const applied = await db.applyIfUnchanged({
    snapshot: snapshots[0],
    patch: {
      status: "sent",
      provider_last_event: "delivered",
      last_reconciled_at: "2026-08-19T11:59:00.000Z",
    },
  });
  assert.equal(applied.kind, "applied");
  assert.equal(db.get().status, "sent", "the lifecycle column did not change at all");

  // Run A now comes back with the older, in-flight answer, holding the snapshot
  // it read before run B wrote.
  const stale = await db.applyIfUnchanged({
    snapshot: snapshots[0],
    patch: { provider_last_event: "sending", last_reconciled_at: AT },
  });

  assert.equal(stale.kind, "stale");
  assert.equal(db.get().provider_last_event, "delivered", "a newer event must never regress");
  assert.equal(db.get().last_reconciled_at, "2026-08-19T11:59:00.000Z");
});

test("5b. a first-ever reconciliation matches on a NULL last_reconciled_at", async () => {
  // The nullable columns are compared with IS NULL, not `= NULL`. Getting this
  // wrong would make every first reconciliation a permanent no-op.
  const db = new FakeSmsDb([makeRow({ last_reconciled_at: null, provider_last_event: null })]);
  const summary = await run(db, lookups.delivered);

  assert.equal(summary.delivered, 1);
  assert.equal(summary.stale, 0);
  assert.equal(db.get().last_reconciled_at, AT);
});

// ── 6. A zero-row write is never a delivery ────────────────────────────────

test("6. a zero-row guarded update increments neither delivered nor undelivered", async () => {
  for (const [name, lookup] of [
    ["delivered", lookups.delivered],
    ["undelivered", lookups.undelivered],
  ] as const) {
    const db = new FakeSmsDb();
    const summary = await run(db, lookup, () => {
      db.get().status = "dismissed"; // anything at all, so the CAS misses
    });

    assert.equal(db.writes[0].result, "stale", name);
    assert.equal(summary.delivered, 0, `${name}: no error, but nothing was written`);
    assert.equal(summary.undelivered, 0, name);
    assert.equal(summary.stale, 1, name);
    assert.equal(summary.errors, 0, name);
    // Every checked row is accounted for exactly once.
    assert.equal(summary.delivered + summary.undelivered + summary.unresolved, summary.checked);
  }
});

// ── 7. A real database error is its own answer ─────────────────────────────

test("7. a DB error leaves the row unresolved and is not counted as stale", async () => {
  const db = new FakeSmsDb();
  db.writeError = "deadlock detected";
  const summary = await run(db, lookups.delivered);

  assert.equal(summary.errors, 1);
  assert.equal(summary.unresolved, 1);
  assert.equal(summary.stale, 0, "a refused statement is not a concurrent write");
  assert.equal(summary.delivered, 0);
  assert.equal(summary.undelivered, 0);

  // Untouched, and re-asked next run.
  assert.equal(db.get().provider_last_event, "queued");
  assert.equal(db.get().last_reconciled_at, null);
});

test("7b. a read failure ends the run without inventing outcomes", async () => {
  const db = new FakeSmsDb();
  db.readError = "connection reset";
  const summary = await run(db, lookups.delivered);

  assert.equal(summary.checked, 0);
  assert.equal(summary.delivered, 0);
  assert.equal(summary.errors, 1);
  assert.equal(db.writes.length, 0);
});

// ── 8. The parent is never touched, and nothing resends ────────────────────

test("8. the parent reminder is never written by the SMS pass", async () => {
  // Structural, because the parent is unreachable from this module by design:
  // the port has exactly two methods and neither names reminder_logs.
  const lib = code("lib/sms-reconcile.ts");
  assert.equal(/reminder_logs/.test(lib), false);
  assert.equal(/from\(/.test(lib), false, "the decision layer holds no queries at all");

  // And no resend: `undelivered` is not claimable, and nothing here dispatches.
  assert.equal(/sendTwilioSms|dispatchChannels|retryReminderChannel/.test(lib), false);

  // The adapter's every write goes through the guarded method.
  const cron = code("app/api/cron/reconcile-reminders/route.ts");
  const pass = cron.slice(cron.indexOf("function makeSmsDb("), cron.indexOf("function makeDb("));
  assert.equal(/reminder_logs/.test(pass), false);
  const updates = pass.match(/\.update\(/g) ?? [];
  assert.equal(updates.length, 1, "exactly one write path, and it is the CAS");
});

// ── The guard itself, pinned structurally ──────────────────────────────────

test("the CAS compares every field of the snapshot that was read", () => {
  const cron = code("app/api/cron/reconcile-reminders/route.ts");
  const cas = cron.slice(cron.indexOf("async applyIfUnchanged("), cron.indexOf("async function reconcileSmsDelivery"));
  assert.ok(cas.length > 0);

  for (const clause of [
    /\.eq\("id", snapshot\.id\)/,
    /\.eq\("status", snapshot\.status\)/,
    /\.eq\("provider_message_id", snapshot\.providerMessageId\)/,
    /\.eq\("send_attempt_count", snapshot\.sendAttemptCount\)/,
    /\.is\("provider_last_event", null\)/,
    /\.eq\("provider_last_event", snapshot\.providerLastEvent\)/,
    /\.is\("last_reconciled_at", null\)/,
    /\.eq\("last_reconciled_at", snapshot\.lastReconciledAt\)/,
  ]) {
    assert.match(cas, clause);
  }

  // The broad allowed-status set must NOT be the write guard.
  assert.equal(/\.in\("status"/.test(cas), false,
    "a status SET matches rows a concurrent run already rewrote within that status");

  // The row count must be observable, or zero rows looks like success.
  assert.match(cas, /\.select\("id"\)/);
  assert.match(cas, /data\?\.length \?\? 0\) > 0 \? \{ kind: "applied" \} : \{ kind: "stale" \}/);
});

test("both branches write through the same guarded method", () => {
  const lib = code("lib/sms-reconcile.ts");
  const pass = lib.slice(lib.indexOf("export async function reconcileSmsChannels"));

  // Two writes: the terminal resolve, and the in-flight/ambiguous touch.
  const calls = pass.match(/deps\.db\.applyIfUnchanged\(/g) ?? [];
  assert.equal(calls.length, 2, "the metadata branch must be guarded, not bare");

  // Neither may be issued and ignored. Anchored at the start of a line, so a
  // call whose result IS bound (`const x = await …`) does not match.
  assert.equal(/^\s*(?:await|void) deps\.db\.applyIfUnchanged\(/m.test(pass), false,
    "the write result must be bound and inspected, never fired and forgotten");
  assert.match(pass, /const written = await deps\.db\.applyIfUnchanged\(/);
  assert.match(pass, /const touched = await deps\.db\.applyIfUnchanged\(/);

  // A stale result is never folded into a delivery count.
  const resolve = pass.slice(pass.indexOf("const written ="), pass.indexOf("// in_flight or ambiguous"));
  const staleAt = resolve.indexOf('written.kind === "stale"');
  const deliveredAt = resolve.indexOf("summary.delivered++");
  assert.ok(staleAt > -1 && deliveredAt > staleAt,
    "the stale branch must be taken before anything is counted as delivered");
});
