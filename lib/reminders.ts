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
    .select("*, invoice:invoices(customer_name, amount, due_date, status)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("fetchPendingReminders error:", error.message);
    return [];
  }
  // Defensive: never surface reminders for invoices that have been paid.
  // (Mark Paid also dismisses these, but this guards any that slip through.)
  const logs = (data ?? []) as ReminderLog[];
  return logs.filter((r) => r.invoice?.status !== "paid");
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

/**
 * Returns a map of invoice_id → ISO timestamp of that invoice's most recent
 * SENT reminder. Used to drive the "action needed after 48h" escalation rule.
 * RLS scopes this to the current user's reminders only.
 */
export async function fetchLatestSentMap(
  supabase: SupabaseClient
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("reminder_logs")
    .select("invoice_id, sent_at")
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false });

  if (error) {
    console.error("fetchLatestSentMap error:", error.message);
    return {};
  }

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    // rows are newest-first, so the first time we see an invoice_id is its latest
    if (row.invoice_id && row.sent_at && !map[row.invoice_id]) {
      map[row.invoice_id] = row.sent_at as string;
    }
  }
  return map;
}
