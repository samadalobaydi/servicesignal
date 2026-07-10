"use client";

import type { ReactNode } from "react";
import Link from "next/link";

export interface SummaryStat {
  label: string;
  value: string;
  accent?: string;       // text colour for the value
  hint?: string;         // small supporting text under the value
  icon?: ReactNode;
  iconBg?: string;
  href?: string;         // when set, the card becomes a navigation link
  ariaLabel?: string;    // accessible label for the link
}

/**
 * A compact horizontal strip of summary figures shown above an inner page's
 * main content. Pure presentation — values are computed by the caller from
 * existing data. No logic, no fetching.
 */
export default function SummaryStrip({ stats }: { stats: SummaryStat[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((s, i) => {
        const inner = (
          <>
            {s.icon && (
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: s.iconBg ?? "var(--dash-card-muted)", color: s.accent ?? "var(--dash-text-muted)" }}>
                {s.icon}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs" style={{ color: "var(--dash-text-muted)", fontWeight: 500 }}>{s.label}</p>
              <p style={{ fontSize: "1.35rem", fontWeight: 700, color: s.accent ?? "var(--dash-text)", letterSpacing: "-0.01em", lineHeight: 1.15 }}>
                {s.value}
              </p>
              {s.hint && <p className="text-xs mt-0.5" style={{ color: "var(--dash-text-soft)" }}>{s.hint}</p>}
            </div>
          </>
        );

        if (s.href) {
          return (
            <Link
              key={i}
              href={s.href}
              aria-label={s.ariaLabel ?? s.label}
              className="dash-card p-4 flex items-center gap-3.5 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0ea5c4] cursor-pointer"
              style={{ textDecoration: "none" }}
            >
              {inner}
            </Link>
          );
        }

        return (
          <div key={i} className="dash-card p-4 flex items-center gap-3.5">
            {inner}
          </div>
        );
      })}
    </div>
  );
}
