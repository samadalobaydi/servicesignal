"use client";

import { useState } from "react";
import type { BetaSignupFormData, BetaSignupErrors, ApiResponse } from "@/types";

const BUSINESS_TYPES = [
  "Builder / General Contractor",
  "Electrician",
  "Plumber",
  "Decorator / Painter",
  "Landscaper / Gardener",
  "Cleaner",
  "Handyman",
  "HVAC / Gas Engineer",
  "Security / Alarm Installation",
  "Bathroom / Kitchen Fitter",
  "Window / Door Installer",
  "Roofer",
  "Construction Company",
  "Other Trade",
];

const UNPAID_RANGES = [
  "Less than £500",
  "£500 – £2,000",
  "£2,000 – £5,000",
  "£5,000 – £10,000",
  "£10,000 – £25,000",
  "Over £25,000",
];

const TRUST_POINTS = [
  {
    icon: (
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
        <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" stroke="#0ea5c4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    text: "You approve the reminder wording before anything sends",
  },
  {
    icon: (
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
        <path d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" stroke="#0ea5c4" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    text: "No spammy or aggressive messages — professional tone only",
  },
  {
    icon: (
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
        <path d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" stroke="#0ea5c4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    text: "Built specifically for UK trades and local service businesses",
  },
  {
    icon: (
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
        <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" stroke="#0ea5c4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    text: "Your customer details are private and never shared or sold",
  },
  {
    icon: (
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
        <path d="M6 18L18 6M6 6l12 12" stroke="#0ea5c4" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    text: "Cancel anytime — no lock-in when paid plans launch",
  },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const initialForm: BetaSignupFormData = {
  name: "",
  business_name: "",
  email: "",
  phone: "",
  business_type: "",
  unpaid_range: "",
  willingness_to_pay: "",
};

export default function BetaSignup() {
  const [form, setForm]       = useState<BetaSignupFormData>(initialForm);
  const [errors, setErrors]   = useState<BetaSignupErrors>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<ApiResponse | null>(null);

  // ── Client-side validation ───────────────────────────────────────────────
  function validate(): boolean {
    const e: BetaSignupErrors = {};
    if (!form.name.trim() || form.name.trim().length < 2)
      e.name = "Please enter your name.";
    if (!form.business_name.trim())
      e.business_name = "Please enter your business name.";
    if (!form.email.trim())
      e.email = "Please enter your email address.";
    else if (!EMAIL_RE.test(form.email))
      e.email = "Please enter a valid email address.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    // Clear the field error as soon as the user edits it
    if (name in errors) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data: ApiResponse = await res.json();
      setResult(data);
      if (data.success) setForm(initialForm);
    } catch {
      setResult({ success: false, message: "Network error. Please check your connection and try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      id="signup"
      className="section"
      style={{
        background: "#ffffff",
        borderTop: "1px solid #e5e7eb",
      }}
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          {/* Left: copy + trust */}
          <div className="lg:sticky lg:top-28">
            <p
              className="font-display font-600 text-[#0ea5c4] mb-3 tracking-widest text-sm uppercase"
              style={{ fontWeight: 600, letterSpacing: "0.15em" }}
            >
              Join the Beta
            </p>
            <h2
              className="font-display text-[#0f172a] mb-6"
              style={{
                fontSize: "clamp(2rem, 4vw, 2.8rem)",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
              }}
            >
              Get early access.{" "}
              <span className="text-[#0ea5c4]">Lock in your rate.</span>
            </h2>
            <p className="text-[#64748b] leading-relaxed mb-8">
              We&apos;re building ServiceSignal with a small group of tradespeople and
              local service businesses who are fed up with chasing payments.
            </p>

            {[
              { icon: "🎯", title: "Free during beta",      desc: "Full access, no credit card required." },
              { icon: "🔒", title: "Early adopter pricing", desc: "Your rate is locked in when we go live." },
              { icon: "📣", title: "Shape the product",     desc: "Your feedback directly influences what we build." },
              { icon: "⚡", title: "First to know",         desc: "Be first when new features drop." },
            ].map((perk, i) => (
              <div key={i} className="flex items-start gap-4 mb-5">
                <span className="text-xl flex-shrink-0">{perk.icon}</span>
                <div>
                  <p className="text-[#0f172a] font-display font-700 text-sm" style={{ fontWeight: 700 }}>
                    {perk.title}
                  </p>
                  <p className="text-[#94a3b8] text-sm">{perk.desc}</p>
                </div>
              </div>
            ))}

            {/* Trust section */}
            <div
              className="rounded-xl p-5 mt-8"
              style={{
                background: "#ecfeff",
                border: "1px solid #a5f0fa",
              }}
            >
              <p
                className="font-display font-700 text-[#0f172a] text-sm mb-4 uppercase tracking-wider"
                style={{ fontWeight: 700, letterSpacing: "0.1em" }}
              >
                You're in control
              </p>
              <ul className="space-y-3">
                {TRUST_POINTS.map((point, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex-shrink-0 mt-0.5 opacity-80">{point.icon}</span>
                    <span className="text-[#94a3b8] text-sm leading-snug">{point.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Right: form card */}
          <div
            className="rounded-2xl p-6 sm:p-8"
            style={{
              background: "#ffffff",
              border: "1px solid #a5f0fa",
            }}
          >
            {/* ── Success state ── */}
            {result?.success ? (
              <div className="flex flex-col items-center text-center py-8">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mb-5"
                  style={{ background: "#ecfdf5", border: "2px solid #059669" }}
                >
                  <svg width="30" height="30" fill="none" viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h3
                  className="font-display text-[#0f172a] mb-2"
                  style={{ fontSize: "1.7rem", fontWeight: 700 }}
                >
                  You&apos;re on the list.
                </h3>
                <p className="text-[#94a3b8] text-sm leading-relaxed mb-1 max-w-xs">
                  We'll be in touch as soon as beta access opens — usually within a few days.
                </p>
                <p className="text-[#94a3b8] text-xs mt-4">
                  Questions?{" "}
                  <a href="mailto:hello@servicesignal.co.uk" className="text-[#0ea5c4] hover:underline">
                    hello@servicesignal.co.uk
                  </a>
                </p>
                <div
                  className="mt-6 w-full rounded-lg p-4 text-left"
                  style={{ background: "#ecfdf5", border: "1px solid #a7f3d0" }}
                >
                  <p className="text-xs text-[#059669] font-display font-700 uppercase tracking-wider mb-2" style={{ fontWeight: 700 }}>
                    What happens next
                  </p>
                  <ul className="space-y-1.5">
                    {[
                      "Check your inbox — confirmation coming shortly",
                      "We'll reach out when your beta access is ready",
                      "Your pricing is locked in from day one",
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-[#94a3b8]">
                        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" className="mt-0.5 flex-shrink-0">
                          <path d="M5 13l4 4L19 7" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

            ) : (
              /* ── Form ── */
              <>
                <h3
                  className="font-display text-[#0f172a] mb-6"
                  style={{ fontSize: "1.4rem", fontWeight: 700 }}
                >
                  Request Beta Access
                </h3>

                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                  {/* Name + Business Name */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-[#94a3b8] mb-1.5 font-display font-600 uppercase tracking-wider" style={{ fontWeight: 600 }}>
                        Your Name *
                      </label>
                      <input
                        type="text"
                        name="name"
                        className="lp-input"
                        placeholder="Dave Morrison"
                        value={form.name}
                        onChange={handleChange}
                        aria-invalid={!!errors.name}
                      />
                      {errors.name && (
                        <p className="mt-1 text-xs" style={{ color: "#dc2626" }}>{errors.name}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-[#94a3b8] mb-1.5 font-display font-600 uppercase tracking-wider" style={{ fontWeight: 600 }}>
                        Business Name *
                      </label>
                      <input
                        type="text"
                        name="business_name"
                        className="lp-input"
                        placeholder="Morrison Electrical Ltd"
                        value={form.business_name}
                        onChange={handleChange}
                        aria-invalid={!!errors.business_name}
                      />
                      {errors.business_name && (
                        <p className="mt-1 text-xs" style={{ color: "#dc2626" }}>{errors.business_name}</p>
                      )}
                    </div>
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-xs text-[#94a3b8] mb-1.5 font-display font-600 uppercase tracking-wider" style={{ fontWeight: 600 }}>
                      Email Address *
                    </label>
                    <input
                      type="email"
                      name="email"
                      className="lp-input"
                      placeholder="dave@morrisonelectrical.co.uk"
                      value={form.email}
                      onChange={handleChange}
                      aria-invalid={!!errors.email}
                    />
                    {errors.email && (
                      <p className="mt-1 text-xs" style={{ color: "#dc2626" }}>{errors.email}</p>
                    )}
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-xs text-[#94a3b8] mb-1.5 font-display font-600 uppercase tracking-wider" style={{ fontWeight: 600 }}>
                      Phone Number (optional — for SMS beta updates later)
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      className="lp-input"
                      placeholder="07700 900000"
                      value={form.phone}
                      onChange={handleChange}
                    />
                  </div>

                  {/* Business Type */}
                  <div>
                    <label className="block text-xs text-[#94a3b8] mb-1.5 font-display font-600 uppercase tracking-wider" style={{ fontWeight: 600 }}>
                      Type of Business
                    </label>
                    <select
                      name="business_type"
                      className="lp-input"
                      value={form.business_type}
                      onChange={handleChange}
                    >
                      <option value="">Select your trade...</option>
                      {BUSINESS_TYPES.map((bt) => (
                        <option key={bt} value={bt}>{bt}</option>
                      ))}
                    </select>
                  </div>

                  {/* Unpaid range */}
                  <div>
                    <label className="block text-xs text-[#94a3b8] mb-1.5 font-display font-600 uppercase tracking-wider" style={{ fontWeight: 600 }}>
                      How much are you usually waiting on?
                    </label>
                    <select
                      name="unpaid_range"
                      className="lp-input"
                      value={form.unpaid_range}
                      onChange={handleChange}
                    >
                      <option value="">Select a range...</option>
                      {UNPAID_RANGES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>

                  {/* Willingness to pay */}
                  <div>
                    <label className="block text-xs text-[#94a3b8] mb-2 font-display font-600 uppercase tracking-wider" style={{ fontWeight: 600 }}>
                      After beta, would you consider paying £20–£50/month if this helped you get paid faster?
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                      {["Yes, definitely", "Probably", "Not sure"].map((opt) => (
                        <label key={opt} className="cursor-pointer">
                          <input
                            type="radio"
                            name="willingness_to_pay"
                            value={opt}
                            checked={form.willingness_to_pay === opt}
                            onChange={handleChange}
                            className="sr-only"
                          />
                          <div
                            className="text-center py-2.5 px-2 rounded-lg border text-xs transition-all"
                            style={{
                              background:   form.willingness_to_pay === opt ? "#ecfeff"      : "#ffffff",
                              borderColor:  form.willingness_to_pay === opt ? "#0ea5c4"                  : "#cbd5e1",
                              color:        form.willingness_to_pay === opt ? "#0ea5c4"                  : "#94a3b8",
                              fontFamily: "'DM Sans', sans-serif",
                            }}
                          >
                            {opt}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* API error */}
                  {result && !result.success && (
                    <div
                      className="rounded-lg p-3 text-sm"
                      style={{
                        background: "#fef2f2",
                        border: "1px solid #fecaca",
                        color: "#dc2626",
                      }}
                    >
                      {result.message}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="lp-btn w-full mt-2"
                    style={{ opacity: loading ? 0.7 : 1, cursor: loading ? "not-allowed" : "pointer" }}
                  >
                    {loading ? "Submitting..." : "Join the Beta — It's Free"}
                  </button>

                  <p className="text-[#94a3b8] text-xs text-center">
                    No spam. No credit card. Just early access.
                  </p>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
