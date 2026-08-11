"use client";

import { useSearchParams } from "next/navigation";

/**
 * "Reminder sent to <customer>." shown after a successful approval.
 *
 * Reads ?sent=<name> written by the review page on success only — so it can
 * never appear unless the server actually confirmed the send. Renders nothing
 * otherwise, and disappears on the next navigation because the query string
 * does, which means there is no dismissal state to store or get stuck.
 */
export function SentConfirmation() {
  const name = useSearchParams().get("sent");
  if (!name) return null;

  return (
    <div
      role="status"
      className="mb-5 rounded-xl px-4 py-3.5 flex items-start gap-3"
      style={{ background: "#ecfdf5", border: "1px solid #6ee7b7" }}
    >
      <span aria-hidden="true" style={{ color: "#059669", fontWeight: 700, lineHeight: 1.4 }}>✓</span>
      <div style={{ minWidth: 0 }}>
        <p className="text-sm" style={{ fontWeight: 650, color: "#065f46" }}>
          Reminder sent to {name}.
        </p>
        <p className="text-xs mt-0.5" style={{ color: "#047857", lineHeight: 1.5 }}>
          Replies come back to your account email.
        </p>
      </div>
    </div>
  );
}
