"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useInvoiceForm } from "@/components/invoice/useInvoiceForm";
import { InvoiceFields } from "@/components/invoice/InvoiceFields";
import { prepareEligibility } from "@/lib/reminder-schedule";
import { formatDate } from "@/lib/invoices";
import { ReminderReview, type ReminderPreview } from "./ReminderReview";
import {
  cleanBusinessName,
  BUSINESS_NAME_MESSAGES,
  BUSINESS_NAME_MAX,
} from "@/lib/business-name";
import styles from "./onboarding.module.css";

/**
 * The first-run flow: one invoice in, two real reminders out.
 *
 * ── WHY A PAGE AND NOT A MODAL OVER THE DASHBOARD ─────────────────────────
 *
 * The competitor pattern — dim the dashboard, float setup on top — exists to
 * tell the customer their account is real and waiting. That is worth having.
 * It is not worth having THIS way, for four reasons that are specific to this
 * form rather than to overlays in general:
 *
 *   1. Height. Even with both optional sections collapsed this is a customer
 *      block, an invoice block and a reminder-plan block. On a 390px phone
 *      that is a scrolling dialog inside a scrolling page, which is the
 *      awkward-modal-in-a-phone outcome to avoid, not a risk to manage.
 *   2. The thing behind is the wrong thing. A zero-invoice account renders the
 *      Overview first-run card, which already says "Ready to chase an overdue
 *      invoice? / Add an invoice". Dimming that and floating a second, larger
 *      invitation on top of it is one invitation too many.
 *   3. It would need a focus trap, a scroll lock, an inert background and
 *      considered Escape semantics purely to reach the accessibility a plain
 *      page has for free — and Escape on a setup surface has no good answer:
 *      dismissing to an empty dashboard is a silent Skip nobody chose.
 *   4. Skip already has a real destination. /dashboard is a navigation, not a
 *      dismissal, so the escape route needs no overlay to make sense.
 *
 * What the overlay was FOR is kept and made honest: instead of a blurred
 * screenshot implying the account exists, the header states the two facts we
 * already hold — the business name that will sign the reminders, and the
 * address the customer is signed in with. Checkable, and it doubles as visible
 * proof that neither is about to be asked for again.
 *
 * ── THE STEPS ─────────────────────────────────────────────────────────────
 *
 * A business-name prerequisite exists but is skipped whenever the name is
 * already known, which is the ordinary case. Then: the invoice, then the
 * prepared SMS and email. Two steps, because two things happen. Nothing is
 * padded to three.
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

/** A saved invoice with no reachable checkpoint yet — the Case B payload. */
interface AddedInvoice {
  invoiceId: string;
  dueDate: string;
  /**
   * The date the earliest remaining checkpoint is reached — prepareEligibility's
   * own answer, computed from the invoice's due date and the plan the owner
   * chose. Fixed arithmetic, not a promise that anything will happen.
   */
  eligibleFrom: string | null;
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
   *   3 — reminder review          (a checkpoint has been reached)
   *   4 — invoice added, nothing to review yet (no checkpoint reached)
   *
   * 3 and 4 are the two honest endings, chosen by the invoice's own lifecycle
   * rather than by anything onboarding wants to happen. The visible progress
   * is two steps in both cases; see visibleStep below.
   */
  const [step, setStep] = useState<1 | 2 | 3 | 4>(needsBusinessName ? 1 : 2);
  /**
   * The saved invoice, when it produced nothing to review yet.
   *
   * `eligibleFrom` is the date the earliest remaining checkpoint is reached —
   * computed by prepareEligibility from the invoice's OWN due date and
   * schedules, which is the same rule the daily job uses to decide what to
   * prepare. It is a forecast the system genuinely keeps, not a guess.
   */
  const [added, setAdded] = useState<AddedInvoice | null>(null);
  /**
   * A saved future-dated invoice whose COMPLETION has not been recorded.
   *
   * `added` is set only once the server has banked the outcome, so the success
   * screen cannot appear before onboarding is genuinely finished. This holds
   * the same payload while that write is outstanding, which keeps the invoice
   * form retired — resubmitting it would create a second invoice for the same
   * job, the exact duplicate this lifecycle change exists to prevent.
   */
  const [pendingCompletion, setPendingCompletion] = useState<AddedInvoice | null>(null);
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
  /** Scoped root for the first-error search — see focusFirstError. */
  const invoiceFormRef = useRef<HTMLFormElement>(null);

