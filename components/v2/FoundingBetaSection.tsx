"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { V2_BUSINESS_TYPES, V2_UNPAID_RANGES } from "@/lib/beta-options";

/**
 * Section 3 — Founding beta access.
 *
 * A live registration form, not a visual mock. It submits to the existing
 * /api/signup route and the existing beta_signups table — no second
 * datastore, no fabricated success. Success is shown only when the API
 * confirms the record was saved.
 *
 * Five required fields. Phone, willingness-to-pay, customer, invoice and
 * payment details are deliberately not collected here.
 */

const BUSINESS_TYPES: readonly string[] = V2_BUSINESS_TYPES;
const UNPAID_RANGES: readonly string[] = V2_UNPAID_RANGES;

type Fields = {
  name: string;
  business_name: string;
  email: string;
  business_type: string;
  unpaid_range: string;
};

type Errors = Partial<Record<keyof Fields, string>>;

const EMPTY: Fields = { name: "", business_name: "", email: "", business_type: "", unpaid_range: "" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function FoundingBetaSection() {
  const [form, setForm] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const set = (k: keyof Fields, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const validate = (f: Fields): Errors => {
    const e: Errors = {};
    if (!f.name.trim()) e.name = "Please enter your name.";
    else if (f.name.trim().length < 2) e.name = "Name must be at least 2 characters.";
    if (!f.business_name.trim()) e.business_name = "Please enter your business name.";
    if (!f.email.trim()) e.email = "Please enter your email address.";
    else if (!EMAIL_RE.test(f.email.trim())) e.email = "Please enter a valid email address.";
    if (!f.business_type) e.business_type = "Please choose your business type.";
    if (!f.unpaid_range) e.unpaid_range = "Please choose an approximate amount.";
    return e;
  };

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault(); // never reload — the visitor keeps their position
    setFormError(null);

    const found = validate(form);
    if (Object.keys(found).length) {
      setErrors(found);
      // Move focus to the first invalid field
      const first = (Object.keys(found) as (keyof Fields)[])[0];
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    setStatus("sending");
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          business_name: form.business_name.trim(),
          email: form.email.trim().toLowerCase(),
          business_type: form.business_type,
          unpaid_range: form.unpaid_range,
          source: "v2",
        }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        setStatus("done"); // only on confirmed save
        return;
      }
      setStatus("idle");
      if (data?.fieldErrors && typeof data.fieldErrors === "object") {
        setErrors(data.fieldErrors as Errors);
        const first = Object.keys(data.fieldErrors)[0];
        formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      }
      setFormError(
        data?.message ?? "We couldn't submit your details. Please try again."
      );
    } catch {
      setStatus("idle");
      setFormError("We couldn't submit your details. Please try again.");
    }
  };

  const sending = status === "sending";

  return (
    <section id="access" className="v2-beta" aria-labelledby="beta-heading">
      <div className="v2-section v2-beta-grid">
        {/* ── Copy ── */}
        <div className="v2-beta-copy">
          <p className="v2-beta-eyebrow">Founding beta</p>
          <h2 id="beta-heading" className="v2-beta-heading">
            Built for UK trades. Opening to a small founding group.
          </h2>
          <p className="v2-beta-sub">
            We&rsquo;re opening ServiceSignal to a limited number of trades and local
            service businesses. Tell us about your work and we&rsquo;ll contact you
            about joining the beta.
          </p>
        </div>

        {/* ── Live form ── */}
        <div className="v2-beta-card">
          {status === "done" ? (
            <div className="v2-beta-done" role="status" aria-live="polite">
              <span className="v2-beta-done-ico" aria-hidden="true">✓</span>
              <p className="v2-beta-done-t">
                Thanks — we&rsquo;ve received your details. We&rsquo;ll be in touch about
                the founding beta.
              </p>
            </div>
          ) : (
            <form ref={formRef} onSubmit={onSubmit} noValidate>
              <div className="v2-beta-fields">
                <div className="v2-beta-field">
                  <label htmlFor="beta-name">Your name</label>
                  <input
                    id="beta-name" name="name" type="text" autoComplete="name"
                    value={form.name} onChange={(e) => set("name", e.target.value)}
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? "beta-name-err" : undefined}
                    disabled={sending}
                  />
                  {errors.name && <p id="beta-name-err" className="v2-beta-err">{errors.name}</p>}
                </div>

                <div className="v2-beta-field">
                  <label htmlFor="beta-business">Business name</label>
                  <input
                    id="beta-business" name="business_name" type="text" autoComplete="organization"
                    value={form.business_name} onChange={(e) => set("business_name", e.target.value)}
                    aria-invalid={!!errors.business_name}
                    aria-describedby={errors.business_name ? "beta-business-err" : undefined}
                    disabled={sending}
                  />
                  {errors.business_name && <p id="beta-business-err" className="v2-beta-err">{errors.business_name}</p>}
                </div>

                <div className="v2-beta-field">
                  <label htmlFor="beta-email">Email address</label>
                  <input
                    id="beta-email" name="email" type="email" autoComplete="email"
                    value={form.email} onChange={(e) => set("email", e.target.value)}
                    aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? "beta-email-err" : undefined}
                    disabled={sending}
                  />
                  {errors.email && <p id="beta-email-err" className="v2-beta-err">{errors.email}</p>}
                </div>

                <div className="v2-beta-field">
                  <label htmlFor="beta-type">Business type</label>
                  <select
                    id="beta-type" name="business_type"
                    value={form.business_type} onChange={(e) => set("business_type", e.target.value)}
                    aria-invalid={!!errors.business_type}
                    aria-describedby={errors.business_type ? "beta-type-err" : undefined}
                    disabled={sending}
                  >
                    <option value="">Please choose…</option>
                    {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {errors.business_type && <p id="beta-type-err" className="v2-beta-err">{errors.business_type}</p>}
                </div>

                <div className="v2-beta-field v2-beta-field-wide">
                  <label htmlFor="beta-range">Roughly how much are you currently chasing?</label>
                  <select
                    id="beta-range" name="unpaid_range"
                    value={form.unpaid_range} onChange={(e) => set("unpaid_range", e.target.value)}
                    aria-invalid={!!errors.unpaid_range}
                    aria-describedby={errors.unpaid_range ? "beta-range-err" : undefined}
                    disabled={sending}
                  >
                    <option value="">Please choose…</option>
                    {UNPAID_RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {errors.unpaid_range && <p id="beta-range-err" className="v2-beta-err">{errors.unpaid_range}</p>}
                </div>
              </div>

              {formError && (
                <p className="v2-beta-formerr" role="alert">{formError}</p>
              )}

              <button type="submit" className="v2-beta-btn" disabled={sending}>
                {sending ? "Sending…" : "Join the founding beta"}
              </button>

              <p className="v2-beta-privacy">
                We&rsquo;ll only use your details to contact you about the ServiceSignal
                beta. Read our{" "}
                <Link href="/privacy" className="v2-beta-privacy-link">Privacy Policy</Link>.
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
