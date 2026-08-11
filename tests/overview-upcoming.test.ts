import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { buildUpcomingItems, checkpointDate, upcomingRelative } from "@/lib/overview-upcoming";
import type { Invoice, ReminderLog } from "@/types";

/**
 * Overview — "Coming up".
 *
 * A forecast is a promise, so the tests that matter are the ones that prove it
 * STAYS SILENT. Every precondition the daily cron applies is mirrored in the
 * module, and each has a test here that fails if the mirror is removed: a
 * version that forecast everything would still pass a naive "the row appears"
 * test, and would lie to the owner every day.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const NOW = new Date("2026-08-08T12:00:00Z");

/** An ISO date `n` days from 2026-08-08. */
function day(n: number): string {
  const d = new Date(NOW);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    invoice_reference: "INV-1042",
    job_description: null,
    customer_name: "Dave Morrison",
    customer_email: "dave@example.co.uk",
    customer_phone: "07700 900000",
    amount: 1240,
    due_date: day(0),
    payment_link: "",
    reminder_tone: "firm",
    reminder_schedules: ["due_today", "overdue_3_days", "overdue_7_days", "overdue_14_days"],
    status: "unpaid",
    created_at: NOW.toISOString(),
    paid_at: null,
    reminders_sent: [],
    escalation_status: "active",
    ...over,
  } as Invoice;
}

function reminder(over: Partial<ReminderLog> = {}): ReminderLog {
  return {
    id: "rem-1",
    invoice_id: "inv-1",
    user_id: "user-1",
    schedule: "overdue_3_days",
    status: "pending",
    email_to: "dave@example.co.uk",
    subject: null,
    created_at: NOW.toISOString(),
    sent_at: null,
    error_message: null,
    send_started_at: null,
    send_attempt_key: null,
    send_attempt_count: 0,
    provider_message_id: null,
    provider_last_event: null,
    last_send_error: null,
    reviewed_content_hash: null,
    last_reconciled_at: null,
    ...over,
  } as ReminderLog;
}

const EMPTY = { invoices: [], pendingReminders: [], reminderHistory: [], now: NOW };

// ── The date is derived, not guessed ───────────────────────────────────────

test("a checkpoint date is the due date plus its fixed offset", () => {
  assert.equal(checkpointDate("2026-08-08", "before_due_3_days"), "2026-08-05");
  assert.equal(checkpointDate("2026-08-08", "due_today"), "2026-08-08");
  assert.equal(checkpointDate("2026-08-08", "overdue_3_days"), "2026-08-11");
  assert.equal(checkpointDate("2026-08-08", "overdue_7_days"), "2026-08-15");
  assert.equal(checkpointDate("2026-08-08", "overdue_14_days"), "2026-08-22");
  // Month and year boundaries, since the offsets are added to a real date.
  assert.equal(checkpointDate("2026-12-28", "overdue_7_days"), "2027-01-04");
});

test("the next real checkpoint is shown, with its date and distance", () => {
  const items = buildUpcomingItems({
    ...EMPTY,
    invoices: [invoice({ due_date: day(-1), reminder_schedules: ["overdue_3_days"] })],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].date, day(2));
  assert.equal(items[0].daysAway, 2);
  assert.equal(items[0].schedule, "overdue_3_days");
  assert.equal(items[0].description, "3-day overdue reminder");
});

// ── The four ways it could become a lie ────────────────────────────────────

test("a paid invoice is never forecast, whatever remains on its schedule", () => {
  const items = buildUpcomingItems({
    ...EMPTY,
    invoices: [invoice({ status: "paid", paid_at: NOW.toISOString(), due_date: day(-1) })],
  });
  assert.deepEqual(items, [], "marking paid stops the cron, so it must stop the forecast");
});

test("an invoice the cron cannot email is never forecast", () => {
  // The cron rejects these with the same expression and skips the invoice
  // every single day — a date here would never be honoured.
  for (const email of ["", "not-an-email", "missing@domain", null]) {
    const items = buildUpcomingItems({
      ...EMPTY,
      invoices: [invoice({ customer_email: email as string, due_date: day(-1) })],
    });
    assert.deepEqual(items, [], `customer_email ${JSON.stringify(email)}`);
  }
});

test("only checkpoints the owner actually chose are forecast", () => {
  const items = buildUpcomingItems({
    ...EMPTY,
    invoices: [invoice({ due_date: day(-1), reminder_schedules: ["overdue_14_days"] })],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].schedule, "overdue_14_days", "overdue_3_days was not selected");
  assert.equal(items[0].date, day(13));
});

