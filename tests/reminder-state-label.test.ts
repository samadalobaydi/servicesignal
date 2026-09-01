import { test } from "node:test";
import assert from "node:assert/strict";
import { reminderStateLabel } from "@/lib/reminder-state-label";
import type { Invoice } from "@/types";

/**
 * The pill/non-pill split IS the rule the removed "Reminder state" column
 * used to render permanently: pill:true states are actionable/abnormal
 * enough to stay on the Active Chasing row; everything else is now normal
 * future scheduling, described only in the expandable history (see
 * tests/invoice-activity.test.ts for that half).
 */

function isoDaysFromToday(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    invoice_reference: null,
    job_description: null,
    customer_name: "Test Customer",
    customer_email: "customer@example.com",
    customer_phone: "07700900000",
    amount: 100,
    due_date: isoDaysFromToday(-7),
    payment_link: "",
    reminder_tone: "friendly",
    reminder_schedules: ["overdue_7_days"],
    status: "overdue",
    created_at: new Date().toISOString(),
    paid_at: null,
    reminders_sent: [],
    escalation_status: "active",
    archived_at: null,
    ...overrides,
  } as Invoice;
}

test("a partial send is a pill, red, and outranks everything else", () => {
  const rs = reminderStateLabel(invoice(), /* hasPending */ true, /* allowanceSpent */ false, "Email sent · SMS failed");
  assert.equal(rs.pill, true);
  assert.equal(rs.tone, "red");
  assert.equal(rs.text, "Partially sent");
  assert.equal(rs.detail, "Email sent · SMS failed");
});

test("a pending reminder is a pill, amber, 'Ready for review'", () => {
  const rs = reminderStateLabel(invoice(), true, false, null);
  assert.equal(rs.pill, true);
  assert.equal(rs.tone, "amber");
  assert.equal(rs.text, "Ready for review");
});

test("no reminder schedules selected is NOT a pill", () => {
  const rs = reminderStateLabel(invoice({ reminder_schedules: [] }), false, false, null);
  assert.equal(rs.pill, undefined);
  assert.equal(rs.text, "No reminders set");
});

test("allowance exhausted with an otherwise-preparable reminder is a pill, slate", () => {
  const rs = reminderStateLabel(
    invoice({ reminder_schedules: ["overdue_7_days"], due_date: isoDaysFromToday(-7) }),
    false,
    /* allowanceSpent */ true,
    null
  );
  assert.equal(rs.pill, true);
  assert.equal(rs.tone, "slate");
  assert.equal(rs.text, "Reminder limit reached");
});

test("a preparable reminder with nothing sent yet is NOT a pill — normal scheduling", () => {
  const rs = reminderStateLabel(
    invoice({ reminder_schedules: ["overdue_7_days"], due_date: isoDaysFromToday(-7), reminders_sent: [] }),
    false,
    false,
    null
  );
  assert.equal(rs.pill, undefined);
  assert.equal(rs.text, "Ready to chase");
});

test("a preparable reminder with some already sent is NOT a pill — normal scheduling", () => {
  const rs = reminderStateLabel(
    invoice({
      reminder_schedules: ["before_due_3_days", "overdue_7_days"],
      due_date: isoDaysFromToday(-7),
      reminders_sent: ["before_due_3_days"],
    }),
    false,
    false,
    null
  );
  assert.equal(rs.pill, undefined);
  assert.equal(rs.text, "1 of 2 reminders sent");
});

test("not yet due is NOT a pill — normal scheduling, names when it becomes available", () => {
  const rs = reminderStateLabel(
    invoice({ reminder_schedules: ["overdue_7_days"], due_date: isoDaysFromToday(2), reminders_sent: [] }),
    false,
    false,
    null
  );
  assert.equal(rs.pill, undefined);
  assert.match(rs.text, /^First reminder from /);
});

test("every schedule already sent is NOT a pill — normal scheduling", () => {
  const rs = reminderStateLabel(
    invoice({ reminder_schedules: ["overdue_7_days"], due_date: isoDaysFromToday(-7), reminders_sent: ["overdue_7_days"] }),
    false,
    false,
    null
  );
  assert.equal(rs.pill, undefined);
  assert.equal(rs.text, "All reminders sent");
});

test("exactly the three actionable states are pills — nothing else is", () => {
  const pillTexts = new Set(["Partially sent", "Ready for review", "Reminder limit reached"]);

  const cases: Array<[ReturnType<typeof reminderStateLabel>, boolean]> = [
    [reminderStateLabel(invoice(), true, false, "x"), true],
    [reminderStateLabel(invoice(), true, false, null), true],
    [reminderStateLabel(invoice({ reminder_schedules: [] }), false, false, null), false],
    [
      reminderStateLabel(invoice({ due_date: isoDaysFromToday(-7) }), false, true, null),
      true,
    ],
    [
      reminderStateLabel(invoice({ due_date: isoDaysFromToday(-7), reminders_sent: [] }), false, false, null),
      false,
    ],
    [
      reminderStateLabel(invoice({ due_date: isoDaysFromToday(-7), reminders_sent: ["overdue_7_days"] }), false, false, null),
      false,
    ],
    [
      reminderStateLabel(invoice({ due_date: isoDaysFromToday(2) }), false, false, null),
      false,
    ],
  ];

  for (const [rs, expectedPill] of cases) {
    assert.equal(Boolean(rs.pill), expectedPill, `"${rs.text}" pill=${rs.pill} expected ${expectedPill}`);
    if (rs.pill) assert.ok(pillTexts.has(rs.text), `unexpected pill text: ${rs.text}`);
  }
});
