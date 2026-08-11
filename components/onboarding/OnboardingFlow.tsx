"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useInvoiceForm } from "@/components/invoice/useInvoiceForm";
import { InvoiceFields } from "@/components/invoice/InvoiceFields";
import { ReminderReview, type ReminderPreview } from "./ReminderReview";
import {
  cleanBusinessName,
  BUSINESS_NAME_MESSAGES,
  BUSINESS_NAME_MAX,
} from "@/lib/business-name";
import styles from "./onboarding.module.css";

/**
 * The two-step first-run flow.
 *
 * Step 1 confirms the business name. It is a confirmation and not a question:
 * the value captured at signup arrives prefilled, because asking again for
 * something the user has already given is the fastest way to make a product
 * feel careless.
 *
 * Step 2 records the first invoice and prepares its reminder, then hands off
 * to the dashboard with the invoice and reminder named in the URL so the
 * dashboard can open directly on the thing that was just created.
 *
 * Skipping is always available and always honest — it marks the account
 * `skipped`, not `completed`, so nothing later claims the user finished a flow
 * they left.
 */

/**
 * Loads BOTH prepared channels for a reminder.
 *
 * Points at /api/reminders/[id]/content rather than the old email-only
 * onboarding preview: that route returns the current stored version of each
 * channel — the owner's edit when one exists — which is the same version the
 * send path will use. Reading a different endpoint here would let the review
 * screen and the send path disagree.
 */
