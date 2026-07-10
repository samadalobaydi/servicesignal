import type { Invoice, InvoiceStatus, InvoiceInsert, ReminderSchedule } from "@/types";
import { getDaysFromDue, getDueStatusLabelShort } from "./date-status";

// ── Pure utility functions (no data fetching) ─────────────────────────────

export function deriveStatus(invoice: Invoice): InvoiceStatus {
  if (invoice.status === "paid") return "paid";
  // Overdue once past the due date, using the shared London-aware calc.
  // Due-today counts as unpaid (not yet overdue).
  return getDaysFromDue(invoice.due_date) > 0 ? "overdue" : "unpaid";
}

export function refreshStatuses(invoices: Invoice[]): Invoice[] {
  return invoices.map((inv) => ({ ...inv, status: deriveStatus(inv) }));
}

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
      return (
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      );
    })
    .reduce((sum, i) => sum + i.amount, 0);

  return { totalUnpaid, overdueCount, remindersScheduled, paidThisMonth };
}

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
  // Single source of truth — computed live from due_date vs today (London).
  return getDueStatusLabelShort(invoice.due_date);
}

export const SCHEDULE_LABELS: Record<ReminderSchedule, string> = {
  before_due_3_days: "3 days before due",
  due_today:         "On the due date",
  overdue_3_days:    "3 days overdue",
  overdue_7_days:    "7 days overdue",
  overdue_14_days:   "14 days overdue",
};

/** Display order for schedule checkboxes — chronological */
export const SCHEDULE_ORDER: ReminderSchedule[] = [
  "before_due_3_days",
  "due_today",
  "overdue_3_days",
  "overdue_7_days",
  "overdue_14_days",
];

// ── Supabase CRUD helpers ─────────────────────────────────────────────────
// These accept a Supabase browser client and return typed results.
// RLS policies enforce that each user only accesses their own invoices.
// user_id is never passed from the client — set by DB DEFAULT auth.uid().

import type { SupabaseClient } from "@supabase/supabase-js";

export async function fetchInvoices(
  supabase: SupabaseClient
): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchInvoices error:", error.message);
    return [];
  }
  return (data ?? []) as Invoice[];
}

export async function insertInvoice(
  supabase: SupabaseClient,
  payload: InvoiceInsert
): Promise<Invoice | null> {
  // user_id is NOT in payload — DB sets it via DEFAULT auth.uid()
  // RLS INSERT policy also enforces auth.uid() = user_id
  const { data, error } = await supabase
    .from("invoices")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error("insertInvoice error:", error.message);
    return null;
  }
  return data as Invoice;
}

export async function markInvoicePaid(
  supabase: SupabaseClient,
  id: string
): Promise<boolean> {
  const { error } = await supabase
    .from("invoices")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", id);
  // RLS UPDATE policy enforces auth.uid() = user_id — no cross-user update possible

  if (error) {
    console.error("markInvoicePaid error:", error.message);
    return false;
  }

  // ── Kill switch: stop future chasing for this invoice ─────────────────────
  // Dismiss any reminders still awaiting approval so they leave the queue and
  // can never be sent. Historical logs (sent/failed) are left untouched.
  // RLS (update_own_reminder_logs) scopes this to the caller's own rows.
  const { error: dismissError } = await supabase
    .from("reminder_logs")
    .update({ status: "dismissed" })
    .eq("invoice_id", id)
    .eq("status", "pending");

  if (dismissError) {
    // Non-fatal: the invoice IS paid, and the queue also filters paid
    // invoices defensively, plus Send Now blocks paid invoices server-side.
    console.error("markInvoicePaid: failed to dismiss pending reminders:", dismissError.message);
  }

  return true;
}

export async function deleteInvoice(
  supabase: SupabaseClient,
  id: string
): Promise<boolean> {
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  // RLS DELETE policy enforces auth.uid() = user_id

  if (error) {
    console.error("deleteInvoice error:", error.message);
    return false;
  }
  return true;
}
