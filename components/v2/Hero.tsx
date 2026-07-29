"use client";

import { useReveal } from "./useReveal";
import ProductTour from "./ProductTour";

/**
 * Hero — centred copy above one large interactive product tour.
 *
 * One connected composition: label, headline, supporting copy, CTAs and
 * reassurance, then the tour as the dominant visual. No floating toast, no
 * browser chrome, no arrow, no second dashboard.
 */
export default function Hero() {
  const { ref, inView } = useReveal<HTMLDivElement>({ threshold: 0.03 });

  return (
    <section className="relative pt-24 pb-16 sm:pt-28 sm:pb-20 overflow-hidden">
      <span
        className="v2-wash"
        style={{ width: 860, height: 460, top: -190, left: "50%", marginLeft: -430, background: "radial-gradient(ellipse at center, rgba(42,95,227,0.10), transparent 70%)" }}
        aria-hidden="true"
      />

      <div ref={ref} className={`v2-section relative z-10 ${inView ? "is-in" : ""}`}>
        {/* ══════ Copy ══════ */}
        <div className="v2-hero-copy">
          <span
            className="v2-reveal inline-flex items-center gap-2 rounded-full px-3.5 py-1.5"
            style={{ background: "var(--v2-blue-soft)", border: "1px solid var(--v2-blue-border)", color: "var(--v2-blue)", fontSize: "0.78rem", fontWeight: 600 }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--v2-blue)" }} aria-hidden="true" />
            Founding beta — limited places
          </span>

          <h1 className="v2-reveal v2-d1 v2-hero-h1">
            Unpaid invoices, followed up{" "}
            <span style={{ color: "var(--v2-blue)" }}>without you chasing.</span>
          </h1>

          <p className="v2-reveal v2-d2 v2-hero-sub">
            ServiceSignal prepares professional SMS and email reminders for overdue
            invoices. You review them, send them and stay in control.
          </p>

          <div className="v2-reveal v2-d3 v2-hero-cta">
            <a href="#access" className="lp-btn" style={{ background: "var(--v2-blue)", whiteSpace: "nowrap", padding: "0.7rem 1.5rem", fontSize: "0.95rem" }}>
              Join the founding beta
            </a>
            <a href="/login" className="lp-btn-ghost" style={{ whiteSpace: "nowrap", padding: "0.7rem 1.5rem", fontSize: "0.95rem" }}>
              Sign in
            </a>
          </div>

          <ul className="v2-reveal v2-d4 v2-hero-reassure">
            {["Nothing sends without your approval", "Built for UK trades"].map((t) => (
              <li key={t}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 13l4 4L19 7" stroke="var(--v2-green)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* ══════ Product tour ══════ */}
        <div className="v2-reveal v2-d5">
          <ProductTour />
        </div>
      </div>
    </section>
  );
}