async function loadPreparedChannels(reminderId: string): Promise<ReminderPreview | null> {
  try {
    const res = await fetch(`/api/reminders/${encodeURIComponent(reminderId)}/content`, {
      cache: "no-store",
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.success) return null;
    return {
      reminderId: payload.reminderId,
      invoiceId: payload.invoiceId ?? "",
      email: payload.email,
      sms: payload.sms,
      legacy: payload.legacy,
    };
  } catch {
    return null;
  }
}

export function OnboardingFlow({
  initialBusinessName,
  email,
  resuming = false,
  needsBusinessName,
}: {
  initialBusinessName: string;
  email: string;
  /** True when the user previously skipped and has come back. */
  resuming?: boolean;
  /**
   * Whether the business-name prerequisite is genuinely needed.
   *
   * Decided on the server from the canonical profile value. When false the
   * flow opens directly on the invoice step — the name was collected at beta
   * signup and again at account creation, and asking a third time is the
   * friction this removes.
   */
  needsBusinessName: boolean;
}) {
  const router = useRouter();
  /**
   * Internal phase, NOT the number shown to the user.
   *
   *   1 — business-name prerequisite (only when the name is missing)
   *   2 — invoice form
   *   3 — reminder review
   *
   * The visible progress is deliberately two steps; see visibleStep below.
   */
  const [step, setStep] = useState<1 | 2 | 3>(needsBusinessName ? 1 : 2);
  /** The prepared reminder, once review has it. Completion depends on this. */
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [businessName, setBusinessName] = useState(initialBusinessName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * An invoice that exists but has no prepared reminder yet.
   *
   * Set when preparation fails after a successful save, and also on mount when
   * a previous attempt left one behind. While this holds an id the form is
   * retired — re-submitting it would create a second invoice for the same job
   * — and the flow offers to retry preparation for THIS invoice.
   *
   * Crucially, being in this state writes nothing. onboarding_status stays
   * `required`, because a preparation failure is a system problem, not a
   * decision by the user to stop.
   */
  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null);
  const [resumedInvoice, setResumedInvoice] = useState(false);
  /** The account default payment link, loaded from the canonical profile. */
  const [savedPaymentLink, setSavedPaymentLink] = useState<string | null>(null);
  /** Whether this invoice's link should be promoted to the account default. */
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  /**
   * Non-destructive warning shown when the invoice saved but the account
   * default did not. Deliberately separate from `failure`: `failure` means the
   * step did not complete, and this means it did.
   */
  const [defaultLinkWarning, setDefaultLinkWarning] = useState<string | null>(null);

  // Onboarding is the one surface that requires a schedule which can produce a
  // reminder today — the whole point is to end on one the user can look at.
  const invoiceState = useInvoiceForm({
    requireReminderEligibility: true,
    requireOnboardingFields: true,
  });

  /**
   * The step number the USER sees, or null when this phase is not a numbered
   * step at all.
   *
   * Onboarding is two steps: add the invoice, review the reminder. Everything
   * else is machinery and must not inflate the count —
   *
   *   business-name prerequisite → null. It only appears when the name is
   *     missing, so numbering it would make the flow appear to be a different
   *     length for different users, and would count a question we ideally
   *     never have to ask.
   *   retry after a preparation failure → null. A failure is not progress, and
   *     numbering it would imply the user had advanced by hitting an error.
   *
   * Both a successful first preparation and a successful retry land on the
   * review phase, so both show "Step 2 of 2".
   */
  const visibleStep: 1 | 2 | null =
    pendingInvoiceId ? null : step === 2 ? 1 : step === 3 ? 2 : null;

  // Guarantee a profile row exists, using the canonical creation path.
  //
  // GET /api/profile is the ONLY thing that creates a profile: it seeds
  // business_name from auth metadata, repairs a blank name, records terms
  // acceptance, applies table defaults and triggers the welcome email. The
  // onboarding status write deliberately cannot create a row, so this must
  // succeed before the flow can finish. It is idempotent — the dashboard
  // calls it on every load too.
  /**
   * Restore the sub-step from the SERVER, not from React state.
   *
   * This is the Note 44 fix. Onboarding status persisted correctly, but which
   * sub-step the user had reached lived only in component state, so arriving
   * via /continue — or any navigation, or a refresh — reconstructed Step 1
   * over an invoice and reminder that already existed.
   *
   * /api/onboarding/resume now reports a state rather than a retry candidate,
   * and each one maps to the screen the user actually left:
   *
   *   review            → Step 2, preview reloaded from the same endpoint the
   *                       first pass used, so the composition cannot diverge
   *   needs_preparation → the retry screen for the saved invoice
   *   fresh             → Step 1
   *
   * Creates nothing and prepares nothing: a repeat visit is idempotent.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/onboarding/resume", { cache: "no-store" });
        if (!res.ok) return;
        const payload = await res.json().catch(() => null);
        if (cancelled || !payload?.success) return;

        if (payload.state === "review" && payload.reminderId) {
          // Reuse the EXISTING reminder — no second prepare, no second row.
          const loaded = await loadPreparedChannels(payload.reminderId);
          if (cancelled) return;

          if (loaded) {
            setPreview({ ...loaded, invoiceId: payload.invoiceId ?? loaded.invoiceId });
            setResumedInvoice(true);
            setStep(3);
            return;
          }

          // The reminder exists but its preview could not be composed. Fall
          // back to the retry screen rather than a blank form — the invoice is
          // real and must not be re-created.
          setPendingInvoiceId(payload.invoiceId);
          setResumedInvoice(true);
          setStep(2);
          return;
        }

        if (payload.state === "needs_preparation" && payload.invoiceId) {
          setPendingInvoiceId(payload.invoiceId);
          setResumedInvoice(true);
          setStep(2);
        }
        // "fresh" leaves the flow exactly as initialised.
      } catch {
        // A failed resume check is not worth surfacing: the user gets the
        // ordinary form. The invoice, if any, is still on their dashboard.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        const link = payload?.profile?.default_payment_link;
        if (typeof link === "string" && link) {
          setSavedPaymentLink(link);
          // Prefill, but only into an empty field — never overwrite something
          // the user has already typed for this invoice.
          invoiceState.setField("payment_link", link);
        }
      })
      .catch(() => {
        // Non-fatal here. If the row genuinely does not exist, the status
        // write reports 409 and the user is told to reload, rather than being
        // handed a silent failure at the very start of the flow.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Records the outcome, then leaves — but ONLY if the record succeeded.
   *
   * Navigating regardless would be a loop: the status would still be
   * `required`, so the dashboard's server-side gate would send the user
   * straight back here, forever, with no error ever shown. Staying put with a
   * visible message is worse for one user on one attempt and better than an
   * unrecoverable bounce. Returns whether it left.
   */
  const finish = useCallback(
    async (
      status: "skipped" | "completed",
      destination = "/dashboard",
      evidence?: { invoice_id: string; reminder_id: string }
    ): Promise<boolean> => {
      try {
        const res = await fetch("/api/onboarding/status", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // `completed` must name what it produced. The server re-checks that
          // the invoice and reminder exist, are this user's, are joined to one
          // another, and that the reminder is still reviewable.
          body: JSON.stringify({ status, ...evidence }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          setFailure(
            payload?.message ??
              "We couldn't save your setup progress. Please reload and try again."
          );
          return false;
        }
      } catch {
        setFailure("We couldn't reach ServiceSignal. Please check your connection and try again.");
        return false;
      }

      router.push(destination);
      router.refresh();
      return true;
    },
    [router]
  );

  const skip = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    const left = await finish("skipped");
    if (!left) setBusy(false);
  }, [finish]);

  /**
   * Prepares the reminder for an EXISTING invoice, then shows it for review.
   *
   * It does NOT complete onboarding. Preparation is step 2; the user has to
   * see the real email in step 3 and choose to go on. An earlier version
   * finished and navigated straight from here, which skipped the review the
   * whole flow exists to deliver — the user would have been told a reminder
   * was ready without ever being shown it.
   *
   * Used by the first attempt AND by the retry control, so both land on the
   * same review step. Retrying re-prepares the invoice already saved; it never
   * re-creates the invoice.
   *
   * On failure it parks the invoice id and writes NOTHING. A preparation
   * failure is a system problem, and recording it as `skipped` would put a
   * decision in the user's mouth. The status stays `required`, so closing the
   * tab and coming back resumes here.
   */
  const prepareAndReview = useCallback(async (invoiceId: string) => {
    let reminderId: string | null = null;
    try {
      const res = await fetch("/api/reminders/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      const payload = await res.json().catch(() => null);
      if (res.ok && payload?.reminderId) reminderId = payload.reminderId;
    } catch {
      // Handled identically to a non-OK response below.
    }

    // Fetch the composed email. reminder_logs stores only a placeholder
    // subject and no body, so the preview is built server-side by the same
    // builder the send path uses. Without it there is nothing to review, so a
    // failure here is treated exactly like a preparation failure.
    let composed: ReminderPreview | null = null;
    if (reminderId) {
      try {
        const loaded = await loadPreparedChannels(reminderId);
        if (loaded) composed = { ...loaded, invoiceId: loaded.invoiceId || invoiceId };
      } catch {
        // Falls through to the retry state below.
      }
    }

    if (!composed) {
      setPendingInvoiceId(invoiceId);
      setFailure(
        "Your invoice is saved. We couldn't prepare its reminder just now — " +
          "you can try again in a moment."
      );
      setBusy(false);
      return;
    }

    setPreview(composed);
    setPendingInvoiceId(null);
    setFailure(null);
    setStep(3);
    setBusy(false);
  }, []);

  const retryPrepare = useCallback(async () => {
    if (!pendingInvoiceId) return;
    setBusy(true);
    setFailure(null);
    await prepareAndReview(pendingInvoiceId);
  }, [pendingInvoiceId, prepareAndReview]);

  /**
   * The ONLY path that records completion.
   *
   * Reached exclusively from "Go to your reminders" on the review step, so
   * `completed` cannot be written until the user has seen the actual email.
   * Sends nothing — it records the status and moves to the queue where
   * approval actually happens.
   */
  const goToReminders = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    setFailure(null);
    const params = new URLSearchParams({
      invoice: preview.invoiceId,
      reminder: preview.reminderId,
    });
    const left = await finish(
      "completed",
      `/dashboard/chasing?${params.toString()}`,
      { invoice_id: preview.invoiceId, reminder_id: preview.reminderId }
    );
    if (!left) setBusy(false);
  }, [preview, finish]);

  const submitName = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = cleanBusinessName(businessName);
    if (cleaned.error) {
      setNameError(BUSINESS_NAME_MESSAGES[cleaned.error]);
      return;
    }
    setNameError(null);
    setBusy(true);
    setFailure(null);

    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_name: cleaned.value }),
      });
      if (!res.ok) throw new Error("profile");
      setStep(2);
    } catch {
      setFailure("We couldn't save your business name. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = invoiceState.validateAndGet();
    if (!data) return;

    setBusy(true);
    setFailure(null);

    try {
      // Through the onboarding server boundary, NOT the browser client. RLS
      // proves who is writing but says nothing about whether their email is
      // confirmed, and nothing about reminder eligibility. This route enforces
      // both server-side, so neither can be bypassed by skipping the UI.
      const createRes = await fetch("/api/onboarding/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const createPayload = await createRes.json().catch(() => null);
      const invoice = createRes.ok ? createPayload?.invoice : null;

      if (!invoice) {
        setFailure("We couldn't save that invoice. Please check the details and try again.");
        setBusy(false);
        return;
      }

      // ── Promote to account default ──────────────────────────────────
      //
      // AFTER the invoice exists, and only when the user explicitly ticked the
      // box. Ordering matters: a failed invoice must never leave a changed
      // account default behind, so this cannot run earlier.
      //
      // Four guards, each preventing a different way to corrupt the default:
      //   saveAsDefault  — an invoice-specific link alone never changes it
      //   startsWith     — only a validated https link is ever promoted
      //   !== saved      — no pointless write when it already matches
      //   (blank fails startsWith) — an empty field can never erase the default
      //
      // Non-blocking by design. The invoice is saved and the reminder is the
      // point of this step; a convenience setting failing must not discard
      // real work. The user is TOLD rather than left guessing — see the
      // warning below, which is additive and does not stop the flow.
      const linkToSave = data.payment_link.trim();
      if (
        saveAsDefault &&
        linkToSave.startsWith("https://") &&
        linkToSave !== (savedPaymentLink ?? "")
      ) {
        try {
          const res = await fetch("/api/profile", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ default_payment_link: linkToSave }),
          });
          if (!res.ok) throw new Error("profile update failed");
          setSavedPaymentLink(linkToSave);
          // Checkbox state is cleared only on SUCCESS, so a retry of this step
          // still knows the user wanted it saved.
          setSaveAsDefault(false);
        } catch {
          setDefaultLinkWarning(
            "Your invoice was saved, but we couldn't store this as your default payment link. " +
              "You can add it in Settings."
          );
        }
      }

      // Hand straight to the shared preparation path, so the first attempt and
      // any later retry behave identically. Unconditional: it runs whether or
      // not the default-link write above succeeded.
      await prepareAndReview(invoice.id);
    } catch {
      setFailure("Something went wrong saving your invoice. Please try again.");
      setBusy(false);
    }
  };

  return (
    <main className={styles.root}>
      <div className={styles.shell}>
        <header className={styles.head}>
          <span className={styles.lockup}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/servicesignal-mark.png" alt="" className={styles.mark} />
            <span className={styles.word}>
              Service<span className={styles.wordB}>Signal</span>
            </span>
          </span>
          {visibleStep && (
            <p className={styles.progress} aria-live="polite">
              Step {visibleStep} of 2
            </p>
          )}
        </header>

        {visibleStep && (
          <ol className={styles.rail} aria-label="Setup progress">
            <li className={visibleStep >= 1 ? styles.railOn : styles.railOff}>First invoice</li>
            <li className={visibleStep >= 2 ? styles.railOn : styles.railOff}>Review reminders</li>
          </ol>
        )}

        {failure && (
          <p className={styles.failure} role="alert">
            {failure}
          </p>
        )}

        {/* Amber, not red, and it never blocks: the invoice and reminder both
            succeeded. role="status" rather than "alert" for the same reason. */}
        {defaultLinkWarning && (
          <p className={styles.warning} role="status">
            {defaultLinkWarning}
          </p>
        )}

        {step === 1 ? (
          <form onSubmit={submitName} noValidate>
            <h1 className={styles.title}>
              {resuming ? "Let's pick up where you left off" : "Confirm your business name"}
            </h1>
            <p className={styles.sub}>
              This is the business name customers will see on your reminders.
            </p>

            <label className={styles.label} htmlFor="ob-business-name">
              Business name
            </label>
            <input
              id="ob-business-name"
              className={styles.input}
              value={businessName}
              maxLength={BUSINESS_NAME_MAX}
              onChange={(e) => {
                setBusinessName(e.target.value);
                if (nameError) setNameError(null);
              }}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? "ob-business-name-err" : undefined}
              autoFocus
            />
            {nameError && (
              <p id="ob-business-name-err" className={styles.err}>
                {nameError}
              </p>
            )}

            <div className={styles.actions}>
              <button type="submit" className={styles.primary} disabled={busy}>
                {busy ? "Saving…" : "Continue"}
              </button>
              <button type="button" className={styles.skip} onClick={skip} disabled={busy}>
                I&rsquo;ll do this later
              </button>
            </div>
          </form>
        ) : step === 3 && preview ? (
          <ReminderReview
            preview={preview}
            busy={busy}
            onContinue={goToReminders}
            onLater={skip}
          />
        ) : pendingInvoiceId ? (
          // The invoice exists; its reminder does not yet. The form is retired
          // because re-submitting would create a second invoice for the same
          // job — but NOTHING has been written to onboarding_status. The
          // primary action retries preparation for this invoice. Only the
          // secondary action, chosen deliberately, records `skipped`.
          <div>
            <h1 className={styles.title}>
              {resumedInvoice ? "Let's finish setting up your reminder" : "Your invoice is saved"}
            </h1>
            <p className={styles.sub}>
              {resumedInvoice
                ? "You saved an invoice last time but its reminder wasn't prepared yet. Nothing has been sent."
                : "Your invoice is safe. We just couldn't prepare its reminder — this is usually temporary."}{" "}
              You can try again now, and nothing will be sent without your approval.
            </p>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={retryPrepare}
                disabled={busy}
              >
                {busy ? "Preparing…" : "Try preparing the reminder again"}
              </button>
              <button type="button" className={styles.skip} onClick={skip} disabled={busy}>
                Finish this later
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submitInvoice} noValidate>
            <h1 className={styles.title}>Add your first overdue invoice</h1>
            <p className={styles.sub}>
              {/* Plural: the owner reviews an SMS and an email, and the two
                  channels are equal. Scoped to THESE reminders rather than
                  stated as a permanent product guarantee — Auto mode is
                  planned, and an absolute claim here would age badly. */}
              Add the details below. ServiceSignal will prepare your SMS and
              email reminders for review — neither is sent until you approve
              them.
            </p>

            <div className={styles.fields}>
              <InvoiceFields
                state={invoiceState}
                onboarding
                savedPaymentLink={savedPaymentLink}
                saveAsDefault={saveAsDefault}
                onSaveAsDefaultChange={setSaveAsDefault}
              />
            </div>

            <div className={styles.actions}>
              <button type="submit" className={styles.primary} disabled={busy}>
                {busy ? "Saving…" : "Save and review reminders"}
              </button>
              <button
                type="button"
                className={styles.skip}
                onClick={skip}
                disabled={busy}
              >
                I&rsquo;ll do this later
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
