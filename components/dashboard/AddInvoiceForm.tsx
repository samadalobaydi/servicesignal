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
  { value: "friendly", label: "Friendly", desc: "Polite nudge, good faith", color: "#059669" },
  { value: "firm",     label: "Firm",     desc: "Professional & direct",    color: "#0891b2" },
  { value: "final",    label: "Final",    desc: "Urgent, last reminder",    color: "#dc2626" },
];

const SCHEDULE_OPTIONS = SCHEDULE_ORDER;

// ── Smart reminder presets (frontend mapping only — same schedule values) ──
type PresetKey = "light" | "standard" | "firm" | "custom";

const PRESETS: {
  key: PresetKey;
  title: string;
  subtitle: string;
  summary?: string;
  badge?: string;
  schedules?: ReminderSchedule[];
}[] = [
  {
    key: "light", title: "Light", subtitle: "Friendly nudge",
    summary: "Due date + 7 days overdue",
    schedules: ["due_today", "overdue_7_days"],
  },
  {
    key: "standard", title: "Standard", subtitle: "Balanced follow-up", badge: "Recommended",
    summary: "Due date + 3 and 7 days overdue",
    schedules: ["due_today", "overdue_3_days", "overdue_7_days"],
  },
  {
    key: "firm", title: "Firm", subtitle: "For stubborn late payers",
    summary: "3 days before + due date + 3, 7 and 14 days overdue",
    schedules: ["before_due_3_days", "due_today", "overdue_3_days", "overdue_7_days", "overdue_14_days"],
  },
  {
    key: "custom", title: "Custom schedule", subtitle: "Choose reminder days manually",
  },
];

interface AddInvoiceFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: InvoiceFormData) => void;
}

