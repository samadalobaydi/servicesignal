"use client";

import { useState, useEffect } from "react";
import type { Invoice } from "@/types";
import { useDashboard } from "./DashboardProvider";
import { buildReminderEmail } from "@/lib/email-templates";
import { formatCurrency } from "@/lib/invoices";
import { getDueStatusLabel } from "@/lib/date-status";

type Channel = "email" | "sms";
type Step = "choose" | "preview" | "done";

interface ChannelPickerModalProps {
  invoice: Invoice;
  onClose: () => void;
  onPrepareEmail: (invoiceId: string) => Promise<{ success: boolean; message: string }>;
}

/**
 * Channel picker + preview MVP (v8.5.0).
 * Email uses the existing prepare flow unchanged. SMS is PREVIEW ONLY —
 * nothing is sent or created for SMS in this version. WhatsApp is coming soon.
 */
export default function ChannelPickerModal({ invoice, onClose, onPrepareEmail }: ChannelPickerModalProps) {
  const { profile, userEmail } = useDashboard();
  const [selected, setSelected] = useState<Set<Channel>>(new Set<Channel>(["email"]));
  const [step, setStep] = useState<Step>("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const hasPhone = Boolean(invoice.customer_phone && invoice.customer_phone.trim());
  const businessName = profile?.business_name?.trim() || userEmail || "your business";

  useEffect(() => {
    // Reset whenever the modal opens for a different invoice
    setSelected(new Set<Channel>(["email"]));
    setStep("choose");
    setError(null);
    setDoneMessage(null);
  }, [invoice.id]);

  const toggle = (c: Channel) => {
    if (c === "sms" && !hasPhone) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const emailSelected = selected.has("email");
  const smsSelected = selected.has("sms");
  const nothingSelected = selected.size === 0;

  // Genuine email preview using the real template builder (pure, client-safe).
  const emailPreview = emailSelected
    ? buildReminderEmail({
        tone: invoice.reminder_tone,
        schedule: "due_today", // display only — wording is computed live from the due date
        customerName: invoice.customer_name,
        businessName,
        amount: invoice.amount,
        dueDate: invoice.due_date,
        paymentLink: invoice.payment_link || undefined,
      })
    : null;

  const emailBodyPreview = emailPreview
    ? (emailPreview.text.split("\n\n")[2] ?? "").slice(0, 220)
    : "";

  // SMS preview text — display only, nothing is sent in this version.
  const smsText = `Hi ${invoice.customer_name.split(" ")[0]}, quick reminder from ${businessName}. Your invoice for ${formatCurrency(invoice.amount)} is ${getDueStatusLabel(invoice.due_date).toLowerCase()}.${invoice.payment_link ? ` Pay here: ${invoice.payment_link}` : ""}`;

  const prepareSelected = async () => {
    setError(null);

    if (emailSelected) {
      setBusy(true);
      const r = await onPrepareEmail(invoice.id);
      setBusy(false);
      if (!r.success) {
        setError(r.message);
        return;
      }
      setDoneMessage(
        smsSelected
          ? "Email reminder prepared — it's in your approval queue. SMS preview ready. Real SMS sending will be enabled in the next version."
          : "Email reminder prepared — it's in your approval queue."
      );
      setStep("done");
      return;
    }

    if (smsSelected) {
      // No backend call — SMS is preview-only in this version.
      setDoneMessage("SMS preview ready. Real SMS sending will be enabled in the next version.");
      setStep("done");
    }
  };

  const channelCard = (opts: {
    key: string;
    title: string;
    desc: string;
    active?: boolean;
    disabled?: boolean;
    badge?: string;
    onClick?: () => void;
  }) => (
    <button
      key={opts.key}
      type="button"
      onClick={opts.onClick}
      disabled={opts.disabled}
      aria-pressed={opts.active}
      aria-label={`${opts.title} — ${opts.desc}`}
      className="w-full text-left p-3.5 rounded-xl border transition-all"
      style={{
        background: opts.disabled ? "var(--dash-card-muted)" : opts.active ? "var(--dash-accent-soft)" : "#ffffff",
        borderColor: opts.active ? "var(--dash-accent)" : "var(--dash-border)",
        boxShadow: opts.active ? "0 0 0 1px var(--dash-accent)" : "none",
        cursor: opts.disabled ? "default" : "pointer",
        opacity: opts.disabled ? 0.65 : 1,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
          style={{
            background: opts.active ? "var(--dash-accent)" : "transparent",
            border: `2px solid ${opts.active ? "var(--dash-accent)" : "var(--dash-border-strong)"}`,
          }}
        >
          {opts.active && (
            <svg width="9" height="9" fill="none" viewBox="0 0 24 24">
              <path d="M5 13l4 4L19 7" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <p className="text-sm" style={{ fontWeight: 650, color: opts.active ? "var(--dash-accent-strong)" : "var(--dash-text)" }}>
          {opts.title}
        </p>
        {opts.badge && (
          <span className="text-xs px-1.5 py-0.5 rounded whitespace-nowrap" style={{ background: "var(--dash-amber-soft)", color: "var(--dash-amber)", fontWeight: 600 }}>
            {opts.badge}
          </span>
        )}
      </div>
      <p className="text-xs mt-1 ml-6" style={{ color: "var(--dash-text-muted)" }}>{opts.desc}</p>
    </button>
  );

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(3px)" }}
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
        <div
          className="w-full max-w-md rounded-2xl my-auto overflow-hidden"
          style={{ background: "#ffffff", border: "1px solid var(--dash-border)", boxShadow: "var(--dash-shadow-lg)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--dash-border)" }}>
            <h3 style={{ fontWeight: 700, fontSize: "1.15rem", color: "var(--dash-text)", letterSpacing: "-0.01em" }}>
              Choose reminder channels
            </h3>
            <p className="text-sm mt-1" style={{ color: "var(--dash-text-muted)" }}>
              {step === "choose" ? "Pick how you want to chase this invoice." : `${invoice.customer_name} · ${formatCurrency(invoice.amount)}`}
            </p>
          </div>

          <div className="px-6 py-5">
            {step === "choose" && (
              <div className="space-y-2.5">
                {channelCard({
                  key: "email", title: "Email", desc: "Send the full reminder email.",
                  active: emailSelected, onClick: () => toggle("email"),
                })}
                {channelCard({
                  key: "sms", title: "SMS",
                  desc: hasPhone ? "Short payment text with a Pay Now link." : "SMS unavailable — add customer phone number first.",
                  active: smsSelected, disabled: !hasPhone, onClick: () => toggle("sms"),
                })}
                {channelCard({
                  key: "whatsapp", title: "WhatsApp", desc: "Coming soon", badge: "Coming soon", disabled: true,
                })}
              </div>
            )}

            {step === "preview" && (
              <div className="space-y-4">
                {emailSelected && emailPreview && (
                  <div className="rounded-xl p-4" style={{ background: "var(--dash-card-muted)", border: "1px solid var(--dash-border)" }}>
                    <p className="text-xs uppercase mb-2" style={{ color: "var(--dash-text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>Email preview</p>
                    <p className="text-sm" style={{ fontWeight: 650, color: "var(--dash-text)" }}>{emailPreview.subject}</p>
                    <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)", lineHeight: 1.5 }}>{emailBodyPreview}…</p>
                    {invoice.payment_link && (
                      <p className="text-xs mt-2" style={{ color: "var(--dash-accent-strong)", fontWeight: 600 }}>Includes a Pay Now button linking to your payment link.</p>
                    )}
                  </div>
                )}

                {smsSelected && (
                  <div className="rounded-xl p-4" style={{ background: "var(--dash-card-muted)", border: "1px solid var(--dash-border)" }}>
                    <p className="text-xs uppercase mb-2" style={{ color: "var(--dash-text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>SMS preview</p>
                    <p className="text-sm rounded-lg p-3" style={{ background: "#ffffff", border: "1px solid var(--dash-border)", color: "var(--dash-text)", lineHeight: 1.5 }}>
                      {smsText}
                    </p>
                    {!invoice.payment_link && (
                      <p className="text-xs mt-2" style={{ color: "var(--dash-amber)", fontWeight: 500 }}>
                        No payment link added — SMS will not include a Pay Now link.
                      </p>
                    )}
                    <p className="text-xs mt-2" style={{ color: "var(--dash-text-soft)" }}>
                      Preview only — SMS sending is coming in the next version.
                    </p>
                  </div>
                )}
              </div>
            )}

            {step === "done" && doneMessage && (
              <div className="rounded-xl p-4 text-center" style={{ background: "var(--dash-green-soft)", border: "1px solid #a7f3d0" }}>
                <p className="text-sm" style={{ color: "var(--dash-green)", fontWeight: 600 }}>{doneMessage}</p>
              </div>
            )}

            {error && (
              <div className="mt-3 rounded-lg px-4 py-2.5 text-sm" style={{ background: "var(--dash-red-soft)", border: "1px solid #fecaca", color: "var(--dash-red)" }}>
                {error}
              </div>
            )}

            {/* Footer buttons */}
            <div className="flex gap-3 mt-5">
              {step === "choose" && (
                <>
                  <button onClick={onClose} className="dash-btn-ghost flex-1 justify-center">Cancel</button>
                  <button
                    onClick={() => setStep("preview")}
                    disabled={nothingSelected}
                    className="dash-btn flex-1 justify-center"
                    style={{ opacity: nothingSelected ? 0.55 : 1 }}
                  >
                    Preview Reminder
                  </button>
                </>
              )}
              {step === "preview" && (
                <>
                  <button onClick={() => { setStep("choose"); setError(null); }} className="dash-btn-ghost flex-1 justify-center">Back</button>
                  <button
                    onClick={prepareSelected}
                    disabled={busy}
                    className="dash-btn flex-1 justify-center"
                    style={{ opacity: busy ? 0.6 : 1 }}
                  >
                    {busy ? "Preparing…" : "Prepare Selected"}
                  </button>
                </>
              )}
              {step === "done" && (
                <button onClick={onClose} className="dash-btn flex-1 justify-center">Done</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
