import type { Invoice, InvoiceStatus, InvoiceInsert, ReminderSchedule, InvoiceFormData } from "@/types";
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
    // Archived invoices are not operational. Filtering here means every
    // dashboard surface excludes them by construction — see lib/invoice-live.ts.
    .is("archived_at", null)
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

/**
 * Marks an invoice paid through the trusted server route.
 *
 * ── WHY THIS IS NO LONGER A DIRECT TABLE WRITE ──────────────────────────
 *
 * It used to be `supabase.from("invoices").update({ status: "paid", ... })`
 * from the browser, which worked only because `authenticated` held table-level
 * UPDATE on invoices. Migration 012 revokes that: RLS answered "whose row",
 * never "which columns, with what consequences", so an owner could set any
 * lifecycle column straight from the console.
 *
 * The signature keeps its unused client argument so every call site and the
 * provider stay unchanged.
 */
export async function markInvoicePaid(
  _supabase: SupabaseClient,
  id: string
): Promise<boolean> {
  try {
    const res = await fetch(`/api/invoices/${id}/paid`, { method: "POST" });
    const body = await res.json();
    return body.success === true;
  } catch {
    return false;
  }
}

/**
 * Deletes an invoice through the lifecycle API.
 *
 * ── THIS REPLACED A LIFECYCLE BYPASS ────────────────────────────────────
 *
 * It used to be a bare `supabase.from("invoices").delete().eq("id", id)` from
 * the browser, reachable from the Paid Invoices page. Given the verified
 * production FK — reminder_logs.invoice_id ON DELETE CASCADE — that button
 * could erase dispatched message history and, through migration 011's cascade,
 * REFUND consumed Founding Beta allowance.
 *
 * All deletion now goes through DELETE /api/invoices/[id], which proves
 * ownership, applies the lifecycle rules and returns a typed refusal. The
 * database guard in migration 012 refuses an ineligible delete regardless.
 */
export async function deleteInvoice(
  _supabase: SupabaseClient,
  id: string
): Promise<{ success: boolean; message: string; state?: string; useArchive?: boolean }> {
  try {
    const res = await fetch(`/api/invoices/${id}`, { method: "DELETE" });
    return await res.json();
  } catch {
    return { success: false, message: "Network error. Please try again." };
  }
}

/** Archives an invoice — preserves everything, removes it from the workflow. */
export async function archiveInvoice(
  id: string
): Promise<{ success: boolean; message: string; state?: string }> {
  try {
    const res = await fetch(`/api/invoices/${id}/archive`, { method: "POST" });
    return await res.json();
  } catch {
    return { success: false, message: "Network error. Please try again." };
  }
}

/** Saves an invoice edit. `acceptRefresh` acknowledges refreshing an unsent reminder. */
export async function updateInvoice(
  id: string,
  form: InvoiceFormData,
  acceptRefresh = false
): Promise<{ success: boolean; message: string; state?: string; requiresRefreshConfirmation?: boolean; ownerEdited?: boolean; errors?: Record<string, string> }> {
  try {
    const res = await fetch(`/api/invoices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, accept_refresh: acceptRefresh }),
    });
    return await res.json();
  } catch {
    return { success: false, message: "Network error. Please try again." };
  }
}

/**
 * Archived invoices — the ONLY read path that returns them.
 *
 * fetchInvoices() deliberately excludes archived rows so every dashboard
 * surface is correct by construction. This is the deliberate exception, and it
 * is a separate function rather than a flag so an archived row can never
 * arrive somewhere operational by accident: nothing calls this except the
 * Archived page.
 *
 * RLS scopes it to the caller, exactly as every other read here does.
 */
export async function fetchArchivedInvoices(
  supabase: SupabaseClient
): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });

  if (error) {
    console.error("fetchArchivedInvoices error:", error.message);
    return [];
  }
  return (data ?? []) as Invoice[];
}
