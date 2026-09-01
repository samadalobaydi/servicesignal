process.env.REVIEW_TOKEN_SECRET ??= "test-review-token-secret";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { approveAndSendReminder } from "@/lib/reminder-approval";
import { FOUNDING_BETA_ALLOWANCE } from "@/lib/beta-allowance";
import {
  ALLOWANCE_EXHAUSTED_STATE,
  ALLOWANCE_UNAVAILABLE_STATE,
  ALLOWANCE_EXHAUSTED_STATUS,
} from "@/lib/allowance-claim";
import {
  FakeApprovalDb,
  FakeAllowanceStore,
  FakeMailer,
  OWNER,
  REMINDER_ID,
  freshToken,
  makeDeps,
  makeStoredReminder,
  type StoredReminder,
} from "./support/fakes";

/**
 * HARD ENFORCEMENT of the Founding Beta allowance.
 *
 * The single claim worth proving is negative: at the cap, NO EMAIL LEAVES.
 * Every test therefore asserts on FakeMailer.sent — a test that only checked
 * the HTTP status would pass against an implementation that refused the
 * response after submitting the message.
 *
 * The database-level race guard is a unique constraint and cannot be executed
 * here; there is no test database. What IS executed is the application's
 * behaviour against a store that models those constraints faithfully, plus
 * structural assertions on the migration. Both are labelled honestly.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIGRATION = readFileSync(join(ROOT, "supabase/sql/011_reminder_allowance.sql"), "utf8");

/**
 * Comments explain the design; they cannot constrain anything.
 *
 * This exists because of a caught false positive: an assertion for
 * `unique (user_id, slot_number)` passed against a migration with that
 * constraint DELETED, because the phrase also appears in the header prose
 * explaining why it matters. Every structural claim below is made against
 * executable SQL only.
 */
const DDL = MIGRATION.replace(/^\s*--.*$/gm, "");

async function approve(store: FakeAllowanceStore, mailer: FakeMailer | null = new FakeMailer()) {
  const db = new FakeApprovalDb([makeStoredReminder()]);
  const token = await freshToken(db);
  const result = await approveAndSendReminder(
    makeDeps(db, mailer, { allowance: store }),
    { reminderId: REMINDER_ID, reviewToken: token }
  );
  return { result, db, mailer };
}

// ── The cap ────────────────────────────────────────────────────────────────

test("0 of 10 used — the reminder sends", async () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 0);
  const { result, mailer } = await approve(store);

  assert.equal(result.status, 200);
  assert.equal(result.outcome, "sent");
  assert.equal(mailer!.calls.length, 1);
  assert.equal(store.slots.size, 1);
});

test("9 of 10 used — exactly one more send is allowed, and the next is refused", async () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 9);

  const tenth = await approve(store);
  assert.equal(tenth.result.status, 200, "the tenth reminder is free");
  assert.equal(tenth.mailer!.calls.length, 1);
  assert.equal(store.slots.size, 10);

  // A DIFFERENT reminder, on the same account, immediately afterwards.
  const db = new FakeApprovalDb([makeStoredReminder({ id: "rem-eleven" })]);
  const token = await freshToken(db, { reminderId: "rem-eleven" });
  const mailer = new FakeMailer();
  const eleventh = await approveAndSendReminder(
    makeDeps(db, mailer, { allowance: store }),
    { reminderId: "rem-eleven", reviewToken: token }
  );

  assert.equal(eleventh.status, ALLOWANCE_EXHAUSTED_STATUS);
  assert.equal(eleventh.body.state, ALLOWANCE_EXHAUSTED_STATE);
  assert.equal(eleventh.outcome, "allowance_exhausted");
  assert.equal(mailer.calls.length, 0, "THE POINT: nothing was submitted");
});

test("10 of 10 used — refused, with a message that says what is needed", async () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 10);
  const { result, mailer } = await approve(store);

  assert.equal(result.status, 402, "402 Payment Required — a billing state, not a permission error");
  assert.equal(result.body.state, ALLOWANCE_EXHAUSTED_STATE);
  assert.match(result.body.message, /all 10 Founding Beta reminders/);
  assert.match(result.body.message, /Upgrade to continue sending SMS and email reminders/);
  assert.equal(mailer!.calls.length, 0);
});

