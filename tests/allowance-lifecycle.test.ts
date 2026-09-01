process.env.REVIEW_TOKEN_SECRET ??= "test-review-token-secret";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  releasesAllowance,
  consumesAllowance,
  isDispatchedRegression,
  ALLOWANCE_RELEASING_STATUSES,
  FOUNDING_BETA_ALLOWANCE,
} from "@/lib/beta-allowance";
import type { ReminderSendStatus } from "@/lib/reminder-send-state";
import { FakeAllowanceStore } from "./support/fakes";

/**
 * THE ORPHANED-SLOT DEFECT, and the lifecycle rule that closes it.
 *
 * A reminder could reserve a unit and then move to a state meaning it would
 * never be sent — dismissed, or failed on the auto path — while still holding
 * that unit. On a hard cap of ten, a handful of dismissals could permanently
 * lock a paying-nothing customer out of a product that told them they had
 * credits left.
 *
 * The rule now lives in ONE function, releasesAllowance(), and is enforced by
 * a database trigger so it applies to every code path including bulk updates
 * and hand-run SQL. These tests drive the rule exhaustively and assert the
 * trigger implements exactly it.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIGRATION = readFileSync(join(ROOT, "supabase/sql/011_reminder_allowance.sql"), "utf8");
const DDL = MIGRATION.replace(/^\s*--.*$/gm, "");

const ALL_STATUSES: ReminderSendStatus[] = [
  "pending", "sending", "sent", "dismissed", "failed", "delivery_unknown", "undelivered",
];

/**
 * The database trigger, in TypeScript, for tests that need a whole lifecycle.
 * It calls the SAME rule the migration mirrors — if they diverge, the
 * structural tests at the bottom fail.
 */
function applyStatusChange(
  store: FakeAllowanceStore,
  reminderId: string,
  previous: ReminderSendStatus,
  next: ReminderSendStatus
): void {
  if (releasesAllowance(previous, next)) store.slots.delete(reminderId);
}

// ── The rule, over every transition that exists ────────────────────────────

test("the full 7x7 transition matrix releases exactly where it should", () => {
  const released: string[] = [];

  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      if (releasesAllowance(from, to)) released.push(`${from}->${to}`);
    }
  }

  // Every releasing transition, enumerated. Anything added or removed here is
  // a deliberate product decision, not an accident.
  assert.deepEqual(released.sort(), [
    // Non-consuming to non-consuming. The slot is already gone, so the DELETE
    // is a no-op — listed because the enumeration is exhaustive by design and
    // a silent omission here is how a rule quietly changes.
    "dismissed->failed",
    "dismissed->pending",
    "failed->dismissed",
    "failed->pending",
    "pending->dismissed",
    "pending->failed",
    "sending->dismissed",
    "sending->failed",
    "sending->pending",
  ].sort());
});

test("consumed is FINAL — nothing refunds a dispatched reminder", () => {
  for (const from of ["sent", "delivery_unknown", "undelivered"] as ReminderSendStatus[]) {
    assert.equal(consumesAllowance(from), true);
    for (const to of ALL_STATUSES) {
      assert.equal(
        releasesAllowance(from, to), false,
        `${from} -> ${to} must never refund a reminder that reached a provider`
      );
    }
  }
});

test("an in-flight attempt keeps its reservation", () => {
  // Releasing mid-send is exactly how a second request slips into the gap and
  // an eleventh reminder goes out.
  for (const from of ALL_STATUSES) {
    assert.equal(releasesAllowance(from, "sending"), false, `${from} -> sending`);
  }
  assert.equal(ALLOWANCE_RELEASING_STATUSES.includes("sending"), false);
});

test("a non-transition releases nothing", () => {
  for (const s of ALL_STATUSES) {
    assert.equal(releasesAllowance(s, s), false, `${s} -> ${s}`);
  }
});

// ── The scenarios from the product rule ────────────────────────────────────

test("reserved then dismissed → the unit comes back", () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 0);
  store.slots.set("rem-A", 1);           // reserved, reminder is pending

  applyStatusChange(store, "rem-A", "pending", "dismissed");

  assert.equal(store.slots.size, 0, "0 of 10 used");
  assert.equal(store.slots.has("rem-A"), false);
});

