"use client";

import { useEffect } from "react";
import type { InvoiceFormData } from "@/types";
import { useInvoiceForm } from "@/components/invoice/useInvoiceForm";
import { InvoiceFields } from "@/components/invoice/InvoiceFields";

interface AddInvoiceFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: InvoiceFormData) => void;
  /**
   * Edit mode. The SAME drawer, the same fields, the same validation — only
   * the title, the button and the seeding differ. A second invoice form would
   * be a second place for the field rules to drift.
   */
  mode?: "add" | "edit";
  /** Prefill for edit mode. Ignored when adding. */
  initial?: InvoiceFormData;
  /** Shown above the actions when saving will refresh an unsent reminder. */
  consequenceWarning?: string | null;
  saving?: boolean;
}

/**
 * The dashboard's add-invoice slide-over.
 *
 * The fields, presets and validation now live in components/invoice so the
 * onboarding step uses exactly the same ones. What stays here is what is
 * genuinely specific to this surface: the overlay, the slide-over frame,
 * Escape-to-close, the header and the footer buttons.
 *
 * The props are unchanged, and so is the behaviour: the form resets to
 * Standard every time it opens, and onSave still receives the data before
 * onClose runs.
 *
 * Reminder-eligibility validation is deliberately NOT enabled here. The
 * dashboard records invoices whenever they exist, including ones due next
 * month; requiring an immediately-preparable schedule would reject correct
 * data. Only onboarding opts in, because it has to end on a real reminder.
 */
export default function AddInvoiceForm({
  open, onClose, onSave, mode = "add", initial, consequenceWarning = null, saving = false,
}: AddInvoiceFormProps) {
  const editing = mode === "edit";
  const state = useInvoiceForm(editing && initial ? { initial } : {});
  const { reset, validateAndGet } = state;

  // Reset on open, matching the previous behaviour exactly.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = validateAndGet();
    if (!data) return;
    onSave(data);
    // Adding closes immediately, as it always has. Editing does not: the save
    // may come back asking the owner to confirm refreshing an unsent reminder,
    // and closing the drawer would throw away everything they typed.
    if (!editing) onClose();
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(3px)" }}
        onClick={onClose}
      />

      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col overflow-hidden w-full sm:w-[480px]"
        style={{
          background: "#ffffff",
          borderLeft: "1px solid rgba(0,200,255,0.12)",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.5)",
        }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--dash-border)" }}
        >
          <div>
            <h2 style={{ fontWeight: 700, fontSize: "1.3rem", color: "var(--dash-text)", letterSpacing: "-0.01em" }}>
              {editing ? "Edit invoice" : "ADD INVOICE"}
            </h2>
            <p className="text-sm" style={{ color: "var(--dash-text-muted)" }}>
              {editing ? "Update the details below" : "Fill in the details below"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "var(--dash-card-muted)", border: "1px solid var(--dash-border)" }}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" stroke="#c2ccdb" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {consequenceWarning && (
          <div
            role="status"
            className="mx-6 mt-4 rounded-lg px-4 py-3"
            style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}
          >
            <p className="text-sm" style={{ fontWeight: 650 }}>Update invoice?</p>
            <p className="text-sm mt-0.5" style={{ lineHeight: 1.5 }}>{consequenceWarning}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <form id="add-invoice-form" onSubmit={handleSubmit} noValidate>
            <InvoiceFields state={state} />
          </form>
        </div>

        <div
          className="flex gap-3 px-6 py-4 flex-shrink-0"
          style={{ borderTop: "1px solid var(--dash-border)", background: "#ffffff" }}
        >
          <button type="button" onClick={onClose} disabled={saving} className="dash-btn-ghost flex-1 justify-center">
            {editing ? "Cancel" : "CANCEL"}
          </button>
          <button
            type="submit"
            form="add-invoice-form"
            disabled={saving}
            className="dash-btn flex-1 justify-center"
            style={{ padding: "0.6rem 1rem", fontSize: "0.9rem" }}
          >
            {editing ? (saving ? "Saving…" : "Save changes") : "SAVE INVOICE"}
          </button>
        </div>
      </div>

    </>
  );
}