test("a checkpoint that already has a reminder row is not forecast again", () => {
  const base = { ...EMPTY, invoices: [invoice({ due_date: day(-1) })] };

  // Pending: the reminder exists and is waiting in Needs your attention.
  const pending = buildUpcomingItems({ ...base, pendingReminders: [reminder({ schedule: "overdue_3_days" })] });
  assert.equal(pending[0].schedule, "overdue_7_days", "skips to a genuinely LATER checkpoint");

  // History: sent, dismissed, failed — the cron's duplicate check does not
  // care which, and neither does this.
  for (const status of ["sent", "dismissed", "failed", "undelivered"]) {
    const done = buildUpcomingItems({
      ...base,
      reminderHistory: [reminder({ schedule: "overdue_3_days", status: status as ReminderLog["status"] })],
    });
    assert.equal(done[0].schedule, "overdue_7_days", status);
  }

  // And reminders_sent on the invoice itself.
  const sent = buildUpcomingItems({
    ...EMPTY,
    invoices: [invoice({ due_date: day(-1), reminders_sent: ["overdue_3_days"] })],
  });
  assert.equal(sent[0].schedule, "overdue_7_days");
});

// ── No overlap with the current action ─────────────────────────────────────

test("Coming up never repeats the job already sitting in Needs your attention", () => {
  // The exact case the two sections could collide on: a reminder is prepared
  // and waiting for review right now.
  const items = buildUpcomingItems({
    ...EMPTY,
    invoices: [invoice({ due_date: day(-3) })],
    pendingReminders: [reminder({ schedule: "overdue_3_days" })],
  });

  assert.equal(items.length, 1);
  assert.notEqual(items[0].schedule, "overdue_3_days", "that one is a current action, not a future one");
  assert.equal(items[0].schedule, "overdue_7_days");
  assert.ok(items[0].daysAway > 0);
});

test("an invoice contributes at most one row", () => {
  const items = buildUpcomingItems({
    ...EMPTY,
    invoices: [invoice({ due_date: day(-1) })], // three future checkpoints remain
  });
  assert.equal(items.length, 1, "the next one only — this is a glance, not a schedule audit");
  assert.equal(items[0].schedule, "overdue_3_days");
});

// ── Only the future, and only when there is one ────────────────────────────

test("a checkpoint dated today disappears once the run has fired", () => {
  // NOW is 13:00 London (BST) — well past the 09:00 run.
  const today = buildUpcomingItems({
    ...EMPTY,
    invoices: [invoice({ due_date: day(0), reminder_schedules: ["due_today"] })],
  });
  assert.deepEqual(today, [], "it belongs to Needs your attention now");
});

test("the past is never 'coming up', at any hour of the day", () => {
  // A missed checkpoint is not a promise — "Prepare reminder" covers it.
  const invoices = [invoice({ due_date: day(-30), reminder_schedules: ["overdue_3_days"] })];
  assert.deepEqual(buildUpcomingItems({ ...EMPTY, invoices }), []);

  // Including in the window BEFORE today's run, where a checkpoint from weeks
  // ago must not be reported as "not yet processed".
  for (const iso of ["2026-08-10T23:30:00Z", "2026-08-11T06:00:00Z", "2026-08-11T07:59:59Z"]) {
    assert.deepEqual(buildUpcomingItems({ ...EMPTY, invoices, now: new Date(iso) }), [], iso);
  }
});

// ── The timezone boundary ──────────────────────────────────────────────────
//
// The run is at 08:00 UTC: 09:00 London under BST, 08:00 under GMT. A
// checkpoint falling today is STILL UPCOMING until that instant. The previous
// date-only check hid it from London midnight, so a reminder due in a few
// hours vanished from the page for most of the morning.

test("[BST] a checkpoint due today is shown before the run and hidden after it", () => {
  // Due 8 Aug + 3 days = 11 Aug 2026, which is BST.
  const invoices = [invoice({ due_date: "2026-08-08", reminder_schedules: ["overdue_3_days"] })];

  // 00:30 London on the 11th — the worst case for the old check. It is
  // already "today" in London, and the run is eight and a half hours away.
  const justAfterMidnight = buildUpcomingItems({
    ...EMPTY, invoices, now: new Date("2026-08-10T23:30:00Z"),
  });
  assert.equal(justAfterMidnight.length, 1, "still upcoming — the run has not happened");
  assert.equal(justAfterMidnight[0].date, "2026-08-11");
  assert.equal(justAfterMidnight[0].daysAway, 0);

  // 08:59 London: one minute before the run, during BST. This is the hour the
  // old implementation could not represent at all.
  const oneMinuteBefore = buildUpcomingItems({
    ...EMPTY, invoices, now: new Date("2026-08-11T07:59:00Z"),
  });
  assert.equal(oneMinuteBefore.length, 1);
  assert.equal(oneMinuteBefore[0].daysAway, 0);

  // 09:00 London exactly — the run is firing.
  const atTheRun = buildUpcomingItems({
    ...EMPTY, invoices, now: new Date("2026-08-11T08:00:00Z"),
  });
  assert.deepEqual(atTheRun, [], "handed over to the run at the boundary, inclusive");

  // 10:30 London.
  const after = buildUpcomingItems({
    ...EMPTY, invoices, now: new Date("2026-08-11T09:30:00Z"),
  });
  assert.deepEqual(after, []);
});