test("historical usage beyond the cap stays exhausted", async () => {
  // A pre-enforcement account that somehow holds more than the allowance must
  // not wrap around into free reminders.
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 14);
  const { result, mailer } = await approve(store);

  assert.equal(result.body.state, ALLOWANCE_EXHAUSTED_STATE);
  assert.equal(mailer!.calls.length, 0);
});

test("the refused reminder is left completely intact", async () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 10);
  const { result, db } = await approve(store);

  assert.equal(result.body.state, ALLOWANCE_EXHAUSTED_STATE);

  const row = db.rows.get(REMINDER_ID)!;
  assert.equal(row.status, "pending", "still pending — not sending, not failed, not dismissed");
  assert.equal(row.sendAttemptCount, 0, "no attempt was allocated");
  assert.ok(db.rows.has(REMINDER_ID), "the row was not deleted");
  // Refusing must not strand the reminder mid-send: it stays reviewable and
  // becomes sendable the moment the customer upgrades.
});

// ── One reminder, one unit ─────────────────────────────────────────────────

test("a retry of the same reminder does not consume a second unit", async () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 0);

  // First attempt: the provider definitively rejects it.
  const db = new FakeApprovalDb([makeStoredReminder()]);
  const rejecting = new FakeMailer();
  rejecting.behaviour = () => ({ ok: false, code: "validation_error", message: "bad recipient" });
  await approveAndSendReminder(
    makeDeps(db, rejecting, { allowance: store }),
    { reminderId: REMINDER_ID, reviewToken: await freshToken(db) }
  );
  assert.equal(db.rows.get(REMINDER_ID)!.status, "failed");
  assert.equal(store.slots.size, 0, "a definite pre-acceptance failure returns the unit");

  // Second attempt on the SAME reminder succeeds.
  const ok = new FakeMailer();
  const again = await approveAndSendReminder(
    makeDeps(db, ok, { allowance: store }),
    { reminderId: REMINDER_ID, reviewToken: await freshToken(db) }
  );

  assert.equal(again.status, 200);
  assert.equal(store.slots.size, 1, "one reminder, one unit — never two");
});

test("a duplicate approval for the same reminder is idempotent, not a second charge", async () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 0);
  // The reminder already holds a unit from an earlier attempt.
  store.slots.set(REMINDER_ID, 1);

  const { result, mailer } = await approve(store);

  assert.equal(result.status, 200);
  assert.equal(mailer!.calls.length, 1);
  assert.equal(store.slots.size, 1, "already_held — no second unit");
  assert.ok(store.calls.includes("already_held"));
});

test("SMS and email are one unit, because neither is nameable", () => {
  // Structural, not behavioural, and that is the strength of it: the slot
  // table's key is reminder_log_id, and channels live in a child table. There
  // is no expressible way for a channel to hold a unit.
  assert.match(DDL, /reminder_log_id uuid primary key/);
  assert.equal(
    /reminder_channel_messages/.test(DDL),
    false,
    "no executable statement references the channel table"
  );
});

test("re-reading a reminder charges nothing — only the send path claims", () => {
  const approval = readFileSync(join(ROOT, "lib/reminder-approval.ts"), "utf8");
  const review = readFileSync(join(ROOT, "lib/reminder-review.ts"), "utf8");
  const prepare = readFileSync(join(ROOT, "app/api/reminders/prepare/route.ts"), "utf8");

  // Exactly one claim call in the service.
  assert.equal((approval.match(/allowance\.claim\(/g) ?? []).length, 1);
  // And none anywhere that merely reads or prepares.
  assert.equal(/allowance\.claim|claim_reminder_allowance/.test(review), false, "reviewing is free");
  assert.equal(/claim_reminder_allowance/.test(prepare), false, "preparing is free");
});

// ── Failure semantics ──────────────────────────────────────────────────────

test("an AMBIGUOUS outcome keeps the unit", async () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 0);
  const db = new FakeApprovalDb([makeStoredReminder()]);
  const mailer = new FakeMailer();
  mailer.behaviour = () => ({ ok: false, code: "internal_server_error", message: "timeout" });

  const result = await approveAndSendReminder(
    makeDeps(db, mailer, { allowance: store }),
    { reminderId: REMINDER_ID, reviewToken: await freshToken(db) }
  );

  assert.equal(result.body.state, "delivery_unknown");
  assert.equal(
    store.slots.size, 1,
    "the provider may already have it — refunding ambiguity would make a flaky provider an unlimited free tier"
  );
  assert.equal(store.calls.includes("released"), false);
});

