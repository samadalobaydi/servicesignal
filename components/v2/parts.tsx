"use client";

import { DEMO } from "./demo";

/* ══════════════════════════════════════════════════════════════════
   Shared visual parts for Landing Page 2.0.
   These are the reusable pieces of the ServiceSignal interface that
   carry the invoice story: envelope, status pill, invoice row,
   dashboard chrome and notification toast.
   ══════════════════════════════════════════════════════════════════ */

/** The travelling invoice. Decorative — hidden from assistive tech. */
export function Envelope({
  size = 46,
  className = "",
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span className={className} style={style} aria-hidden="true">
      <svg width={size} height={size * 0.72} viewBox="0 0 50 36" fill="none">
        <rect x="0.6" y="0.6" width="48.8" height="34.8" rx="5" fill="#ffffff" stroke="#c7d7fb" />
        <path d="M1.5 4.5 L25 20 L48.5 4.5" stroke="#2A5FE3" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M1.5 33 L18 18 M48.5 33 L32 18" stroke="#dbe6fd" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** Small status pill. Text always carries the meaning, never colour alone. */
export function Pill({
  tone,
  children,
}: {
  tone: "amber" | "blue" | "green" | "neutral";
  children: React.ReactNode;
}) {
  const tones = {
    amber: { background: "var(--v2-amber-soft)", color: "var(--v2-amber)" },
    blue: { background: "var(--v2-blue-soft)", color: "var(--v2-blue)" },
    green: { background: "var(--v2-green-soft)", color: "var(--v2-green)" },
    neutral: { background: "#f1f5f9", color: "#475569" },
  } as const;
  return (
    <span className="v2-pill" style={tones[tone]}>
      {children}
    </span>
  );
}

/** Two-letter initials for the customer identity badge (e.g. "AT"). */
export function initialsOf(name: string) {
  return name
    .split(" ")
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Owner-side actions, simplified for the marketing composition:
 * primary "Send now", one compact secondary "Mark paid", and an overflow
 * control standing in for the remaining real-product actions (Dismiss lives
 * there in this mock — the real application keeps all controls).
 */
export function RowActions({ paid = false }: { paid?: boolean }) {
  if (paid) {
    return (
      <span className="flex items-center gap-1.5">
        <Pill tone="green">✓ Paid · reminders stopped</Pill>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="v2-act" style={{ background: "var(--v2-blue)", color: "#fff" }}>Send now</span>
      <span className="v2-act v2-cq-secondary" style={{ background: "#fff", border: "1px solid #bbf7d0", color: "var(--v2-green)" }}>Mark paid</span>
      <span className="v2-act v2-cq-more" style={{ background: "#fff", border: "1px solid var(--v2-line)", color: "var(--v2-faint)", letterSpacing: "0.08em" }} aria-hidden="true">⋯</span>
    </span>
  );
}

/** One invoice line inside the dashboard. */
export function InvoiceRow({
  name,
  reference,
  amount,
  meta,
  state,
  tone,
  focus = false,
  paid = false,
}: {
  name: string;
  reference: string;
  amount: string;
  meta: string;
  state: string;
  tone: "amber" | "blue" | "green" | "neutral";
  focus?: boolean;
  paid?: boolean;
}) {
  return (
    <div
      className={`v2-invoice-row ${focus ? "v2-row-hero" : "v2-card"}`}
      style={!focus ? { background: "#f8fafc", opacity: 0.86 } : undefined}
    >
      {/* 1 · Customer badge — two-letter initials, own grid cell */}
      <span
        className="rounded-full flex items-center justify-center"
        style={{ width: 27, height: 27, background: "var(--v2-blue-soft)", color: "var(--v2-blue)", fontWeight: 700, fontSize: "0.62rem", letterSpacing: "0.02em" }}
        aria-hidden="true"
      >
        {initialsOf(name)}
      </span>

      {/* 2 · Customer identity. The focused row carries full context; secondary
             rows show reference only, so nothing truncates awkwardly at the
             mock's width. */}
      <span className="min-w-0 block">
        <span className="block truncate" style={{ fontWeight: 600, fontSize: "0.75rem" }}>{name}</span>
        <span className="block truncate" style={{ color: "var(--v2-muted)", fontSize: "0.65rem" }}>
          {focus ? `${reference} · ${meta}` : reference}
        </span>
      </span>

      {/* 3 · Amount — reserved right-aligned cell, tabular figures */}
      <span className="v2-amount text-xs" style={{ fontWeight: 700 }}>{amount}</span>

      {/* 4 · Status — hides only when the dashboard itself is narrow */}
      <span className="v2-cq-state">
        <Pill tone={tone}>{state}</Pill>
      </span>

      {/* 5 · Actions — simplified set, always inside the dashboard */}
      <RowActions paid={paid} />
    </div>
  );
}

/** The four dashboard metrics, including reminders awaiting approval. */
export function StatCards({ paidState = false }: { paidState?: boolean }) {
  const stats = paidState
    ? [
        { label: "Active invoices", value: "2", sub: "being chased" },
        { label: "Outstanding", value: "£1,160", sub: "across active invoices" },
        { label: "Overdue", value: "2", sub: "past due date", color: "var(--v2-amber)" },
        { label: "Paid this month", value: "£1,240", sub: "recorded by you", color: "var(--v2-green)" },
      ]
    : [
        { label: "Active invoices", value: "3", sub: "being chased" },
        { label: "Outstanding", value: "£2,400", sub: "across active invoices" },
        { label: "Overdue", value: "3", sub: "past due date", color: "var(--v2-amber)" },
        { label: "Reminders ready", value: "3", sub: "awaiting your approval", color: "var(--v2-blue)" },
      ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 items-stretch">
      {stats.map((s, i) => (
        <div key={i} className="v2-card flex flex-col justify-between h-full" style={{ padding: "0.6rem 0.7rem", minHeight: 78 }}>
          <span className="block" style={{ color: "var(--v2-muted)", fontSize: "0.66rem", lineHeight: 1.25 }}>{s.label}</span>
          <span className="block" style={{ fontSize: "1.18rem", fontWeight: 700, letterSpacing: "-0.015em", lineHeight: 1.15, marginTop: 2, color: s.color ?? "var(--v2-ink)" }}>
            {s.value}
          </span>
          <span className="block" style={{ color: "var(--v2-faint)", fontSize: "0.62rem", lineHeight: 1.25 }}>{s.sub}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Dashboard Window — the owner-side environment.
 * Recurs through the story: overdue at the start, resolved at the end.
 */
export function DashboardWindow({
  paidState = false,
  compact = false,
}: {
  paidState?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="v2-panel overflow-hidden">
      {/* Browser chrome — decorative context only */}
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--v2-line)", background: "#f8fafc" }}
        aria-hidden="true"
      >
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#ff5f57" }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#ffbd2e" }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#28c840" }} />
        <span
          className="flex-1 mx-3 rounded px-3 py-1 text-center"
          style={{ background: "#fff", border: "1px solid var(--v2-line)", color: "var(--v2-faint)", fontSize: "0.65rem" }}
        >
          servicesignal.app/dashboard
        </span>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <div className="hidden sm:flex flex-col w-40 flex-shrink-0 py-4 px-3 gap-1" style={{ background: "var(--v2-navy)" }}>
          <div className="flex items-center gap-2 px-1 pb-3 mb-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/servicesignal-mark.png" alt="" style={{ height: 18, width: "auto" }} aria-hidden="true" />
            <span className="text-white" style={{ fontWeight: 700, fontSize: "0.8rem" }}>
              Service<span style={{ color: "#5b8def" }}>Signal</span>
            </span>
          </div>
          {["Overview", "Active Chasing", "Needs Action", "Paid Invoices", "Settings"].map((label, i) => (
            <span
              key={label}
              className="px-2 py-1.5 rounded-lg"
              style={{
                fontSize: "0.68rem",
                background: i === 1 ? "rgba(91,141,239,0.18)" : "transparent",
                color: i === 1 ? "#fff" : "#94a3b8",
                fontWeight: i === 1 ? 600 : 500,
              }}
            >
              {label}
            </span>
          ))}
        </div>

        {/* Content — a size container so rows adapt to the dashboard's width */}
        <div className="v2-dash-main flex-1 p-4" style={{ background: "#f6f8fb", minWidth: 0 }}>
          <StatCards paidState={paidState} />

          {!compact && (
            <div className="v2-card p-3 mt-3">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-sm" style={{ fontWeight: 650 }}>Active Chasing</span>
                <Pill tone="blue">You approve every reminder</Pill>
              </div>
              <div className="space-y-2">
                <InvoiceRow
                  name={DEMO.customerName}
                  reference={DEMO.reference}
                  amount={DEMO.amount}
                  meta={paidState ? "Paid 27 June" : DEMO.overdueBy}
                  state={paidState ? "Paid" : "Ready to send"}
                  tone={paidState ? "green" : "amber"}
                  focus
                  paid={paidState}
                />
                <InvoiceRow name="Sarah & Paul Clarke" reference="INV-1043" amount="£680" meta="7 days overdue" state="Reminder sent" tone="blue" />
                <InvoiceRow name="J. Whitfield" reference="INV-1044" amount="£480" meta="3 days overdue" state="Ready to send" tone="amber" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Notification Toast — the owner being informed, after the event. */
export function Toast({
  title,
  detail,
  tone = "blue",
}: {
  title: string;
  detail: string;
  tone?: "blue" | "green";
}) {
  const accent = tone === "green" ? "var(--v2-green)" : "var(--v2-blue)";
  return (
    <div
      className="v2-panel flex items-start gap-2.5"
      style={{
        width: "min(272px, 78vw)",
        padding: "0.75rem 0.85rem",
        borderRadius: 13,
        boxShadow: "0 16px 34px rgba(16,24,40,0.14), 0 2px 6px rgba(16,24,40,0.05)",
      }}
    >
      <span className="rounded-full flex-shrink-0" style={{ width: 7, height: 7, marginTop: 5, background: accent }} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block" style={{ fontWeight: 650, fontSize: "0.75rem", lineHeight: 1.35 }}>{title}</span>
        <span className="block" style={{ color: "var(--v2-muted)", fontSize: "0.68rem", lineHeight: 1.5, marginTop: 2 }}>{detail}</span>
      </span>
    </div>
  );
}