test("[GMT] the same handover, with no BST offset", () => {
  // Due 8 Jan 2027 + 3 days = 11 Jan 2027, which is GMT.
  const invoices = [invoice({ due_date: "2027-01-08", reminder_schedules: ["overdue_3_days"] })];

  const before = buildUpcomingItems({
    ...EMPTY, invoices, now: new Date("2027-01-11T07:30:00Z"), // 07:30 London
  });
  assert.equal(before.length, 1);
  assert.equal(before[0].daysAway, 0);

  const after = buildUpcomingItems({
    ...EMPTY, invoices, now: new Date("2027-01-11T08:30:00Z"), // 08:30 London
  });
  assert.deepEqual(after, []);
});

test("a same-day checkpoint stops showing as soon as its reminder log exists", () => {
  // The handover the other way round: the run fired early, or the row was
  // created manually. `claimed` must win even while the run instant is still
  // in the future, so the two sections can never both show the same job.
  const items = buildUpcomingItems({
    ...EMPTY,
    invoices: [invoice({ due_date: "2026-08-08", reminder_schedules: ["overdue_3_days"] })],
    pendingReminders: [reminder({ schedule: "overdue_3_days" })],
    now: new Date("2026-08-11T06:00:00Z"), // 07:00 London, before the run
  });
  assert.deepEqual(items, [], "the reminder exists — it is a current action, not a forecast");
});

test("tomorrow is upcoming at every hour of today, before and after the run", () => {
  const invoices = [invoice({ due_date: "2026-08-09", reminder_schedules: ["overdue_3_days"] })]; // 12 Aug

  for (const iso of ["2026-08-10T23:10:00Z", "2026-08-11T07:00:00Z", "2026-08-11T08:00:00Z", "2026-08-11T20:00:00Z"]) {
    const items = buildUpcomingItems({ ...EMPTY, invoices, now: new Date(iso) });
    assert.equal(items.length, 1, iso);
    assert.equal(items[0].date, "2026-08-12", iso);
    assert.equal(items[0].daysAway, 1, iso);
  }
});

test("an exhausted schedule produces nothing — no impossible checkpoint after the last step", () => {
  const items = buildUpcomingItems({
    ...EMPTY,
    invoices: [invoice({
      due_date: day(-40),
      reminder_schedules: ["due_today", "overdue_3_days", "overdue_7_days", "overdue_14_days"],
      reminders_sent: ["due_today", "overdue_3_days", "overdue_7_days", "overdue_14_days"],
    })],
  });
  assert.deepEqual(items, [], "there is no checkpoint beyond the last one the owner chose");
});

test("no invoices, no schedules, nothing due — an empty array every time", () => {
  assert.deepEqual(buildUpcomingItems(EMPTY), []);
  assert.deepEqual(
    buildUpcomingItems({ ...EMPTY, invoices: [invoice({ reminder_schedules: [] })] }),
    []
  );
});

// ── Ordering ───────────────────────────────────────────────────────────────

test("rows are chronological, with a stable tie-break", () => {
  const items = buildUpcomingItems({
    ...EMPTY,
    invoices: [
      invoice({ id: "c", customer_name: "Zoe", due_date: day(-1), reminder_schedules: ["overdue_14_days"] }),
      invoice({ id: "a", customer_name: "Alan", due_date: day(-1), reminder_schedules: ["overdue_3_days"] }),
      invoice({ id: "b", customer_name: "Brenda", due_date: day(-1), reminder_schedules: ["overdue_3_days"] }),
    ],
  });

  assert.deepEqual(items.map((i) => i.invoiceId), ["a", "b", "c"]);
  const dates = items.map((i) => i.date);
  assert.deepEqual([...dates].sort(), dates, "already in date order");
});

test("the relative gloss reads naturally from today onwards", () => {
  // 0 is reachable — a checkpoint falling today, before the run has fired.
  assert.equal(upcomingRelative(0), "Later today");
  assert.equal(upcomingRelative(1), "Tomorrow");
  assert.equal(upcomingRelative(2), "In 2 days");
  assert.equal(upcomingRelative(14), "In 14 days");

  // The tell-tale of unconsidered timezone handling.
  assert.equal(/In 0 days/.test(upcomingRelative(0)), false);
});

