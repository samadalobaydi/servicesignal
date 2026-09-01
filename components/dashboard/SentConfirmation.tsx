"use client";

import { useSearchParams } from "next/navigation";
import { useDashboard } from "./DashboardProvider";
import type { ChannelStatuses } from "@/lib/reminder-aggregate";

/**
 * "Reminder sent to <customer>." shown after a successful approval.
 *
 * Reads ?sent=<name> written by the review page on success only — so it can
 * never appear unless the server actually confirmed the send. Renders nothing
 * otherwise, and disappears on the next navigation because the query string
 * does, which means there is no dismissal state to store or get stuck.
 *
 * ── WHY THIS ONLY EVER REPRESENTS A CLEAN SUCCESS ─────────────────────────
 *
 * ReminderReviewPanel.onApprove() navigates here ONLY inside its
 * `result.success === true` branch. Tracing every outcome
 * approveAndSendReminder() can return: the partial-send branch, the
 * delivery_unknown branch and the rejected branch ALL set `success: false`
 * (a partial answers 207, but the body is still success:false — "so no
 * surface can render this as a clean send", per reminder-approval.ts's own
 * comment). onApprove()'s `if (!result.success) {...return;}` therefore
 * keeps the owner ON THE REVIEW PAGE for every one of those outcomes,
 * where data.partiallySent / blockedReason already render the correct
 * dedicated banner — including, for a partial send, the one-channel retry
 * button.
 *
 * An earlier version of this component ALSO branched on a partial outcome
 * here. That branch could never actually run — this component is only ever
 * reached after a clean success — and dead code that LOOKS load-bearing is
 * worse than no code: it invites a future edit to trust a path nothing
 * exercises. Rather than leave it as documented-but-unreachable, or force a
 * partial send to navigate away from the one place with its recovery
 * action (a worse experience), the two are now factored correctly: the
 * review page owns "your send did not fully succeed", and this component
 * owns "your send fully succeeded" — for a real SMS+email pair, or the
 * pre-SMS legacy email-only shape. See tests/ui-and-static-safety.test.ts,
 * "onApprove never navigates to the confirmation on anything but a clean
 * success", which pins the guarantee this relies on.
 */
export function SentConfirmation() {
  const params = useSearchParams();
  const name = params.get("sent");
  const reminderId = params.get("sentReminderId");
  const { channelStatuses } = useDashboard();
  if (!name) return null;

  const statuses = reminderId
    ? (channelStatuses[reminderId] as ChannelStatuses | undefined)
    : undefined;

  const headline =
    statuses?.email === "sent" && statuses?.sms === "sent"
      ? `Email and SMS sent to ${name}.`
      : `Reminder sent to ${name}.`;
  const detail = "Replies come back to your account email.";

  return (
    <div
      role="status"
      className="mb-5 rounded-xl px-4 py-3.5 flex items-start gap-3"
      style={{ background: "#ecfdf5", border: "1px solid #6ee7b7" }}
    >
      <span aria-hidden="true" style={{ color: "#059669", fontWeight: 700, lineHeight: 1.4 }}>✓</span>
      <div style={{ minWidth: 0 }}>
        <p className="text-sm" style={{ fontWeight: 650, color: "#065f46" }}>
          {headline}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "#047857", lineHeight: 1.5 }}>
          {detail}
        </p>
      </div>
    </div>
  );
}
