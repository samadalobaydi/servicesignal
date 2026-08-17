import { test } from "node:test";
import assert from "node:assert/strict";

import { planFromDueDate, describePlan, describeScheduleFromDueDate } from "@/lib/onboarding-schedule";
import { scheduleToPrepare, todaysSchedule } from "@/lib/reminder-schedule";
import type { ReminderSchedule } from "@/types";

/**
 * Onboarding schedule description.
 *
 * The first two tests are the ones that matter: they pin the description to the
 * REAL scheduler rather than to a hand-written expectation, so the sentence on
 * screen cannot drift away from what the product does.
 */

const STANDARD: ReminderSchedule[] = ["due_today", "overdue_3_days", "overdue_7_days"];
const TODAY = new Date("2026-08-07T12:00:00Z");

/** A due date exactly N days before TODAY. */
function overdueBy(days: number): string {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

test("the described 'now' reminder is exactly what the scheduler will prepare", () => {
  for (const days of [1, 2, 3, 4, 7, 8, 12, 30]) {
    const due = overdueBy(days);
    const plan = planFromDueDate(STANDARD, due, TODAY);
    assert.equal(
      plan.now,
      scheduleToPrepare(STANDARD, [], due, TODAY),
      `${days} days overdue: description must match scheduleToPrepare`
    );
  }
});

test("every 'later' checkpoint is one the cron can genuinely still fire", () => {
  // The cron matches an EXACT day count, so a checkpoint only fires if a future
  // day exists where todaysSchedule() returns it.
  for (const days of [1, 4, 12]) {
    const due = overdueBy(days);
    const plan = planFromDueDate(STANDARD, due, TODAY);

    for (const later of plan.later) {
      let willFire = false;
      for (let ahead = 1; ahead <= 40; ahead++) {
        const future = new Date(TODAY);
        future.setUTCDate(future.getUTCDate() + ahead);
        if (todaysSchedule(due, future) === later) { willFire = true; break; }
      }
      assert.ok(willFire, `${days} days overdue: promised "${later}" must actually fire`);
    }

    // And a missed checkpoint must never be promised.
    for (const missed of plan.missed) {
      assert.ok(!plan.later.includes(missed));
    }
  }
});

test("1 day overdue — due-date reminder now, two still to come", () => {
  const plan = planFromDueDate(STANDARD, overdueBy(1), TODAY);
  assert.equal(plan.now, "due_today");
  assert.deepEqual(plan.later, ["overdue_3_days", "overdue_7_days"]);
  assert.deepEqual(plan.missed, []);
  assert.equal(
    describePlan(plan),
    "First reminder ready to review now, then at 3 days overdue and 7 days overdue."
  );
});

test("4 days overdue — the due-date checkpoint is gone and is never mentioned", () => {
  const plan = planFromDueDate(STANDARD, overdueBy(4), TODAY);
  assert.equal(plan.now, "overdue_3_days");
  assert.deepEqual(plan.later, ["overdue_7_days"]);
  assert.deepEqual(plan.missed, ["due_today"], "the due-date reminder can no longer happen");

  const text = describePlan(plan);
  assert.equal(text, "First reminder ready to review now, then at 7 days overdue.");
  assert.equal(/due date/.test(text), false, "a passed checkpoint must not be advertised");
});

test("12 days overdue — ONE reminder ever, and the copy says so", () => {
  const plan = planFromDueDate(STANDARD, overdueBy(12), TODAY);
  assert.equal(plan.now, "overdue_7_days");
  assert.deepEqual(plan.later, []);
  assert.deepEqual(plan.missed, ["due_today", "overdue_3_days"]);

  const text = describePlan(plan);
  assert.match(text, /One reminder/);
  assert.match(text, /no later reminders/i);
  // The old shared summary promised three. This must promise exactly one.
  assert.equal(/3 days overdue|the due date/.test(text), false);
});

test("the sentence degrades safely on bad input", () => {
  assert.equal(describeScheduleFromDueDate(STANDARD, "", TODAY), null);
  assert.equal(describeScheduleFromDueDate([], "2026-08-01", TODAY), null);
  assert.equal(describeScheduleFromDueDate(STANDARD, "not-a-date", TODAY), null);
});

test("a not-yet-due invoice is never told a reminder is ready", () => {
  const future = new Date(TODAY);
  future.setUTCDate(future.getUTCDate() + 10);
  const plan = planFromDueDate(STANDARD, future.toISOString().slice(0, 10), TODAY);
  assert.equal(plan.now, null);

  // NOW AN ORDINARY CASE. Onboarding used to reject an invoice that was not
  // already overdue, so this branch was defensive and named only the first
  // checkpoint. A customer can now legitimately join with an invoice due next
  // week, so the sentence has to be the WHOLE forward-looking plan.
  const sentence = describePlan(plan);
  assert.equal(
    sentence,
    "First reminder at the due date, then at 3 days overdue and 7 days overdue."
  );
  // The two claims that would be false.
  assert.equal(/ready to review/i.test(sentence), false);
  assert.equal(/sent/i.test(sentence), false);
});

test("a single remaining checkpoint reads as one sentence, not a list", () => {
  const future = new Date(TODAY);
  future.setUTCDate(future.getUTCDate() + 30);
  const plan = planFromDueDate(["overdue_14_days"], future.toISOString().slice(0, 10), TODAY);
  assert.equal(plan.now, null);
  assert.equal(describePlan(plan), "First reminder at 14 days overdue.");
});
