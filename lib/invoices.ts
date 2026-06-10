import type { Invoice, InvoiceStatus, ReminderSchedule } from "@/types";

// ── Storage key ────────────────────────────────────────────────────────────
const STORAGE_KEY = "ss_invoices";

// ── Persist / load ─────────────────────────────────────────────────────────
export function loadInvoices(): Invoice[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Invoice[]) : seedInvoices();
  } catch {
    return [];
  }
}

export function saveInvoices(invoices: Invoice[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(invoices));
}

// ── Status derivation (called at render time so it stays fresh) ────────────
export function deriveStatus(invoice: Invoice): InvoiceStatus {
  if (invoice.status === "paid") return "paid";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(invoice.due_date);
  due.setHours(0, 0, 0, 0);
  return due < today ? "overdue" : "unpaid";
}

/** Re-derives status for every invoice (call after any mutation) */
export function refreshStatuses(invoices: Invoice[]): Invoice[] {
  return invoices.map((inv) => ({ ...inv, status: deriveStatus(inv) }));
}

// ── Which reminders are "due" for a given invoice ──────────────────────────
export function dueSendSchedules(invoice: Invoice): ReminderSchedule[] {
  if (invoice.status === "paid") return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(invoice.due_date);
  due.setHours(0, 0, 0, 0);
  const daysOverdue = Math.floor(
    (today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)
  );

  const thresholds: Record<ReminderSchedule, number> = {
    "1_day": 1,
    "3_days": 3,
    "7_days": 7,
  };

  return invoice.reminder_schedules.filter((s) => {
    const threshold = thresholds[s];
    return (
      daysOverdue >= threshold && !invoice.reminders_sent.includes(s)
    );
  });
}

// ── Stats helpers ──────────────────────────────────────────────────────────
export function calcStats(invoices: Invoice[]) {
  const live = refreshStatuses(invoices);

  const totalUnpaid = live
    .filter((i) => i.status !== "paid")
    .reduce((sum, i) => sum + i.amount, 0);

  const overdueCount = live.filter((i) => i.status === "overdue").length;

  const remindersScheduled = live
    .filter((i) => i.status !== "paid")
    .reduce((sum, i) => sum + i.reminder_schedules.length, 0);

  const now = new Date();
  const paidThisMonth = live
    .filter((i) => {
      if (i.status !== "paid" || !i.paid_at) return false;
      const d = new Date(i.paid_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((sum, i) => sum + i.amount, 0);

  return { totalUnpaid, overdueCount, remindersScheduled, paidThisMonth };
}

// ── Formatting ─────────────────────────────────────────────────────────────
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function daysOverdueLabel(invoice: Invoice): string {
  if (invoice.status === "paid") return "Paid";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(invoice.due_date);
  due.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `Due in ${Math.abs(diff)}d`;
  if (diff === 0) return "Due today";
  return `${diff}d overdue`;
}

export const SCHEDULE_LABELS: Record<ReminderSchedule, string> = {
  "1_day": "1 day overdue",
  "3_days": "3 days overdue",
  "7_days": "7 days overdue",
};

// ── Seed data for first-run experience ────────────────────────────────────
function seedInvoices(): Invoice[] {
  const today = new Date();
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
  };
  const daysFromNow = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d.toISOString().split("T")[0];
  };

  const seeds: Invoice[] = [
    {
      id: crypto.randomUUID(),
      customer_name: "Dave Morrison",
      customer_email: "dave@morrisonbuilds.co.uk",
      customer_phone: "07700 900001",
      amount: 1240,
      due_date: daysAgo(14),
      payment_link: "",
      reminder_tone: "firm",
      reminder_schedules: ["1_day", "3_days", "7_days"],
      status: "overdue",
      created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
      paid_at: null,
      reminders_sent: ["1_day", "3_days"],
    },
    {
      id: crypto.randomUUID(),
      customer_name: "Sarah & Paul Clarke",
      customer_email: "sarah.clarke@gmail.com",
      customer_phone: "07700 900002",
      amount: 680,
      due_date: daysAgo(7),
      payment_link: "",
      reminder_tone: "friendly",
      reminder_schedules: ["1_day", "3_days"],
      status: "overdue",
      created_at: new Date(Date.now() - 12 * 86400000).toISOString(),
      paid_at: null,
      reminders_sent: ["1_day"],
    },
    {
      id: crypto.randomUUID(),
      customer_name: "Apex Building Ltd",
      customer_email: "accounts@apexbuilding.co.uk",
      customer_phone: "020 7946 0001",
      amount: 3500,
      due_date: daysAgo(28),
      payment_link: "https://pay.example.com/apex",
      reminder_tone: "final",
      reminder_schedules: ["1_day", "3_days", "7_days"],
      status: "overdue",
      created_at: new Date(Date.now() - 35 * 86400000).toISOString(),
      paid_at: null,
      reminders_sent: ["1_day", "3_days", "7_days"],
    },
    {
      id: crypto.randomUUID(),
      customer_name: "Tom Yates",
      customer_email: "tomyates@hotmail.com",
      customer_phone: "07700 900003",
      amount: 450,
      due_date: daysFromNow(5),
      payment_link: "",
      reminder_tone: "friendly",
      reminder_schedules: ["1_day"],
      status: "unpaid",
      created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
      paid_at: null,
      reminders_sent: [],
    },
    {
      id: crypto.randomUUID(),
      customer_name: "Riverside Café",
      customer_email: "owners@riversidecafe.co.uk",
      customer_phone: "01234 567890",
      amount: 890,
      due_date: daysAgo(5),
      payment_link: "https://pay.example.com/riverside",
      reminder_tone: "firm",
      reminder_schedules: ["1_day", "3_days"],
      status: "paid",
      created_at: new Date(Date.now() - 18 * 86400000).toISOString(),
      paid_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      reminders_sent: ["1_day"],
    },
  ];

  saveInvoices(seeds);
  return seeds;
}
