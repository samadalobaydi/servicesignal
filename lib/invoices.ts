import type { Invoice, InvoiceStatus, InvoiceInsert, ReminderSchedule } from "@/types";

// ── Pure utility functions (no data fetching) ─────────────────────────────

export function deriveStatus(invoice: Invoice): InvoiceStatus {
  if (invoice.status === "paid") return "paid";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(invoice.due_date);
  due.setHours(0, 0, 0, 0);
  return due < today ? "overdue" : "unpaid";
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(invoice.due_date);
  due.setHours(0, 0, 0, 0);
  const diff = Math.floor(
    (today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff < 0) return `Due in ${Math.abs(diff)}d`;
  if (diff === 0) return "Due today";
  return `${diff}d overdue`;
}

export const SCHEDULE_LABELS: Record<ReminderSchedule, string> = {
  "1_day": "1 day overdue",
  "3_days": "3 days overdue",
  "7_days": "7 days overdue",
};

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
