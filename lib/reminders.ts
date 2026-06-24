import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReminderLog } from "@/types";

/**
 * Fetches pending reminders for the current user (RLS-scoped), joined with
 * basic invoice details for display in the ReminderQueue panel.
 */
export async function fetchPendingReminders(
  supabase: SupabaseClient
): Promise<ReminderLog[]> {
  const { data, error } = await supabase
    .from("reminder_logs")
    .select("*, invoice:invoices(customer_name, amount, due_date)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("fetchPendingReminders error:", error.message);
    return [];
  }
  return (data ?? []) as ReminderLog[];
}

/**
 * Fetches recent sent/failed/dismissed reminders for history display.
 */
export async function fetchReminderHistory(
  supabase: SupabaseClient,
  limit = 20
): Promise<ReminderLog[]> {
  const { data, error } = await supabase
    .from("reminder_logs")
    .select("*, invoice:invoices(customer_name, amount, due_date)")
    .neq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("fetchReminderHistory error:", error.message);
    return [];
  }
  return (data ?? []) as ReminderLog[];
}

/** Calls /api/reminders/[id]/approve — sends the email, server enforces ownership via RLS */
export async function approveReminder(id: string): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`/api/reminders/${id}/approve`, { method: "POST" });
    return await res.json();
  } catch {
    return { success: false, message: "Network error. Please try again." };
  }
}

/** Calls /api/reminders/[id]/dismiss — marks as dismissed without sending */
export async function dismissReminder(id: string): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`/api/reminders/${id}/dismiss`, { method: "POST" });
    return await res.json();
  } catch {
    return { success: false, message: "Network error. Please try again." };
  }
}

/**
 * Calls /api/reminders/prepare — manually creates a pending reminder for an
 * invoice so the user can chase it now, regardless of cron timing.
 * Never sends; the reminder lands in the approval queue.
 */
export async function prepareReminder(
  invoiceId: string
): Promise<{ success: boolean; message: string; alreadyPending?: boolean }> {
  try {
    const res = await fetch(`/api/reminders/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice_id: invoiceId }),
    });
    return await res.json();
  } catch {
    return { success: false, message: "Network error. Please try again." };
  }
}
