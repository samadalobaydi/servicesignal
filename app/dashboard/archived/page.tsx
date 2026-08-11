"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { fetchArchivedInvoices, formatCurrency, formatDate } from "@/lib/invoices";
import type { Invoice } from "@/types";

/**
 * Archived invoices — read only.
 *
 * ── WHY THIS PAGE HAD TO EXIST ───────────────────────────────────────────
 *
 * Archive preserved everything and showed the customer nothing. The
 * confirmation promised "existing reminder history will be kept" and then gave
 * them no way to verify it, which makes Archive indistinguishable from a
 * Delete that lies. The smallest thing that makes the promise checkable is a
 * list of what was archived.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────
 *
 * No unarchive. Restoring raises real questions — missed checkpoints, a due
 * date long past, reminders_sent already containing schedules, whether the
 * allowance ledger should move — and getting any of them wrong sends a
 * customer's customer a wrong message. A read-only view answers the trust
 * problem without inventing answers to those.
 *
 * No reminder-history detail. The channel content exists and could be shown,
 * but rendering per-reminder delivery state is a surface of its own. The
 * archive confirmation copy was changed to say "records" rather than implying
 * this page browses them.
 */
export default function ArchivedInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchArchivedInvoices(getSupabaseBrowser()).then((rows) => {
      if (!cancelled) setInvoices(rows);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 style={{ fontSize: "1.85rem", fontWeight: 700, color: "var(--dash-text)", letterSpacing: "-0.02em" }}>
          Archived
        </h1>
        <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)" }}>
          Invoices you removed from chasing. Their records are kept.
        </p>
      </div>

      {invoices === null ? null : invoices.length === 0 ? (
        <div className="dash-card p-8">
          <p style={{ fontSize: "1.05rem", fontWeight: 650, color: "var(--dash-text)" }}>
            No archived invoices
          </p>
          <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)" }}>
            Invoices you archive will appear here.
          </p>
        </div>
      ) : (
        <section className="dash-card dash-section" aria-labelledby="archived-h">
          <h2 id="archived-h" className="sr-only">Archived invoices</h2>
          <ul className="ss-archived-list">
            {invoices.map((inv) => (
              <li key={inv.id} className="ss-archived-row">
                <span className="ss-archived-who">
                  {inv.customer_name}
                  {inv.invoice_reference && (
                    <span style={{ color: "var(--dash-text-soft)", fontWeight: 400 }}>
                      {" · "}{inv.invoice_reference}
                    </span>
                  )}
                </span>
                <span className="ss-archived-meta">
                  {formatCurrency(inv.amount)}
                  {" · due "}{formatDate(inv.due_date)}
                  {" · archived "}{inv.archived_at ? formatDate(inv.archived_at.slice(0, 10)) : "—"}
                </span>
                {/*
                  Paid and archived are different facts, and archiving never
                  touched status — so this stays truthful either way rather
                  than labelling every archived invoice as one or the other.
                */}
                <span className={`ss-archived-tag ss-archived-tag--${inv.status === "paid" ? "paid" : "unpaid"}`}>
                  {inv.status === "paid" ? "Paid" : "Unpaid"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
