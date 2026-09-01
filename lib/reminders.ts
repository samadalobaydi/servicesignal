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

/**
 * Calls /api/reminders/[id]/approve. Server enforces ownership via RLS.
 *
 * ── THE JSON GOVERNS, NOT THE HTTP STATUS ────────────────────────────────
 *
 * `res.ok` is deliberately NOT consulted. A partial send answers 207, which is
 * a 2xx — so any caller branching on res.ok would render "email sent, SMS
 * failed" as a clean success. Returning the parsed body unconditionally means
 * the only thing a consumer can branch on is `success`, which is false for a
 * partial. A test pins this.
 */
export async function approveReminder(
  id: string,
  /**
   * The server-SIGNED review authorisation issued when the page rendered.
   * Opaque to the browser: it cannot be forged, retargeted at another reminder
   * or account, or made to outlive its expiry.
   */
  reviewToken: string
): Promise<{ success: boolean; message: string; state?: string }> {
  try {
    const res = await fetch(`/api/reminders/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review_token: reviewToken }),
    });
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
): Promise<{
  success: boolean;
  message: string;
  alreadyPending?: boolean;
  /**
   * "allowance_exhausted" when the founding-beta cap left no capacity to
   * prepare a new reminder. Named so a caller can branch on the STATE rather
   * than pattern-matching prose; the row already renders `message` verbatim,
   * so the copy is truthful even if the cap was reached between the page
   * rendering and the click.
   */
  state?: string;
  allowanceExhausted?: boolean;
}> {
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

/**
 * How many founding-beta reminders this user has consumed.
 *
 * ── ONE DEFINITION, NOT THREE ────────────────────────────────────────────
 *
 * This counts `reminder_allowance_slots` — the exact rows the enforcement
 * function creates and deletes. It does NOT re-derive usage from
 * reminder_logs statuses, which is what it did while the banner was
 * display-only.
 *
 * That change is the point. Before, "used" existed in two places: a status
 * filter for display, and (had it been built that way) a separate rule for
 * enforcement. Two rules that must agree eventually disagree, and the failure
 * mode is a customer told they have credits the server will refuse to spend.
 * Now the banner reads the enforcement ledger directly, so the number on the
 * screen is the number the server will act on, by construction.
 *
 * The slot table is still LOGICAL-reminder-level counting: its primary key is
 * reminder_log_id. Channels live in reminder_channel_messages and are not
 * countable here.
 *
 * `head: true` with an exact count transfers no rows — a COUNT(*), not a
 * fetch-then-length. Scoped by the table's RLS select policy to the caller's
 * own slots.
 *
 * Returns null on error rather than 0 — including while migration 011 is
 * unapplied and the table does not exist. Zero is a meaningful, reassuring
 * number; showing it because a query failed would tell a customer at their
 * limit that they had ten reminders left. The banner hides instead.
 */
export async function fetchAllowanceUsed(
  supabase: SupabaseClient
): Promise<number | null> {
  const { count, error } = await supabase
    .from("reminder_allowance_slots")
    .select("reminder_log_id", { count: "exact", head: true });

  if (error) {
    console.error("fetchAllowanceUsed error:", error.message);
    return null;
  }
  return count ?? null;
}

/**
 * Per-channel statuses for every reminder the caller owns, keyed by reminder id.
 *
 * ── WHY THE DASHBOARD NEEDS THIS ──────────────────────────────────────────
 *
 * reminder_logs.status answers "did anything reach the customer". After the SMS
 * work that is no longer the same question as "did the whole reminder land": a
 * reminder whose email was accepted and whose SMS was rejected is `sent`, and
 * every surface reading the parent alone renders it as a clean success.
 *
 * RLS scopes this to the caller. Returns {} on any failure — including while a
 * migration is unapplied — so a read problem degrades to the pre-SMS behaviour
 * rather than mislabelling a working reminder as broken.
 */
export async function fetchChannelStatuses(
  supabase: SupabaseClient
): Promise<Record<string, Partial<Record<"email" | "sms", string>>>> {
  const { data, error } = await supabase
    .from("reminder_channel_messages")
    .select("reminder_log_id, channel, status");

  if (error) {
    console.error("fetchChannelStatuses error:", error.message);
    return {};
  }

  const map: Record<string, Partial<Record<"email" | "sms", string>>> = {};
  for (const row of (data ?? []) as { reminder_log_id: string; channel: string; status: string }[]) {
    (map[row.reminder_log_id] ??= {})[row.channel as "email" | "sms"] = row.status;
  }
  return map;
}

/**
 * Calls /api/reminders/[id]/regenerate — rebuilds a pending/failed reminder's
 * stored SMS+email from the current invoice and sender identity, for a
 * reminder whose stored content can no longer be proven to match the
 * account's current identity. Sends nothing.
 */
export async function regenerateReminder(
  id: string
): Promise<{ success: boolean; message: string; state?: string }> {
  try {
    const res = await fetch(`/api/reminders/${id}/regenerate`, { method: "POST" });
    return await res.json();
  } catch {
    return { success: false, message: "Network error. Please try again." };
  }
}

/** Retries ONE channel of a partially-sent reminder. Never touches the other. */
export async function retryReminderChannel(
  reminderId: string,
  channel: "email" | "sms"
): Promise<{ success: boolean; message: string; state?: string; channels?: Record<string, string> }> {
  try {
    const res = await fetch(
      `/api/reminders/${reminderId}/channels/${channel}/retry`,
      { method: "POST" }
    );
    // Deliberately NOT res.ok — see approveReminder. The JSON `success` field
    // is the contract; a 2xx status is not.
    return await res.json();
  } catch {
    return { success: false, message: "Network error. Please try again." };
  }
}