// ── The section's claim about itself ───────────────────────────────────────

test("[static] Coming up describes preparation for review, never sending", () => {
  const page = readFileSync(join(ROOT, "app/dashboard/page.tsx"), "utf8");
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // The mode-INDEPENDENT half: preparation happens on the date shown whatever
  // the account is set to.
  assert.match(code, /prepares the SMS and email on the date shown/);

  // ── NO PRODUCT-WIDE APPROVAL PROMISE ──────────────────────────────────
  //
  // "Nothing is sent without your approval" was an absolute claim about the
  // whole product. ServiceSignal cannot make it: Manual mode is approval-
  // based, Auto mode is designed to send on its own. Any approval statement
  // must name the mode it applies to.
  assert.equal(/Nothing is sent without your approval/.test(code), false,
    "no product-wide approval promise");
  assert.equal(/Nothing goes out on its own/.test(code), false);

  // The scoped replacement, and it must actually name Manual mode.
  assert.match(code, /In Manual mode, you’ll review each reminder before it sends\./);

  // ── AND IT MUST NOT BRANCH ON THE STORED MODE ─────────────────────────
  //
  // Auto mode is not fully shipped: sending is gated server-side by
  // BETA_APPROVAL_ONLY, which holds even for profile rows already stored as
  // 'auto'. Rendering a different sentence for those rows would imply the
  // stored value changes send behaviour today. It does not.
  //
  // The wording names Manual mode itself, so one unconditional sentence is
  // both simpler and truthful.
  const note = code.slice(code.indexOf("dash-up-note"), code.indexOf("</p>", code.indexOf("dash-up-note")));
  assert.equal(/reminder_mode/.test(note), false,
    "the reassurance sentence must not branch on the stored mode");
  assert.equal(/\?|manualMode/.test(note), false,
    "the sentence must be unconditional");
  for (const overclaim of [/sends? automatically/i, /will send/i, /without asking/i, /Auto mode/i]) {
    assert.equal(overclaim.test(note), false,
      `the note must claim nothing about Auto mode: ${overclaim}`);
  }

  // Auto mode is not live. Nothing may imply a customer gets contacted on a
  // future date on its own.
  for (const banned of [
    /will be sent (on|automatically)/i,
    /sends automatically/i,
    /automatic(ally)? chase/i,
    /we'?ll send/i,
  ]) {
    assert.equal(banned.test(code), false, `banned: ${banned}`);
  }
});

test("[static] SMS and email are named together and equally", () => {
  const upcoming = readFileSync(join(ROOT, "lib/overview-upcoming.ts"), "utf8");
  const page = readFileSync(join(ROOT, "app/dashboard/page.tsx"), "utf8");
  const code = (upcoming + page).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const banned of [/supporting email/i, /SMS-first/i, /primary channel/i, /richer/i]) {
    assert.equal(banned.test(code), false, `banned: ${banned}`);
  }
});

test("[static] Coming up has a SMALL empty state, and it stays small", () => {
  // CHANGED DELIBERATELY. Previously the section rendered nothing at all when
  // empty, on the reasoning that absence beats a box saying nothing. That held
  // while Invoice Status sat below it. With the chart removed, Coming up is
  // the bottom of the page, and silently vanishing ends the Overview
  // mid-thought — while "nothing is scheduled" is genuinely worth knowing when
  // invoices are overdue.
  //
  // So: one line, inside the existing section, no illustration, no CTA.
  const page = readFileSync(join(ROOT, "app/dashboard/page.tsx"), "utf8");
  const code = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.match(code, /visibleUpcoming\.length === 0 \? \(/,
    "the empty branch must exist");
  assert.match(code, /No reminders are scheduled to go out in the next few days\./);

  // Truthful and calm: no celebration, no fake reassurance.
  for (const banned of [/All clear/i, /Nothing to do/i, /you're all set/i, /🎉/]) {
    assert.equal(banned.test(code), false, `banned empty-state copy: ${banned}`);
  }

  // SMALL means one paragraph. The empty branch must not grow a list, a
  // graphic or a call to action.
  const start = code.indexOf("visibleUpcoming.length === 0 ? (");
  const branch = code.slice(start, code.indexOf(") : (", start));
  assert.equal(/<ul|<svg|<Link|<button/.test(branch), false,
    "the empty state must stay a single line of text");
  assert.ok((branch.match(/<p /g) ?? []).length === 1, "exactly one paragraph");
});
