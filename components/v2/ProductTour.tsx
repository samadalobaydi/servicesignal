"use client";

import { useCallback, useRef, useState } from "react";
import { TourShell, ActiveChasingScene, PreparedScene, EmailReviewScene, ApprovalScene } from "./TourScenes";

/**
 * Interactive product tour — the hero's dominant visual.
 *
 * Four selectable states over one persistent application frame. Hovering a
 * step previews it; clicking locks it; leaving returns to the locked step.
 * Fully keyboard operable via the tablist pattern.
 *
 * All four states are always mounted and cross-faded, so switching is
 * instant with no loading, no layout shift and no blank frame.
 */

/**
 * The four steps describe the WORKFLOW, so they are channel-neutral: this is
 * what happens whichever channel a reminder goes out on. The panel below them
 * shows a real email, and the email-specific language lives there — in the
 * From/Subject rows and the "Email reminder" summary — where it is describing
 * something visible on screen rather than defining the product.
 */
const STEPS = [
  { n: "01", label: "Find invoices", blurb: "See overdue invoices and reminders that are ready for attention." },
  { n: "02", label: "Reminder prepared", blurb: "ServiceSignal prepares a professional reminder and holds it for your review." },
  { n: "03", label: "Review reminder", blurb: "Read the full message exactly as your customer will receive it." },
  { n: "04", label: "Approve and send", blurb: "You make the final decision. Nothing is sent until you approve it." },
] as const;

const A11Y = [
  "ServiceSignal Active Chasing workspace. Invoice INV-1042 for Alex Turner, £1,240, 12 days overdue, marked Overdue with a reminder Ready for review and a Review reminder action awaiting your decision.",
  "Reminder prepared for INV-1042: Alex Turner, £1,240, 12 days overdue. An email reminder is ready for review. Nothing has been sent.",
  "Review the reminder for INV-1042. It is an email from ServiceSignal at reminders@servicesignal.app, subject Overdue invoice reminder from Oakfield Plumbing, signed off by Oakfield Plumbing. Nothing has been sent.",
  "Approve and send INV-1042: Alex Turner, £1,240, email reminder awaiting your approval. Once approved, the email is sent.",
];

export default function ProductTour() {
  const [locked, setLocked] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  /* Nothing is sent until the owner activates "Approve and send" in step 4. */
  const [approved, setApproved] = useState(false);
  const tabsRef = useRef<HTMLDivElement | null>(null);

  const active = hovered ?? locked;

  /* Leaving step 4 resets the demonstration to its unsent state. */
  const selectStep = useCallback((i: number) => {
    setLocked(i);
    setHovered(null);
    if (i !== 3) setApproved(false);
  }, []);

  const focusTab = useCallback((i: number) => {
    const el = tabsRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[i];
    el?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = e.key === "ArrowRight" ? (i + 1) % STEPS.length : (i - 1 + STEPS.length) % STEPS.length;
      selectStep(next);
      focusTab(next);
    } else if (e.key === "Home") {
      e.preventDefault(); selectStep(0); focusTab(0);
    } else if (e.key === "End") {
      e.preventDefault(); selectStep(STEPS.length - 1); focusTab(STEPS.length - 1);
    }
  };

  const go = (dir: -1 | 1) => selectStep((locked + dir + STEPS.length) % STEPS.length);

  return (
    <div className="v2-tour">
      {/* ── Step navigation ── */}
      <div
        ref={tabsRef}
        role="tablist"
        aria-label="ServiceSignal product tour"
        className="v2-tour-tabs"
        onMouseLeave={() => setHovered(null)}
      >
        {STEPS.map((s, i) => (
          <button
            key={s.n}
            role="tab"
            id={`tour-tab-${i}`}
            aria-selected={active === i}
            aria-controls="tour-panel"
            tabIndex={active === i ? 0 : -1}
            className={`v2-tour-tab${active === i ? " is-on" : ""}`}
            onMouseEnter={() => setHovered(i)}
            onFocus={() => setHovered(i)}
            onBlur={() => setHovered(null)}
            onClick={() => selectStep(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className="v2-tour-tab-n">{s.n}</span>
            <span className="v2-tour-tab-l">{s.label}</span>
          </button>
        ))}
      </div>

      {/* ── Active step explanation ── */}
      <p className="v2-tour-blurb" aria-live="polite">{STEPS[active].blurb}</p>

      {/* ── Product frame: shell persists, layers cross-fade ── */}
      <div
        className="v2-tour-frame"
        role="tabpanel"
        id="tour-panel"
        aria-labelledby={`tour-tab-${active}`}
        aria-label={A11Y[active]}
      >
        <TourShell>
          <div className="v2-tour-stage">
            {/* Base workspace, always present */}
            <ActiveChasingScene dimmed={active > 0} sentState={active === 3 && approved} />

            {/* Modal layers */}
            <div className={`v2-tour-layer${active === 1 ? " is-on" : ""}`} aria-hidden={active !== 1}>
              <PreparedScene />
            </div>
            <div className={`v2-tour-layer${active === 2 ? " is-on" : ""}`} aria-hidden={active !== 2}>
              <EmailReviewScene onContinue={() => selectStep(3)} interactive={active === 2} />
            </div>
            <div className={`v2-tour-layer${active === 3 ? " is-on" : ""}`} aria-hidden={active !== 3}>
              <ApprovalScene
                done={approved}
                interactive={active === 3}
                onApprove={() => setApproved(true)}
                onReset={() => setApproved(false)}
              />
            </div>
          </div>
        </TourShell>
      </div>

      {/* ── Prev / next + position ── */}
      <div className="v2-tour-ctrl">
        <button type="button" className="v2-tour-arrow" onClick={() => go(-1)} aria-label="Previous step">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="v2-tour-count">{active + 1} of {STEPS.length}</span>
        <button type="button" className="v2-tour-arrow" onClick={() => go(1)} aria-label="Next step">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
