import Link from "next/link";
import { DEMO } from "@/components/v2/demo";
import split from "./auth-split.module.css";

/**
 * Reassurance panel for the sign-in page.
 *
 * Restrained by intent: this is a returning-user utility, not a sales page.
 * Three short points and one compact artefact, on navy for contrast — no
 * feature grid, no decorative artwork.
 *
 * Product truth. Every line describes behaviour the software actually has:
 * approval-only sending, no payment handling, replies routed to the owner's
 * account email. No statistics, ratings, testimonials, user counts, recovery
 * figures, payment-speed claims or tracking claims.
 *
 * The artefact is a compact approval-queue preview — the screen a returning
 * user signs in to reach — rather than the customer-facing email, which the
 * landing page already shows in full. It reads from the canonical
 * demonstration dataset rather than duplicating those values, so it can never
 * drift from the landing page.
 *
 * It shows a reminder in the state the product actually holds it in: prepared,
 * counted in the queue, waiting. It deliberately shows NO sent state, NO
 * delivery, open, click, read or reply information, NO payment control, and
 * nothing that behaves as if it were interactive — "Review email" is a styled
 * span, not a control.
 *
 * Note the row lists the CUSTOMER (Alex Turner), not the account holder's own
 * business. Oakfield Plumbing is the ServiceSignal user in the canonical
 * dataset, so printing it inside the row would read as though it were the
 * customer's company.
 *
 * "EXAMPLE REVIEW QUEUE" is the single label marking this as fictional. A
 * second "Example data" caption would repeat what the eyebrow already says
 * directly above the content; the aria-label carries the fuller statement for
 * screen-reader users.
 *
 * initialsOf is deliberately NOT imported from components/v2/parts: that
 * module is "use client", and importing a plain function from it into this
 * server component yields a client-reference proxy that throws when called.
 *
 * Accessibility: a <section> labelled by its own heading — not a landmark
 * competing with the form. It follows the form in DOM order at every
 * breakpoint, so keyboard and screen-reader users reach the sign-in fields
 * first regardless of how the columns are arranged visually.
 */

const POINTS = [
  {
    title: "Review before anything sends",
    line: "Every reminder waits for your approval.",
  },
  {
    title: "Keep your existing payment route",
    line: "Customers continue paying you directly. ServiceSignal never handles the money.",
  },
  {
    title: "Stay connected to the conversation",
    line: "Customer replies come back to the email address on your account.",
  },
];

/** Initials for the avatar. Local by design — see the note above. */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function LoginAside() {
  return (
    <section className={split.aside} aria-labelledby="login-aside-heading">
      <div className={split.asideInner}>
        <h2 id="login-aside-heading" className={split.asideHeading}>
          Spend less time chasing overdue invoices.
        </h2>
        <p className={split.asideSub}>
          ServiceSignal prepares professional email reminders for you to review,
          so you can follow up consistently without rewriting the same message
          every time.
        </p>

        <ul className={split.points}>
          {POINTS.map((p) => (
            <li key={p.title} className={split.point}>
              <span className={split.tick} aria-hidden="true">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span>
                <span className={split.pointTitle}>{p.title}</span>
                <span className={split.pointLine}>{p.line}</span>
              </span>
            </li>
          ))}
        </ul>

        <figure
          className={split.card}
          aria-label={`Example review queue. One reminder is ready for approval: ${DEMO.customerName}, invoice ${DEMO.reference}, ${DEMO.amount}, ${DEMO.overdueBy}. The reminder is prepared and has not been sent. Demonstration data, not a real account.`}
        >
          <figcaption className={split.cardLabel}>Example review queue</figcaption>

          <div className={split.queueHead}>
            <span className={split.queueTitle}>Ready for your approval</span>
            <span className={split.queueCount}>1 reminder</span>
          </div>

          <div className={split.queueRow}>
            <span className={split.avatar} aria-hidden="true">
              {initials(DEMO.customerName)}
            </span>
            <span className={split.rowId}>
              <span className={split.rowName}>{DEMO.customerName}</span>
              <span className={split.rowMeta}>
                {DEMO.reference} · {DEMO.overdueBy}
              </span>
            </span>
            <span className={split.rowAmount}>{DEMO.amount}</span>
          </div>

          <div className={split.queueFoot}>
            <span className={split.chip}>
              <span className={split.chipDot} aria-hidden="true" />
              Reminder prepared
            </span>
            {/* Presentational only — a span, never a control. */}
            <span className={split.action} aria-hidden="true">Review email</span>
          </div>
        </figure>

        {/* REVIEW BRANCH: points at the /v2 preview. Change back to "/" when v2 becomes the root landing page. */}
        <Link href="/v2" className={split.asideLink}>
          New to ServiceSignal? See how it works →
        </Link>
      </div>
    </section>
  );
}