  const invoiceState = useInvoiceForm({ requireOnboardingFields: true });

  /**
   * The step number the USER sees, or null when this phase is not a numbered
   * step at all.
   *
   * Onboarding is two steps: add the invoice, then whatever the invoice
   * actually produced. Everything else is machinery and must not inflate the
   * count —
   *
   *   business-name prerequisite → null. It only appears when the name is
   *     missing, so numbering it would make the flow appear to be a different
   *     length for different users, and would count a question we ideally
   *     never have to ask.
   *   retry after a preparation failure → null. A failure is not progress, and
   *     numbering it would imply the user had advanced by hitting an error.
   *
   * Steps 3 and 4 are both step 2 of 2 — the customer has finished either way.
   * Only the LABEL differs, because "Ready to review" is false when nothing is
   * eligible yet. A false step is worse than a plain one.
   */
  const visibleStep: 1 | 2 | null =
    pendingInvoiceId || pendingCompletion
      ? null
      : step === 2
      ? 1
      : step === 3 || step === 4
      ? 2
      : null;
  const secondStepLabel = step === 4 ? "Added" : "Ready to review";

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
   * The single PATCH that records an onboarding outcome. Records only — it
   * navigates nothing and shows nothing.
   *
   * Split out from `finish` because Case B has to record WITHOUT leaving: the
   * outcome must already be banked before the "Invoice added" screen claims
   * the setup is done. Everything else still uses `finish`, which is this plus
   * a navigation, so there remains exactly one place that writes the status.
   *
   * `eligibleNow` is a distinct result rather than an error string, because it
   * is recoverable and the recovery is specific — see completeWithoutReminder.
   */
  const recordStatus = useCallback(
    async (
      status: "skipped" | "completed",
      // reminder_id is omitted when the invoice produced nothing to review.
      // The server does NOT take that on trust — it re-derives eligibility
      // from the stored invoice; see app/api/onboarding/status.
      evidence?: { invoice_id: string; reminder_id?: string }
    ): Promise<
      | { ok: true }
      | { ok: false; eligibleNow: true }
      | { ok: false; eligibleNow: false; message: string }
    > => {
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
          // The invoice reached its first checkpoint between being created and
          // this request. Not a failure of the customer's — see the recovery.
          if (payload?.reason === "eligible_now") return { ok: false, eligibleNow: true };
          return {
            ok: false,
            eligibleNow: false,
            message:
              payload?.message ??
              "We couldn't save your setup progress. Please reload and try again.",
          };
        }
      } catch {
        return {
          ok: false,
          eligibleNow: false,
          message:
            "We couldn't reach ServiceSignal. Please check your connection and try again.",
        };
      }
      return { ok: true };
    },
    []
  );

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
      evidence?: { invoice_id: string; reminder_id?: string }
    ): Promise<boolean> => {
      const result = await recordStatus(status, evidence);
      if (!result.ok) {
        setFailure(
          result.eligibleNow
            ? "We couldn't save your setup progress. Please reload and try again."
            : result.message
        );
        return false;
      }

      router.push(destination);
      router.refresh();
      return true;
    },
    [router, recordStatus]
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

  /**
   * Banks the Case B outcome, and only then shows it.
   *
   * ── WHY COMPLETION IS NOT ON THE BUTTON ──────────────────────────────────
   *
   * It used to be: the screen appeared, and the PATCH ran when the customer
   * pressed "Go to Active Chasing". Two things went wrong with that.
   *
   *   1. Closing the tab on that screen left a real invoice behind with the
   *      status still `required`. The dashboard gate would send them back
   *      through onboarding, where the form is blank — so the natural thing to
   *      do is enter the same invoice again.
   *   2. The screen can sit open across the invoice's first checkpoint, most
   *      obviously over midnight. The server re-derives eligibility on every
   *      reminder-less completion, so it would by then find a schedule and
   *      answer 422 — correctly, and with no way out for the customer.
   *
   * Recording first fixes (1) outright. For (2) the answer is not to weaken
   * the server check but to LISTEN to it: `eligible_now` means the invoice has
   * become preparable, so the honest response is to give the customer the
   * review they would have had a minute earlier. They land on the real
   * reminder, having seen it, and completion is then recorded with the full
   * reminder evidence. Nothing bypasses review, and nobody is stranded.
   *
   * Used by the first attempt and by the retry, so both behave identically.
   */
  const completeWithoutReminder = useCallback(
    async (payload: AddedInvoice) => {
      const result = await recordStatus("completed", { invoice_id: payload.invoiceId });

      if (result.ok) {
        setAdded(payload);
        setPendingCompletion(null);
        setFailure(null);
        setStep(4);
        setBusy(false);
        return;
      }

      if (result.eligibleNow) {
        // The checkpoint arrived while we were here. prepareAndReview owns
        // `busy` and moves to step 3 on success, or parks the invoice for
        // retry — the same handling any eligible invoice gets.
        setPendingCompletion(null);
        await prepareAndReview(payload.invoiceId);
        return;
      }

      // Recorded nothing. The invoice is real, so the form stays retired and
      // the customer is offered the write again rather than a blank form.
      setPendingCompletion(payload);
      setFailure(result.message);
      setBusy(false);
    },
    [recordStatus, prepareAndReview]
  );

  const retryCompletion = useCallback(async () => {
    if (!pendingCompletion) return;
    setBusy(true);
    setFailure(null);
    await completeWithoutReminder(pendingCompletion);
  }, [pendingCompletion, completeWithoutReminder]);

  /**
   * The forward action from the "Invoice added" ending — NAVIGATION ONLY.
   *
   * By the time this screen renders, `completed` is already recorded. Pressing
   * this decides nothing about the customer's setup; it only takes them to the
   * invoice they just created.
   */
  const goToAddedInvoice = useCallback(() => {
    if (!added) return;
    const params = new URLSearchParams({ invoice: added.invoiceId });
    router.push(`/dashboard/chasing?${params.toString()}`);
    router.refresh();
  }, [added, router]);

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

  /**
   * Moves the cursor to the first field the validator rejected.
   *
   * Queried from the DOM rather than from a hand-kept list of field ids, so
   * adding, removing or reordering a field cannot silently stop this working —
   * and the order it finds is document order, which is the order the customer
   * reads in.
   *
   * rAF because aria-invalid is written by React on the next paint; querying
   * synchronously would search the markup as it was BEFORE validation. The
   * scroll afterwards is not redundant: focus() alone can leave the field
   * under the sticky action bar.
   */
  const focusFirstError = useCallback(() => {
    requestAnimationFrame(() => {
      const first =
        invoiceFormRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (!first) return;
      first.focus();
      first.scrollIntoView({ block: "center" });
    });
  }, []);

  const submitInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = invoiceState.validateAndGet();
    // Everything typed stays exactly where it is — validateAndGet only reads.
    if (!data) {
      focusFirstError();
      return;
    }

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

      // ── WHICH ENDING THIS INVOICE EARNS ─────────────────────────────
      //
      // Asked of the INVOICE, using the same function the Prepare Reminder
      // control and /api/reminders/prepare use, with `alreadySent` empty
      // because the row was created a moment ago. So the flow follows the
      // lifecycle rather than the lifecycle being bent to suit the flow.
      //
      // Preparing anyway would mean either a reminder_logs row for a
      // checkpoint that has not been reached — premature work the daily job
      // would then duplicate or skip — or invented preview content with
      // nothing behind it. Both are worse than saying so.
      const eligibility = prepareEligibility(
        invoice.reminder_schedules ?? [],
        invoice.reminders_sent ?? [],
        invoice.due_date
      );

      if (!eligibility.schedule) {
        setPendingInvoiceId(null);
        // Records BEFORE showing anything. completeWithoutReminder owns the
        // step, the busy flag and the failure message from here.
        await completeWithoutReminder({
          invoiceId: invoice.id,
          dueDate: invoice.due_date,
          eligibleFrom: eligibility.eligibleFrom ?? null,
        });
        return;
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

        {/* Two segments because two things happen, not because a progress bar
            looks more sophisticated with three. Labelled with the actions
            themselves — a bare "1 / 2" tells the customer how long it is but
            not what it is. */}
        {visibleStep && (
          <ol className={styles.rail} aria-label="Setup progress">
            <li className={visibleStep >= 1 ? styles.railOn : styles.railOff}>Add invoice</li>
            <li className={visibleStep >= 2 ? styles.railOn : styles.railOff}>{secondStepLabel}</li>
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
                Skip for now
              </button>
            </div>
          </form>
        ) : step === 4 && added ? (
          /*
           * CASE B — the invoice is real, and nothing is due to be prepared
           * yet. Deliberately small: the customer has not done anything wrong
           * and must not be handed another full screen as a consolation.
           *
           * ── WHY IT DESCRIBES THE SCHEDULE RATHER THAN PROMISING AN ACTION ─
           *
           * The first version said "We'll prepare the SMS and the email on 6
           * September, ready for you to review." That is an unconditional
           * promise about a future action, and the action is conditional:
           *
           *   - the founding-beta allowance is finite, and at 10 / 10 the
           *     Prepare Reminder control is already refused by
           *     allowancePreflight — so a reminder the customer cannot act on
           *     is not one we can promise them;
           *   - the daily job also skips an invoice that has since been paid,
           *     archived, or left without a deliverable customer email.
           *
           * None of that belongs on this screen, and spelling it out would put
           * billing copy in front of someone who has just added their first
           * invoice. The fix is not a disclaimer — it is to stop claiming
           * something conditional. Both facts below are unconditional: the due
           * date is the one they typed, and the checkpoint date is fixed
           * arithmetic on the plan they chose (due date + SCHEDULE_DAY offset),
           * stored on their invoice. Neither depends on anything happening.
           *
           * Nothing implies a message has been sent, because none has, and
           * SMS and email are named together as one reminder — which is also
           * exactly what one unit of the allowance is.
           */
          <div>
            {/* NO EYEBROW. "Step complete" labelled the state twice — the rail
                already reads "Added" — and the heading is the outcome. */}
            <h1 className={styles.title}>Invoice added</h1>
            <p className={styles.sub}>
              {!added.eligibleFrom ? (
                // No remaining checkpoint at all. Says only what is certain.
                <>It&rsquo;s due on {formatDate(added.dueDate)}.</>
              ) : added.eligibleFrom === added.dueDate ? (
                // The common case: the due date IS the first checkpoint. "The
                // same day" rather than the date again, so it is not read twice.
                <>
                  It&rsquo;s due on {formatDate(added.dueDate)}. Your first reminder is
                  scheduled for the same day.
                </>
              ) : (
                <>
                  It&rsquo;s due on {formatDate(added.dueDate)}. Your first reminder is
                  scheduled for {formatDate(added.eligibleFrom)}.
                </>
              )}
              {/* NOT "SMS and email". The invoice step has already said
                  ServiceSignal prepares both, and the channels are equal
                  there — repeating it here re-explains what a reminder is to
                  someone who has just been told. It also stays a statement
                  about the SCHEDULE, which is fixed, rather than about what we
                  will do, which is conditional. */}
            </p>

            <div className={styles.actions}>
              {/* Not disabled by `busy`, and it awaits nothing: onboarding is
                  already recorded as completed by the time this renders. */}
              <button type="button" className={styles.primary} onClick={goToAddedInvoice}>
                Go to Active Chasing
              </button>
            </div>
          </div>
        ) : step === 3 && preview ? (
          <ReminderReview
            preview={preview}
            busy={busy}
            onContinue={goToReminders}
            onLater={skip}
          />
        ) : pendingCompletion ? (
          /*
           * The invoice saved; the completion write did not. Deliberately NOT
           * the "Invoice added" screen — that screen states the setup is done,
           * and it is not yet.
           *
           * The form is not offered again. It is blank, and a customer looking
           * at a blank form after a failure reasonably re-enters the invoice
           * they just created. The only forward action is the write that
           * failed.
           */
          <div>
            <h1 className={styles.title}>Your invoice is saved</h1>
            <p className={styles.sub}>
              Nothing needs adding again. We just couldn&rsquo;t finish saving your
              setup — this is usually temporary.
            </p>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={retryCompletion}
                disabled={busy}
              >
                {busy ? "Finishing…" : "Try again"}
              </button>
              {/* Records `skipped`, which is true: they are choosing to leave
                  setup unfinished. Their invoice stays exactly where it is. */}
              <button type="button" className={styles.skip} onClick={skip} disabled={busy}>
                Finish this later
              </button>
            </div>
          </div>
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
              You can try again now.
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
          <form onSubmit={submitInvoice} noValidate ref={invoiceFormRef}>
            {/* The account part is over, said once and quietly. This is the
                whole emotional job of the screen: the customer has just done
                a beta application, an email verification, a password and a
                terms agreement, and needs to know none of that is starting
                again. */}
            <p className={styles.eyebrow}>Your account is ready</p>
            <h1 className={styles.title}>
              {/* NOT "your first overdue invoice". The flow now accepts any
                  real due date, so promising an overdue one in the heading
                  would tell a customer with an invoice due next week that they
                  are in the wrong place — the exact pressure this pass
                  removed from the validator. */}
              Let&rsquo;s get your first invoice ready.
            </h1>
            <p className={styles.sub}>
              {/* Plural, and symmetrical: the owner reviews an SMS and an
                  email, and the two channels are equal — neither is described
                  as the main one. Scoped to THESE reminders rather than stated
                  as a permanent product guarantee, because Auto mode is
                  planned and an absolute claim here would age badly. */}
              Add your customer, what they owe and when it&rsquo;s due. ServiceSignal
              prepares the SMS and the email, and you review both before anything
              goes out. Takes about a minute.
            </p>

            {/* WHAT WE ALREADY KNOW — see the module CSS for why this replaces
                a dimmed dashboard. Rendered only from values that exist, so a
                missing one leaves no dangling separator or empty emphasis. */}
            {(businessName.trim() || email) && (
              <p className={styles.facts}>
                {businessName.trim() && (
                  <span>
                    Reminders will come from{" "}
                    <span className={styles.factStrong}>{businessName.trim()}</span>
                  </span>
                )}
                {email && <span>Signed in as {email}</span>}
              </p>
            )}

            <div className={styles.fields}>
              <InvoiceFields
                state={invoiceState}
                variant="onboarding"
                savedPaymentLink={savedPaymentLink}
                saveAsDefault={saveAsDefault}
                onSaveAsDefaultChange={setSaveAsDefault}
              />
            </div>

            <div className={styles.actions}>
              <button type="submit" className={styles.primary} disabled={busy}>
                {busy ? "Saving…" : "Add invoice & continue"}
              </button>
              {/* A real button beside the primary, not a footnote beneath it.
                  No confirmation, no warning, no consequence copy: skipping
                  creates nothing and costs nothing. */}
              <button
                type="button"
                className={styles.skip}
                onClick={skip}
                disabled={busy}
              >
                Skip for now
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