test("a definite pre-acceptance failure returns the unit", async () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 5);
  const db = new FakeApprovalDb([makeStoredReminder()]);
  const mailer = new FakeMailer();
  mailer.behaviour = () => ({ ok: false, code: "validation_error", message: "invalid address" });

  const result = await approveAndSendReminder(
    makeDeps(db, mailer, { allowance: store }),
    { reminderId: REMINDER_ID, reviewToken: await freshToken(db) }
  );

  assert.equal(result.body.state, "failed");
  assert.equal(store.slots.size, 5, "back to where it started — nothing reached anyone");
  assert.ok(store.calls.includes("released"));
});

test("a cheap refusal never touches the allowance", async () => {
  // A paid invoice is the kill switch and is checked long before the claim.
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 0);
  const db = new FakeApprovalDb([makeStoredReminder({ invoice: { status: "paid" } as StoredReminder["invoice"] })]);
  const mailer = new FakeMailer();

  await approveAndSendReminder(
    makeDeps(db, mailer, { allowance: store }),
    { reminderId: REMINDER_ID, reviewToken: await freshToken(db) }
  );

  assert.equal(store.calls.length, 0, "no claim was even attempted");
  assert.equal(store.slots.size, 0);
  assert.equal(mailer.calls.length, 0);
});

// ── Fail closed ────────────────────────────────────────────────────────────

test("an unreachable allowance store refuses the send — and does NOT call it exhaustion", async () => {
  // Includes the case where migration 011 has not been applied yet.
  const store = new FakeAllowanceStore();
  store.unavailable = 'function "claim_reminder_allowance" does not exist';

  const { result, mailer } = await approve(store);

  assert.equal(result.status, 503);
  assert.equal(result.body.state, ALLOWANCE_UNAVAILABLE_STATE);
  assert.notEqual(
    result.body.state, ALLOWANCE_EXHAUSTED_STATE,
    "telling a customer with credits left that they have none is its own failure"
  );
  assert.equal(mailer!.calls.length, 0, "fails CLOSED — a cap that lapses on error is not a cap");
  // And it must not leak the database error to the customer.
  assert.equal(/does not exist|claim_reminder_allowance/.test(String(result.body.message)), false);
});

// ── CONCURRENCY ────────────────────────────────────────────────────────────
//
// The race, stated exactly: the account is at 9 of 10. Two approvals for two
// DIFFERENT reminders arrive together. Both read "used = 9". Both conclude a
// unit remains. Both send. The customer receives 11 free reminders.
//
// The existing per-row claim does not help — the requests touch different
// reminder_logs rows, so both win their own claim. Only a shared, atomic
// decision closes it.

test("CONCURRENCY: at 9 of 10, two simultaneous sends cannot both take the last unit", async () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 9);

  // Suspend both requests inside the store, AFTER each has chosen slot 10 and
  // BEFORE either has taken it. This is the exact window a count-then-send
  // implementation loses in, and it is forced open here rather than hoped for.
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let waiting = 0;
  store.settle = async () => {
    waiting++;
    if (waiting === 2) release();   // both are inside the window
    await gate;
  };

  const setup = async (id: string) => {
    const db = new FakeApprovalDb([makeStoredReminder({ id })]);
    const mailer = new FakeMailer();
    return {
      mailer,
      run: async () =>
        approveAndSendReminder(
          makeDeps(db, mailer, { allowance: store }),
          { reminderId: id, reviewToken: await freshToken(db, { reminderId: id }) }
        ),
    };
  };

  const a = await setup("rem-A");
  const b = await setup("rem-B");
  const [ra, rb] = await Promise.all([a.run(), b.run()]);

  const statuses = [ra.status, rb.status].sort();
  assert.deepEqual(statuses, [200, ALLOWANCE_EXHAUSTED_STATUS],
    "exactly one succeeded and exactly one was refused");

  const totalSent = a.mailer.calls.length + b.mailer.calls.length;
  assert.equal(totalSent, 1, "THE POINT: exactly one email left the building, never two");

  assert.equal(store.slots.size, 10, "10 of 10 — never 11");
  assert.ok(store.slots.size <= FOUNDING_BETA_ALLOWANCE);

  const refused = ra.status === 200 ? rb : ra;
  assert.equal(refused.body.state, ALLOWANCE_EXHAUSTED_STATE);
  assert.equal(refused.outcome, "allowance_exhausted");
});

