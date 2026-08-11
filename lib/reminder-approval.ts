import { buildReminderEmail } from "./email-templates";
import { prepareEligibility } from "./reminder-schedule";
import { formatDate } from "./invoices";
import { verifyReviewToken } from "./review-token";
import {
  currentContent,
  contentVersionHash,
  emailHtmlForBody,
  type ReminderFacts,
  type StoredReminderContent,
} from "./reminder-content";
import {
  isClaimable,
  CLAIMABLE_STATUSES,
  classifyProviderError,
  statusForOutcome,
  contentHash,
  idempotencyKeyFor,
  type ReminderSendStatus,
} from "./reminder-send-state";
import {
  allowanceExhaustedRefusal,
  allowanceUnavailableRefusal,
  isAllowanceUnavailable,
  type AllowanceStore,
} from "./allowance-claim";
import type { ReminderSchedule, ReminderTone } from "@/types";

/**
 * The reminder approval SERVICE — every rule that decides whether a real email
 * reaches a real customer, with the database and the email provider injected.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE ROUTE
 *
 * All of this logic previously lived inside the Next.js route handler, where it
 * could only be exercised by actually running a server, actually holding a
 * session, and actually calling Resend. That made the most safety-critical code
 * in the product the least testable code in the product, and the strongest
 * claims about it — atomic claiming, at-most-once submission, no retry after an
 * ambiguous result — provable only by reading it.
 *
 * The route is now a thin adapter that wires Supabase and Resend into the ports
 * below. Everything a test needs to drive is a plain object, so concurrency,
 * provider rejection, provider ambiguity and post-acceptance database failure
 * are all reachable without a network or a database.
 *
 * NOTHING about ownership is decided here. The adapter supplies a Supabase
 * client bound to the caller's own session, so RLS makes another user's
 * reminder simply not exist — see loadReminder in the route.
 */

// ── Ports ───────────────────────────────────────────────────────────────────

export interface ApprovalInvoice {
  customerName: string;
  customerEmail: string;
  /** Part of the reviewed identity: changing it invalidates an approval. */
  customerPhone: string | null;
  amount: number;
  dueDate: string;
  paymentLink: string | null;
  reminderTone: ReminderTone;
  /** invoices.status — 'paid' is the kill switch. */
  status: string;
  reminderSchedules: ReminderSchedule[] | null;
  remindersSent: ReminderSchedule[] | null;
  invoiceReference: string | null;
  jobDescription: string | null;
}

export interface ApprovalReminder {
  id: string;
  invoiceId: string;
  schedule: ReminderSchedule;
  status: ReminderSendStatus;
  emailTo: string;
  /** Logical attempts already allocated. 0 for a reminder never attempted. */
  sendAttemptCount: number;
  /**
   * Per-channel stored content. Both null for a legacy reminder prepared before
   * migration 010, which then falls back to live composition.
   */
  storedContent: StoredReminderContent | null;
  invoice: ApprovalInvoice;
}

export interface ClaimInput {
  id: string;
  /** The only statuses a claim may take the row from. */
  fromStatuses: readonly ReminderSendStatus[];
  /** Compare-and-set guard: the attempt count the caller read. */
  expectAttemptCount: number;
  /** expectAttemptCount + 1. Persisted by the winning claim. */
  nextAttemptCount: number;
  attemptKey: string;
  contentHash: string;
  startedAt: string;
}

export interface ApprovalDb {
  loadReminder(id: string): Promise<ApprovalReminder | null>;
  loadBusinessName(userId: string): Promise<string | null>;
  /** Used only by the paid-invoice kill switch. */
  dismiss(id: string): Promise<void>;
  /**
   * Atomic conditional UPDATE. MUST match on id, status ∈ fromStatuses AND
   * send_attempt_count = expectAttemptCount, so exactly one concurrent caller
   * can ever succeed.
   */
  claim(input: ClaimInput): Promise<{ claimed: boolean; error?: string; archived?: boolean }>;
  /** Records a non-accepted or ambiguous submission outcome. */
  recordSubmissionOutcome(input: {
    id: string;
    status: ReminderSendStatus;
    error: string;
  }): Promise<{ ok: boolean; error?: string }>;
  /** Records a CONFIRMED provider acceptance. */
  recordAccepted(input: {
    id: string;
    providerMessageId: string | null;
    sentAt: string;
  }): Promise<{ ok: boolean; error?: string }>;
  appendScheduleSent(invoiceId: string, schedule: ReminderSchedule): Promise<void>;
}

export type MailerResult =
  | { ok: true; id: string | null }
  | { ok: false; code: string | null; message: string };

