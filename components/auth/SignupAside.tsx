import { DEMO } from "@/components/v2/demo";
import split from "./auth-split.module.css";

/**
 * Reassurance panel for the account-creation page.
 *
 * Shares the visual system with LoginAside but NOT its copy. Login speaks to
 * someone who has already decided and is returning; this speaks to someone
 * mid-decision, so the framing is about what they are agreeing to — control
 * retained, payment route untouched, replies still theirs — rather than a
 * reminder of what the product does for them.
 *
 * Product truth. Every line describes behaviour the software actually has:
 * approval-only sending, no payment handling, replies routed to the owner's
 * account email. No statistics, ratings, testimonials, user counts, recovery
 * figures, payment-speed claims or tracking claims.
 *
 * The artefact is the same approval-queue preview used on sign-in — the screen
 * this account will open onto. It reads from the canonical demonstration
 * dataset rather than duplicating those values, so it can never drift from the
 * landing page or the sign-in panel.
 *
 * It shows a reminder in the state the product actually holds it in: prepared,
 * counted in the queue, waiting. It deliberately shows NO sent state, NO
 * delivery, open, click, read or reply information, NO payment control, and
 * nothing that behaves as if it were interactive — "Review reminder" is a
 * styled span, not a control.
 *
 * The row lists the CUSTOMER (Alex Turner), not the account holder's own
 * business. Oakfield Plumbing is the ServiceSignal user in the canonical
 * dataset, so printing it inside the row would read as though it were the
 * customer's company.
 *
 * initialsOf is deliberately NOT imported from components/v2/parts: that
 * module is "use client", and importing a plain function from it into this
 * server component yields a client-reference proxy that throws when called.
 *
 * Accessibility: a <section> labelled by its own heading — not a landmark
 * competing with the form. It follows the form in DOM order at every
 * breakpoint, so keyboard and screen-reader users reach the account fields
 * first regardless of how the columns are arranged visually.
 */

/**
 * The four-step story, replacing the three reassurance bullets.
 *
 * REPLACING rather than adding: the panel had unused vertical space, and the
 * fix for that is a clearer explanation, not more of the same. The bullets and
 * the journey together would be two versions of the same reassurance stacked
 * on each other.
 *
 * Four steps, not three. The obvious cut is step 3, but removing it breaks the
 * causal chain — the reader goes from "you approve" straight to "they pay"
 * without ever being told the customer receives anything. Steps 3 and 4 are
 * also the two that carry the product truths that matter most commercially:
 * the message only goes out once approved, and the money never touches
 * ServiceSignal.
 *
 * Every step is real text. The icons are decorative and hidden from assistive
 * technology, so nothing depends on seeing them.
 */