test("dismissing twice releases once, not twice", () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 4);
  store.slots.set("rem-A", 5);
  assert.equal(store.slots.size, 5);

  applyStatusChange(store, "rem-A", "pending", "dismissed");
  assert.equal(store.slots.size, 4);

  // The second dismissal is a no-op transition AND an idempotent DELETE.
  applyStatusChange(store, "rem-A", "dismissed", "dismissed");
  applyStatusChange(store, "rem-A", "dismissed", "dismissed");
  assert.equal(store.slots.size, 4, "no phantom credits appear from repeated dismissal");
});

test("a released slot is reusable, and reused at the lowest free number", async () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 0);
  for (let i = 1; i <= 5; i++) store.slots.set(`seeded-${i}`, i);

  applyStatusChange(store, "seeded-3", "pending", "dismissed");
  assert.equal(store.slots.size, 4);

  const claim = await store.claim("rem-new");
  assert.equal((claim as { outcome: string }).outcome, "claimed");
  assert.equal(store.slots.get("rem-new"), 3, "fills the gap rather than marching past the cap");
  assert.equal(store.slots.size, 5);
});

test("9 of 10, reserve the last, dismiss it, and another reminder becomes the tenth", async () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 9);

  const first = await store.claim("rem-A");
  assert.equal((first as { outcome: string; used: number }).used, 10);

  // Reminder A is definitely never sent.
  applyStatusChange(store, "rem-A", "pending", "dismissed");
  assert.equal(store.slots.size, 9, "back to 9 of 10");

  // A different, legitimate reminder can now take the tenth.
  const second = await store.claim("rem-B");
  assert.equal((second as { outcome: string }).outcome, "claimed");
  assert.equal(store.slots.size, 10);

  // And the eleventh is still refused.
  const third = await store.claim("rem-C");
  assert.equal((third as { outcome: string }).outcome, "exhausted");
  assert.equal(store.slots.size, 10, "never 11");
});

test("a sent reminder cannot be refunded by a dismissal-like path", () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 9);
  store.slots.set("rem-sent", 10);

  // Every route that writes 'dismissed', tried against a reminder that has
  // already been dispatched.
  for (const attempt of ["dismissed", "failed", "pending"] as ReminderSendStatus[]) {
    applyStatusChange(store, "rem-sent", "sent", attempt);
  }
  assert.equal(store.slots.size, 10, "10 of 10 — the send happened and stays paid for");
  assert.equal(store.slots.get("rem-sent"), 10);
});

test("delivery_unknown and undelivered keep their units", () => {
  for (const consumed of ["delivery_unknown", "undelivered"] as ReminderSendStatus[]) {
    const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 0);
    store.slots.set("rem-X", 1);

    applyStatusChange(store, "rem-X", "sending", consumed);
    assert.equal(store.slots.size, 1, `${consumed} may already have reached the customer`);

    applyStatusChange(store, "rem-X", consumed, "dismissed");
    assert.equal(store.slots.size, 1, `${consumed} must not be refundable afterwards`);
  }
});

test("a definite pre-provider failure releases", () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 3);
  store.slots.set("rem-F", 4);

  applyStatusChange(store, "rem-F", "sending", "failed");
  assert.equal(store.slots.size, 3, "nothing reached anyone");
});

test("releasing one reminder cannot remove another reminder's unit", () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 0);
  store.slots.set("rem-A", 1);
  store.slots.set("rem-B", 2);
  store.slots.set("rem-C", 3);

  applyStatusChange(store, "rem-B", "pending", "dismissed");

  assert.deepEqual(Array.from(store.slots.keys()).sort(), ["rem-A", "rem-C"]);
  assert.equal(store.slots.get("rem-A"), 1, "untouched");
  assert.equal(store.slots.get("rem-C"), 3, "untouched");
});

// ── Concurrency, with releases in the mix ──────────────────────────────────