export interface MailerMessage {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  send(
    message: MailerMessage,
    options: { idempotencyKey: string }
  ): Promise<MailerResult>;
}

export interface ApprovalDeps {
  db: ApprovalDb;
  /**
   * The Founding Beta cap. Required, and there is no "no store" mode: an
   * optional enforcement point is one someone forgets to wire up.
   */
  allowance: AllowanceStore;
  /** null when RESEND_API_KEY is absent — handled, never crashed on. */
  mailer: Mailer | null;
  from: string;
  userId: string;
  userEmail: string | null;
  now?: () => Date;
  log?: (level: "warn" | "error", message: string) => void;
}

export interface ApprovalRequest {
  reminderId: string;
  /** Whatever the client posted. Untrusted, verified below. */
  reviewToken: string | null;
}

/**
 * `outcome` exists for tests and logs. `status`/`body` are exactly what the
 * route returns, so the HTTP contract is asserted here rather than restated.
 */
export interface ApprovalResult {
  status: number;
  body: Record<string, unknown> & { success: boolean; message: string };
  outcome:
    | "sent"
    | "refused"
    | "rejected"
    | "delivery_unknown"
    | "not_configured"
    | "db_error"
    | "allowance_exhausted"
    | "allowance_unavailable";
  /** Set only when a provider submission was actually made. */
  attemptKey?: string;
}

const NO_SEND: Omit<ApprovalResult, "status" | "body"> = { outcome: "refused" };

function refuse(
  status: number,
  body: Record<string, unknown> & { success: boolean; message: string }
): ApprovalResult {
  return { status, body, ...NO_SEND };
}

// ── Composition ─────────────────────────────────────────────────────────────

/**
 * The sender-name fallback chain. Exported because the review page must use the
 * identical one — if the two ever diverged the reviewed message and the sent
 * message would differ in the From line, which is exactly what the content hash
 * exists to prevent.
 */
export function resolveBusinessName(
  profileBusinessName: string | null | undefined,
  userEmail: string | null
): string {
  return profileBusinessName?.trim() || userEmail || "ServiceSignal";
}

/**
 * Builds the message AND its fingerprint from live data.
 *
 * Exported so a test can compute exactly what the service will compute, rather
 * than a test-local reimplementation that could drift and quietly stop testing
 * the real rule.
 */
export function composeReminderContent(
  reminder: ApprovalReminder,
  businessName: string,
  replyTo: string | null,
  now: Date = new Date()
): {
  subject: string;
  html: string;
  text: string;
  smsBody: string;
  hash: string;
  edited: { email: boolean; sms: boolean };
  legacy: boolean;
} {
  const facts: ReminderFacts = {
    tone: reminder.invoice.reminderTone,
    schedule: reminder.schedule,
    customerName: reminder.invoice.customerName,
    businessName,
    amount: reminder.invoice.amount,
    dueDate: reminder.invoice.dueDate,
    paymentLink: reminder.invoice.paymentLink,
    invoiceReference: reminder.invoice.invoiceReference,
    jobDescription: reminder.invoice.jobDescription,
  };

  // THE STORED VERSION WINS.
  //
  // This is the change that makes customer editing real. Previously this
  // function always rebuilt the message, which meant an edit could never
  // survive to the provider — it would be silently replaced by the generated
  // wording at send time.
  //
  // currentContent() reads the stored original, or the owner's edit when one
  // exists, and only falls back to live composition for legacy reminders that
  // predate the channel table. So the bytes hashed here, the bytes shown on the
  // review page, and the bytes handed to Resend are the same bytes.
  const stored = reminder.storedContent ?? { email: null, sms: null };
  const current = currentContent(stored, facts, now);

  // The designed HTML template is still used verbatim whenever the owner has
  // not edited. Only an edited body needs its own rendering.
  const generatedHtml = buildReminderEmail({
    tone: facts.tone,
    schedule: facts.schedule,
    customerName: facts.customerName,
    businessName,
    amount: facts.amount,
    dueDate: facts.dueDate,
    paymentLink: facts.paymentLink || undefined,
    invoiceReference: facts.invoiceReference ?? null,
    jobDescription: facts.jobDescription ?? null,
  }).html;

  return {
    subject: current.email.subject,
    html: emailHtmlForBody(current.email.body, generatedHtml, current.email.edited),
    text: current.email.body,
    smsBody: current.sms.body,
    edited: { email: current.email.edited, sms: current.sms.edited },
    legacy: current.legacy,
    // Spans BOTH channels and the recipient identities, so editing the SMS
    // invalidates an approval taken over the pair exactly as an email edit
    // does. That is what makes ONE approval for TWO channels safe.
    hash: contentVersionHash(current, {
      recipientEmail: reminder.emailTo,
      recipientPhone: reminder.invoice.customerPhone ?? null,
      senderName: businessName,
      replyTo,
    }),
  };
}