const JOURNEY: { title: string; icon: React.ReactNode }[] = [
  {
    title: "Add an overdue invoice",
    icon: (
      <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    // SMS and email are equal channels. Plural "reminders" because both are
    // meant; neither is described as supporting, primary or richer, and
    // neither is implied to arrive before the other.
    title: "Review the SMS and email reminders",
    icon: (
      <path d="M4 6h16M4 12h10M9 20l-4-4h15a1 1 0 001-1V6" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    title: "Your customer receives the approved reminder",
    icon: (
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    title: "They pay using your existing payment route",
    icon: (
      <path d="M3 10h18M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
];

/**
 * The closing summary beneath the queue — what this account actually gives you.
 *
 * WHY IT EXISTS. The panel column is as tall as the signup form (the grid
 * stretches both to the taller one), and the journey plus the queue did not
 * fill it. The honest fix for a short column is more of the right content, not
 * redistributed whitespace: spacing derived from the form's height would put
 * this panel back in the coupling that caused the original Note 43 defect.
 *
 * WHY THESE FOUR. They are the four things a UK trade hesitates over at the
 * moment of signing up: how their customer is actually contacted, whether they
 * lose control of the message, whether this stays manual forever, and whether
 * anything happens to their money. Each answer is a fact about the shipped
 * product or a clearly-labelled plan — no counts, no testimonials, no
 * recovery figures, no logos.
 *
 * WHY 2 AND 3 SIT SIDE BY SIDE. Read together they say "you approve today, and
 * you will be able to automate later" without either claim overreaching.
 * "Nothing ever sends without your approval" is deliberately absent: it is
 * true of the current workflow and would become false the day Auto mode ships,
 * so this describes the action the owner takes rather than a permanent
 * guarantee about the product.
 */
const ASSURANCES: {
  title: string;
  line: string;
  /** Renders the COMING SOON pill. Presentational text, never a control. */
  soon?: boolean;
}[] = [
  {
    title: "SMS and email reminders",
    line: "Chase by SMS and by email, from one queue.",
  },
  {
    title: "You approve each reminder",
    line: "Read it and decide before your customer does.",
  },
  {
    title: "Auto mode",
    line: "Set your reminder rules once and let ServiceSignal send them for you.",
    soon: true,
  },
  {
    title: "Customers pay you directly",
    line: "ServiceSignal never holds or processes the money.",
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

export function SignupAside() {
  return (
    // `asideTop` is signup-only. It overrides the vertical centring that
    // /login relies on — see the Note 43 block in auth-split.module.css.
    <section className={`${split.aside} ${split.asideTop}`} aria-labelledby="signup-aside-heading">
      <div className={split.asideInner}>
        <h2 id="signup-aside-heading" className={split.asideHeading}>
          Start following up without giving up control.
        </h2>
        <p className={split.asideSub}>
          ServiceSignal helps you follow up overdue invoices professionally while
          keeping every decision, payment route and customer conversation with you.
        </p>

        <ol className={split.journey} aria-label="How ServiceSignal works">
          {JOURNEY.map((step, i) => (
            <li key={step.title} className={split.journeyStep}>
              <span className={split.journeyIcon} aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {step.icon}
                </svg>
              </span>
              <span className={split.journeyText}>{step.title}</span>
              {i < JOURNEY.length - 1 && (
                <span className={split.journeyConnector} aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>

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
            <span className={split.action} aria-hidden="true">Review reminder</span>
          </div>
        </figure>

        {/* ── Closing summary ──────────────────────────────────────────────
            A different texture from everything above it on purpose: the
            journey is icons on a connected rail, the queue is a bordered
            product artefact, and this is plain text under hairline rules. A
            third card here would read as three competing panels; this reads as
            the summary it is.

            Semantic <ul> with a heading per item, so a screen-reader user can
            navigate it. Nothing inside is focusable — there is no control
            here, and adding one would put a decorative stop in the middle of
            the signup tab order. */}
        <div className={split.assure}>
          <ul className={split.assureList} aria-label="What your account includes">
            {ASSURANCES.map((a) => (
              <li key={a.title} className={split.assureItem}>
                <span className={split.assureRule} aria-hidden="true" />
                <h3 className={split.assureT}>
                  {a.title}
                  {a.soon && (
                    /* Real text, not an icon or a colour — it is announced
                       verbatim as part of the heading ("Auto mode Coming
                       soon"). A span, never a toggle or a button, so nothing
                       here can look switchable. */
                    <span className={split.soon}>Coming soon</span>
                  )}
                </h3>
                <p className={split.assureL}>{a.line}</p>
              </li>
            ))}
          </ul>

          <p className={split.closing}>
            Built for UK trades who want less chasing without changing how they
            get paid.
          </p>
        </div>

        {/* No footer link here by design. "Already have an account? Sign in"
            already sits beneath the form in the left column, and repeating it
            would duplicate the route while inviting the visitor away from the
            account they are part-way through creating. No second CTA either:
            the conversion action is the Create Account button opposite, and a
            competing button in the panel would split the decision. */}
      </div>
    </section>
  );
}
