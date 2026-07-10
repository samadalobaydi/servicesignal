"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useDashboard } from "./DashboardProvider";

type NotificationTone = "cyan" | "green" | "red" | "grey";

interface Notification {
  id: string;
  type: "approval" | "sent" | "failed" | "paid";
  title: string;
  detail: string;
  href: string;
  tone: NotificationTone;
  timestamp?: string;
}

const TONE_COLORS: Record<NotificationTone, string> = {
  cyan: "var(--dash-accent-strong)",
  green: "var(--dash-green)",
  red: "var(--dash-red)",
  grey: "var(--dash-text-soft)",
};

/** e.g. "6 Jul 2026 at 11:59" */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} at ${time}`;
}

/**
 * Builds the MVP notification list purely from data the dashboard provider
 * already loads — no extra fetching, no storage, no schema. The badge count
 * is simply the number of current important notifications.
 */
export default function NotificationBell() {
  const { reminders, reminderHistory, liveInvoices } = useDashboard();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside the bell/dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const invoiceById = (id: string) => liveInvoices.find((i) => i.id === id);
  const nameFor = (id: string) => invoiceById(id)?.customer_name ?? "Invoice";
  const hrefFor = (id: string) =>
    invoiceById(id)?.status === "paid" ? "/dashboard/paid" : "/dashboard/chasing";

  const notifications: Notification[] = [];

  // 1. Reminders awaiting approval
  for (const r of reminders) {
    notifications.push({
      id: `approval-${r.id}`,
      type: "approval",
      title: "Reminder ready to approve",
      detail: `${r.invoice?.customer_name ?? nameFor(r.invoice_id)} — prepared recently`,
      href: "/dashboard",
      tone: "cyan",
      timestamp: r.created_at,
    });
  }

  // 2 & 3. Sent / failed reminders from recent history
  for (const r of reminderHistory) {
    const name = r.invoice?.customer_name ?? nameFor(r.invoice_id);
    if (r.status === "sent") {
      const when = r.sent_at ?? r.created_at;
      notifications.push({
        id: `sent-${r.id}`,
        type: "sent",
        title: "Email reminder sent",
        detail: `${name} — ${formatWhen(when)}`,
        href: hrefFor(r.invoice_id),
        tone: "green",
        timestamp: when,
      });
    } else if (r.status === "failed") {
      notifications.push({
        id: `failed-${r.id}`,
        type: "failed",
        title: "Reminder failed to send",
        detail: `${name} — check reminder settings`,
        href: hrefFor(r.invoice_id),
        tone: "red",
        timestamp: r.created_at,
      });
    }
  }

  // 4. Invoices marked paid
  for (const inv of liveInvoices) {
    if (inv.status === "paid" && inv.paid_at) {
      notifications.push({
        id: `paid-${inv.id}`,
        type: "paid",
        title: "Invoice marked paid",
        detail: `${inv.customer_name} — future reminders stopped`,
        href: "/dashboard/paid",
        tone: "green",
        timestamp: inv.paid_at,
      });
    }
  }

  const sorted = notifications
    .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime())
    .slice(0, 8);

  const count = sorted.length;
  const badge = count > 9 ? "9+" : String(count);

  return (
    <div ref={wrapRef} className="relative">
      {/* Bell button */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close notifications" : `Open notifications${count > 0 ? ` (${count})` : ""}`}
        className="relative inline-flex items-center justify-center rounded-lg transition-colors"
        style={{
          width: 38,
          height: 38,
          background: "#ffffff",
          border: "1px solid var(--dash-border-strong)",
          color: open ? "var(--dash-accent-strong)" : "var(--dash-text-muted)",
        }}
      >
        <svg width="17" height="17" fill="none" viewBox="0 0 24 24">
          <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {count > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center rounded-full text-xs"
            style={{ background: "var(--dash-accent)", color: "#ffffff", minWidth: 18, height: 18, fontWeight: 700, padding: "0 4px" }}
          >
            {badge}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 mt-2 z-40 rounded-xl overflow-hidden"
          style={{
            width: 340,
            background: "#ffffff",
            border: "1px solid var(--dash-border)",
            boxShadow: "var(--dash-shadow-lg)",
          }}
        >
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--dash-border)" }}>
            <p style={{ fontWeight: 650, fontSize: "0.95rem", color: "var(--dash-text)" }}>Notifications</p>
          </div>

          {sorted.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm" style={{ fontWeight: 600, color: "var(--dash-text)" }}>You&apos;re all caught up</p>
              <p className="text-sm mt-1" style={{ color: "var(--dash-text-muted)" }}>No important updates right now.</p>
            </div>
          ) : (
            <div className="max-h-[320px] overflow-y-auto">
              {sorted.map((n) => (
                <Link
                  key={n.id}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2.5 px-4 py-3 transition-colors hover:bg-[#f8fafc]"
                  style={{ borderTop: "1px solid var(--dash-border)", textDecoration: "none" }}
                >
                  <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: TONE_COLORS[n.tone] }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm" style={{ fontWeight: 600, color: "var(--dash-text)" }}>{n.title}</p>
                    <p className="text-sm truncate" style={{ color: "var(--dash-text-muted)" }}>{n.detail}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