test("CONCURRENCY: ten simultaneous sends on an empty allowance grant exactly ten", async () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 0);

  // Twelve requests, all suspended inside the claim window together.
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let waiting = 0;
  store.settle = async () => {
    waiting++;
    if (waiting === 12) release();
    await gate;
  };

  const runs = await Promise.all(
    Array.from({ length: 12 }, async (_, i) => {
      const id = `rem-${i}`;
      const db = new FakeApprovalDb([makeStoredReminder({ id })]);
      const mailer = new FakeMailer();
      const token = await freshToken(db, { reminderId: id });
      return { mailer, run: () => approveAndSendReminder(
        makeDeps(db, mailer, { allowance: store }),
        { reminderId: id, reviewToken: token }
      ) };
    })
  );

  const results = await Promise.all(runs.map((r) => r.run()));

  const sent = results.filter((r) => r.status === 200).length;
  const refused = results.filter((r) => r.status === ALLOWANCE_EXHAUSTED_STATUS).length;
  const emails = runs.reduce((n, r) => n + r.mailer.calls.length, 0);

  assert.equal(sent, 10, "exactly the allowance, no more");
  assert.equal(refused, 2);
  assert.equal(emails, 10, "ten emails, not twelve");
  assert.equal(store.slots.size, 10);
});

test("CONCURRENCY: two requests for the SAME reminder share one unit", async () => {
  const store = new FakeAllowanceStore(FOUNDING_BETA_ALLOWANCE, 0);
  const db = new FakeApprovalDb([makeStoredReminder()]);
  const mailer = new FakeMailer();
  const token = await freshToken(db);

  const deps = () => makeDeps(db, mailer, { allowance: store });
  const [x, y] = await Promise.all([
    approveAndSendReminder(deps(), { reminderId: REMINDER_ID, reviewToken: token }),
    approveAndSendReminder(deps(), { reminderId: REMINDER_ID, reviewToken: token }),
  ]);

  assert.equal(store.slots.size, 1, "one reminder, one unit, whoever wins the row claim");
  assert.equal(mailer.calls.length, 1, "and one submission — the existing row claim still holds");

  // The loser must NOT release: it would take the unit out from under the
  // request that is actively sending.
  const loser = x.status === 200 ? y : x;
  assert.equal(loser.body.state, "sending");
  assert.equal(store.slots.has(REMINDER_ID), true, "the winner keeps its unit");
});

// ── The database guarantee, asserted structurally ──────────────────────────
//
// These do not execute SQL. They assert that the properties the concurrency
// argument rests on are actually written in the migration, so the argument
// cannot quietly stop being true.

test("[static] the migration contains the constraint that decides the race", () => {
  assert.match(
    DDL,
    /unique \(user_id, slot_number\)/,
    "two racers computing the same slot must not both insert"
  );
  assert.match(DDL, /reminder_log_id uuid primary key/, "one slot per logical reminder");
  assert.match(DDL, /min\(g\)[\s\S]*?generate_series\(1, v_allowance\)/,
    "the LOWEST free slot, so releases leave usable gaps rather than shifting the cap");
  assert.match(DDL, /exception when unique_violation then/, "the loser recomputes");
  assert.match(DDL, /match full/, "the cross-tenant ownership invariant");
});

test("[static] the slot table cannot be written from a browser session", () => {
  assert.match(DDL, /enable row level security/);
  assert.match(DDL, /for select\s+using \(auth\.uid\(\) = user_id\)/);
  // No insert/update/delete policies at all: RLS denies by default, so the
  // SECURITY DEFINER functions are the only writers. A user cannot grant
  // themselves a slot or delete one to win back a credit.
  for (const policy of [/for insert/, /for update/, /for delete/, /for all/]) {
    assert.equal(policy.test(DDL), false, `no ${policy} policy may exist`);
  }
});

