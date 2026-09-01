"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Invoice, InvoiceFormData, Profile, ReminderLog, InvoiceAction } from "@/types";
import {
  refreshStatuses,
  calcStats,
  fetchInvoices,
  insertInvoice,
  markInvoicePaid,
  deleteInvoice,
  archiveInvoice,
} from "@/lib/invoices";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { buildInvoiceInsert } from "@/lib/invoice-create-payload";
import { fetchProfile } from "@/lib/profile";
import { fetchPendingReminders, prepareReminder, fetchLatestSentMap, fetchReminderHistory, fetchChannelStatuses } from "@/lib/reminders";
import { fetchLatestActionMap } from "@/lib/invoice-actions";
import { computeLifecycleState, type InvoiceLifecycleState } from "@/lib/escalation";
import { scheduleToPrepare } from "@/lib/reminder-schedule";

/** Which workflow page an invoice belongs to, derived from its lifecycle state. */
export type WorkflowBucket = "chasing" | "needs_action" | "paid";

export function bucketForInvoice(
  invoice: Invoice,
  hasPending: boolean,
  finalReminderSentAt: string | null
): WorkflowBucket {
  if (invoice.status === "paid") return "paid";

  const canPrepare = !!scheduleToPrepare(
    invoice.reminder_schedules ?? [],
    invoice.reminders_sent ?? [],
    invoice.due_date
  );
  const state = computeLifecycleState({ invoice, hasPending, canPrepare, finalReminderSentAt });

  // Needs Action: exhausted reminders or an explicit escalation status
  const needsAction: InvoiceLifecycleState[] = [
    "action_needed", "promised", "disputed", "paused", "written_off",
  ];
  if (needsAction.includes(state)) return "needs_action";

  // Everything else unpaid is normal active chasing
  return "chasing";
}

interface DashboardContextValue {
  // data
  invoices: Invoice[];
  liveInvoices: Invoice[];            // status-refreshed
  profile: Profile | null;
  reminders: ReminderLog[];
  reminderHistory: ReminderLog[];
  latestSentMap: Record<string, string>;
  /**
   * Per-channel statuses keyed by reminder id.
   *
   * The parent status cannot express "email sent, SMS failed", so every surface
   * that reports on a reminder needs these to tell the truth. Empty until the
   * first load, and empty on any read failure — which degrades to the pre-SMS
   * behaviour rather than mislabelling a working reminder.
   */
  channelStatuses: Record<string, Partial<Record<"email" | "sms", string>>>;
  latestActionMap: Record<string, InvoiceAction>;
  pendingReminderInvoiceIds: Set<string>;
  userEmail: string;
  loading: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  notice: string | null;
  setNotice: (n: string | null) => void;

  // derived
  stats: ReturnType<typeof calcStats>;
  needsActionCount: number;
  buckets: { chasing: Invoice[]; needs_action: Invoice[]; paid: Invoice[] };

  // handlers
  refreshAll: () => Promise<void>;
  refetchAfterReminderAction: () => Promise<void>;
  handleAddInvoice: (data: InvoiceFormData) => Promise<void>;
  handleMarkPaid: (id: string) => Promise<void>;
  handleDeleteInvoice: (id: string) => Promise<boolean>;
  handleArchiveInvoice: (id: string) => Promise<boolean>;
  handlePrepareReminder: (invoiceId: string) => Promise<{ success: boolean; message: string }>;
  setProfile: (p: Profile) => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [userEmail, setUserEmail] = useState("");
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [reminders, setReminders] = useState<ReminderLog[]>([]);
  const [reminderHistory, setReminderHistory] = useState<ReminderLog[]>([]);
  const [latestSentMap, setLatestSentMap] = useState<Record<string, string>>({});
  const [channelStatuses, setChannelStatuses] = useState<
    Record<string, Partial<Record<"email" | "sms", string>>>
  >({});
  const [latestActionMap, setLatestActionMap] = useState<Record<string, InvoiceAction>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const supabase = getSupabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserEmail(user.email ?? "");

      const [invoiceData, profileData, reminderData, historyData, sentMap, actionMap, channels] =
        await Promise.all([
          fetchInvoices(supabase),
          fetchProfile(),
          fetchPendingReminders(supabase),
          fetchReminderHistory(supabase),
          fetchLatestSentMap(supabase),
          fetchLatestActionMap(supabase),
          fetchChannelStatuses(supabase),
        ]);

