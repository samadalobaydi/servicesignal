"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReminderReviewData } from "@/lib/reminder-review";
import { formatCurrency, formatDate } from "@/lib/invoices";
import { approveReminder, retryReminderChannel, regenerateReminder } from "@/lib/reminders";
import { CHANNEL_LABEL } from "@/lib/reminder-aggregate";
import { SEND_STATE_COPY } from "@/lib/reminder-send-state";
import { ALLOWANCE_EXHAUSTED_STATE } from "@/lib/allowance-claim";
import { FOUNDING_BETA_ALLOWANCE } from "@/lib/beta-allowance";
import { useDashboard } from "./DashboardProvider";
import { useRefetchBetaAllowance } from "./BetaAllowanceContext";

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
  const { refetchAfterReminderAction } = useDashboard();
  const refetchAllowance = useRefetchBetaAllowance();

  /**
   * `busy` is the client-side duplicate guard: the first click flips it and the
   * button becomes disabled, so a second click cannot start a parallel request.
   * It is never reset on success — the page navigates away instead, so there is
   * no window in which the action becomes clickable again after sending.
   */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set when Approve refused with "channel_state_not_ready" or
   * "fresh_approve_not_ready" — the server has authoritatively refused this
   * Approve request for THIS rendered review state. Immediately repeating
   * Approve against the same rendered state is pointless and would only
   * repeat the identical refusal, so this mounted review instance locks
   * Approve rather than allowing that.
   *
   * Local React state only — it does NOT observe the underlying channel
   * rows and does NOT automatically clear if/when they change. Recovery
   * requires obtaining a fresh, reloaded review state after whatever
   * underlying recovery is appropriate for the specific refusal (which
   * varies — not universally a per-channel Retry).
   *
   * DELIBERATELY SEPARATE FROM `busy`. The request that produced this refusal
   * has already finished — `busy` is reset to false alongside this, so the
   * button stops claiming "Sending…"/"please wait" (both false the moment
   * this fires). `busy` means a request is currently in flight;
   * `approveLocked` means Approve is no longer valid for this rendered
   * review state — the two are different facts and must not share one flag.
   */
  const [approveLocked, setApproveLocked] = useState(false);
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
  /**
   * Per-channel recovery state.
   *
   * Separate from `busy` because the two actions are different: `busy` guards
   * approving the whole reminder, this guards resending ONE channel of a
   * reminder that has already partly gone.
   */
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  /**
   * Set when Approve/Retry refused with state "identity_drift" — the sender
   * identity changed since this reminder's stored content was generated and
   * "reload" cannot repair that (reloading re-reads the SAME frozen content).
   * The only way forward is to regenerate it. Seeded from data.identityDrifted
   * so the page can offer this BEFORE the owner ever clicks Approve, not only
   * after a failed attempt.
   */
  const [identityDrifted, setIdentityDrifted] = useState(data.identityDrifted);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateMessage, setRegenerateMessage] = useState<string | null>(null);

  const onRegenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    setRegenerateMessage(null);

    const result = await regenerateReminder(data.reminderId);

    if (!result.success) {
      setRegenerateMessage(result.message);
      setRegenerating(false);
      return;
    }

    // The page must re-read: subject, body, SMS body, and the review token
    // are all now different — the stored content was just rewritten.
    router.refresh();
  };

  const onRetryChannel = async () => {
    if (retrying || !data.retryableChannel) return;
    setRetrying(true);
    setRetryMessage(null);

    const result = await retryReminderChannel(data.reminderId, data.retryableChannel);

    if (!result.success) {
      setRetryMessage(result.message);
      if (result.state === "identity_drift") setIdentityDrifted(true);
      // Re-enable ONLY where another attempt is safe. After delivery_unknown
      // the customer may already have it, so the control stays disabled and
      // the owner needs a fresh decision rather than a button.
      if (result.state !== "delivery_unknown") setRetrying(false);
      return;
    }

    // The page must re-read: the channel row has moved and the partial state
    // may be gone entirely.
    router.refresh();
  };

  // "not_found" never reaches this component — the page renders its own
  // unavailable state for that — so it is excluded from the copy map.
  const blocked =
    data.blockedReason && data.blockedReason !== "not_found"
      ? BLOCKED_COPY[data.blockedReason]
      : null;

  const onApprove = async () => {
    if (busy || approveLocked || !data.approvable) return;
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
        result.state === "identity_drift" ||
        result.state === "sending" ||
        result.state === "sent" ||
        // Retrying cannot help: the account is out of free reminders and the
        // server will refuse identically every time.
        result.state === ALLOWANCE_EXHAUSTED_STATE;

      // These two are NOT part of unsafeToRetry/busy-latching: the request
      // has genuinely finished, so `busy` resets to false below like any
      // other refusal — "Sending…" would be false. Approve is instead locked
      // by its own, separate flag (see approveLocked above): the server has
      // authoritatively refused, so re-clicking against this same rendered
      // state would only repeat the identical refusal. A fresh, reloaded
      // review state is what recovery requires — this local flag does not
      // observe the channel rows and will not clear on its own.
      if (result.state === "channel_state_not_ready" || result.state === "fresh_approve_not_ready") {
        setApproveLocked(true);
      }

      if (result.state === "stale_review") setStaleReview(true);
      // Reload cannot fix this one — the stored content is frozen under the
      // OLD identity regardless of how many times the page is reloaded (see
      // lib/reminder-content.ts's identityHasDrifted). Only regeneration can.
      if (result.state === "identity_drift") setIdentityDrifted(true);
      if (result.state === ALLOWANCE_EXHAUSTED_STATE) {
        setAllowanceExhausted(true);
        // The dedicated panel below says it properly; a duplicate red error
        // line above it would say the same thing twice.
        setError(null);
      }
      if (!unsafeToRetry) setBusy(false);
      return;
    }

    // ── INVALIDATE THE SHELL'S CACHED STATE BEFORE NAVIGATING ────────────
    //
    // THE BUG THIS FIXES. DashboardProvider and BetaAllowanceProvider each
    // fetch their data once, client-side, on mount — router.refresh() only
    // re-runs SERVER component data, so neither one ever learns a send just
    // happened. Left alone: Active Chasing kept offering "Review reminder"
    // for a reminder that was already `sent`, and the header kept reading
    // "0 / 10 used" after a slot had genuinely been claimed. Both were
    // confirmed, from production evidence, to be display-only — the database
    // was correct the whole time.
    //
    // Awaited BEFORE the navigation, so the chasing page's first render
    // already reflects the send — no flash of stale state, no second reload
    // required.
    await Promise.all([refetchAfterReminderAction(), refetchAllowance()]);

    router.push(
      `/dashboard/chasing?sent=${encodeURIComponent(data.customerName)}&sentReminderId=${encodeURIComponent(data.reminderId)}`
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

      {/* ── SENDER IDENTITY CHANGED SINCE THIS WAS PREPARED ─────────────────
          Reloading cannot fix this — the stored subject/body below are frozen
          under the OLD identity and reload just re-reads the same frozen
          content (see lib/reminder-content.ts's identityHasDrifted). The only
          way forward is an explicit rebuild under the CURRENT identity. */}
      {identityDrifted && (
        <div
          role="status"
          className="rounded-lg px-4 py-3"
          style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}
        >
          <p className="text-sm" style={{ fontWeight: 650 }}>Sender details changed</p>
          <p className="text-sm mt-0.5" style={{ lineHeight: 1.5 }}>
            Your sender details changed after this reminder was prepared. The message
            below still shows the name it was written under, so it can&apos;t be approved
            as-is. Nothing has been sent.
          </p>

          {regenerateMessage && (
            <p className="text-sm mt-2" style={{ fontWeight: 600 }}>{regenerateMessage}</p>
          )}

          {/* Server-authoritative gate (lib/regenerate-capability.ts) — the
              route refuses independently of this render, so hiding the
              button here is a courtesy, not the enforcement. */}
          {data.regenerateEnabled && (
            <button
              type="button"
              className="dash-btn mt-3 justify-center"
              onClick={onRegenerate}
              disabled={regenerating}
              aria-disabled={regenerating}
              aria-label="Regenerate this reminder's SMS and email under your current sender identity. Nothing will be sent."
              style={{ padding: "0.55rem 1.1rem", fontSize: "0.9rem" }}
            >
              {regenerating ? "Regenerating…" : "Regenerate reminder"}
            </button>
          )}
        </div>
      )}

      {/* ── PARTIAL SEND ───────────────────────────────────────────────────
          The parent reminder is `sent`, so without this the page said "It was
          approved and sent to your customer. It can't be sent again" — both
          halves untrue. Names the channels in plain words and offers recovery
          for the one that failed, never for the one that worked. */}
      {data.partiallySent && (
        <div
          role="status"
          className="rounded-lg px-4 py-3"
          style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}
        >
          <p className="text-sm" style={{ fontWeight: 650 }}>Part of this reminder didn&apos;t send</p>
          <p className="text-sm mt-0.5" style={{ lineHeight: 1.5 }}>
            {data.partialSummary}. Your customer received the part that went
            through. Nothing will be sent again automatically.
          </p>

          {retryMessage && (
            <p className="text-sm mt-2" style={{ fontWeight: 600 }}>{retryMessage}</p>
          )}

          {data.retryableChannel && (
            <button
              type="button"
              className="dash-btn mt-3 justify-center"
              onClick={onRetryChannel}
              disabled={retrying}
              aria-disabled={retrying}
              aria-label={`Retry sending only the ${CHANNEL_LABEL[data.retryableChannel]} to ${data.customerName}. The channel that already sent will not be sent again.`}
              style={{ padding: "0.55rem 1.1rem", fontSize: "0.9rem" }}
            >
              {retrying
                ? `Retrying ${CHANNEL_LABEL[data.retryableChannel]}…`
                : `Retry ${CHANNEL_LABEL[data.retryableChannel]} only`}
            </button>
          )}
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
                    {data.senderName}
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

          {/* SMS AND EMAIL, BOTH SHOWN, BOTH REAL.
              This section did not exist before: the page composed and stored
              real SMS content but only ever displayed the email half, so the
              owner approved a text message they had never seen. data.smsBody
              is the exact stored/composed SMS text — the same bytes
              buildReminderSms() produced and the same bytes the send path
              will submit to Twilio. */}
          {data.customerPhone && (
            <section className="dash-card p-6" aria-labelledby="ss-sms-h">
              <h2 id="ss-sms-h" style={{ fontSize: "1.05rem", fontWeight: 650, color: "var(--dash-text)" }}>
                SMS reminder
              </h2>
              <p className="text-xs mt-1" style={{ color: "var(--dash-text-muted)" }}>
                This is the text message ServiceSignal has prepared. Nothing has been sent.
              </p>

              <dl className="ss-review-head mt-4">
                <Row label="To" value={data.customerPhone} />
                <Row label="From" value={data.senderName} />
              </dl>

              <div
                className="ss-review-body mt-4"
                style={{ whiteSpace: "pre-wrap", background: "var(--dash-card-muted)", borderRadius: "0.75rem", padding: "0.9rem 1rem" }}
              >
                {data.smsBody}
              </div>
            </section>
          )}
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
              {/* Both together, always. A checkpoint name only exists at
                  specific day-offsets (0, 3, 7, 14...), so an invoice sitting
                  between two of them — e.g. genuinely 1 day overdue, with no
                  day+1 checkpoint in the model — would otherwise show
                  "On the due date" with nothing to explain why that reads
                  older than today. The live due-status label is the
                  explanation, not a correction. */}
              <Row
                label="Checkpoint"
                value={
                  <>
                    {data.scheduleLabel}
                    <span style={{ color: "var(--dash-text-muted)" }}>
                      {" "}· invoice currently {data.dueStatusLabel.toLowerCase()}
                    </span>
                  </>
                }
              />
              <Row label="Status" value={<span style={{ textTransform: "capitalize" }}>{data.status}</span>} />
              {data.customerPhone && (
                <Row
                  label="Mobile"
                  value={
                    <>
                      {data.customerPhone}
                      {/* SMS is a real channel now. The per-channel status is
                          the truth, so it is shown rather than a claim. */}
                      <span style={{ color: "var(--dash-text-muted)" }}>
                        {data.channelStatuses.sms === "sent"
                          ? " · SMS sent"
                          : data.channelStatuses.sms === "failed"
                          ? " · SMS didn't send"
                          : " · SMS will be sent with the email"}
                      </span>
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
            disabled={busy || !data.approvable || staleReview || allowanceExhausted || identityDrifted || approveLocked}
            aria-disabled={busy || !data.approvable || staleReview || allowanceExhausted || identityDrifted || approveLocked}
            // Names the consequence, not just the control. A screen-reader user
            // should know this sends a real email before activating it.
            aria-label={
              data.approvable
                ? `Approve and send this reminder to ${data.customerName}. This sends a real SMS and a real email.`
                : "This reminder cannot be sent"
            }
            style={{ padding: "0.7rem 1.35rem", fontSize: "0.95rem", opacity: busy || !data.approvable || approveLocked ? 0.6 : 1 }}
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
          Approving sends the SMS and the email to your customer straight away.
          Customers pay you directly — ServiceSignal never handles the money.
        </p>
      </div>
    </div>
  );
}
