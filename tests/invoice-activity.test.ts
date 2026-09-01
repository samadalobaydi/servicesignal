import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvoiceActivityEntries } from "@/lib/invoice-activity";
import type { Invoice, ReminderLog } from "@/types";

/**
 * lib/invoice-activity.ts is the pure logic behind the expanded Invoice
 * History panel — pulled out of InvoiceActivityLog.tsx specifically so the
 * defect a real Stage B run found ("Email reminder sent" shown for a
 * reminder that dispatched BOTH SMS and email) is provable without a
 * browser.
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
    created_at: "2026-08-01T09:00:00.000Z",
    paid_at: null,
    reminders_sent: [],
    escalation_status: "active",
    archived_at: null,
    ...overrides,
  } as Invoice;
}

function reminder(overrides: Partial<ReminderLog> = {}): ReminderLog {
  return {
    id: "rem-1",
    invoice_id: "inv-1",
    user_id: "user-1",
    schedule: "overdue_7_days",
    status: "sent",
    email_to: "customer@example.com",
    subject: "Reminder",
    created_at: "2026-08-05T09:00:00.000Z",
    sent_at: "2026-08-05T09:05:00.000Z",
    ...overrides,
  } as ReminderLog;
}

test("a clean two-channel send is described as the pair, not just email", () => {
  const entries = buildInvoiceActivityEntries({
    invoice: invoice(),
    pendingForInvoice: [],
    historyForInvoice: [reminder({ id: "rem-1", status: "sent" })],
    channelStatuses: { "rem-1": { email: "sent", sms: "sent" } },
  });
  const sent = entries.find((e) => e.key === "sent-rem-1");
  assert.ok(sent);
  assert.equal(sent!.label, "SMS and email reminder sent");
  assert.equal(sent!.color, "var(--dash-green)");
});

test("a legacy email-only reminder (no SMS channel row) still says email only", () => {
  const entries = buildInvoiceActivityEntries({
    invoice: invoice(),
    pendingForInvoice: [],
    historyForInvoice: [reminder({ id: "rem-1", status: "sent" })],
    channelStatuses: { "rem-1": { email: "sent" } },
  });
  const sent = entries.find((e) => e.key === "sent-rem-1");
  assert.equal(sent!.label, "Email reminder sent");
});

test("a partial send is described truthfully, reusing the shared summary", () => {
  const entries = buildInvoiceActivityEntries({
    invoice: invoice(),
    pendingForInvoice: [],
    historyForInvoice: [reminder({ id: "rem-1", status: "sent" })],
    channelStatuses: { "rem-1": { email: "sent", sms: "failed" } },
  });
  const sent = entries.find((e) => e.key === "sent-rem-1");
  assert.equal(sent!.label, "Email sent · SMS failed");
  assert.equal(sent!.color, "var(--dash-red)");
});

test("the mirror partial case (SMS through, email failed) is also truthful", () => {
  const entries = buildInvoiceActivityEntries({
    invoice: invoice(),
    pendingForInvoice: [],
    historyForInvoice: [reminder({ id: "rem-1", status: "sent" })],
    channelStatuses: { "rem-1": { email: "failed", sms: "sent" } },
  });
  const sent = entries.find((e) => e.key === "sent-rem-1");
  // partialSendSummary() always names email first, then sms — the order is
  // fixed regardless of which channel actually succeeded (see
  // lib/reminder-aggregate.ts). Reused verbatim, not reinvented here.
  assert.equal(sent!.label, "Email failed · SMS sent");
});

test("a fully failed pair says both channels failed", () => {
  const entries = buildInvoiceActivityEntries({
    invoice: invoice(),
    pendingForInvoice: [],
    historyForInvoice: [reminder({ id: "rem-1", status: "failed" })],
    channelStatuses: { "rem-1": { email: "failed", sms: "failed" } },
  });
  const failed = entries.find((e) => e.key === "fail-rem-1");
  assert.equal(failed!.label, "SMS and email reminder failed to send");
});

test("a legacy failed reminder (no SMS row) keeps the email-only wording", () => {
  const entries = buildInvoiceActivityEntries({
    invoice: invoice(),
    pendingForInvoice: [],
    historyForInvoice: [reminder({ id: "rem-1", status: "failed" })],
    channelStatuses: { "rem-1": { email: "failed" } },
  });
  const failed = entries.find((e) => e.key === "fail-rem-1");
  assert.equal(failed!.label, "Email reminder failed to send");
});

test("a prepared (pending) reminder is described as the pair when SMS was prepared", () => {
  const entries = buildInvoiceActivityEntries({
    invoice: invoice(),
    pendingForInvoice: [reminder({ id: "rem-2", status: "pending" })],
    historyForInvoice: [],
    channelStatuses: { "rem-2": { email: "pending", sms: "pending" } },
  });
  const prepared = entries.find((e) => e.key === "prep-rem-2");
  assert.equal(prepared!.label, "SMS and email reminder prepared");
});

test("dismissed reminders are unaffected — channel-agnostic wording", () => {
  const entries = buildInvoiceActivityEntries({
    invoice: invoice(),
    pendingForInvoice: [],
    historyForInvoice: [reminder({ id: "rem-1", status: "dismissed" })],
    channelStatuses: {},
  });
  const dismissed = entries.find((e) => e.key === "dis-rem-1");
  assert.equal(dismissed!.label, "Reminder dismissed");
});

// ── "Next reminder scheduled" — the replacement for the removed column ─────

test("names the next checkpoint when nothing is pending and one remains", () => {
  const entries = buildInvoiceActivityEntries({
    invoice: invoice({
      reminder_schedules: ["overdue_7_days", "overdue_14_days"],
      due_date: isoDaysFromToday(-7),
      reminders_sent: ["overdue_7_days"],
    }),
    pendingForInvoice: [],
    historyForInvoice: [],
    channelStatuses: {},
    now: new Date(isoDaysFromToday(0)),
  });
  const next = entries.find((e) => e.key === "next");
  assert.ok(next, "expected a next-reminder entry");
  assert.match(next!.label, /^Next reminder scheduled — /);
});

test("does NOT show a next-reminder line while a reminder is already pending", () => {
  const entries = buildInvoiceActivityEntries({
    invoice: invoice({
      reminder_schedules: ["overdue_7_days", "overdue_14_days"],
      due_date: isoDaysFromToday(-7),
      reminders_sent: [],
    }),
    pendingForInvoice: [reminder({ id: "rem-2", status: "pending" })],
    historyForInvoice: [],
    channelStatuses: {},
  });
  assert.equal(entries.find((e) => e.key === "next"), undefined);
});

test("does NOT show a next-reminder line once every selected schedule has sent", () => {
  const entries = buildInvoiceActivityEntries({
    invoice: invoice({
      reminder_schedules: ["overdue_7_days"],
      due_date: isoDaysFromToday(-7),
      reminders_sent: ["overdue_7_days"],
    }),
    pendingForInvoice: [],
    historyForInvoice: [],
    channelStatuses: {},
  });
  assert.equal(entries.find((e) => e.key === "next"), undefined);
});

test("the next-reminder line is flagged dateOnly — eligibleFrom is a bare date, not a real send time", () => {
  const entries = buildInvoiceActivityEntries({
    invoice: invoice({
      reminder_schedules: ["overdue_7_days", "overdue_14_days"],
      due_date: isoDaysFromToday(-7),
      reminders_sent: ["overdue_7_days"],
    }),
    pendingForInvoice: [],
    historyForInvoice: [],
    channelStatuses: {},
    now: new Date(isoDaysFromToday(0)),
  });
  const next = entries.find((e) => e.key === "next");
  assert.equal(next!.dateOnly, true,
    "eligibleFrom is a bare YYYY-MM-DD; formatWhen() must not print a fabricated time-of-day for it");
});

test("sent/failed/prepared/dismissed history entries are NOT dateOnly — they carry a real timestamp", () => {
  const entries = buildInvoiceActivityEntries({
    invoice: invoice(),
    pendingForInvoice: [],
    historyForInvoice: [reminder({ id: "rem-1", status: "sent" })],
    channelStatuses: { "rem-1": { email: "sent", sms: "sent" } },
  });
  const sent = entries.find((e) => e.key === "sent-rem-1");
  assert.notEqual(sent!.dateOnly, true);
});

test("entries sort newest-first, and a future next-reminder line sorts above past history", () => {
  const entries = buildInvoiceActivityEntries({
    invoice: invoice({
      reminder_schedules: ["overdue_7_days", "overdue_14_days"],
      due_date: isoDaysFromToday(-7),
      reminders_sent: ["overdue_7_days"],
      created_at: "2026-08-01T09:00:00.000Z",
    }),
    pendingForInvoice: [],
    historyForInvoice: [reminder({ id: "rem-1", status: "sent", sent_at: "2026-08-05T09:00:00.000Z" })],
    channelStatuses: { "rem-1": { email: "sent", sms: "sent" } },
  });
  assert.equal(entries[0].key, "next", "the future checkpoint must sort above past history");
});
