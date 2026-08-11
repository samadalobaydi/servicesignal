"use client";

import { useOpenAddInvoice } from "./AddInvoiceContext";

/**
 * The Overview at zero invoices.
 *
 * WHAT THIS REPLACES
 *
 * Four KPI cards reading £0.00 / 0 / 0 / £0.00, an empty "Needs your
 * attention", a hidden "Coming up", and an Invoice Status card with an empty
 * donut. Every one of those is a truthful report about nothing, and together
 * they make a working product look broken on the one screen where a new
 * customer decides whether it is.
 *
 * The page answers one question here instead: what do I do first, and what
 * happens after I do it.
 *
 * WHAT IT IS NOT
 *
 * No illustration, no tips, no sample data, no feature grid, no video, no
 * testimonial. One card, one action, three lines of explanation, and space.
 * Anything else would be filling a hole that is not there.
 */

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: "Add an invoice",
    body: "Customer, amount and due date.",
  },
  {
    // "We prepare" — the product does the writing. Both channels named
    // together and equally; neither is described as primary or supporting.
    title: "We prepare the reminders",
    body: "ServiceSignal writes the SMS and the email.",
  },
  {
    // Scoped to these reminders rather than an absolute promise. Auto mode is
    // a later mode, so "nothing is ever sent without approval" would age into
    // a lie the same way it would in the Welcome email.
    title: "Review and send",
    body: "Check both messages, then send when you're ready.",
  },
];

export default function FirstInvoiceActivation() {
  const openAddInvoice = useOpenAddInvoice();

  return (
    <section className="dash-card ss-firstrun" aria-labelledby="ss-firstrun-h">
      <h2 id="ss-firstrun-h" className="ss-firstrun-h">
        Add an invoice to get started
      </h2>

      <p className="ss-firstrun-sub">
        ServiceSignal will prepare the SMS and email reminders, ready for you to
        review and send.
      </p>

      {/* The SAME modal the top bar opens — see AddInvoiceContext. A <button>,
          not a link, because it opens a dialog rather than navigating. */}
      <button type="button" onClick={openAddInvoice} className="dash-btn ss-firstrun-cta">
        <svg width="15" height="15" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        Add invoice
      </button>

      {/* An ordered list because it IS an order. Numerals rather than three
          invented icons: a sequence is what needs communicating, and numbers
          say it without adding a new visual language to the product. The
          rendered numeral is decorative — the <ol> already conveys position. */}
      <ol className="ss-firstrun-steps">
        {STEPS.map((step, i) => (
          <li key={step.title} className="ss-firstrun-step">
            <span className="ss-firstrun-num" aria-hidden="true">{i + 1}</span>
            <span className="ss-firstrun-step-body">
              <span className="ss-firstrun-step-title">{step.title}</span>
              <span className="ss-firstrun-step-text">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