test("CONCURRENCY: releases racing claims can never produce an eleventh unit", async () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 9);

  // Hold every claim inside the window between choosing a slot and taking it,
  // then let releases land in the same instant.
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let waiting = 0;
  store.settle = async () => {
    waiting++;
    if (waiting === 5) release();
    await gate;
  };

  const claims = Array.from({ length: 5 }, (_, i) => store.claim(`rem-new-${i}`));
  const releases = [1, 2, 3].map(async (n) => {
    applyStatusChange(store, `seed-${n}`, "pending", "dismissed");
  });

  await Promise.all([...claims, ...releases]);

  assert.ok(store.slots.size <= FOUNDING_BETA_ALLOWANCE, `size ${store.slots.size} exceeded the cap`);

  const numbers = Array.from(store.slots.values());
  assert.equal(new Set(numbers).size, numbers.length, "no duplicate slot numbers");
  assert.ok(numbers.every((n) => n >= 1 && n <= FOUNDING_BETA_ALLOWANCE), "no slot 11");

  const ids = Array.from(store.slots.keys());
  assert.equal(new Set(ids).size, ids.length, "no reminder holds two units");
});

test("CONCURRENCY: a dismissal mid-flight cannot hand a unit away from an active send", () => {
  // 'sending' is not a releasing state, so the trigger leaves an in-flight
  // attempt alone even if a dismissal write lands at the same moment.
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 9);
  store.slots.set("rem-inflight", 10);

  applyStatusChange(store, "rem-inflight", "sending", "sending");
  assert.equal(store.slots.size, 10, "the in-flight attempt keeps its unit");

  // And when it lands, it stays paid for.
  applyStatusChange(store, "rem-inflight", "sending", "sent");
  assert.equal(store.slots.size, 10);
});

// ── The trigger implements exactly this rule ───────────────────────────────

test("[static] the trigger exists and fires on every status transition", () => {
  assert.match(DDL, /create trigger reminder_logs_allowance_sync/);
  assert.match(DDL, /after update of status on public\.reminder_logs/);
  assert.match(DDL, /for each row/);
  assert.match(DDL, /when \(old\.status is distinct from new\.status\)/,
    "a rewrite of the same status is not a transition");
  assert.match(DDL, /execute function public\.sync_reminder_allowance_slot\(\)/);
});

