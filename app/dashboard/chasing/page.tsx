"use client";

import { Suspense, useMemo, useState } from "react";

import { useDashboard } from "@/components/dashboard/DashboardProvider";
import ActiveChasingList from "@/components/dashboard/ActiveChasingList";
import SummaryStrip, { type SummaryStat } from "@/components/dashboard/SummaryStrip";
import InvoiceSearchInput, { matchesInvoiceSearch, SearchEmptyState } from "@/components/dashboard/InvoiceSearchInput";
import { formatCurrency } from "@/lib/invoices";
import { OnboardingHandoff } from "@/components/dashboard/OnboardingHandoff";
import { SentConfirmation } from "@/components/dashboard/SentConfirmation";
import AddInvoiceForm from "@/components/dashboard/AddInvoiceForm";
import { updateInvoice } from "@/lib/invoices";
import { formatAmount, isoToUkDate } from "@/lib/invoice-input";
import type { Invoice, InvoiceFormData } from "@/types";

export default function ChasingPage() {
  const {
    buckets, pendingReminderInvoiceIds, reminders, reminderHistory,
    handlePrepareReminder, handleMarkPaid, handleDeleteInvoice, handleArchiveInvoice,
    refreshAll, setError, setNotice,
  } = useDashboard();

  /**
   * invoice_id → every reminder status. Delete-vs-archive eligibility is a
   * per-INVOICE question ("has anything ever been dispatched?"), so pending
   * and history are merged; one historic sent reminder forces archive for ever.
   */
  const reminderStatusesByInvoice = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const r of [...reminders, ...reminderHistory]) {
      (map[r.invoice_id] ??= []).push(r.status);
    }
    return map;
  }, [reminders, reminderHistory]);

  const [editing, setEditing] = useState<Invoice | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editInitial: InvoiceFormData | undefined = editing
    ? {
        invoice_reference: editing.invoice_reference ?? "",
        job_description: editing.job_description ?? "",
        customer_name: editing.customer_name,
        customer_email: editing.customer_email,
        customer_phone: editing.customer_phone,
        amount: formatAmount(editing.amount),
        due_date: isoToUkDate(editing.due_date),
        payment_link: editing.payment_link ?? "",
        reminder_tone: editing.reminder_tone,
        reminder_schedules: editing.reminder_schedules,
      }
    : undefined;

  /**
   * Two-phase save. The first attempt does NOT acknowledge refreshing an
   * unsent reminder, so the server refuses and tells us what it would cost;
   * the warning is shown and the second attempt carries the acknowledgement.
   *
   * The confirmation is therefore enforced by the server, not by this dialog —
   * a direct API call cannot skip it either.
   */
  const saveEdit = async (data: InvoiceFormData) => {
    if (!editing) return;
    setSaving(true);
    const first = await updateInvoice(editing.id, data, warning !== null);
    setSaving(false);

    if (first.requiresRefreshConfirmation) {
      setWarning(
        first.ownerEdited
          ? "This reminder has been edited. Saving these invoice changes will regenerate the unsent SMS and email and replace those edits."
          : "This invoice has reminders ready for review. Saving these changes will refresh the unsent SMS and email so they match the updated invoice."
      );
      return;
    }

    if (!first.success) { setError(first.message); return; }

    setEditing(null);
    setWarning(null);
    setNotice(first.state === "updated" ? "Invoice updated." : first.message);
    await refreshAll();
  };

  const [search, setSearch] = useState("");
  const active = buckets.chasing;
  const visible = active.filter((inv) => matchesInvoiceSearch(inv, search));
  const searching = search.trim().length > 0;
  const outstanding = active.reduce((sum, inv) => sum + inv.amount, 0);
  const overdueCount = active.filter((inv) => inv.status === "overdue").length;
  const remindersReady = active.filter((inv) => pendingReminderInvoiceIds.has(inv.id)).length;

  const summary: SummaryStat[] = [
    {
      href: "/dashboard/chasing", ariaLabel: "View active chasing invoices",
      label: "Active invoices", value: String(active.length),
      hint: active.length === 1 ? "being chased" : "being chased",
      accent: "var(--dash-accent-strong)", iconBg: "var(--dash-accent-soft)",
      icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    },
    {
      href: "/dashboard/chasing", ariaLabel: "View outstanding invoices",
      label: "Outstanding", value: formatCurrency(outstanding),
      hint: "across active invoices",
      accent: "var(--dash-text)", iconBg: "var(--dash-card-muted)",
      icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
    },
    {
      href: "/dashboard/chasing", ariaLabel: "View overdue invoices",
      label: "Overdue", value: String(overdueCount),
      hint: overdueCount === 1 ? "past due date" : "past due date",
      accent: overdueCount > 0 ? "var(--dash-amber)" : "var(--dash-text)", iconBg: "var(--dash-amber-soft)",
      icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    },
    {
      href: "/dashboard", ariaLabel: "Review reminders awaiting approval",
      label: "Reminders ready", value: String(remindersReady),
      hint: "awaiting approval",
      accent: remindersReady > 0 ? "var(--dash-amber)" : "var(--dash-text)", iconBg: "var(--dash-card-muted)",
      icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Onboarding now hands off HERE, not to Needs Action. A brand-new
          invoice is ordinary active work, not an exception needing a decision.
          useSearchParams suspends during prerender, hence the boundary. The
          "Review it" link is suppressed — the invoice is on this page. */}
      <Suspense fallback={null}>
        <OnboardingHandoff showReviewLink={false} />
      </Suspense>

      {/* Success confirmation after a send, carried in the URL by the review
          page. role="status" so it is announced without stealing focus, and it
          clears on the next navigation because the query string does. */}
      <Suspense fallback={null}>
        <SentConfirmation />
      </Suspense>

      <div>
        <h1 style={{ fontSize: "1.85rem", fontWeight: 700, color: "var(--dash-text)", letterSpacing: "-0.02em" }}>
          Active Chasing
        </h1>
        <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)" }}>
          Unpaid invoices in the normal reminder loop. Prepare reminders to chase payment.
        </p>
      </div>

      <InvoiceSearchInput value={search} onChange={setSearch} placeholder="Search active invoices..." />

      <SummaryStrip stats={summary} />

      {searching && visible.length === 0 ? (
        <SearchEmptyState />
      ) : (
        <ActiveChasingList
          invoices={visible}
          pendingReminderInvoiceIds={pendingReminderInvoiceIds}
          onPrepareReminder={handlePrepareReminder}
          onMarkPaid={handleMarkPaid}
          reminderStatusesByInvoice={reminderStatusesByInvoice}
          onEditInvoice={(inv) => { setWarning(null); setEditing(inv); }}
          onDeleteInvoice={async (inv) => handleDeleteInvoice(inv.id)}
          onArchiveInvoice={async (inv) => handleArchiveInvoice(inv.id)}
        />
      )}
      <AddInvoiceForm
        open={editing !== null}
        mode="edit"
        initial={editInitial}
        consequenceWarning={warning}
        saving={saving}
        onClose={() => { setEditing(null); setWarning(null); }}
        onSave={saveEdit}
      />
    </div>
  );
}