      setInvoices(refreshStatuses(invoiceData));
      setProfileState(profileData);
      setReminders(reminderData);
      setReminderHistory(historyData);
      setLatestSentMap(sentMap);
      setLatestActionMap(actionMap);
      setChannelStatuses(channels);
      setLoading(false);
    };
    init();
  }, [router]);

  const refreshAll = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    const [invoiceData, reminderData, historyData, sentMap, actionMap, channels] =
      await Promise.all([
        fetchInvoices(supabase),
        fetchPendingReminders(supabase),
        fetchReminderHistory(supabase),
        fetchLatestSentMap(supabase),
        fetchLatestActionMap(supabase),
        fetchChannelStatuses(supabase),
      ]);
    setInvoices(refreshStatuses(invoiceData));
    setReminders(reminderData);
    setReminderHistory(historyData);
    setLatestSentMap(sentMap);
    setLatestActionMap(actionMap);
    setChannelStatuses(channels);
  }, []);

  const refetchAfterReminderAction = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    // channelStatuses is included so a caller right after an approve/retry
    // (ReminderReviewPanel) has correct per-channel data on the very next
    // render — SentConfirmation and Active Chasing's partial-send indicator
    // both read this map, and neither should show stale channel state for
    // the reminder that was just acted on.
    const [reminderData, invoiceData, channels] = await Promise.all([
      fetchPendingReminders(supabase),
      fetchInvoices(supabase),
      fetchChannelStatuses(supabase),
    ]);
    setReminders(reminderData);
    setInvoices(refreshStatuses(invoiceData));
    setChannelStatuses(channels);
  }, []);

  const handleAddInvoice = useCallback(async (data: InvoiceFormData) => {
    // The payload is built by a pure, tested function — see
    // lib/invoice-create-payload.ts. It used to be assembled inline here,
    // which is why a parseFloat on a currency-formatted string ("£1,500.00")
    // could reach production as amount = null with nothing to catch it.
    const payload = buildInvoiceInsert(data);
    if (!payload) {
      setError("Failed to save invoice. Please check the amount and try again.");
      return;
    }

    const supabase = getSupabaseBrowser();
    const inserted = await insertInvoice(supabase, payload);
    if (inserted) {
      setInvoices((prev) => refreshStatuses([inserted, ...prev]));
    } else {
      setError("Failed to save invoice. Please try again.");
    }
  }, []);

  const handleMarkPaid = useCallback(async (id: string) => {
    const supabase = getSupabaseBrowser();
    const ok = await markInvoicePaid(supabase, id);
    if (ok) {
      setInvoices((prev) =>
        refreshStatuses(prev.map((inv) =>
          inv.id === id ? { ...inv, status: "paid", paid_at: new Date().toISOString() } : inv
        ))
      );
      // Kill switch: pendings for this invoice were dismissed — drop them
      // from the approval queue immediately.
      setReminders((prev) => prev.filter((r) => r.invoice_id !== id));
      setNotice("Invoice marked paid — future reminders stopped.");
    } else {
      setError("Failed to update invoice. Please try again.");
    }
  }, []);

  /**
   * Deletion now goes through the lifecycle API, which can refuse. The refusal
   * is surfaced verbatim — an invoice with sent history must be ARCHIVED, and
   * telling the owner "failed, try again" would be both wrong and unhelpful.
   */
  const handleDeleteInvoice = useCallback(async (id: string): Promise<boolean> => {
    const result = await deleteInvoice(getSupabaseBrowser(), id);
    if (result.success) {
      setInvoices((prev) => refreshStatuses(prev.filter((inv) => inv.id !== id)));
    } else {
      setError(result.message);
    }
    return result.success;
  }, []);

  /**
   * Archive preserves everything and removes the invoice from the workflow.
   * Dropping it from local state is correct because fetchInvoices() excludes
   * archived rows — the browser never holds them.
   */
  const handleArchiveInvoice = useCallback(async (id: string): Promise<boolean> => {
    const result = await archiveInvoice(id);
    if (result.success) {
      setInvoices((prev) => refreshStatuses(prev.filter((inv) => inv.id !== id)));
      setReminders((prev) => prev.filter((r) => r.invoice_id !== id));
      setNotice("Invoice archived. Its reminder history has been kept.");
    } else {
      setError(result.message);
    }
    return result.success;
  }, []);

  const handlePrepareReminder = useCallback(async (invoiceId: string) => {
    const result = await prepareReminder(invoiceId);
    if (result.success) {
      const supabase = getSupabaseBrowser();
      const [reminderData, invoiceData] = await Promise.all([
        fetchPendingReminders(supabase),
        fetchInvoices(supabase),
      ]);
      setReminders(reminderData);
      setInvoices(refreshStatuses(invoiceData));
    }
    return { success: result.success, message: result.message };
  }, []);

  const setProfile = useCallback((p: Profile) => setProfileState(p), []);

  // ── Derived ────────────────────────────────────────────────────────────────
  const liveInvoices = refreshStatuses(invoices);
  const stats = calcStats(liveInvoices);
  const pendingReminderInvoiceIds = new Set(reminders.map((r) => r.invoice_id));

  const buckets = { chasing: [] as Invoice[], needs_action: [] as Invoice[], paid: [] as Invoice[] };
  for (const inv of liveInvoices) {
    const bucket = bucketForInvoice(
      inv,
      pendingReminderInvoiceIds.has(inv.id),
      latestSentMap[inv.id] ?? null
    );
    buckets[bucket].push(inv);
  }

  const needsActionCount = buckets.needs_action.filter((inv) => {
    // Count only true "action_needed" (not paused/written_off) for the urgent badge
    const finalSent = latestSentMap[inv.id] ?? null;
    const canPrepare = !!scheduleToPrepare(inv.reminder_schedules ?? [], inv.reminders_sent ?? [], inv.due_date);
    const state = computeLifecycleState({ invoice: inv, hasPending: pendingReminderInvoiceIds.has(inv.id), canPrepare, finalReminderSentAt: finalSent });
    return state === "action_needed";
  }).length;

  const value: DashboardContextValue = {
    invoices, liveInvoices, profile, reminders, reminderHistory, latestSentMap, latestActionMap,
    channelStatuses,
    pendingReminderInvoiceIds, userEmail, loading, error, setError, notice, setNotice,
    stats, needsActionCount, buckets,
    refreshAll, refetchAfterReminderAction, handleAddInvoice, handleMarkPaid,
    handleDeleteInvoice, handleArchiveInvoice, handlePrepareReminder, setProfile,
  };

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}
