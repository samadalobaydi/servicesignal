import type { InvoiceAction, InvoiceActionType } from "@/types";

/** Records an invoice action via the API. Returns success + message. */
export async function recordInvoiceAction(
  invoiceId: string,
  actionType: InvoiceActionType,
  note?: string
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch("/api/invoices/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice_id: invoiceId, action_type: actionType, note }),
    });
    return await res.json();
  } catch {
    return { success: false, message: "Network error. Please try again." };
  }
}

/** Fetches the action history for a single invoice, newest first. */
export async function fetchInvoiceActions(invoiceId: string): Promise<InvoiceAction[]> {
  try {
    const res = await fetch(`/api/invoices/actions?invoice_id=${encodeURIComponent(invoiceId)}`);
    const data = await res.json();
    return data.success ? (data.actions as InvoiceAction[]) : [];
  } catch {
    return [];
  }
}

/**
 * Fetches the most recent action for ALL of the user's invoices in one call,
 * returning a map of invoice_id → latest InvoiceAction. Used to show a short
 * latest-action summary directly on each invoice row. RLS scopes to the user.
 */
export async function fetchLatestActionMap(
  supabase: import("@supabase/supabase-js").SupabaseClient
): Promise<Record<string, InvoiceAction>> {
  const { data, error } = await supabase
    .from("invoice_actions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchLatestActionMap error:", error.message);
    return {};
  }

  const map: Record<string, InvoiceAction> = {};
  for (const row of (data ?? []) as InvoiceAction[]) {
    // newest-first, so first occurrence per invoice is the latest
    if (!map[row.invoice_id]) map[row.invoice_id] = row;
  }
  return map;
}
