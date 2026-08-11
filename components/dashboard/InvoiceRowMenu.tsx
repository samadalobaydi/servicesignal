"use client";

import { useEffect, useRef, useState } from "react";
import type { Invoice } from "@/types";
import { removalActionFor } from "@/lib/invoice-lifecycle-service";
import {
  DELETE_CONFIRM_TITLE, DELETE_CONFIRM_BODY,
  ARCHIVE_CONFIRM_TITLE, ARCHIVE_CONFIRM_BODY,
  IN_FLIGHT_MESSAGE,
} from "@/lib/invoice-lifecycle";

/**
 * The `⋯` management menu on an Active Chasing row.
 *
 * Review reminder / Dismiss / Mark Paid stay as buttons — they are the daily
 * workflow. Edit and remove are management actions taken rarely, so they live
 * behind one discreet control rather than adding two more buttons to every row.
 *
 * ── DELETE OR ARCHIVE, NEVER BOTH ────────────────────────────────────────
 *
 * The menu asks removalActionFor() — the SAME function the server calls — so
 * the word the customer sees and the rule the API enforces cannot disagree.
 * Showing both would ask the customer a question the system already knows the
 * answer to, and the wrong answer is unrecoverable.
 *
 * The menu is UX. It is not the enforcement: the API re-checks, and migration
 * 012's trigger refuses at the database.
 */

interface Props {
  invoice: Invoice;
  /** Every reminder_logs.status for this invoice. */
  reminderStatuses: readonly string[];
  onEdit: (invoice: Invoice) => void;
  onDelete: (invoice: Invoice) => Promise<boolean>;
  onArchive: (invoice: Invoice) => Promise<boolean>;
}

type Confirming = null | "delete" | "archive";

export default function InvoiceRowMenu({ invoice, reminderStatuses, onEdit, onDelete, onArchive }: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const decision = removalActionFor(reminderStatuses, invoice.archived_at ?? null);
  const inFlight = !decision.allowed && decision.reason === "in_flight";
  const removal = decision.allowed ? decision.action : null;

  const label = invoice.invoice_reference || invoice.customer_name;

  // Escape closes, and returns focus to the trigger so the keyboard user is
  // not dropped at the top of the document.
  useEffect(() => {
    if (!open && !confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirming) setConfirming(null);
      else {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, confirming]);

  // Outside click closes the menu. Not the confirmation — a destructive
  // dialog must be dismissed deliberately, not by a stray click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const run = async (action: "delete" | "archive") => {
    setBusy(true);
    const ok = action === "delete" ? await onDelete(invoice) : await onArchive(invoice);
    setBusy(false);
    if (ok) { setConfirming(null); setOpen(false); }
    else setConfirming(null);
  };

  return (
    <div className="ss-rowmenu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ss-rowmenu-trigger"
        aria-label={`More actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Three dots drawn, not an emoji — an emoji renders differently on
            every platform and carries a name screen readers announce. */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>

      {open && !confirming && (
        <div className="ss-rowmenu-list" role="menu" aria-label={`Actions for ${label}`}>
          <button
            type="button" role="menuitem" className="ss-rowmenu-item"
            disabled={inFlight}
            onClick={() => { setOpen(false); onEdit(invoice); }}
          >
            Edit invoice
          </button>

          {removal === "delete" && (
            <button
              type="button" role="menuitem" className="ss-rowmenu-item ss-rowmenu-item--destructive"
              onClick={() => setConfirming("delete")}
            >
              Delete invoice
            </button>
          )}

          {removal === "archive" && (
            <button
              type="button" role="menuitem" className="ss-rowmenu-item"
              onClick={() => setConfirming("archive")}
            >
              Archive invoice
            </button>
          )}

          {inFlight && (
            <p className="ss-rowmenu-note" role="status">{IN_FLIGHT_MESSAGE}</p>
          )}
        </div>
      )}

      {confirming && (
        <div className="ss-rowmenu-confirm" role="dialog" aria-modal="false" aria-label={
          confirming === "delete" ? DELETE_CONFIRM_TITLE : ARCHIVE_CONFIRM_TITLE
        }>
          <p className="ss-rowmenu-confirm-title">
            {confirming === "delete" ? DELETE_CONFIRM_TITLE : ARCHIVE_CONFIRM_TITLE}
          </p>
          <p className="ss-rowmenu-confirm-body">
            {confirming === "delete" ? DELETE_CONFIRM_BODY : ARCHIVE_CONFIRM_BODY}
          </p>
          <div className="ss-rowmenu-confirm-actions">
            <button
              type="button"
              className={confirming === "delete" ? "ss-btn-destructive" : "dash-btn"}
              disabled={busy}
              onClick={() => run(confirming)}
            >
              {confirming === "delete" ? "Delete invoice" : "Archive invoice"}
            </button>
            <button type="button" className="dash-btn-ghost" disabled={busy} onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
