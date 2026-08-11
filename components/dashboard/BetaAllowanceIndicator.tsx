"use client";

import { useBetaAllowance } from "./BetaAllowanceContext";
import {
  ALLOWANCE_LABEL_PREFIX,
  allowanceExhausted,
  ALLOWANCE_LIMIT_BADGE,
  allowanceUsageDetail,
  allowanceUsageLabelCompact,
  allowanceUsageLabelMini,
  allowanceProgressLabel,
} from "@/lib/beta-allowance";

/**
 * Founding Beta allowance — a compact account-usage panel in the header.
 *
 * ── WHAT THE PREVIOUS PASS GOT WRONG ─────────────────────────────────────
 *
 * It rendered "Founding beta · 10 free reminders" and "10 remaining" inside a
 * ~26px pill. Three problems, and they compounded:
 *
 *   the same number twice, in two framings, so neither could be read quickly;
 *   too small to be read at all at a glance;
 *   a tag, when the thing it reports is account status.
 *
 * ── WHAT REPLACES IT ─────────────────────────────────────────────────────
 *
 * One usage fraction and one bar. "4 / 10 reminders used" already says six
 * remain, so the second element goes; the bar shows the proportion, so a
 * percentage would be a third rendering of one number.
 *
 * The bar is back because at 40px the component has the room the chip did
 * not, and a proportion is genuinely faster to read than digits — but it stays
 * 4px and subordinate. It is never red: at 10/10 it is simply full. This
 * reports an account fact, it does not raise an alarm, and the send path
 * already refuses clearly at the point of action.
 *
 * ── STILL NOT INTERACTIVE ────────────────────────────────────────────────
 *
 * A <div>. No href, no onClick, no tabindex — there is no billing destination
 * to send anyone to. No icon: no star, no lightning. The text and the bar are
 * the whole component.
 *
 * ── AND STILL ONE SOURCE OF TRUTH ────────────────────────────────────────
 *
 * Everything numeric comes from the BetaAllowance handed down by
 * BetaAllowanceProvider — including percentUsed, which betaAllowance() has
 * already clamped. Nothing here fetches, counts or divides.
 */

/** `light` for the pale desktop header, `dark` for the navy mobile bar. */
export type AllowanceTone = "light" | "dark";

export default function BetaAllowanceIndicator({ tone }: { tone: AllowanceTone }) {
  const allowance = useBetaAllowance();

  // Nothing until the count is verified. A usage meter is the one component
  // where a plausible wrong value is worse than absence.
  if (!allowance) return null;

  // At the cap the bar is full, and a full bar alone reads as "nearly there"
  // rather than "stopped". The modifier carries a restrained amber treatment
  // and the wording (allowanceUsageDetail) says "limit reached" — no upgrade
  // CTA, because the product has no billing destination to send anyone to.
  const exhausted = allowanceExhausted(allowance);

  return (
    <div
      className={`ss-beta-panel ss-beta-panel--${tone}${exhausted ? " ss-beta-panel--spent" : ""}`}
      data-spent={exhausted ? "true" : undefined}
    >
      {/*
        All three wordings render; CSS shows one. display:none removes the
        others from the accessibility tree as well as the layout, so a screen
        reader reads exactly what is on screen.
      */}
      <span className="ss-beta-panel-text">
        {/* Two spans, one source: allowanceUsageLabel() is composed from these
            same two pieces, so weighting the prefix cannot make the rendered
            line diverge from the canonical string. */}
        <span className="ss-beta-t-full">
          <span className="ss-beta-prefix">{ALLOWANCE_LABEL_PREFIX}</span>
          {" \u2014 "}
          <span className="ss-beta-detail">{allowanceUsageDetail(allowance)}</span>
        </span>
        <span className="ss-beta-t-compact">{allowanceUsageLabelCompact(allowance)}</span>
        <span className="ss-beta-t-mini">{allowanceUsageLabelMini(allowance)}</span>
      </span>

      {/* A SEPARATE element, not more words on the end of the sentence above.
          Appended, it was the part that got truncated away; beside it, it has
          its own box and cannot be clipped by the usage line's length.
          Still no upgrade CTA — there is no billing destination to send
          anyone to, so this states the fact and stops. */}
      {exhausted && (
        <span className="ss-beta-badge">{ALLOWANCE_LIMIT_BADGE}</span>
      )}

      {/*
        Real progress semantics, since there is now a real progress element.
        aria-valuetext spells the fraction out as a sentence; it is not
        rendered, because the visible line already carries the meaning.
      */}
      <span
        className="ss-beta-track"
        role="progressbar"
        aria-label="Founding Beta reminder allowance"
        aria-valuemin={0}
        aria-valuemax={allowance.allowance}
        aria-valuenow={allowance.used}
        aria-valuetext={allowanceProgressLabel(allowance)}
      >
        {/* percentUsed is clamped to 0–100 by betaAllowance(). */}
        <span className="ss-beta-fill" style={{ width: `${allowance.percentUsed}%` }} />
      </span>
    </div>
  );
}
