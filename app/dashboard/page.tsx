"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Invoice, InvoiceFormData } from "@/types";
import {
  refreshStatuses,
  calcStats,
  fetchInvoices,
  insertInvoice,
  markInvoicePaid,
  deleteInvoice,
} from "@/lib/invoices";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import DashNav from "@/components/dashboard/DashNav";
import StatsCards from "@/components/dashboard/StatsCards";
import AddInvoiceForm from "@/components/dashboard/AddInvoiceForm";
import InvoiceTable from "@/components/dashboard/InvoiceTable";

type FilterTab = "all" | "overdue" | "unpaid" | "paid";

const TAB_LABELS: Record<FilterTab, string> = {
  all:     "All",
  overdue: "Overdue",
  unpaid:  "Unpaid",
  paid:    "Paid",
};

export default function DashboardPage() {
  const router = useRouter();

  const [invoices, setInvoices]   = useState<Invoice[]>([]);
  const [userEmail, setUserEmail] = useState<string>("");
  const [formOpen, setFormOpen]   = useState(false);
  const [filter, setFilter]       = useState<FilterTab>("all");
  const [deleteId, setDeleteId]   = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  // ── Auth check + load invoices on mount ──────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const supabase = getSupabaseBrowser();

      // Validate session — belt-and-braces alongside middleware
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      setUserEmail(user.email ?? "");

      // Load this user's invoices (RLS ensures they only get their own)
      const data = await fetchInvoices(supabase);
      setInvoices(refreshStatuses(data));
      setLoading(false);
    };

    init();
  }, [router]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const handleAddInvoice = useCallback(async (data: InvoiceFormData) => {
    const supabase = getSupabaseBrowser();
    const inserted = await insertInvoice(supabase, {
      customer_name:      data.customer_name.trim(),
      customer_email:     data.customer_email.trim(),
      customer_phone:     data.customer_phone.trim(),
      amount:             parseFloat(data.amount),
      due_date:           data.due_date,
      payment_link:       data.payment_link.trim(),
      reminder_tone:      data.reminder_tone,
      reminder_schedules: data.reminder_schedules,
      status:             "unpaid",
      reminders_sent:     [],
    });

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
        refreshStatuses(
          prev.map((inv) =>
            inv.id === id
              ? { ...inv, status: "paid", paid_at: new Date().toISOString() }
              : inv
          )
        )
      );
    } else {
      setError("Failed to update invoice. Please try again.");
    }
  }, []);

  const handleDelete = useCallback((id: string) => {
    setDeleteId(id);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteId) return;
    const supabase = getSupabaseBrowser();
    const ok = await deleteInvoice(supabase, deleteId);
    if (ok) {
      setInvoices((prev) =>
        refreshStatuses(prev.filter((inv) => inv.id !== deleteId))
      );
    } else {
      setError("Failed to delete invoice. Please try again.");
    }
    setDeleteId(null);
  }, [deleteId]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const live  = refreshStatuses(invoices);
  const stats = calcStats(live);
  const filtered = live.filter(
    (inv) => filter === "all" || inv.status === filter
  );
  const tabCounts: Record<FilterTab, number> = {
    all:     live.length,
    overdue: live.filter((i) => i.status === "overdue").length,
    unpaid:  live.filter((i) => i.status === "unpaid").length,
    paid:    live.filter((i) => i.status === "paid").length,
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "#0a0e1a" }}
      >
        <div className="flex items-center gap-3" style={{ color: "#64748b" }}>
          <svg className="animate-spin" width="18" height="18" fill="none" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
            <path d="M12 2a10 10 0 0110 10" stroke="#00c8ff" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span
            className="text-sm font-display"
            style={{ fontWeight: 600, letterSpacing: "0.08em" }}
          >
            LOADING...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#0a0e1a" }}>
      <DashNav
        onAddInvoice={() => setFormOpen(true)}
        userEmail={userEmail}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Global error banner ── */}
        {error && (
          <div
            className="rounded-xl px-5 py-3 flex items-center justify-between text-sm"
            style={{
              background: "rgba(255,107,107,0.08)",
              border: "1px solid rgba(255,107,107,0.2)",
              color: "#ff6b6b",
            }}
          >
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-4 opacity-60 hover:opacity-100">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        <StatsCards
          totalUnpaid={stats.totalUnpaid}
          overdueCount={stats.overdueCount}
          remindersScheduled={stats.remindersScheduled}
          paidThisMonth={stats.paidThisMonth}
        />

        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid rgba(255,255,255,0.06)", background: "#0a0e1a" }}
        >
          {/* Panel header + filter tabs */}
          <div
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div>
              <h2
                className="font-display text-white"
                style={{ fontWeight: 800, fontSize: "1.1rem", letterSpacing: "0.04em" }}
              >
                INVOICES
              </h2>
              {stats.overdueCount > 0 && (
                <p className="text-xs mt-0.5" style={{ color: "#ff6b6b" }}>
                  {stats.overdueCount} overdue — reminders will fire automatically once email/SMS is connected
                </p>
              )}
            </div>

            <div
              className="flex gap-1 p-1 rounded-lg flex-shrink-0"
              style={{ background: "#05080f", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {(Object.keys(TAB_LABELS) as FilterTab[]).map((tab) => {
                const active  = filter === tab;
                const isAlert = tab === "overdue" && tabCounts.overdue > 0;
                return (
                  <button
                    key={tab}
                    onClick={() => setFilter(tab)}
                    className="px-3 py-1.5 rounded-md text-xs font-display transition-all flex items-center gap-1.5"
                    style={{
                      background: active ? "#0f1628" : "transparent",
                      border: active ? "1px solid rgba(255,255,255,0.08)" : "1px solid transparent",
                      color: active ? "#ffffff" : "#64748b",
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                    }}
                  >
                    {TAB_LABELS[tab]}
                    {tabCounts[tab] > 0 && (
                      <span
                        className="inline-flex items-center justify-center rounded px-1 min-w-[18px] h-[18px]"
                        style={{
                          background: isAlert ? "rgba(255,107,107,0.15)" : active ? "rgba(0,200,255,0.1)" : "rgba(255,255,255,0.05)",
                          color: isAlert ? "#ff6b6b" : active ? "#00c8ff" : "#475569",
                          fontSize: "0.65rem",
                          fontWeight: 700,
                        }}
                      >
                        {tabCounts[tab]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {filtered.length === 0 ? (
              <div className="text-center py-12" style={{ color: "#64748b" }}>
                {live.length === 0 ? (
                  <>
                    <div
                      className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center"
                      style={{ background: "rgba(0,200,255,0.06)", border: "1px solid rgba(0,200,255,0.12)" }}
                    >
                      <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                          stroke="#00c8ff" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </div>
                    <p className="font-display text-white text-base mb-1" style={{ fontWeight: 700 }}>
                      No invoices yet
                    </p>
                    <p className="text-sm mb-5" style={{ color: "#475569" }}>
                      Add your first unpaid invoice to get started
                    </p>
                    <button
                      onClick={() => setFormOpen(true)}
                      className="btn-primary"
                      style={{ padding: "0.6rem 1.5rem", fontSize: "0.9rem" }}
                    >
                      Add Your First Invoice
                    </button>
                  </>
                ) : (
                  <p className="text-sm">No {filter} invoices</p>
                )}
              </div>
            ) : (
              <InvoiceTable
                invoices={filtered}
                onMarkPaid={handleMarkPaid}
                onDelete={handleDelete}
              />
            )}
          </div>
        </div>

        <p className="text-center text-xs pb-6" style={{ color: "#1e2d4f" }}>
          ServiceSignal · Invoices saved securely in the cloud
        </p>
      </main>

      <AddInvoiceForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={handleAddInvoice}
      />

      {/* Delete confirmation modal */}
      {deleteId && (
        <>
          <div
            className="fixed inset-0 z-50"
            style={{ background: "rgba(5,8,15,0.8)", backdropFilter: "blur(4px)" }}
            onClick={() => setDeleteId(null)}
          />
          <div
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
            onClick={() => setDeleteId(null)}
          >
            <div
              className="w-full max-w-sm rounded-2xl p-6"
              style={{
                background: "#0f1628",
                border: "1px solid rgba(255,107,107,0.2)",
                boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.2)" }}
              >
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                  <path
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    stroke="#ff6b6b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h3
                className="font-display text-white mb-1"
                style={{ fontWeight: 800, fontSize: "1.2rem" }}
              >
                DELETE INVOICE?
              </h3>
              <p className="text-sm mb-6" style={{ color: "#94a3b8" }}>
                This will permanently remove the invoice and its reminder history. This can&apos;t be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteId(null)}
                  className="flex-1 py-2.5 rounded-lg text-sm font-display"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#94a3b8",
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                  }}
                >
                  CANCEL
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 py-2.5 rounded-lg text-sm font-display"
                  style={{
                    background: "rgba(255,107,107,0.12)",
                    border: "1px solid rgba(255,107,107,0.3)",
                    color: "#ff6b6b",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                  }}
                >
                  DELETE
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
