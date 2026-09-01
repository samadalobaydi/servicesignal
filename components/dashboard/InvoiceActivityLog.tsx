"use client";

import { useState } from "react";
import { useDashboard } from "./DashboardProvider";
import { buildInvoiceActivityEntries } from "@/lib/invoice-activity";

/** e.g. "5 Jul 2026 at 22:41" */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} at ${time}`;
}

/**
 * The stored payment link, shown once with an explicit copy action.
 *
 * ── WHY THIS LIVES HERE, NOT AS A TIMELINE ENTRY ─────────────────────────
 *
 * A payment link is a static fact about the invoice, not something that
 * happened at a point in time — it has no natural place among "Invoice
 * added" / "SMS and email reminder sent". Previously it surfaced as a bare
 * "Payment link added" hint under the customer name on the collapsed row,
 * with no way to actually see or use the link. Moving it here keeps the
 * collapsed row uncluttered and gives it an obvious home: expand history,
 * see the actual URL, copy it.
 *
 * Routing semantics are unchanged — ServiceSignal still never processes or
 * holds payment; this only makes an already-stored value visible and
 * copyable.
 */
function PaymentLinkBlock({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied or unavailable (permissions, older
      // browsers, non-secure context). The link is still selectable text —
      // nothing here needs a fallback message beyond leaving the button as
      // it was.
    }
  };

  return (
    <div
      className="rounded-lg p-3 mb-3"
      style={{ background: "#ffffff", border: "1px solid var(--dash-border)" }}
    >
      <p className="text-xs uppercase" style={{ color: "var(--dash-text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>
        Payment link
      </p>
      <div className="flex items-center gap-2 mt-1.5">
        <p className="text-sm truncate flex-1" style={{ color: "var(--dash-text)" }} title={url}>
          {url}
        </p>
        <button
          type="button"
          onClick={copy}
          className="dash-btn-ghost flex-shrink-0"
          style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
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
  const { liveInvoices, reminders, reminderHistory, channelStatuses } = useDashboard();

  const invoice = liveInvoices.find((i) => i.id === invoiceId);

  // Newest activity first, plus (when nothing is pending) the next scheduled
  // checkpoint — see lib/invoice-activity.ts for why this is a pure function
  // rather than built inline: it is the one place that decides whether a
  // reminder is described as reaching one channel or the pair, and that
  // decision needs to be testable without a browser.
  const sorted = buildInvoiceActivityEntries({
    invoice,
    pendingForInvoice: reminders.filter((r) => r.invoice_id === invoiceId),
    historyForInvoice: reminderHistory.filter((r) => r.invoice_id === invoiceId),
    channelStatuses,
  });

  return (
    <div
      className="rounded-lg p-3.5"
      style={{ background: "var(--dash-card-muted)", border: "1px solid var(--dash-border)" }}
    >
      <p className="text-xs uppercase mb-2.5" style={{ color: "var(--dash-text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>
        Invoice History
      </p>
      {invoice?.payment_link && <PaymentLinkBlock url={invoice.payment_link} />}
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
                {/* dateOnly entries (currently: "Next reminder scheduled")
                    already spell the date out in the label itself, and
                    `when` for them is a bare YYYY-MM-DD with no real
                    time-of-day — formatWhen() would print a spurious
                    "at 01:00" (UTC midnight shifted by the browser's local
                    offset) for a value that was never a real timestamp. */}
                {!e.dateOnly && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--dash-text-soft)" }}>{formatWhen(e.when)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
