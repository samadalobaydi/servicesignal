import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  buildAttentionItems,
  attentionDescription,
  attentionTone,
} from "@/lib/overview-attention";
import type { Invoice, ReminderLog } from "@/types";

/**
 * Overview — "Needs your attention".
 *
 * THE DEFECT THESE EXIST FOR: the old page built its list from three
 * independent counts (needs-decision, reminders-awaiting-approval, overdue), so
 * one overdue invoice with a prepared reminder produced two bullets pointing at
 * the same page for the same job. Every test below therefore asserts on the
 * TOTAL number of items as well as their content — a test that only checked
 * "the reminder item is present" would have passed against the broken version.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const NOW = new Date("2026-08-08T12:00:00Z");

function daysAgo(n: number): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - n);
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
    due_date: daysAgo(12),
    payment_link: "",
    reminder_tone: "firm",
    reminder_schedules: ["due_today", "overdue_3_days", "overdue_7_days"],
    status: "overdue",
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
    schedule: "overdue_7_days",
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

const EMPTY = { invoices: [], pendingReminders: [], reminderHistory: [], needsDecisionInvoiceIds: new Set<string>(), now: NOW };

// ── The duplication defect ─────────────────────────────────────────────────

test("an overdue invoice with a prepared reminder is ONE item, not two", () => {
  const items = buildAttentionItems({
    ...EMPTY,
    invoices: [invoice()],
    pendingReminders: [reminder()],
  });

  assert.equal(items.length, 1, "the old page produced two rows for this exact case");
  assert.equal(items[0].kind, "reminder_ready");
  assert.equal(items[0].invoiceId, "inv-1");
  // Approving the prepared reminder IS the chase, so "also chase this" must
  // not appear alongside it.
  assert.equal(items.some((i) => i.kind === "overdue_no_reminder"), false);
});

test("no invoice can ever produce more than one item", () => {
  // Everything true at once: overdue, needs a decision, has a pending reminder,
  // and has a failed send in its history.
  const items = buildAttentionItems({
    invoices: [invoice()],
    pendingReminders: [reminder()],
    reminderHistory: [reminder({ id: "rem-old", status: "failed" })],
    needsDecisionInvoiceIds: new Set(["inv-1"]),
    now: NOW,
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "send_failed", "the most urgent state wins");
  const ids = items.map((i) => i.invoiceId);
  assert.equal(new Set(ids).size, ids.length, "invoice ids must be unique");
});

// ── Precedence ─────────────────────────────────────────────────────────────

test("precedence: failed > ready > decision > overdue", () => {
  const cases: Array<[string, Parameters<typeof buildAttentionItems>[0], string]> = [
    ["failed beats ready", {
      ...EMPTY, invoices: [invoice()], pendingReminders: [reminder()],
      reminderHistory: [reminder({ id: "r2", status: "delivery_unknown" })],
    }, "send_failed"],
    ["ready beats decision", {
      ...EMPTY, invoices: [invoice()], pendingReminders: [reminder()],
      needsDecisionInvoiceIds: new Set(["inv-1"]),
    }, "reminder_ready"],
    ["decision beats overdue", {
      ...EMPTY, invoices: [invoice()], needsDecisionInvoiceIds: new Set(["inv-1"]),
    }, "needs_decision"],
    ["overdue is the fallback", { ...EMPTY, invoices: [invoice()] }, "overdue_no_reminder"],
  ];

  for (const [label, input, expected] of cases) {
    const items = buildAttentionItems({ ...input, now: NOW });
    assert.equal(items.length, 1, label);
    assert.equal(items[0].kind, expected, label);
  }
});

test("every unresolved send state counts as needing resolution", () => {
  for (const status of ["failed", "delivery_unknown", "undelivered"]) {
    const items = buildAttentionItems({
      ...EMPTY,
      invoices: [invoice()],
      reminderHistory: [reminder({ status: status as ReminderLog["status"] })],
    });
    assert.equal(items[0].kind, "send_failed", status);
  }

  // A cleanly sent or dismissed reminder is NOT an outstanding job.
  for (const status of ["sent", "dismissed"]) {
    const items = buildAttentionItems({
      ...EMPTY,
      invoices: [invoice({ reminders_sent: ["due_today", "overdue_3_days", "overdue_7_days"] })],
      reminderHistory: [reminder({ status: status as ReminderLog["status"] })],
    });
    assert.equal(items.length, 0, `${status} must not raise an attention item`);
  }
});

// ── Exclusions ─────────────────────────────────────────────────────────────

test("a paid invoice never appears, whatever is attached to it", () => {
  const items = buildAttentionItems({
    invoices: [invoice({ status: "paid", paid_at: NOW.toISOString() })],
    pendingReminders: [reminder()],
    reminderHistory: [reminder({ id: "r2", status: "failed" })],
    needsDecisionInvoiceIds: new Set(["inv-1"]),
    now: NOW,
  });
  assert.deepEqual(items, [], "marking paid is the kill switch for the whole lifecycle");
});

test("an invoice that is not yet overdue raises nothing", () => {
  const future = new Date(NOW);
  future.setUTCDate(future.getUTCDate() + 10);
  const items = buildAttentionItems({
    ...EMPTY,
    invoices: [invoice({ due_date: future.toISOString().slice(0, 10), status: "unpaid" })],
  });
  assert.equal(items.length, 0, "nothing is owed of the owner yet");
});

test("'Prepare reminder' is only offered when a checkpoint has actually been reached", () => {
  // One day overdue, but the only configured checkpoint is 14 days — the
  // server would refuse to prepare, so the button must not be offered.
  const items = buildAttentionItems({
    ...EMPTY,
    invoices: [invoice({ due_date: daysAgo(1), reminder_schedules: ["overdue_14_days"] })],
  });
  assert.equal(items.length, 0, "a button the server would refuse is worse than none");

  // Past the checkpoint, it appears.
  const reached = buildAttentionItems({
    ...EMPTY,
    invoices: [invoice({ due_date: daysAgo(15), reminder_schedules: ["overdue_14_days"] })],
  });
  assert.equal(reached[0].kind, "overdue_no_reminder");
});

// ── Ordering and deep links ────────────────────────────────────────────────

test("the most urgent, most overdue, most valuable rises to the top", () => {
  const items = buildAttentionItems({
    ...EMPTY,
    invoices: [
      invoice({ id: "a", due_date: daysAgo(8), amount: 100 }),
      invoice({ id: "b", due_date: daysAgo(30), amount: 100 }),
      invoice({ id: "c", due_date: daysAgo(30), amount: 5000 }),
      invoice({ id: "d", due_date: daysAgo(9), amount: 100 }),
    ],
    pendingReminders: [reminder({ id: "rem-d", invoice_id: "d" })],
  });

  assert.equal(items[0].invoiceId, "d", "a ready reminder outranks any overdue invoice");
  assert.equal(items[1].invoiceId, "c", "then most overdue, breaking ties on amount");
  assert.equal(items[2].invoiceId, "b");
  assert.equal(items[3].invoiceId, "a");
});

test("each action deep-links to the right destination and names a real verb", () => {
  const ready = buildAttentionItems({ ...EMPTY, invoices: [invoice()], pendingReminders: [reminder({ id: "rem-9" })] })[0];
  assert.equal(ready.href, "/dashboard/reminders/rem-9/review", "straight to the reminder, not the list");
  assert.equal(ready.actionLabel, "Review reminders");

  const failed = buildAttentionItems({ ...EMPTY, invoices: [invoice()], reminderHistory: [reminder({ id: "rem-x", status: "failed" })] })[0];
  assert.equal(failed.href, "/dashboard/reminders/rem-x/review");
  assert.equal(failed.actionLabel, "Resolve issue");

  const decision = buildAttentionItems({ ...EMPTY, invoices: [invoice()], needsDecisionInvoiceIds: new Set(["inv-1"]) })[0];
  assert.equal(decision.href, "/dashboard/needs-action");

  const overdue = buildAttentionItems({ ...EMPTY, invoices: [invoice()] })[0];
  assert.equal(overdue.actionLabel, "Prepare reminder");

  // No vague verbs anywhere.
  for (const label of [ready, failed, decision, overdue].map((i) => i.actionLabel)) {
    assert.equal(/^(View|Manage|Open)$/.test(label), false, `"${label}" is too vague`);
  }
});

// ── Copy truthfulness ──────────────────────────────────────────────────────

test("descriptions treat SMS and email equally and never claim delivery", () => {
  const ready = buildAttentionItems({ ...EMPTY, invoices: [invoice()], pendingReminders: [reminder()] })[0];
  const text = attentionDescription(ready);

  assert.match(text, /SMS and email/);
  assert.equal(/supporting|primary|richer/i.test(text), false);
  // Prepared, not sent.
  assert.equal(/\bsent\b|delivered/i.test(text), false);
});

test("the description no longer repeats the day count carried by urgencyLabel", () => {
  const one = buildAttentionItems({ ...EMPTY, invoices: [invoice({ due_date: daysAgo(1), reminder_schedules: ["due_today"] })] })[0];
  assert.equal(attentionDescription(one), "No reminder prepared yet");
  assert.equal(/\d/.test(attentionDescription(one)), false, "no number here — it belongs to the meta line");
});

// ── Urgency: derived live, never fabricated ────────────────────────────────

test("overdue age counts days correctly, singular and plural", () => {
  const one = buildAttentionItems({ ...EMPTY, invoices: [invoice({ due_date: daysAgo(1), reminder_schedules: ["due_today"] })] })[0];
  assert.equal(one.urgencyLabel, "1 day overdue");
  assert.equal(one.daysOverdue, 1);

  const many = buildAttentionItems({ ...EMPTY, invoices: [invoice({ due_date: daysAgo(12) })] })[0];
  assert.equal(many.urgencyLabel, "12 days overdue");
  assert.equal(many.daysOverdue, 12);
});

test("overdue age comes from the due date, not from the reminder or the schedule name", () => {
  // The reminder says "overdue_7_days" but the invoice is 40 days past due.
  // The label must follow the calendar, not the checkpoint it was filed under.
  const item = buildAttentionItems({
    ...EMPTY,
    invoices: [invoice({ due_date: daysAgo(40) })],
    pendingReminders: [reminder({ schedule: "overdue_7_days" })],
  })[0];
  assert.equal(item.kind, "reminder_ready");
  assert.equal(item.urgencyLabel, "40 days overdue");
});

test("a not-yet-overdue item never invents an overdue label", () => {
  const future = new Date(NOW);
  future.setUTCDate(future.getUTCDate() + 3);

  // A prepared reminder on an invoice that is not yet due — the
  // before_due_3_days checkpoint. Real, and not overdue.
  const item = buildAttentionItems({
    ...EMPTY,
    invoices: [invoice({ due_date: future.toISOString().slice(0, 10), status: "unpaid" })],
    pendingReminders: [reminder({ schedule: "before_due_3_days" })],
  })[0];

  assert.equal(item.kind, "reminder_ready");
  assert.equal(item.urgencyLabel, null, "silence, not '0 days overdue'");
  assert.equal(item.daysOverdue, 0);
});

test("an invoice due today says so rather than saying nothing", () => {
  const item = buildAttentionItems({
    ...EMPTY,
    invoices: [invoice({ due_date: NOW.toISOString().slice(0, 10), status: "unpaid" })],
    pendingReminders: [reminder({ schedule: "due_today" })],
  })[0];
  assert.equal(item.urgencyLabel, "Due today");
  assert.equal(/overdue/i.test(item.urgencyLabel!), false);
});

test("every state has a tone AND a distinct word, so colour is never the only signal", () => {
  const kinds = ["send_failed", "reminder_ready", "needs_decision", "overdue_no_reminder"] as const;
  for (const k of kinds) {
    assert.ok(["red", "amber", "blue"].includes(attentionTone(k)), k);
  }

  const page = readFileSync(join(ROOT, "app/dashboard/page.tsx"), "utf8");
  const labels = page.match(/KIND_LABEL: Record<AttentionItem\["kind"\], string> = \{([\s\S]*?)\}/);
  assert.ok(labels, "the page maps every kind to a visible word");
  for (const k of kinds) assert.match(labels![1], new RegExp(k));
});

// ── The page itself ────────────────────────────────────────────────────────

test("[static] the duplicated navigation cards are gone", () => {
  const page = readFileSync(join(ROOT, "app/dashboard/page.tsx"), "utf8");
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.equal(/quickNav/.test(code), false, "the four sidebar-duplicating cards must be removed");
  assert.equal(/Business & reminders/.test(code), false, "the Settings card is gone");
  // And nothing was added back in their place.
  assert.equal(/lg:grid-cols-4/.test(code), false, "no replacement four-card row");
});

test("[static] the old overlapping counts no longer drive the attention list", () => {
  const page = readFileSync(join(ROOT, "app/dashboard/page.tsx"), "utf8");
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.equal(/priorities/.test(code), false);
  assert.equal(/overdue invoices to chase/.test(code), false);
  assert.match(code, /buildAttentionItems/);
});

test("[static] no Overview copy claims ServiceSignal collects money", () => {
  const stats = readFileSync(join(ROOT, "components/dashboard/StatsCards.tsx"), "utf8");
  const page = readFileSync(join(ROOT, "app/dashboard/page.tsx"), "utf8");
  const code = (stats + page).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.equal(/collected so far/.test(code), false);
  assert.equal(/we (collected|received|detected)/i.test(code), false);
  for (const banned of [/Collected this month/i, /Received this month/i, /Payments received/i]) {
    assert.equal(banned.test(code), false, `banned: ${banned}`);
  }
  // The heading is the metric; the supporting line names who recorded it.
  assert.match(code, /label="Paid this month"/);
  assert.match(code, /sub="marked paid by you"/);
});

test("[static] the KPI slot no longer changes identity with the data", () => {
  const stats = readFileSync(join(ROOT, "components/dashboard/StatsCards.tsx"), "utf8");
  const code = stats.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // The old ternary swapped card three between two different metrics.
  assert.equal(/needsActionCount > 0 \?/.test(code), false);
  assert.equal(/Reminders Set/.test(code), false, "a count of configured checkpoints is not a KPI");
  assert.match(code, /label="Awaiting approval"/);
});

test("[static] Recent activity is gone from Overview, and was not backfilled", () => {
  const page = readFileSync(join(ROOT, "app/dashboard/page.tsx"), "utf8");
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.equal(/Recent activity/.test(code), false);
  assert.equal(/recentActivity|ActivityItem|actionTypeLabel/.test(code), false);
  // Nothing decorative moved into the space it left.
  for (const filler of [/Tips/, /Insights/, /Welcome back/, /Quick links/, /Trend/]) {
    assert.equal(filler.test(code), false, `filler: ${filler}`);
  }
});

test("[static] the activity architecture itself is untouched — this was a page decision", () => {
  // Removing a section from one page must not delete the data layer other
  // pages read from.
  const escalation = readFileSync(join(ROOT, "lib/escalation.ts"), "utf8");
  assert.match(escalation, /export function actionTypeLabel/);
  assert.match(escalation, /export function actionTypeColor/);

  const provider = readFileSync(join(ROOT, "components/dashboard/DashboardProvider.tsx"), "utf8");
  assert.match(provider, /latestActionMap/);
});

test("[static] the subtitle no longer announces the name of a section below it", () => {
  const page = readFileSync(join(ROOT, "app/dashboard/page.tsx"), "utf8");
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.equal(/Here&apos;s what needs your attention today/.test(code), false);
  assert.match(code, /Your invoices and reminders at a glance\./);
  // The section keeps its own heading, which is now the only place the phrase
  // appears.
  assert.match(code, /Needs your attention/);
});