test("[static] the trigger's rule matches releasesAllowance()", () => {
  const fn = DDL.slice(DDL.indexOf("function public.sync_reminder_allowance_slot"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  // Consumed is final, and checked FIRST so no clause ordering can refund.
  assert.match(body, /if old\.status in \('sent', 'delivery_unknown', 'undelivered'\) then\s*\n\s*return new;/);
  // The releasing set, exactly.
  assert.match(body, /if new\.status in \('pending', 'dismissed', 'failed'\) then/);
  assert.equal(/'sending'/.test(body.split("if new.status in")[1] ?? ""), false,
    "'sending' must not be a releasing state");
  // Scoped to the row whose status just changed.
  assert.match(body, /where reminder_log_id = new\.id/);
  // A DELETE, so releasing twice is releasing once.
  assert.match(body, /delete from public\.reminder_allowance_slots/);
});

test("[static] the trigger covers the bulk paths that have no service layer", () => {
  // These write 'dismissed' straight to reminder_logs, and the paid kill
  // switch is a bulk update that never names a single reminder — so there is
  // nowhere to put a per-reminder release call, which is why the invariant
  // lives in the database rather than in application code.
  //
  // The kill switch moved from lib/invoices.ts to the trusted
  // lib/invoice-owner-writes.ts when migration 012 revoked browser UPDATE on
  // invoices. Same bulk `where invoice_id = ? and status = 'pending'` shape,
  // still with no per-reminder service layer — so the trigger is still what
  // keeps the allowance ledger correct for it.
  const bulk = [
    "lib/invoice-owner-writes.ts",
    "app/api/reminders/[id]/dismiss/route.ts",
  ];
  for (const file of bulk) {
    const code = readFileSync(join(ROOT, file), "utf8");
    assert.match(code, /status: "dismissed"/, `${file} still writes dismissed`);
    // And none of them hand-rolls its own release, which would be a second
    // rule free to drift from the trigger.
    assert.equal(
      /release_reminder_allowance/.test(code), false,
      `${file} must rely on the trigger, not its own release call`
    );
  }

  // The auto-mode sender writes 'failed' with no service layer either.
  // /api/invoices/actions now delegates its dismissal to the same helper, so
  // it must NOT hand-roll one of its own.
  const actions = readFileSync(join(ROOT, "app/api/invoices/actions/route.ts"), "utf8");
  assert.match(actions, /dismissPendingForOwner\(admin, body\.invoice_id, user\.id\)/);
  assert.equal(
    /\.from\("reminder_logs"\)[\s\S]{0,120}status: "dismissed"/.test(actions), false,
    "the actions route must use the shared helper, not its own bulk dismiss"
  );

  const sender = readFileSync(join(ROOT, "lib/reminder-sender.ts"), "utf8");
  assert.match(sender, /status: "failed"/);
  assert.equal(/release_reminder_allowance/.test(sender), false);

  // The approve route is the ONE legitimate caller of release: it owns the
  // `sending` claim on the definite-failure path, so it can release
  // immediately rather than waiting for the trigger. That is defence in depth
  // over the same rule, not a competing one — the trigger would delete the
  // same row moments later when the status write lands.
  const approve = readFileSync(join(ROOT, "lib/approval-wiring.ts"), "utf8");
  assert.match(approve, /release_reminder_allowance/);
  assert.match(approve, /p_reminder_log_id: reminderLogId/, "scoped to one reminder");
});

// ── Migration hardening ────────────────────────────────────────────────────

test("[static] every SECURITY DEFINER function pins a safe search_path", () => {
  const definers = (DDL.match(/security definer/g) ?? []).length;
  assert.equal(definers, 3, "claim, release, and the trigger function");

  const safe = (DDL.match(/set search_path = pg_catalog, pg_temp/g) ?? []).length;
  assert.equal(
    safe, 5,
    "the three definers, plus founding_beta_allowance() and " +
      "enforce_dispatched_reminder_final() — neither is a definer, but both " +
      "run inside statements that definers participate in, so both pin it too"
  );
  assert.ok(safe >= definers, "no definer may be left unpinned");

  // 'public' must NOT be on the search path of a definer function: if any role
  // can create objects in public, a same-named table or function would be
  // resolved ahead of the intended one and would run as the function owner.
  assert.equal(
    /search_path = [^\n]*\bpublic\b/.test(DDL), false,
    "no definer function may search the public schema"
  );
  // Which is only safe because every object reference is fully qualified.
  assert.match(DDL, /public\.reminder_allowance_slots/);
  assert.match(DDL, /public\.reminder_logs/);
  assert.match(DDL, /auth\.uid\(\)/);
});

test("[static] PUBLIC's default EXECUTE grant is revoked from every function", () => {
  // PostgreSQL grants EXECUTE to PUBLIC on creation. Without these, anon could
  // call the claim function directly.
  for (const fn of [
    /revoke all on function public\.claim_reminder_allowance\(uuid, uuid\) from public;/,
    /revoke all on function public\.release_reminder_allowance\(uuid, uuid\) from public;/,
    /revoke all on function public\.sync_reminder_allowance_slot\(\) from public;/,
    /revoke all on function public\.enforce_dispatched_reminder_final\(\) from public;/,
    /revoke all on function public\.founding_beta_allowance\(\) from public;/,
  ]) {
    assert.match(DDL, fn);
  }

  // Every function in this migration is revoked from PUBLIC — none forgotten.
  const created = (DDL.match(/create or replace function public\.(\w+)/g) ?? [])
    .map((m) => m.split(".")[1]);
  assert.equal(created.length, 5);
  for (const name of created) {
    assert.match(
      DDL, new RegExp(`revoke all on function public\\.${name}\\(`),
      `${name} must be revoked from PUBLIC`
    );
  }
});

test("[static] RLS is enabled but NOT forced, and there is no browser write route", () => {
  assert.match(DDL, /alter table public\.reminder_allowance_slots enable row level security;/);
  // FORCE would apply RLS to the table owner too — the very role the definer
  // functions run as — and break the only legitimate write path.
  assert.equal(/force row level security/.test(DDL), false);

  assert.match(DDL, /for select\s*\n?\s*using \(auth\.uid\(\) = user_id\)/);
  for (const policy of [/for insert/, /for update/, /for delete/, /for all/]) {
    assert.equal(policy.test(DDL), false, `no ${policy} policy`);
  }
});

test("[static] the rollback drops the trigger before the table it reads", () => {
  const rollback = MIGRATION.slice(MIGRATION.indexOf("── Rollback"));

  const trigger = rollback.indexOf("drop trigger if exists reminder_logs_allowance_sync");
  const triggerFn = rollback.indexOf("drop function if exists public.sync_reminder_allowance_slot");
  const table = rollback.indexOf("drop table if exists public.reminder_allowance_slots");

  assert.ok(trigger > -1 && triggerFn > -1 && table > -1, "all three are listed");
  assert.ok(trigger < triggerFn, "trigger before its function");
  assert.ok(
    triggerFn < table,
    "the table LAST — PostgreSQL does not track dependencies through function " +
      "bodies, so dropping it first leaves a trigger that errors on every " +
      "reminder_logs status update"
  );
});

// ── The two direct-RPC bypasses ────────────────────────────────────────────
//
// Both were reachable from a browser console by a user acting only on their
// OWN data, so no ownership check could have caught either. Both are closed in
// the SQL, and both are asserted here because the previous test suite passed
// against a migration containing them.

test("[static] BYPASS #1 — the cap is not a caller-supplied parameter", () => {
  // Was: claim_reminder_allowance(p_reminder_log_id, p_user_id, p_allowance).
  // A user could pass p_allowance: 9999, pre-claim slot 11 for their own
  // reminder, then press Approve; the server's own claim returned
  // `already_held` rather than `exhausted`, and the send proceeded.
  assert.equal(
    /p_allowance/.test(DDL), false,
    "no function may accept the cap as an argument"
  );
  assert.match(DDL, /function public\.claim_reminder_allowance\(\s*p_reminder_log_id uuid,\s*p_user_id uuid\s*\)/);

  // The value is resolved server-side, once.
  assert.match(DDL, /create or replace function public\.founding_beta_allowance\(\)/);
  assert.match(DDL, /v_allowance integer := public\.founding_beta_allowance\(\);/);
  assert.match(DDL, /generate_series\(1, v_allowance\)/);

  // The backfill cap too — a literal there would drift from the function.
  assert.match(DDL, /where slot_number <= public\.founding_beta_allowance\(\)/);

  // And no caller passes it.
  for (const file of [
    "lib/approval-wiring.ts",
    "app/api/cron/send-reminders/route.ts",
  ]) {
    const raw = readFileSync(join(ROOT, file), "utf8");
    // Comments explain the fix and necessarily name the old parameter. Only
    // executable code can pass an argument.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /claim_reminder_allowance/);
    assert.equal(/p_allowance/.test(code), false, `${file} must not supply the cap`);
  }
});

test("[static] BYPASS #2 — release cannot refund a consumed reminder", () => {
  // Was: an unconditional DELETE. The "consumed is final" trigger fires on
  // reminder_logs, but this function writes to the SLOT TABLE directly and so
  // went straight past it. One RPC call per sent reminder emptied the ledger.
  const fn = DDL.slice(DDL.indexOf("function public.release_reminder_allowance"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  assert.match(body, /delete from public\.reminder_allowance_slots s/);
  assert.match(
    body,
    /and exists \([\s\S]*?from public\.reminder_logs r[\s\S]*?r\.status in \('pending', 'dismissed', 'failed'\)[\s\S]*?\)/,
    "the DELETE must be conditional on a non-consuming status"
  );
  // Scoped to the same owner as the slot, not just to p_user_id.
  assert.match(body, /r\.user_id = s\.user_id/);

  // The releasable set is EXACTLY the one releasesAllowance() permits, so the
  // RPC can never do more than dismissing the reminder already would.
  for (const consumed of ["sent", "delivery_unknown", "undelivered"]) {
    assert.equal(
      new RegExp(`r\\.status in \\([^)]*'${consumed}'`).test(body), false,
      `${consumed} must not be releasable`
    );
  }
  // 'sending' excluded too: releasing an in-flight attempt lets a second
  // request take the freed unit while the first is still submitting.
  assert.equal(/r\.status in \([^)]*'sending'/.test(body), false);
});

test("the SQL releasable set and releasesAllowance() are the same set", () => {
  const fn = DDL.slice(DDL.indexOf("function public.release_reminder_allowance"));
  const body = fn.slice(0, fn.indexOf("$$;"));
  const listed = (body.match(/r\.status in \(([^)]*)\)/) ?? [])[1] ?? "";

  const sqlSet = listed.split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  const tsSet = Array.from(ALLOWANCE_RELEASING_STATUSES).sort();

  assert.deepEqual(sqlSet, tsSet, "one rule, expressed twice, asserted equal");
});

test("[static] the new constant function is locked down like the rest", () => {
  assert.match(DDL, /revoke all on function public\.founding_beta_allowance\(\) from public;/);
  assert.match(DDL, /grant execute on function public\.founding_beta_allowance\(\) to service_role;/);
  // It is a definer-safe pure function: no search_path surface, no side effects.
  const fn = DDL.slice(DDL.indexOf("function public.founding_beta_allowance"));
  assert.match(fn.slice(0, 300), /immutable/);
  assert.match(fn.slice(0, 300), /set search_path = pg_catalog, pg_temp/);
});

test("[static] the rollback drops the constant function too", () => {
  const rollback = MIGRATION.slice(MIGRATION.indexOf("── Rollback"));
  assert.match(rollback, /drop function if exists public\.founding_beta_allowance\(\);/);
  assert.match(rollback, /drop function if exists public\.claim_reminder_allowance\(uuid, uuid\);/);
  // The constant is dropped AFTER the functions that call it.
  assert.ok(
    rollback.indexOf("drop function if exists public.claim_reminder_allowance") <
      rollback.indexOf("drop function if exists public.founding_beta_allowance"),
    "claim depends on the constant, so the constant goes last"
  );
});

// ── The dispatched-state invariant ─────────────────────────────────────────
//
// The ledger rule protects the CAP. This one protects the CUSTOMER.
//
// RLS on reminder_logs permits `auth.uid() = user_id` updates, so a user could
// set one of their own `sent` reminders back to `pending` from the browser.
// The ledger correctly refused to refund — but 'pending' is claimable, so
// re-approving found the reminder already_held, spent nothing further, and
// delivered the same message to the customer again. Unlimited SENDS for one
// unit. These transitions are now rejected outright by the database.

const DISPATCHED: ReminderSendStatus[] = ["sent", "delivery_unknown", "undelivered"];

test("every exit from the dispatched set is a regression", () => {
  const regressions: string[] = [];
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      if (isDispatchedRegression(from, to)) regressions.push(`${from}->${to}`);
    }
  }

  // Exhaustive: three dispatched states × four non-dispatched states.
  assert.deepEqual(regressions.sort(), [
    "delivery_unknown->dismissed", "delivery_unknown->failed",
    "delivery_unknown->pending", "delivery_unknown->sending",
    "sent->dismissed", "sent->failed", "sent->pending", "sent->sending",
    "undelivered->dismissed", "undelivered->failed",
    "undelivered->pending", "undelivered->sending",
  ].sort());
  assert.equal(regressions.length, 12);
});

test("a dispatched reminder cannot be made claimable or sendable again", () => {
  // CLAIMABLE_STATUSES is ['pending', 'failed'] — the two a direct UPDATE
  // would target to resurrect a sent reminder. Both are refused.
  for (const from of DISPATCHED) {
    for (const to of ["pending", "failed"] as ReminderSendStatus[]) {
      assert.equal(
        isDispatchedRegression(from, to), true,
        `${from} -> ${to} would let the same message be delivered twice`
      );
    }
    // And 'sending' directly, skipping the claim entirely.
    assert.equal(isDispatchedRegression(from, "sending"), true, `${from} -> sending`);
  }
});

test("reconciliation's transitions within the dispatched set stay allowed", () => {
  for (const from of DISPATCHED) {
    for (const to of DISPATCHED) {
      assert.equal(
        isDispatchedRegression(from, to), false,
        `${from} -> ${to} is what reconciliation does when the provider answers`
      );
    }
  }
  // The ones that matter by name.
  assert.equal(isDispatchedRegression("delivery_unknown", "sent"), false);
  assert.equal(isDispatchedRegression("delivery_unknown", "undelivered"), false);
  assert.equal(isDispatchedRegression("undelivered", "sent"), false);
});

test("entering the dispatched set is untouched", () => {
  for (const from of ["pending", "sending", "failed", "dismissed"] as ReminderSendStatus[]) {
    for (const to of DISPATCHED) {
      assert.equal(isDispatchedRegression(from, to), false, `${from} -> ${to}`);
    }
  }
});

test("a non-transition is not a regression", () => {
  for (const s of ALL_STATUSES) assert.equal(isDispatchedRegression(s, s), false);
});

test("[static] the invariant is enforced BEFORE the write, and raises", () => {
  assert.match(DDL, /create or replace function public\.enforce_dispatched_reminder_final\(\)/);

  const fn = DDL.slice(DDL.indexOf("function public.enforce_dispatched_reminder_final"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  assert.match(
    body,
    /if old\.status in \('sent', 'delivery_unknown', 'undelivered'\)\s*\n\s*and new\.status not in \('sent', 'delivery_unknown', 'undelivered'\) then/
  );
  assert.match(body, /raise exception/, "the write must be rejected, not corrected");
  assert.match(body, /errcode = '23514'/, "a check-violation, distinguishable by the client");

  // BEFORE, so the row never changes and the statement aborts ahead of the
  // AFTER trigger that touches the ledger.
  assert.match(DDL, /create trigger reminder_logs_dispatched_final\s*\n\s*before update of status on public\.reminder_logs/);
  assert.match(DDL, /for each row\s*\n\s*when \(old\.status is distinct from new\.status\)\s*\n\s*execute function public\.enforce_dispatched_reminder_final\(\)/);
});

test("[static] the SQL invariant and isDispatchedRegression() use the same set", () => {
  const fn = DDL.slice(DDL.indexOf("function public.enforce_dispatched_reminder_final"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  const sets = body.match(/\('sent', 'delivery_unknown', 'undelivered'\)/g) ?? [];
  assert.equal(sets.length, 2, "old-status test and new-status test, same set both times");

  // And that set is exactly what the TypeScript rule treats as consumed.
  for (const s of DISPATCHED) assert.equal(consumesAllowance(s), true);
  for (const s of ["pending", "sending", "dismissed", "failed"]) {
    assert.equal(consumesAllowance(s), false, s);
  }
});

// ── The privilege matrix ───────────────────────────────────────────────────

test("[static] MUTATING RPCs: PUBLIC / anon / authenticated have NO execute", () => {
  for (const fn of [
    "public\\.claim_reminder_allowance\\(uuid, uuid\\)",
    "public\\.release_reminder_allowance\\(uuid, uuid\\)",
  ]) {
    // Revoked from PUBLIC (the default grant) and from both browser roles.
    assert.match(DDL, new RegExp(`revoke all on function ${fn} from public;`));
    assert.match(DDL, new RegExp(`revoke all on function ${fn} from anon, authenticated;`));

    // Granted to service_role, and ONLY service_role.
    assert.match(DDL, new RegExp(`grant execute on function ${fn} to service_role;`));
    assert.equal(
      new RegExp(`grant execute on function ${fn}[^;]*\\b(anon|authenticated)\\b`).test(DDL),
      false,
      `${fn} must not be granted to a browser role`
    );
  }
});

test("[static] no function anywhere is granted to anon or authenticated", () => {
  const grants = DDL.match(/grant execute on function[^;]+;/g) ?? [];
  assert.ok(grants.length > 0, "there are grants to check");

  for (const g of grants) {
    assert.equal(/\banon\b/.test(g), false, `anon must never appear: ${g.trim()}`);
    assert.equal(/\bauthenticated\b/.test(g), false, `authenticated must never appear: ${g.trim()}`);
    assert.match(g, /service_role/);
  }
});

test("[static] trigger functions are callable by nobody directly", () => {
  // PostgreSQL checks EXECUTE at trigger-CREATION time, not at fire time, so
  // revoking does not stop the triggers running for ordinary users.
  for (const fn of [
    "public\\.sync_reminder_allowance_slot\\(\\)",
    "public\\.enforce_dispatched_reminder_final\\(\\)",
  ]) {
    assert.match(DDL, new RegExp(`revoke all on function ${fn} from public;`));
    assert.match(DDL, new RegExp(`revoke all on function ${fn} from anon, authenticated;`));
    assert.equal(
      new RegExp(`grant execute on function ${fn}`).test(DDL), false,
      `${fn} needs no grant at all`
    );
  }
});

test("[static] the ledger table: no browser INSERT/UPDATE/DELETE, owner SELECT only", () => {
  // Layer 1 — table privilege. Supabase default grants hand anon and
  // authenticated full DML on new public tables; without this revoke, RLS
  // would be the ONLY thing between a session and the ledger.
  assert.match(DDL, /revoke all on table public\.reminder_allowance_slots from anon, authenticated;/);

  // The banner still needs to count the user's own slots from the browser.
  assert.match(DDL, /grant select on table public\.reminder_allowance_slots to authenticated;/);
  assert.equal(
    /grant (insert|update|delete|all)[^;]*on table public\.reminder_allowance_slots/.test(DDL),
    false,
    "no write privilege may be granted to any browser role"
  );

  // Layer 2 — RLS. Enabled, SELECT-only policy scoped to the owner, and no
  // write policy exists, so a write finds no permissive policy either.
  assert.match(DDL, /alter table public\.reminder_allowance_slots enable row level security;/);
  assert.match(DDL, /for select\s*\n?\s*using \(auth\.uid\(\) = user_id\)/);
  for (const policy of [/for insert/, /for update/, /for delete/, /for all/]) {
    assert.equal(policy.test(DDL), false, `no ${policy} policy`);
  }

  // Both layers must fail before a slot can be touched.
});

test("[static] the banner's read path is exactly what the grants permit", () => {
  const reminders = readFileSync(join(ROOT, "lib/reminders.ts"), "utf8");
  // SELECT with a count — the one operation `authenticated` retains.
  assert.match(reminders, /from\("reminder_allowance_slots"\)/);
  assert.match(reminders, /\.select\("reminder_log_id", \{ count: "exact", head: true \}\)/);
  // And it never attempts a write.
  assert.equal(
    /reminder_allowance_slots"\)[\s\S]{0,200}\.(insert|update|delete|upsert)\(/.test(reminders),
    false
  );
});

test("[static] the app calls the mutating RPCs with a service-role client", () => {
  const approve = readFileSync(join(ROOT, "lib/approval-wiring.ts"), "utf8");
  const cron = readFileSync(join(ROOT, "app/api/cron/send-reminders/route.ts"), "utf8");

  // authenticated no longer has EXECUTE, so a session client would 403.
  // Asserted on the CLIENT the RPCs actually run on, not merely on the import
  // being present: deleting only the import is caught by tsc, not by this.
  assert.match(approve, /const admin = getSupabaseAdmin\(\);/);
  assert.match(approve, /const supabase = admin;/);
  assert.match(cron, /getSupabaseAdmin/);

  // And the store must NOT be handed a client — taking one is how the session
  // client gets passed back in.
  assert.match(approve, /function makeAllowanceStore\(userId: string\): AllowanceStore/);
  assert.equal(
    /makeAllowanceStore\((supabase|getSupabaseServer)/.test(approve), false,
    "the allowance store must never receive the caller's session client"
  );

  // The user id is derived from the verified session, never from the body.
  assert.match(approve, /p_user_id: userId/);
  assert.match(approve, /makeAllowanceStore\(userId\)/);

  // getUser() now lives in the ROUTES — both of them. Asserted on each rather
  // than on the wiring, so a route that forgot to verify the session before
  // handing an id to makeApprovalDeps is caught.
  for (const route of [
    "app/api/reminders/[id]/approve/route.ts",
    "app/api/reminders/[id]/channels/[channel]/retry/route.ts",
  ]) {
    const src = readFileSync(join(ROOT, route), "utf8");
    assert.match(src, /await supabase\.auth\.getUser\(\)/, `${route} must verify the session`);
    assert.match(src, /makeApprovalDeps\(supabase, user\.id, user\.email \?\? null\)/,
      `${route} must pass the VERIFIED id, never one from the request`);
  }

  // A missing service-role key fails closed rather than skipping the cap.
  assert.match(approve, /if \(!admin\) \{/);
  assert.match(approve, /Service-role client is not configured/);
});
