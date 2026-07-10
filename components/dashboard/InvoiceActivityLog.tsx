"use client";

import { useDashboard } from "./DashboardProvider";
import { formatCurrency, formatDate } from "@/lib/invoices";

interface Entry {
  key: string;
  when: string;
  label: string;
  color: string;
  detail?: string;
}

/** e.g. "5 Jul 2026 at 22:41" */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} at ${time}`;
}

/**
 * A compact per-invoice activity timeline. Reads the SAME existing data the
 * Overview Recent Activity feed uses (invoices + reminder logs from the
 * dashboard provider) and filters it to one invoice. No extra fetching,
 * no schema — pure presentation.
 *
 * Shown newest-first so the latest activity is immediately visible.
 */
/**
 * Icon-only chevron toggle for the invoice history panel.
 * Closed: cyan down arrow ("Show invoice history").
 * Open:   red up arrow   ("Hide invoice history").
 */
export function HistoryToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={open ? "Hide invoice history" : "Show invoice history"}
      title={open ? "Hide invoice history" : "Show invoice history"}
      className="inline-flex items-center justify-center rounded-lg flex-shrink-0 transition-colors"
      style={{
        width: 34,
        height: 34,
        background: "#ffffff",
        border: "1px solid var(--dash-border-strong)",
        color: open ? "var(--dash-red)" : "var(--dash-accent-strong)",
      }}
    >
      <svg
        width="15"
        height="15"
        fill="none"
        viewBox="0 0 24 24"
        style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
      >
        <path d="M19 9l-7 7-7-7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export default function InvoiceActivityLog({ invoiceId }: { invoiceId: string }) {
  const { liveInvoices, reminders, reminderHistory } = useDashboard();

  const invoice = liveInvoices.find((i) => i.id === invoiceId);
  const entries: Entry[] = [];

  if (invoice) {
    entries.push({
      key: "added", when: invoice.created_at,
      label: "Invoice added", color: "var(--dash-accent-strong)",
      detail: `${formatCurrency(invoice.amount)} invoice due ${formatDate(invoice.due_date)}`,
    });
    if (invoice.status === "paid" && invoice.paid_at) {
      entries.push({
        key: "paid", when: invoice.paid_at,
        label: "Invoice marked paid — future reminders stopped", color: "var(--dash-green)",
      });
    }
  }

  for (const r of reminders) {
    if (r.invoice_id !== invoiceId) continue;
    entries.push({ key: `prep-${r.id}`, when: r.created_at, label: "Email reminder prepared", color: "var(--dash-accent-strong)" });
  }

  for (const r of reminderHistory) {
    if (r.invoice_id !== invoiceId) continue;
    if (r.status === "sent") {
      entries.push({ key: `sent-${r.id}`, when: r.sent_at ?? r.created_at, label: "Email reminder sent", color: "var(--dash-green)" });
    } else if (r.status === "dismissed") {
      entries.push({ key: `dis-${r.id}`, when: r.created_at, label: "Reminder dismissed", color: "var(--dash-text-soft)" });
    } else if (r.status === "failed") {
      entries.push({ key: `fail-${r.id}`, when: r.created_at, label: "Reminder failed to send", color: "var(--dash-red)" });
    }
  }

  // Newest first — the most recent activity sits at the top of the panel.
  const sorted = entries.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());

  return (
    <div
      className="rounded-lg p-3.5"
      style={{ background: "var(--dash-card-muted)", border: "1px solid var(--dash-border)" }}
    >
      <p className="text-xs uppercase mb-2.5" style={{ color: "var(--dash-text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>
        Invoice History
      </p>
      {sorted.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--dash-text-soft)" }}>No activity recorded yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((e) => (
            <div key={e.key} className="flex items-start gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: e.color }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm" style={{ color: "var(--dash-text)", fontWeight: 500 }}>{e.label}</p>
                {e.detail && (
                  <p className="text-sm" style={{ color: "var(--dash-text-muted)" }}>{e.detail}</p>
                )}
                <p className="text-xs mt-0.5" style={{ color: "var(--dash-text-soft)" }}>{formatWhen(e.when)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
