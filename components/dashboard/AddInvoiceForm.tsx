"use client";

import { useState, useEffect } from "react";
import type { InvoiceFormData, ReminderSchedule, ReminderTone } from "@/types";
import { SCHEDULE_LABELS, SCHEDULE_ORDER } from "@/lib/invoices";

const EMPTY_FORM: InvoiceFormData = {
  customer_name: "",
  customer_email: "",
  customer_phone: "",
  amount: "",
  due_date: "",
  payment_link: "",
  reminder_tone: "firm",
  reminder_schedules: ["due_today", "overdue_3_days", "overdue_7_days"],
};

const TONE_OPTIONS: { value: ReminderTone; label: string; desc: string; color: string }[] = [
  { value: "friendly", label: "Friendly", desc: "Polite nudge, good faith", color: "#00e676" },
  { value: "firm",     label: "Firm",     desc: "Professional & direct",    color: "#00c8ff" },
  { value: "final",    label: "Final",    desc: "Urgent, last reminder",    color: "#ff6b6b" },
];

const SCHEDULE_OPTIONS = SCHEDULE_ORDER;

interface AddInvoiceFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: InvoiceFormData) => void;
}

export default function AddInvoiceForm({ open, onClose, onSave }: AddInvoiceFormProps) {
  const [form, setForm] = useState<InvoiceFormData>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});

  useEffect(() => {
    if (open) { setForm(EMPTY_FORM); setErrors({}); }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const set = (field: keyof InvoiceFormData, value: unknown) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const toggleSchedule = (s: ReminderSchedule) => {
    setForm((prev) => ({
      ...prev,
      reminder_schedules: prev.reminder_schedules.includes(s)
        ? prev.reminder_schedules.filter((x) => x !== s)
        : [...prev.reminder_schedules, s],
    }));
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.customer_name.trim()) e.customer_name = "Name is required";
    if (!form.customer_email.trim()) e.customer_email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customer_email))
      e.customer_email = "Enter a valid email";
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0)
      e.amount = "Enter a valid amount";
    if (!form.due_date) e.due_date = "Due date is required";
    if (form.reminder_schedules.length === 0)
      e.reminder_schedules = "Pick at least one reminder";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) { onSave(form); onClose(); }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(5,8,15,0.75)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />

      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col overflow-hidden w-full sm:w-[480px]"
        style={{
          background: "#141a2b",
          borderLeft: "1px solid rgba(0,200,255,0.12)",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.10)" }}
        >
          <div>
            <h2 className="font-display text-white" style={{ fontWeight: 800, fontSize: "1.3rem" }}>
              ADD INVOICE
            </h2>
            <p className="text-xs" style={{ color: "#a3b0c4" }}>Fill in the details below</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" stroke="#c2ccdb" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <form id="add-invoice-form" onSubmit={handleSubmit} className="space-y-6" noValidate>

            {/* Customer details */}
            <div>
              <p className="section-legend">Customer Details</p>
              <div className="space-y-3">
                <div>
                  <label className="field-label">Customer Name *</label>
                  <input type="text" className="form-input" placeholder="Dave Morrison"
                    value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} />
                  {errors.customer_name && <p className="field-err">{errors.customer_name}</p>}
                </div>
                <div>
                  <label className="field-label">Email Address *</label>
                  <input type="email" className="form-input" placeholder="dave@example.co.uk"
                    value={form.customer_email} onChange={(e) => set("customer_email", e.target.value)} />
                  {errors.customer_email && <p className="field-err">{errors.customer_email}</p>}
                </div>
                <div>
                  <label className="field-label">Phone Number <span className="opt">(optional)</span></label>
                  <input type="tel" className="form-input" placeholder="07700 900000"
                    value={form.customer_phone} onChange={(e) => set("customer_phone", e.target.value)} />
                </div>
              </div>
            </div>

            {/* Invoice details */}
            <div>
              <p className="section-legend">Invoice Details</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">Amount (£) *</label>
                    <input type="number" min="0.01" step="0.01" className="form-input" placeholder="0.00"
                      value={form.amount} onChange={(e) => set("amount", e.target.value)} />
                    {errors.amount && <p className="field-err">{errors.amount}</p>}
                  </div>
                  <div>
                    <label className="field-label">Due Date *</label>
                    <input type="date" className="form-input" value={form.due_date}
                      onChange={(e) => set("due_date", e.target.value)} style={{ colorScheme: "dark" }} />
                    {errors.due_date && <p className="field-err">{errors.due_date}</p>}
                  </div>
                </div>
                <div>
                  <label className="field-label">Payment Link <span className="opt">(sent in reminders)</span></label>
                  <input type="url" className="form-input" placeholder="https://pay.stripe.com/..."
                    value={form.payment_link} onChange={(e) => set("payment_link", e.target.value)} />
                </div>
              </div>
            </div>

            {/* Reminder settings */}
            <div>
              <p className="section-legend">Reminder Settings</p>

              {/* Tone */}
              <div className="mb-4">
                <label className="field-label">Reminder Tone</label>
                <div className="grid grid-cols-3 gap-2">
                  {TONE_OPTIONS.map((opt) => (
                    <button key={opt.value} type="button" onClick={() => set("reminder_tone", opt.value)}
                      className="p-2.5 rounded-lg border text-left transition-all"
                      style={{
                        background: form.reminder_tone === opt.value ? `${opt.color}12` : "rgba(255,255,255,0.02)",
                        borderColor: form.reminder_tone === opt.value ? opt.color : "rgba(255,255,255,0.08)",
                      }}
                    >
                      <p className="font-display text-sm" style={{ fontWeight: 700, color: form.reminder_tone === opt.value ? opt.color : "#c2ccdb" }}>
                        {opt.label}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#9aa7bd", lineHeight: 1.3 }}>{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Schedule */}
              <div>
                <label className="field-label">Send Reminders At These Points</label>
                <div className="space-y-2">
                  {SCHEDULE_OPTIONS.map((s) => {
                    const checked = form.reminder_schedules.includes(s);
                    return (
                      <label key={s} className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all"
                        style={{
                          background: checked ? "rgba(0,200,255,0.06)" : "rgba(255,255,255,0.02)",
                          border: `1px solid ${checked ? "rgba(0,200,255,0.2)" : "rgba(255,255,255,0.10)"}`,
                        }}
                      >
                        <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                          style={{
                            background: checked ? "#00c8ff" : "transparent",
                            border: `2px solid ${checked ? "#00c8ff" : "rgba(255,255,255,0.2)"}`,
                          }}
                        >
                          {checked && (
                            <svg width="9" height="9" fill="none" viewBox="0 0 24 24">
                              <path d="M5 13l4 4L19 7" stroke="#141a2b" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <span className="text-sm" style={{ color: checked ? "#ffffff" : "#c2ccdb" }}>
                          {SCHEDULE_LABELS[s]}
                        </span>
                        <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleSchedule(s)} />
                      </label>
                    );
                  })}
                </div>
                {errors.reminder_schedules && <p className="field-err mt-1">{errors.reminder_schedules}</p>}
              </div>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 flex-shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.10)", background: "#141a2b" }}>
          <button type="button" onClick={onClose}
            className="flex-1 py-2.5 rounded-lg text-sm font-display transition-colors"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#c2ccdb", fontWeight: 600, letterSpacing: "0.06em" }}>
            CANCEL
          </button>
          <button type="submit" form="add-invoice-form" className="flex-1 btn-primary"
            style={{ padding: "0.6rem 1rem", fontSize: "0.9rem" }}>
            SAVE INVOICE
          </button>
        </div>
      </div>

      <style>{`
        .section-legend {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #00c8ff;
          border-bottom: 1px solid rgba(0,200,255,0.1);
          padding-bottom: 0.4rem;
          margin-bottom: 0.75rem;
        }
        .field-label {
          display: block;
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #a3b0c4;
          margin-bottom: 0.35rem;
        }
        .opt {
          font-family: 'DM Sans', sans-serif;
          text-transform: none;
          letter-spacing: 0;
          font-weight: 400;
          color: #9aa7bd;
        }
        .field-err {
          font-size: 0.72rem;
          color: #ff6b6b;
          margin-top: 0.25rem;
        }
      `}</style>
    </>
  );
}
