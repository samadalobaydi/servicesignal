"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReminderReviewData } from "@/lib/reminder-review";
import { formatCurrency, formatDate } from "@/lib/invoices";
import { approveReminder } from "@/lib/reminders";
import { SEND_STATE_COPY } from "@/lib/reminder-send-state";
import { ALLOWANCE_EXHAUSTED_STATE } from "@/lib/allowance-claim";
import { FOUNDING_BETA_ALLOWANCE } from "@/lib/beta-allowance";

/**
 * The review interface. The ONLY place a prepared reminder can be sent from.
 *
 * Active Chasing and Needs Action previously called approveReminder() straight
 * from a row button labelled "Send Now" — one click, no sight of the message.
 * That contradicted the product's central promise. Those rows now link here,
 * and the send action lives beside the full message it will actually send.
 *
 * All data arrives already composed from the server (lib/reminder-review.ts),
 * built with the same composer the send route uses. Nothing about ownership,
 * eligibility or content is decided in this component.
 */

/**
 * One distinct message per state — never a single generic error. "We couldn't
 * confirm delivery" and "that didn't send" require opposite actions from the
 * owner, so they must never look the same.
 */
const BLOCKED_COPY = SEND_STATE_COPY;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="ss-review-row">
      <dt className="ss-review-key">{label}</dt>
      <dd className="ss-review-val">{value}</dd>
    </div>
  );
}