test("[static] a user cannot spend someone else's allowance", () => {
  // BOTH functions, counted — not merely "present somewhere". Asserting
  // presence passed against a version with the check deleted from claim(),
  // because the identical line still existed in release().
  const guards = DDL.match(/auth\.uid\(\) is not null and auth\.uid\(\) <> p_user_id/g) ?? [];
  assert.equal(guards.length, 2, "claim AND release must each refuse to act for another user");
  assert.equal((DDL.match(/raise exception 'not permitted'/g) ?? []).length, 2);

  // And specifically inside claim_reminder_allowance, which is the one that
  // spends something.
  const claimFn = DDL.slice(DDL.indexOf("function public.claim_reminder_allowance"));
  assert.match(
    claimFn.slice(0, claimFn.indexOf("$$;")),
    /auth\.uid\(\) is not null and auth\.uid\(\) <> p_user_id/
  );
  assert.match(DDL, /r\.id = p_reminder_log_id and r\.user_id = p_user_id/);
  assert.equal(/grant execute[^;]*to[^;]*anon/i.test(DDL), false, "anon has no allowance");
});

test("[static] the backfill preserves usage rather than resetting every account", () => {
  assert.match(DDL, /insert into public\.reminder_allowance_slots/);
  assert.match(DDL, /status in \('sent', 'delivery_unknown', 'undelivered'\)/);
  assert.match(DDL, /where slot_number <= public\.founding_beta_allowance\(\)/,
    "an account already past the cap stays capped, at the SERVER-side value");
  assert.match(DDL, /on conflict \(reminder_log_id\) do nothing/, "re-runnable");
});

test("[static] the migration is not self-applying and says where it points", () => {
  assert.match(MIGRATION, /NOT RUN AUTOMATICALLY/);
  assert.match(MIGRATION, /PRODUCTION/);
});

// ── No bypass ──────────────────────────────────────────────────────────────

test("[static] every send path claims allowance first", () => {
  // The two places in the product that can cause a customer to be contacted.
  const approveRoute = readFileSync(join(ROOT, "lib/approval-wiring.ts"), "utf8");
  const cron = readFileSync(join(ROOT, "app/api/cron/send-reminders/route.ts"), "utf8");

  assert.match(approveRoute, /claim_reminder_allowance/);
  assert.match(cron, /claim_reminder_allowance/, "auto mode is a send path too");

  // The cron's guard must sit BEFORE the send call, not after it.
  assert.ok(
    cron.indexOf("claim_reminder_allowance") < cron.indexOf("sendAndUpdateLog({"),
    "the cap must be decided before submission, not audited afterwards"
  );
});

test("[static] the enforcement point is server-side and not reachable from the client", () => {
  const service = readFileSync(join(ROOT, "lib/reminder-approval.ts"), "utf8");

  // The claim happens inside the service, before the mailer is touched.
  // Submission now happens inside dispatchChannels, which is called AFTER the
  // allowance claim. Anchored on the dispatcher rather than on a mailer call
  // that no longer appears in the service body.
  assert.ok(
    service.indexOf("deps.allowance.claim(") < service.indexOf("await dispatchChannels("),
    "allowance is decided before submission"
  );
  // And nothing submits before the dispatcher: the only provider calls in the
  // service are inside it.
  assert.ok(
    service.indexOf("function dispatchChannels(") < service.indexOf("deps.mailer!.send("),
    "the mailer is only reachable through the dispatcher"
  );
  assert.ok(
    service.indexOf("function dispatchChannels(") < service.indexOf("deps.texter!.send("),
    "the texter is only reachable through the dispatcher"
  );

  // AllowanceStore is required, not optional — an optional enforcement point
  // is one that gets forgotten.
  assert.match(service, /allowance: AllowanceStore;/);
  assert.equal(/allowance\?:/.test(service), false);

  // The panel's disabled button is UX only and must not be the enforcement.
  const panel = readFileSync(join(ROOT, "components/dashboard/ReminderReviewPanel.tsx"), "utf8");
  assert.equal(
    /FOUNDING_BETA_ALLOWANCE\s*[<>=]/.test(panel),
    false,
    "the client must not compute whether there is room"
  );
});

test("[static] the exhausted UI has no dead upgrade button", () => {
  const panel = readFileSync(join(ROOT, "components/dashboard/ReminderReviewPanel.tsx"), "utf8");
  const banner = readFileSync(join(ROOT, "components/dashboard/BetaAllowanceIndicator.tsx"), "utf8");

  // ServiceSignal has no billing route. Nothing may link to one.
  for (const code of [panel, banner]) {
    assert.equal(/href="\/(upgrade|billing|pricing|checkout)/.test(code), false);
    assert.equal(/stripe|checkout\.session/i.test(code), false);
  }
  // The words are allowed; a control that goes nowhere is not.
  assert.match(panel, /Free reminder allowance used/);
});
