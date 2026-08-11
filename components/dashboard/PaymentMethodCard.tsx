"use client";

import { useState } from "react";
import type { Profile } from "@/types";
import { updateProfile } from "@/lib/profile";

/**
 * The account's default payment method (Settings).
 *
 * PHASE 1: payment link only. Bank transfer is deliberately absent — see
 * supabase/sql/008_default_payment_link.sql for why sort code and account
 * number are not being stored yet.
 *
 * This is the permanent home for the default. An invoice may override its own
 * link freely, and that override never reaches this value; the only way an
 * invoice changes the default is the explicit "Save as my default" tick during
 * invoice creation.
 *
 * ServiceSignal never handles the money and says so plainly — the link is
 * whatever the trade already uses, passed through to their customer.
 */
export function PaymentMethodCard({
  profile,
  onUpdated,
}: {
  profile: Profile;
  onUpdated: (next: Profile) => void;
}) {
  const saved = profile.default_payment_link ?? null;

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(saved ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const save = async (next: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const result = await updateProfile({ default_payment_link: next });
      if (!result.success || !result.profile) throw new Error(result.message ?? "save failed");
      onUpdated(result.profile);
      setEditing(false);
      setConfirmingRemove(false);
    } catch {
      setError("We couldn't save that. Please check the link and try again.");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed.startsWith("https://")) {
      setError("Enter a valid payment link starting with https://");
      return;
    }
    void save(trimmed);
  };

  return (
    <div className="dash-card p-6">
      <h2 style={{ fontSize: "1.05rem", fontWeight: 650, color: "var(--dash-text)" }}>
        Default payment method
      </h2>
      <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)", lineHeight: 1.6 }}>
        Prefilled on new invoices so you don&rsquo;t retype it. Customers pay you
        directly — ServiceSignal never handles the money.
      </p>

      {error && (
        <p className="text-sm mt-3" role="alert" style={{ color: "var(--dash-red, #dc2626)" }}>
          {error}
        </p>
      )}

      {!editing && saved && (
        <div className="mt-4">
          <p className="text-xs" style={{ color: "var(--dash-text-muted)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Payment link
          </p>
          {/* The full URL is shown: it is not a secret, it is the thing the
              customer clicks, and truncating it would make it hard to confirm
              the right link is saved. overflowWrap keeps it inside the card. */}
          <p className="text-sm mt-1" style={{ color: "var(--dash-text)", overflowWrap: "anywhere" }}>
            {saved}
          </p>

          <div className="flex gap-3 mt-4">
            <button
              type="button"
              className="dash-btn-ghost"
              onClick={() => {
                setValue(saved);
                setEditing(true);
              }}
            >
              Change
            </button>
            <button
              type="button"
              className="dash-btn-ghost"
              onClick={() => setConfirmingRemove(true)}
            >
              Remove
            </button>
          </div>

          {/* Destructive action, so it asks first. Inline rather than a modal:
              the consequence is small and reversible, and a dialog here would
              be heavier than the decision deserves. */}
          {confirmingRemove && (
            <div
              className="mt-4 rounded-lg p-3"
              style={{ background: "#fffbeb", border: "1px solid #fde68a" }}
            >
              <p className="text-sm" style={{ color: "#0f172a", lineHeight: 1.5 }}>
                Remove your saved payment link? New invoices won&rsquo;t prefill it.
                Invoices you&rsquo;ve already created keep theirs.
              </p>
              <div className="flex gap-3 mt-3">
                <button
                  type="button"
                  className="dash-btn"
                  style={{ padding: "0.45rem 0.9rem", fontSize: "0.85rem" }}
                  onClick={() => void save(null)}
                  disabled={busy}
                >
                  {busy ? "Removing…" : "Yes, remove it"}
                </button>
                <button
                  type="button"
                  className="dash-btn-ghost"
                  onClick={() => setConfirmingRemove(false)}
                  disabled={busy}
                >
                  Keep it
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!editing && !saved && (
        <button
          type="button"
          className="dash-btn mt-4"
          style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}
          onClick={() => {
            setValue("");
            setEditing(true);
          }}
        >
          Add a payment link
        </button>
      )}

      {editing && (
        <form onSubmit={onSubmit} className="mt-4" noValidate>
          <label className="field-label" htmlFor="settings-payment-link">
            Payment link
          </label>
          <input
            id="settings-payment-link"
            type="url"
            inputMode="url"
            className="dash-input"
            placeholder="https://..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-describedby="settings-payment-link-help"
            autoFocus
          />
          <p id="settings-payment-link-help" className="text-xs mt-1.5" style={{ color: "var(--dash-text-muted)" }}>
            Add the payment link you already use.
          </p>
          <div className="flex gap-3 mt-4">
            <button type="submit" className="dash-btn" style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className="dash-btn-ghost" onClick={() => { setEditing(false); setError(null); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