// ── The service ─────────────────────────────────────────────────────────────

export async function approveAndSendReminder(
  deps: ApprovalDeps,
  request: ApprovalRequest
): Promise<ApprovalResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});

  const reminder = await deps.db.loadReminder(request.reminderId);

  // Not found and not-yours are the SAME answer. The adapter reads under the
  // caller's session, so another user's reminder returns null here — and this
  // response cannot be used to confirm that someone else's reminder exists.
  if (!reminder) {
    return refuse(404, { success: false, message: "Reminder not found." });
  }

  // ── Status gating: one distinct answer per state ─────────────────────────
  const currentStatus = reminder.status;

  if (currentStatus === "sent" || currentStatus === "dismissed") {
    return refuse(409, {
      success: false,
      state: currentStatus,
      message: `Reminder is already ${currentStatus}.`,
    });
  }

  if (currentStatus === "sending") {
    return refuse(409, {
      success: false,
      state: "sending",
      message: "This reminder is already being sent.",
    });
  }

  // Resend may already have accepted this message. Resending could deliver a
  // second copy to a real customer, so it is refused outright — reconciliation
  // is a human decision, not a button.
  if (currentStatus === "delivery_unknown") {
    return refuse(409, {
      success: false,
      state: "delivery_unknown",
      message:
        "We couldn't confirm the previous delivery result. Don't resend yet — " +
        "your customer may already have received this.",
    });
  }

  // Accepted by the provider, delivery then failed. NOT the same as `failed`:
  // a submission definitely happened, and the recipient details are the thing
  // that needs attention. A fresh reminder is a deliberate new decision.
  if (currentStatus === "undelivered") {
    return refuse(409, {
      success: false,
      state: "undelivered",
      message:
        "Resend accepted this reminder, but final delivery was unsuccessful. " +
        "Review the recipient details before preparing a new reminder.",
    });
  }

  if (!isClaimable(currentStatus)) {
    return refuse(409, {
      success: false,
      state: currentStatus,
      message: "This reminder can't be sent.",
    });
  }

  // ── Kill switch: never send reminders for a paid invoice ─────────────────
  if (reminder.invoice.status === "paid") {
    await deps.db.dismiss(reminder.id);
    return refuse(409, {
      success: false,
      message: "This invoice has already been marked paid. Reminders are stopped.",
    });
  }

  // ── Eligibility revalidation ─────────────────────────────────────────────
  // The last gate before an email leaves the building, re-checked against LIVE
  // invoice data rather than anything captured at review time.
  if (reminder.invoice.dueDate) {
    const eligibility = prepareEligibility(
      reminder.invoice.reminderSchedules ?? [reminder.schedule],
      reminder.invoice.remindersSent ?? [],
      reminder.invoice.dueDate
    );

    if (!eligibility.schedule) {
      return refuse(409, {
        success: false,
        state: "not_eligible",
        message: eligibility.eligibleFrom
          ? `This reminder isn't due yet. It can be sent from ${formatDate(eligibility.eligibleFrom)}.`
          : "This reminder is no longer due to be sent.",
        blockedReason: eligibility.blockedReason,
        eligibleFrom: eligibility.eligibleFrom,
      });
    }
  }

  if (!deps.mailer) {
    log("error", "[send-reminder] RESEND_API_KEY is missing — cannot send.");
    await deps.db.recordSubmissionOutcome({
      id: reminder.id,
      status: "failed",
      error: "RESEND_API_KEY not configured",
    });
    return {
      status: 503,
      body: { success: false, state: "failed", message: "Email service is not configured." },
      outcome: "not_configured",
    };
  }

  // ── Compose, using the SAME builder and SAME fallback as the review page ──
  const businessName = resolveBusinessName(
    await deps.db.loadBusinessName(deps.userId),
    deps.userEmail
  );

  const { subject, html, text, hash: currentHash } = composeReminderContent(
    reminder,
    businessName,
    deps.userEmail
  );

  // ── Server-trusted review authorisation ──────────────────────────────────
  //
  // An HMAC only this server can mint. Verifying it proves the approval came
  // from a review page issued to THIS user, for THIS reminder, for EXACTLY this
  // content, recently. Every failure mode — absent, forged, expired, retargeted
  // or content-changed — fails closed with no send.
  const verified = verifyReviewToken(
    request.reviewToken,
    { userId: deps.userId, reminderId: reminder.id, contentHash: currentHash },
    now()
  );

  if (!verified.ok) {
    // `content_changed` and `expired` are the ones the owner can act on. The
    // rest share generic wording, because a forged or retargeted token should
    // learn nothing from us.
    const stale = verified.reason === "content_changed" || verified.reason === "expired";

    if (!stale) {
      log(
        "warn",
        `[send-reminder] Review authorisation rejected for reminder ${reminder.id} ` +
          `(user ${deps.userId}): ${verified.reason}.`
      );
    }

    return refuse(409, {
      success: false,
      state: "stale_review",
      reason: verified.reason,
      message: stale
        ? "This reminder changed since you reviewed it. Reload the latest version before sending."
        : "This approval is no longer valid. Reload the review page and try again.",
    });
  }

  // ── FOUNDING BETA ALLOWANCE ──────────────────────────────────────────────
  //
  // PLACED HERE, and the position is the design.
  //
  // AFTER every cheap refusal — wrong status, paid invoice, not yet due, no
  // mailer, bad review token. None of those should touch the allowance, and
  // reserving before them would mean a rejected token could cost a credit.
  //
  // BEFORE the row claim, so an exhausted account leaves the reminder exactly
  // as it was: still `pending`, still reviewable, still sendable the moment
  // the customer upgrades. Reserving after the row claim would strand the
  // reminder in `sending` until its lease expired.
  //
  // BEFORE the provider submission, necessarily. This is the whole point: the
  // decision must be committed before anything leaves the building, because
  // after a send there is nothing left to prevent.
  const allowance = await deps.allowance.claim(reminder.id);

  if (isAllowanceUnavailable(allowance)) {
    // FAIL CLOSED. A cap that stops applying when a database call fails is not
    // a cap. Reported as its own state — never as "you've used all ten", which
    // would tell a customer with credits left that they had none.
    log("error", `[send-reminder] Allowance check failed for ${reminder.id}: ${allowance.error}`);
    const refusal = allowanceUnavailableRefusal();
    return { status: refusal.status, body: refusal.body, outcome: "allowance_unavailable" };
  }

  if (allowance.outcome === "exhausted") {
    const refusal = allowanceExhaustedRefusal(allowance.used, allowance.allowance);
    return { status: refusal.status, body: refusal.body, outcome: "allowance_exhausted" };
  }

  // `claimed` means THIS request reserved the unit and owns releasing it.
  // `already_held` means a previous attempt on this same reminder reserved it;
  // this request must never release a unit it did not take.
  const reservedHere = allowance.outcome === "claimed";

  // ── Allocate the logical attempt, then claim it atomically ───────────────
  //
  // The attempt number comes from the row we just read; the claim only succeeds
  // if the row is STILL at that count and still claimable. Two concurrent
  // approvals compute the same key, and exactly one of them wins the update —
  // so exactly one provider submission happens.
  const attemptNumber = reminder.sendAttemptCount + 1;
  const attemptKey = idempotencyKeyFor(reminder.id, currentHash, attemptNumber);

  const claim = await deps.db.claim({
    id: reminder.id,
    // The single source of truth, shared with the review page. Hardcoding the
    // list here would let the two drift, and a drift in this direction means a
    // status the UI calls unsendable becoming sendable by the route.
    fromStatuses: CLAIMABLE_STATUSES,
    expectAttemptCount: reminder.sendAttemptCount,
    nextAttemptCount: attemptNumber,
    attemptKey,
    contentHash: currentHash,
    startedAt: now().toISOString(),
  });

  // The invoice was archived. Refused calmly and typed — an archived invoice
  // never contacts the customer again, whatever status its reminder is in.
  if (claim.archived) {
    if (reservedHere) await deps.allowance.release(reminder.id);
    return refuse(409, {
      success: false,
      state: "invoice_archived",
      message: "This invoice has been archived and can no longer send reminders.",
    });
  }

  if (claim.error) {
    // The UPDATE errored, so nobody holds `sending` and nothing will be
    // submitted. If this request took the unit, give it straight back — safe
    // precisely because no sibling can be mid-send.
    if (reservedHere) await deps.allowance.release(reminder.id);
    log("error", `[send-reminder] Could not claim reminder ${reminder.id}: ${claim.error}`);
    return {
      status: 500,
      body: { success: false, message: "Could not send this reminder. Please try again." },
      outcome: "db_error",
    };
  }

  if (!claim.claimed) {
    // A concurrent request won and is sending RIGHT NOW. Deliberately no
    // release: for the same reminder both requests share one unit, and this
    // one would be taking it out from under the request that is using it.
    return refuse(409, {
      success: false,
      state: "sending",
      message: "This reminder is already being sent.",
    });
  }

  let result: MailerResult;
  try {
    result = await deps.mailer.send(
      {
        from: deps.from,
        to: reminder.emailTo,
        replyTo: deps.userEmail ?? undefined,
        subject,
        html,
        text,
      },
      // At-most-once submission for THIS attempt. A repeat of the same attempt
      // recomputes the same key and Resend does not deliver twice.
      { idempotencyKey: attemptKey }
    );
  } catch (err) {
    // The call threw. We do not know whether it reached the provider — this is
    // the textbook ambiguous case and must never be reported as a failure.
    const message = err instanceof Error ? err.message : "Unknown error";
    log(
      "error",
      `[send-reminder] Submission for reminder ${reminder.id} threw before an outcome was known: ${message}`
    );
    await deps.db.recordSubmissionOutcome({
      id: reminder.id,
      status: "delivery_unknown",
      error: message,
    });
    return {
      status: 409,
      body: {
        success: false,
        state: "delivery_unknown",
        message:
          "We couldn't confirm the delivery result. Don't resend yet — your customer may already have received this.",
      },
      outcome: "delivery_unknown",
      attemptKey,
    };
  }

  if (!result.ok) {
    // Known rejection vs ambiguous result. Guessing "failed" on an ambiguous
    // error is exactly how a customer gets emailed twice.
    const outcome = classifyProviderError(result.code);
    const nextStatus = statusForOutcome(outcome);

    log(
      "error",
      `[send-reminder] Resend did not confirm reminder ${reminder.id}: ` +
        `${result.code ?? "unknown_error"} - ${result.message} → ${nextStatus}`
    );

    await deps.db.recordSubmissionOutcome({
      id: reminder.id,
      status: nextStatus,
      error: result.message,
    });

    const ambiguous = nextStatus === "delivery_unknown";

    // DEFINITE pre-acceptance rejection: the provider certainly never took the
    // message, so neither the SMS nor the email reached anyone. The unit goes
    // back — a customer must not permanently lose a credit to a fault that
    // reached nobody.
    //
    // Only on this branch. An ambiguous outcome keeps the unit, because a
    // submission may well have happened, and refunding ambiguity would turn a
    // repeatedly-flaky provider into an unlimited free tier.
    //
    // Safe to release even when the unit came from an earlier attempt
    // (`already_held`): this request owns the `sending` claim, so no sibling
    // can be submitting for this reminder.
    if (!ambiguous) await deps.allowance.release(reminder.id);
    return {
      status: ambiguous ? 409 : 500,
      body: {
        success: false,
        state: nextStatus,
        message: ambiguous
          ? "We couldn't confirm the delivery result. Don't resend yet — your customer may already have received this."
          : `Failed to send email: ${result.message}`,
      },
      outcome: ambiguous ? "delivery_unknown" : "rejected",
      attemptKey,
    };
  }

  // ── Provider CONFIRMED acceptance ────────────────────────────────────────
  const persisted = await deps.db.recordAccepted({
    id: reminder.id,
    providerMessageId: result.id,
    sentAt: now().toISOString(),
  });

  if (!persisted.ok) {
    // Accepted by Resend, but our record failed. NOT a failure to report as
    // one, and never an automatic retry — the customer very likely has the
    // email. Marked uncertain so reconciliation can settle it from the
    // provider id, which is logged here because it may not have reached a row.
    log(
      "error",
      `[send-reminder] Resend ACCEPTED reminder ${reminder.id} (provider id ${result.id ?? "unknown"}) ` +
        `but persistence failed: ${persisted.error ?? "unknown"}. Do not resend without reconciliation.`
    );
    await deps.db.recordSubmissionOutcome({
      id: reminder.id,
      status: "delivery_unknown",
      error: persisted.error ?? "Persistence failed after provider acceptance",
    });

    return {
      status: 409,
      body: {
        success: false,
        state: "delivery_unknown",
        message:
          "We couldn't confirm the delivery result. Don't resend yet — your customer may already have received this.",
      },
      outcome: "delivery_unknown",
      attemptKey,
    };
  }

  await deps.db.appendScheduleSent(reminder.invoiceId, reminder.schedule);

  return {
    status: 200,
    body: { success: true, state: "sent", message: "Reminder sent." },
    outcome: "sent",
    attemptKey,
  };
}