export default function AddInvoiceForm({ open, onClose, onSave }: AddInvoiceFormProps) {
  const [form, setForm] = useState<InvoiceFormData>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [preset, setPreset] = useState<PresetKey>("standard");

  useEffect(() => {
    // Standard is selected by default every time the modal opens
    // (EMPTY_FORM's schedules match the Standard preset).
    if (open) { setForm(EMPTY_FORM); setErrors({}); setPreset("standard"); }
  }, [open]);

  const selectPreset = (key: PresetKey) => {
    setPreset(key);
    const chosen = PRESETS.find((p) => p.key === key);
    // Light/Standard/Firm overwrite the schedule; Custom preserves current picks.
    if (chosen?.schedules) {
      setForm((prev) => ({ ...prev, reminder_schedules: [...chosen.schedules!] }));
    }
  };

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
    if (form.payment_link.trim() && !form.payment_link.trim().startsWith("https://"))
      e.payment_link = "Enter a valid payment link starting with https://";
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
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--dash-border)" }}
        >
          <div>
            <h2 style={{ fontWeight: 700, fontSize: "1.3rem", color: "var(--dash-text)", letterSpacing: "-0.01em" }}>
              ADD INVOICE
            </h2>
            <p className="text-sm" style={{ color: "var(--dash-text-muted)" }}>Fill in the details below</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "var(--dash-card-muted)", border: "1px solid var(--dash-border)" }}
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
                  <input type="text" className="dash-input" placeholder="Dave Morrison"
                    value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} />
                  {errors.customer_name && <p className="field-err">{errors.customer_name}</p>}
                </div>
                <div>
                  <label className="field-label">Email Address *</label>
                  <input type="email" className="dash-input" placeholder="dave@example.co.uk"
                    value={form.customer_email} onChange={(e) => set("customer_email", e.target.value)} />
                  {errors.customer_email && <p className="field-err">{errors.customer_email}</p>}
                </div>
                <div>
                  <label className="field-label">Phone Number <span className="opt">(optional)</span></label>
                  <input type="tel" className="dash-input" placeholder="07700 900000"
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
                    <input type="number" min="0.01" step="0.01" className="dash-input" placeholder="0.00"
                      value={form.amount} onChange={(e) => set("amount", e.target.value)} />
                    {errors.amount && <p className="field-err">{errors.amount}</p>}
                  </div>
                  <div>
                    <label className="field-label">Due Date *</label>
                    <input type="date" className="dash-input" value={form.due_date}
                      onChange={(e) => set("due_date", e.target.value)} style={{ colorScheme: "dark" }} />
                    {errors.due_date && <p className="field-err">{errors.due_date}</p>}
                  </div>
                </div>
                <div>
                  <label className="field-label">Payment link <span className="opt">(optional)</span></label>
                  <p className="text-xs mb-1.5" style={{ color: "#64748b" }}>
                    Paste a Stripe, GoCardless, PayPal, SumUp or bank payment link so customers can pay from the reminder.
                  </p>
                  <input type="url" className="dash-input" placeholder="https://pay.stripe.com/..."
                    value={form.payment_link} onChange={(e) => set("payment_link", e.target.value)} />
                  {errors.payment_link && <p className="field-err">{errors.payment_link}</p>}
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
                        background: form.reminder_tone === opt.value ? `${opt.color}10` : "#ffffff",
                        borderColor: form.reminder_tone === opt.value ? opt.color : "var(--dash-border)",
                      }}
                    >
                      <p className="text-sm" style={{ fontWeight: 650, color: form.reminder_tone === opt.value ? opt.color : "var(--dash-text)" }}>
                        {opt.label}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--dash-text-muted)", lineHeight: 1.3 }}>{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Schedule */}
              <div>
                <label className="field-label">Reminder Schedule</label>

                {/* Preset cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PRESETS.map((p) => {
                    const active = preset === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => selectPreset(p.key)}
                        aria-pressed={active}
                        aria-label={`${p.title} reminder schedule — ${p.subtitle}`}
                        className="text-left p-3 rounded-xl border transition-all"
                        style={{
                          background: active ? "var(--dash-accent-soft)" : "#ffffff",
                          borderColor: active ? "var(--dash-accent)" : "var(--dash-border)",
                          boxShadow: active ? "0 0 0 1px var(--dash-accent)" : "none",
                          cursor: "pointer",
                        }}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm" style={{ fontWeight: 650, color: active ? "var(--dash-accent-strong)" : "#0f172a" }}>
                            {p.title}
                          </p>
                          {p.badge && (
                            <span
                              className="text-xs px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0"
                              style={{ background: "var(--dash-accent-soft)", color: "var(--dash-accent-strong)", fontWeight: 600, border: "1px solid #a5f0fa" }}
                            >
                              {p.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-xs mt-0.5" style={{ color: "#64748b" }}>{p.subtitle}</p>
                        {p.summary && (
                          <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>{p.summary}</p>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Custom schedule: manual options, clean white rows */}
                {preset === "custom" && (
                  <div className="space-y-2 mt-3">
                    {SCHEDULE_OPTIONS.map((s) => {
                      const checked = form.reminder_schedules.includes(s);
                      return (
                        <label key={s} className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all"
                          style={{
                            background: "#ffffff",
                            border: "1px solid var(--dash-border)",
                          }}
                        >
                          <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                            style={{
                              background: checked ? "var(--dash-accent)" : "transparent",
                              border: `2px solid ${checked ? "var(--dash-accent)" : "var(--dash-border-strong)"}`,
                            }}
                          >
                            {checked && (
                              <svg width="9" height="9" fill="none" viewBox="0 0 24 24">
                                <path d="M5 13l4 4L19 7" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          <span className="text-sm" style={{ color: "#0f172a" }}>
                            {SCHEDULE_LABELS[s]}
                          </span>
                          <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleSchedule(s)} />
                        </label>
                      );
                    })}
                  </div>
                )}
                {errors.reminder_schedules && <p className="field-err mt-1">{errors.reminder_schedules}</p>}
              </div>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 flex-shrink-0"
          style={{ borderTop: "1px solid var(--dash-border)", background: "#ffffff" }}>
          <button type="button" onClick={onClose}
            className="dash-btn-ghost flex-1 justify-center">
            CANCEL
          </button>
          <button type="submit" form="add-invoice-form" className="dash-btn flex-1 justify-center"
            style={{ padding: "0.6rem 1rem", fontSize: "0.9rem" }}>
            SAVE INVOICE
          </button>
        </div>
      </div>

      <style>{`
        .section-legend {
          font-family: 'DM Sans', sans-serif;
          font-size: 0.95rem;
          font-weight: 650;
          color: #0f172a;
          padding-bottom: 0.5rem;
          margin-bottom: 0.85rem;
          border-bottom: 1px solid #e5e7eb;
        }
        .field-label {
          display: block;
          font-family: 'DM Sans', sans-serif;
          font-size: 0.85rem;
          font-weight: 600;
          color: #0f172a;
          margin-bottom: 0.4rem;
        }
        .opt {
          font-family: 'DM Sans', sans-serif;
          text-transform: none;
          letter-spacing: 0;
          font-weight: 400;
          color: #64748b;
        }
        .field-err {
          font-size: 0.78rem;
          color: #dc2626;
          margin-top: 0.25rem;
        }
      `}</style>
    </>
  );
}