export function ReminderReviewPanel({ data }: { data: ReminderReviewData }) {
  const router = useRouter();

  /**
   * `busy` is the client-side duplicate guard: the first click flips it and the
   * button becomes disabled, so a second click cannot start a parallel request.
   * It is never reset on success — the page navigates away instead, so there is
   * no window in which the action becomes clickable again after sending.
   */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set when the server refused because the message changed since this page
   * rendered. The only safe way forward is to reload and re-read, so the
   * approve action stays disabled and a reload control is offered instead.
   */
  const [staleReview, setStaleReview] = useState(false);
  /**
   * Set when the server refused because the Founding Beta allowance is spent.
   *
   * Distinct from `error` on purpose. Everything else in this panel is a
   * delivery problem the owner may be able to retry; this is an account state
   * that no amount of retrying changes, so it gets its own explanation and the
   * approve action stays disabled. Nothing is deleted, nothing is hidden — the
   * prepared SMS and email are still on the page below.
   */
  const [allowanceExhausted, setAllowanceExhausted] = useState(false);

  // "not_found" never reaches this component — the page renders its own
  // unavailable state for that — so it is excluded from the copy map.
  const blocked =
    data.blockedReason && data.blockedReason !== "not_found"
      ? BLOCKED_COPY[data.blockedReason]
      : null;

  const onApprove = async () => {
    if (busy || !data.approvable) return;
    setBusy(true);
    setError(null);

    const result = await approveReminder(data.reminderId, data.reviewToken);

    if (!result.success) {
      // The server refused. Report exactly what it said — never claim success.
      setError(result.message);

      // Re-enable ONLY where retrying is safe. After delivery_unknown the
      // customer may already have the email; after `undelivered` the provider
      // definitely accepted it and delivery failed, so another attempt at the
      // same recipient is not the answer; after a stale review or a concurrent
      // send the page is out of date. In every one of those cases the button
      // stays disabled and the owner must reload or make a fresh decision.
      const unsafeToRetry =
        result.state === "delivery_unknown" ||
        result.state === "undelivered" ||
        result.state === "stale_review" ||
        result.state === "sending" ||
        result.state === "sent" ||
        // Retrying cannot help: the account is out of free reminders and the
        // server will refuse identically every time.
        result.state === ALLOWANCE_EXHAUSTED_STATE;

      if (result.state === "stale_review") setStaleReview(true);
      if (result.state === ALLOWANCE_EXHAUSTED_STATE) {
        setAllowanceExhausted(true);
        // The dedicated panel below says it properly; a duplicate red error
        // line above it would say the same thing twice.
        setError(null);
      }
      if (!unsafeToRetry) setBusy(false);
      return;
    }

    router.push(
      `/dashboard/chasing?sent=${encodeURIComponent(data.customerName)}`
    );
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--dash-text)", letterSpacing: "-0.02em" }}>
          Review reminder
        </h1>
        <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)" }}>
          Check the message below. Nothing will be sent until you approve it.
        </p>
      </div>

      {/* Announced to screen readers as soon as it appears. */}
      {error && (
        <div
          role="alert"
          className="rounded-lg px-4 py-3 text-sm"
          style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", lineHeight: 1.5 }}
        >
          {error}
        </div>
      )}

      {blocked && (
        <div
          role="status"
          className="rounded-lg px-4 py-3"
          style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}
        >
          <p className="text-sm" style={{ fontWeight: 650 }}>{blocked.title}</p>
          <p className="text-sm mt-0.5" style={{ lineHeight: 1.5 }}>{blocked.body}</p>

          {/* Shown ONLY to explain a blocked state. Never presented as general
              delivery tracking — this product does not offer that, and
              implying it would be a fabricated claim. */}
          {data.blockedReason === "undelivered" && data.providerLastEvent && (
            <p className="text-xs mt-2" style={{ lineHeight: 1.5 }}>
              Delivery result reported by Resend: <strong>{data.providerLastEvent}</strong>.
              Nothing has been resent.
            </p>
          )}
        </div>
      )}

      {/* ── Founding Beta allowance spent ───────────────────────────────────
          Same restrained treatment as the other blocked states — this is an
          account fact, not an error the owner caused. No CTA: ServiceSignal
          has no billing destination yet, and a dead "Upgrade" button would be
          worse than a sentence that tells the truth. The prepared message
          stays visible and editable below. */}
      {allowanceExhausted && (
        <div
          role="status"
          className="rounded-lg px-4 py-3"
          style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}
        >
          <p className="text-sm" style={{ fontWeight: 650 }}>Free reminder allowance used</p>
          <p className="text-sm mt-0.5" style={{ lineHeight: 1.5 }}>
            You&apos;ve used all {FOUNDING_BETA_ALLOWANCE} Founding Beta reminders.
            Upgrade to continue sending SMS and email reminders. This reminder has
            been kept — nothing was sent, and nothing has been deleted.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* The message itself leads: it is what the decision is about. */}
          <section className="dash-card p-6" aria-labelledby="ss-msg-h">
            <h2 id="ss-msg-h" style={{ fontSize: "1.05rem", fontWeight: 650, color: "var(--dash-text)" }}>
              Email reminder
            </h2>
            <p className="text-xs mt-1" style={{ color: "var(--dash-text-muted)" }}>
              This is the reminder ServiceSignal has prepared. Nothing has been sent.
            </p>

            <dl className="ss-review-head mt-4">
              <Row label="To" value={`${data.customerName} · ${data.customerEmail}`} />
              <Row
                label="From"
                value={
                  <>
                    {data.businessName}
                    <span style={{ color: "var(--dash-text-muted)" }}> · delivered by ServiceSignal</span>
                  </>
                }
              />
              {data.replyTo && <Row label="Replies" value={data.replyTo} />}
              <Row label="Subject" value={<strong>{data.subject}</strong>} />
            </dl>

            {/* pre-wrap keeps the composer's paragraphs without rendering markup. */}
            <div className="ss-review-body mt-4">{data.body}</div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="dash-card p-6" aria-labelledby="ss-inv-h">
            <h2 id="ss-inv-h" style={{ fontSize: "1.05rem", fontWeight: 650, color: "var(--dash-text)" }}>
              Invoice
            </h2>
            <dl className="mt-3 space-y-2.5">
              {data.invoiceReference && <Row label="Reference" value={data.invoiceReference} />}
              {data.jobDescription && <Row label="Job" value={data.jobDescription} />}
              <Row label="Amount" value={<strong>{formatCurrency(data.amount)}</strong>} />
              <Row label="Due" value={formatDate(data.dueDate)} />
              {data.paymentLink && (
                <Row
                  label="Payment"
                  value={<span style={{ overflowWrap: "anywhere" }}>{data.paymentLink}</span>}
                />
              )}
            </dl>
          </section>

          <section className="dash-card p-6" aria-labelledby="ss-rem-h">
            <h2 id="ss-rem-h" style={{ fontSize: "1.05rem", fontWeight: 650, color: "var(--dash-text)" }}>
              Reminder
            </h2>
            <dl className="mt-3 space-y-2.5">
              <Row label="Tone" value={<span style={{ textTransform: "capitalize" }}>{data.tone}</span>} />
              <Row label="Checkpoint" value={data.scheduleLabel} />
              <Row label="Status" value={<span style={{ textTransform: "capitalize" }}>{data.status}</span>} />
              {data.customerPhone && (
                <Row
                  label="Mobile"
                  value={
                    <>
                      {data.customerPhone}
                      {/* Stored for the planned SMS channel. Says plainly that
                          no SMS is involved, rather than implying one. */}
                      <span style={{ color: "var(--dash-text-muted)" }}> · no SMS is sent</span>
                    </>
                  }
                />
              )}
            </dl>
          </section>
        </div>
      </div>

      <div className="dash-card p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            className="dash-btn justify-center"
            onClick={onApprove}
            disabled={busy || !data.approvable || staleReview || allowanceExhausted}
            aria-disabled={busy || !data.approvable || staleReview || allowanceExhausted}
            // Names the consequence, not just the control. A screen-reader user
            // should know this sends a real email before activating it.
            aria-label={
              data.approvable
                ? `Approve and send this reminder to ${data.customerName} at ${data.customerEmail}. This sends a real email.`
                : "This reminder cannot be sent"
            }
            style={{ padding: "0.7rem 1.35rem", fontSize: "0.95rem", opacity: busy || !data.approvable ? 0.6 : 1 }}
          >
            {busy
              ? "Sending…"
              : data.blockedReason === "retryable"
              ? "Retry sending"
              : "Approve and send"}
          </button>

          {/* Only path forward after a stale review: re-read the current
              message and take a fresh authorisation with it. */}
          {staleReview && (
            <button
              type="button"
              className="dash-btn justify-center"
              onClick={() => router.refresh()}
              style={{ padding: "0.7rem 1.35rem", fontSize: "0.95rem" }}
            >
              Reload the latest version
            </button>
          )}

          <Link href="/dashboard/chasing" className="dash-btn-ghost justify-center">
            Back to Active Chasing
          </Link>

          {/* Polite so it does not interrupt, but still announced. */}
          <span className="sr-only" role="status" aria-live="polite">
            {busy ? "Sending reminder, please wait." : ""}
          </span>
        </div>

        <p className="text-xs mt-3" style={{ color: "var(--dash-text-muted)", lineHeight: 1.5 }}>
          Approving sends this email to your customer straight away. Customers pay
          you directly — ServiceSignal never handles the money.
        </p>
      </div>
    </div>
  );
}
