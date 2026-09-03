import { buildReminderEmail } from "./email-templates";
import { prepareEligibility } from "./reminder-schedule";
import { formatDate } from "./invoices";
import { verifyReviewToken } from "./review-token";
import {
  resolveSenderIdentity,
  reminderFromHeader,
  senderIdentityMissingReason,
  missingSenderIdentityMessage,
  type SenderIdentityPreference,
  type SenderIdentityKind,
} from "./sender-identity";
import { REMINDER_FROM_ADDRESS } from "./resend";
import {
  currentContent,
  contentVersionHash,
  emailHtmlForBody,
  identityHasDrifted,
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
  type ProviderOutcome,
  type ReminderSendStatus,
} from "./reminder-send-state";
import {
  allowanceExhaustedRefusal,
  allowanceUnavailableRefusal,
  isAllowanceUnavailable,
  type AllowanceStore,
} from "./allowance-claim";
import {
  channelAttemptKey,
  isChannelClaimable,
  statusesByChannel,
  assessApproveReadiness,
  assessChannelStructure,
  type ChannelDb,
  type ChannelRowState,
} from "./reminder-channel-state";
import {
  aggregateChannelOutcomes,
  channelRetryable,
  CHANNEL_LABEL,
  partialSendSummary,
  type ChannelOutcome,
} from "./reminder-aggregate";
import { normaliseUkMobile, PHONE_PROBLEM_MESSAGE } from "./phone";
import { validateSmsBody, SMS_VALIDATION_MESSAGE } from "./reminder-sms";
import type { ReminderChannel } from "./reminder-content";
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
  /**
   * The sender identity that produced the CURRENTLY stored content, recorded
   * once at preparation (migration 015). NULL for a legacy reminder (no stored
   * content — never stale, see identityHasDrifted) or for one that predates the
   * column. Compared against the freshly-resolved identity at Approve/Retry so
   * a reminder generated under one identity can never dispatch under another.
   */
  generatedSenderName: string | null;
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

/** The account's current sender-identity configuration — read fresh at every gate, never cached across a request. */
export interface SenderIdentityInputs {
  preference: SenderIdentityPreference;
  businessName: string | null;
  personalName: string | null;
}

export interface ApprovalDb {
  loadReminder(id: string): Promise<ApprovalReminder | null>;
  loadSenderIdentityInputs(userId: string): Promise<SenderIdentityInputs>;
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

/**
 * The SMS transport port, deliberately shaped like Mailer.
 *
 * `outcome` is returned by the ADAPTER, not inferred here, because Twilio's
 * numeric codes and Resend's string codes share no namespace — see
 * lib/twilio-send-state.ts. Passing a Twilio failure through the email
 * classifier would match nothing, fall to `unknown`, and strand every SMS
 * failure in a non-claimable state.
 */
export type TexterResult =
  | { ok: true; id: string | null; providerStatus: string | null }
  | { ok: false; outcome: "rejected" | "unknown"; message: string };

export interface TexterMessage {
  /** Already normalised to E.164 by the service. Never a raw stored value. */
  to: string;
  body: string;
}

export interface Texter {
  send(message: TexterMessage, options: { attemptKey: string }): Promise<TexterResult>;
}

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
  /**
   * null when Twilio is not configured — handled the same way.
   *
   * REQUIRED, not optional. SMS and email are equal channels, so a deployment
   * missing Twilio must refuse the send rather than quietly deliver half the
   * product; an optional port is one somebody forgets to wire, which is the
   * argument the allowance store already makes above.
   */
  texter: Texter | null;
  /** Per-channel lifecycle on reminder_channel_messages. Required, same reason. */
  channelDb: ChannelDb;
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
    /** At least one channel reached the provider and at least one did not. */
    | "partially_sent"
    | "refused"
    | "rejected"
    | "delivery_unknown"
    | "not_configured"
    /** Required channel row(s) missing or duplicated — see assessChannelStructure(). */
    | "channel_state_not_ready"
    /** Channel rows structurally present but not BOTH currently claimable — see assessApproveReadiness(). */
    | "fresh_approve_not_ready"
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

/** Log-only. Never shown to a customer or the owner — see the response `message` for that. */
function describeChannelReadiness(readiness: { kind: string; status?: string }): string {
  return readiness.kind === "not_ready" ? `not_ready(${readiness.status})` : readiness.kind;
}

// ── Composition ─────────────────────────────────────────────────────────────

/**
 * Sender identity is resolved via lib/sender-identity.ts's resolveSenderIdentity()
 * — the SAME function the review page uses, so a reviewed message and the sent
 * message can never differ in the From line (the content hash below binds
 * senderName, so any divergence invalidates the review token instead of
 * silently sending something different from what was shown).
 *
 * NO CROSS-FALLBACK, NO EMAIL FALLBACK. Every caller that would use this to
 * actually CONTACT a customer (approveAndSendReminder, retryReminderChannel,
 * the prepare route) refuses outright when resolveSenderIdentity() returns
 * null, the same way a missing phone number refuses rather than silently
 * sending email-only. Display-only callers (the review page, the content
 * editor) use resolveSenderIdentityForDisplay() instead, which may show a
 * neutral placeholder — never the login email — because showing nothing is
 * worse than showing "ServiceSignal" while nothing has been sent yet. That
 * display fallback must never be used to gate an actual send.
 */
/**
 * Builds the message AND its fingerprint from live data.
 *
 * Exported so a test can compute exactly what the service will compute, rather
 * than a test-local reimplementation that could drift and quietly stop testing
 * the real rule.
 */
export function composeReminderContent(
  reminder: ApprovalReminder,
  senderName: string,
  senderKind: SenderIdentityKind | null,
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
    senderName,
    senderKind,
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
    senderName,
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
      senderName,
      replyTo,
    }),
  };
}

// ── Channel dispatch ────────────────────────────────────────────────────────

interface DispatchResult {
  outcomes: ChannelOutcome[];
  /** Channel states AFTER dispatch, for the aggregate and the response. */
  finalStates: ChannelRowState[];
  emailProviderId: string | null;
  smsProviderId: string | null;
  /** Joined provider messages, for the parent's last_send_error. Logs only. */
  errorSummary: string;
}

/**
 * Submits each channel independently and records its own outcome.
 *
 * ── THE RULE THAT MAKES PARTIAL RECOVERY SAFE ────────────────────────────
 *
 * A channel already in `sent` is SKIPPED, not resubmitted. That is what stops a
 * retry of a failed SMS from emailing the customer a second time: the email row
 * is `sent`, fails isChannelClaimable, and never reaches its provider. The
 * check is the row's own state, not a flag passed in, so it holds however the
 * retry was triggered.
 *
 * Each channel gets its OWN idempotency key (channelAttemptKey), so the two
 * cannot collide and a per-channel retry cannot recompute the key the other
 * channel already used.
 *
 * Channels are dispatched SEQUENTIALLY rather than in parallel. Two concurrent
 * provider calls would make an ambiguous outcome harder to attribute, and the
 * latency of one extra round trip is worth a result we can reason about.
 */
async function dispatchChannels(input: {
  deps: ApprovalDeps;
  reminderId: string;
  contentHash: string;
  attemptNumber: number;
  email: MailerMessage;
  sms: TexterMessage;
  /**
   * Restricts dispatch to ONE channel — the recovery path.
   *
   * When set, the other channel is not iterated at all: its provider is never
   * called and its row is never touched. That is what makes "a successful
   * channel is never resent" a structural property rather than a check.
   */
  only?: ReminderChannel;
  now: Date;
  log: (level: "warn" | "error", message: string) => void;
}): Promise<DispatchResult> {
  const { deps, reminderId, contentHash, attemptNumber, now, log } = input;

  const before = await deps.channelDb.loadChannelStates(reminderId);
  const stateOf = (channel: ReminderChannel): ChannelRowState =>
    before.find((r) => r.channel === channel) ?? {
      channel,
      // A legacy reminder with no channel row behaves as a fresh one. The
      // aggregate still folds correctly; only the stored per-channel history
      // is absent, which is what migration 010 backfilled for.
      status: "pending",
      sendAttemptCount: 0,
    };

  const outcomes: ChannelOutcome[] = [];
  const finalStates: ChannelRowState[] = [];
  const errors: string[] = [];
  let emailProviderId: string | null = null;
  let smsProviderId: string | null = null;

  const channels = input.only ? ([input.only] as const) : (["email", "sms"] as const);

  for (const channel of channels) {
    const state = stateOf(channel);

    // ALREADY DELIVERED TO THE PROVIDER. Not touched again, at any cost.
    if (!isChannelClaimable(state.status)) {
      outcomes.push({
        channel,
        outcome: state.status === "sent" ? "skipped_already_sent" : "unknown",
      });
      finalStates.push(state);
      continue;
    }

    const nextCount = state.sendAttemptCount + 1;
    const key = channelAttemptKey(reminderId, channel, contentHash, attemptNumber);

    const claim = await deps.channelDb.claimChannel({
      reminderId,
      channel,
      expectAttemptCount: state.sendAttemptCount,
      nextAttemptCount: nextCount,
      attemptKey: key,
      startedAt: now.toISOString(),
    });

    if (!claim.claimed) {
      // Another request owns this channel's attempt, or the row moved under us.
      // Treated as UNKNOWN, never as a failure: a sibling may be submitting it
      // right now, and reporting "failed" would invite a duplicate.
      log(
        "warn",
        `[send-reminder] Could not claim ${channel} for ${reminderId}: ${claim.error ?? "already claimed"}.`
      );
      outcomes.push({ channel, outcome: "unknown" });
      finalStates.push({ ...state, status: "delivery_unknown" });
      errors.push(`${channel}: not claimed`);
      continue;
    }

    let outcome: ProviderOutcome;
    let providerId: string | null = null;
    let providerEvent: string | null = null;
    let message = "";

    try {
      if (channel === "email") {
        const r = await deps.mailer!.send(input.email, { idempotencyKey: key });
        if (r.ok) {
          outcome = "accepted";
          providerId = r.id;
        } else {
          outcome = classifyProviderError(r.code);
          message = r.message;
        }
      } else {
        const r = await deps.texter!.send(input.sms, { attemptKey: key });
        if (r.ok) {
          outcome = "accepted";
          providerId = r.id;
          providerEvent = r.providerStatus;
        } else {
          // The ADAPTER classified this using Twilio's own semantics — the
          // email classifier is never applied to a Twilio code.
          outcome = r.outcome;
          message = r.message;
        }
      }
    } catch (err) {
      // Threw before an outcome was known. Textbook ambiguity.
      outcome = "unknown";
      message = err instanceof Error ? err.message : "Unknown transport error";
    }

    if (outcome === "accepted") {
      if (channel === "email") emailProviderId = providerId;
      else smsProviderId = providerId;

      const recorded = await deps.channelDb.recordChannelAccepted({
        reminderId,
        channel,
        providerMessageId: providerId,
        providerEvent,
        sentAt: now.toISOString(),
      });
      // A failed write AFTER acceptance is ambiguity, not success: the row does
      // not reflect a message the customer may already have.
      const status = recorded.ok ? "sent" : "delivery_unknown";
      if (!recorded.ok) errors.push(`${channel}: ${recorded.error ?? "persist failed"}`);
      outcomes.push({ channel, outcome: recorded.ok ? "accepted" : "unknown" });
      finalStates.push({ channel, status, sendAttemptCount: nextCount });
      continue;
    }

    // ── A NON-ACCEPTED OUTCOME STILL HAS TO BE RECORDED ────────────────────
    //
    // THE BUG THIS CLOSES. The result of this write was previously discarded,
    // so the aggregate treated the channel as durably `failed` while the row
    // could still be sitting at `sending`. With both providers rejecting and
    // both writes failing, the parent became `failed` and the allowance trigger
    // handed the unit back — for a reminder whose children were stuck mid-send
    // and therefore NOT claimable. The owner would see a retryable reminder
    // that no retry could ever move.
    //
    // The accepted branch above already made this distinction. This one now
    // makes the same one, in the same direction.
    const status = statusForOutcome(outcome);
    const recorded = await deps.channelDb.recordChannelOutcome({
      reminderId,
      channel,
      status,
      error: message,
    });

    if (!recorded.ok) {
      // TWO DIFFERENT FACTS, and only the first is known:
      //
      //   the PROVIDER outcome   known — it rejected, or it was ambiguous
      //   the DATABASE lifecycle NOT safely recorded
      //
      // The provider's verdict is kept in the log and the error summary, but it
      // must NOT be what the aggregate folds: claiming a durable `failed` we
      // did not manage to write is exactly the inconsistency being fixed.
      //
      // `unknown` is the safe reading, and it is safe in both directions:
      //   - the parent becomes delivery_unknown, which is NOT claimable, so no
      //     retry can be triggered and no message can be duplicated;
      //   - the allowance is NOT released, so a reminder in an unresolved state
      //     never looks like a refunded, retryable one.
      //
      // The child row is very likely still `sending`, which is also not
      // claimable — so the two agree that nothing may be attempted again until
      // a human or reconciliation resolves it.
      log(
        "error",
        `[send-reminder] ${channel} for reminder ${reminderId} was ${outcome} by the provider, ` +
          `but the channel state could NOT be recorded: ${recorded.error ?? "unknown"}. ` +
          `Treating as UNRESOLVED — the row may still be 'sending'. Do not retry without reconciliation.`
      );
      outcomes.push({ channel, outcome: "unknown" });
      finalStates.push({ channel, status: "delivery_unknown", sendAttemptCount: nextCount });
      errors.push(
        `${channel}: ${message} (provider ${outcome}; state NOT recorded: ${recorded.error ?? "unknown"})`
      );
      continue;
    }

    outcomes.push({ channel, outcome });
    finalStates.push({ channel, status, sendAttemptCount: nextCount });
    errors.push(`${channel}: ${message}`);
  }

  return {
    outcomes,
    finalStates,
    emailProviderId,
    smsProviderId,
    errorSummary: errors.join(" | "),
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

  if (!deps.texter) {
    // Equal channels. A deployment without Twilio must refuse rather than send
    // the email alone and call the reminder done — that would be the
    // "email-only reminder" mode the product contract does not have.
    log("error", "[send-reminder] Twilio is not configured — cannot send.");
    await deps.db.recordSubmissionOutcome({
      id: reminder.id,
      status: "failed",
      error: "Twilio not configured",
    });
    return {
      status: 503,
      body: { success: false, state: "failed", message: "SMS service is not configured." },
      outcome: "not_configured",
    };
  }

  // ── CHANNEL STATE — TWO SEPARATE QUESTIONS, BOTH BEFORE ANYTHING IS SPENT ──
  //
  // THE INCIDENT THIS CLOSES (gate 1). A reminder whose Prepare-time
  // channel-content insert had silently failed reached this far with ZERO
  // reminder_channel_messages rows. dispatchChannels()'s legacy-reminder
  // fallback then treated each missing row as a fake `pending` — claimable
  // enough to consume an allowance slot and attempt a real per-channel claim,
  // which could only ever fail ("already claimed" — misleading; nothing was
  // ever claimed) without EVER reaching Resend or Twilio.
  //
  // THE FOLLOW-UP AUDIT FINDING THIS CLOSES (gate 2). A single combined check
  // here previously reused Fresh-Approve claimability (assessApproveReadiness)
  // as a proxy for "was this reminder ever prepared" — so a reminder whose
  // channel rows are genuinely present, but where one has legitimately moved
  // on (e.g. `sent` via an earlier attempt, or `sending` from another
  // in-flight request) in a combination the parent-status checks above don't
  // already catch, was told "wasn't fully prepared" — false. Split into two
  // gates so each refusal says something true.
  //
  // BOTH ARE READS, NOT LOCKS. Neither is the concurrency safety mechanism —
  // that remains claimChannel()'s atomic UPDATE ... WHERE status IN (...) AND
  // send_attempt_count = $expected (lib/approval-wiring.ts), unchanged and
  // untouched here. If channel state changes between these reads and the real
  // claim moments later (a concurrent request, a double-click), the CAS is
  // what makes that safe — exactly as it always has.
  //
  // Both write NOTHING on refusal — no allowance claim, no parent claim, no
  // reminder_logs or reminder_channel_messages update. One load, reused by
  // both checks below.
  const channelRows = await deps.channelDb.loadChannelStates(reminder.id);

  // ── GATE 1: STRUCTURAL VALIDITY — exactly one email row + one SMS row ────
  const channelStructure = assessChannelStructure(channelRows);
  if (!channelStructure.valid) {
    log(
      "error",
      `[send-reminder] Reminder ${reminder.id} refused: channel structure invalid ` +
        `(email=${channelStructure.email}, sms=${channelStructure.sms}).`
    );
    return {
      // 409, not 503: this is a conflict with THIS reminder's own recorded
      // state — the same per-reminder state-conflict convention used for
      // `sending`/`sent`/`delivery_unknown`/`undelivered`/`not_eligible`
      // elsewhere in this function. It is not a system-wide outage (503,
      // reserved for the mailer/texter
      // configuration checks above, where the SAME cause blocks every
      // reminder and clears the moment the dependency is fixed) — other
      // reminders with intact channel rows are unaffected right now, and
      // fixing this one specifically requires a data change (re-preparing
      // it, or an administrative repair), not merely waiting.
      status: 409,
      body: {
        success: false,
        state: "channel_state_not_ready",
        message:
          "This reminder can't be sent right now — its message wasn't fully prepared. " +
          "Please contact support@servicesignal.app.",
      },
      outcome: "channel_state_not_ready",
    };
  }

  // ── GATE 2: FRESH-APPROVE ADMISSIBILITY — both rows currently claimable ──
  //
  // Reached only when gate 1 passed — the rows genuinely exist, once each.
  // This is the earlier, unchanged assessApproveReadiness() call, now scoped
  // to its true question rather than doubling as a structural check. Its
  // refusal deliberately does NOT claim the reminder "wasn't prepared" —
  // that would be false here — and deliberately does NOT name a specific
  // delivery outcome (never "sent", "sending", "delivery_unknown"): picking
  // the single correct one for an arbitrary channel combination is the
  // deferred parent/channel aggregation design, not decided or built here.
  const channelReadiness = assessApproveReadiness(channelRows);
  if (!channelReadiness.ready) {
    log(
      "error",
      `[send-reminder] Reminder ${reminder.id} refused: not admissible for a fresh Approve ` +
        `(email=${describeChannelReadiness(channelReadiness.email)}, sms=${describeChannelReadiness(channelReadiness.sms)}).`
    );
    return {
      status: 409,
      body: {
        success: false,
        state: "fresh_approve_not_ready",
        message: "This reminder can't be approved as a full send in its current state.",
      },
      outcome: "fresh_approve_not_ready",
    };
  }

  // ── MOBILE NUMBER, CHECKED BEFORE ANYTHING IS SPENT ──────────────────────
  //
  // Positioned with the other cheap refusals and BEFORE the allowance claim, so
  // a historical invoice with customer_phone = null costs nothing and stays
  // exactly as it was: still `pending`, still reviewable, sendable the moment a
  // number is added.
  //
  // Refusing outright — rather than sending the email alone — is the contract.
  // Both channels are the product; delivering one and reporting success would
  // be the silent half-send this whole pass exists to prevent.
  //
  // NO MIGRATION. customer_phone stays nullable; production rows that predate
  // the requirement are handled here, at the point of use.
  const phone = normaliseUkMobile(reminder.invoice.customerPhone);
  if (!phone.ok) {
    log(
      "warn",
      `[send-reminder] Reminder ${reminder.id} refused: mobile number ${phone.problem}.`
    );
    return refuse(409, {
      success: false,
      state: "missing_phone",
      reason: phone.problem,
      message: PHONE_PROBLEM_MESSAGE[phone.problem],
    });
  }

  // ── SENDER IDENTITY, CHECKED BEFORE ANYTHING IS SPENT ──────────────────
  //
  // Same reasoning and same position as the phone check above, and read
  // FRESH here — not anything carried over from when the reminder was
  // prepared or reviewed. No cross-fallback: a 'business' preference with a
  // blank business_name refuses outright, it does not fall back to
  // personal_name even if that happens to be set, and neither ever falls
  // back to the account's login email.
  const senderInputs = await deps.db.loadSenderIdentityInputs(deps.userId);
  const identity = resolveSenderIdentity(senderInputs);

  if (!identity) {
    const reason = senderIdentityMissingReason(senderInputs);
    log("warn", `[send-reminder] Reminder ${reminder.id} refused: sender identity unresolved (${reason}).`);
    return refuse(409, {
      success: false,
      state: "missing_sender_identity",
      reason,
      message: missingSenderIdentityMessage(reason, "sending reminders"),
    });
  }
  const senderName = identity.senderName;

  // ── IDENTITY COHERENCE: the stored content must still agree with the ──
  // ── identity just resolved above ────────────────────────────────────────
  //
  // The gate above proves an identity exists NOW. It says nothing about
  // whether the STORED subject/body — frozen at preparation, never rewritten
  // — was generated under THIS identity or a since-changed one. Composing
  // and sending anyway would combine a fresh From header with a stale body:
  // exactly the mismatch a customer would notice as the sign-off naming a
  // different sender than the one the email claims to be from.
  //
  // Checked BEFORE composeReminderContent, before the review token, before
  // the allowance claim, before the row claim — nothing downstream runs.
  if (identityHasDrifted(reminder.storedContent ?? { email: null, sms: null }, reminder.generatedSenderName, senderName)) {
    log(
      "warn",
      `[send-reminder] Reminder ${reminder.id} refused: sender identity changed since preparation ` +
        `(generated under "${reminder.generatedSenderName ?? "unknown"}", now "${senderName}").`
    );
    return refuse(409, {
      success: false,
      state: "identity_drift",
      message:
        "Your sender identity has changed since this reminder was prepared, so it can't be sent — " +
        "the message would show one name in the From address and sign off as another.",
    });
  }

  const { subject, html, text, smsBody, hash: currentHash } = composeReminderContent(
    reminder,
    senderName,
    identity.kind,
    deps.userEmail
  );

  // The same rule the editor and the content API apply, re-checked server-side
  // before dispatch. An over-long or empty body reaching Twilio would be a
  // provider rejection the owner could not diagnose.
  const smsProblem = validateSmsBody(smsBody);
  if (smsProblem) {
    log("error", `[send-reminder] Reminder ${reminder.id} SMS body invalid: ${smsProblem}.`);
    return refuse(409, {
      success: false,
      state: "invalid_sms",
      message: SMS_VALIDATION_MESSAGE[smsProblem],
    });
  }

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

  // ── TWO CHANNELS, ONE APPROVAL ───────────────────────────────────────────
  //
  // Dispatched through a channel-level dispatcher rather than "inside the same
  // transaction as email", because there is no transaction available: two
  // external providers and a database cannot commit atomically, which
  // reminder-send-state.ts already states as the honest limit of this model.
  //
  // Each channel claims its own row, submits independently, and records its own
  // outcome. The parent status is then FOLDED from both — see
  // lib/reminder-aggregate.ts for why neither "sent" nor "failed" is safe as a
  // blanket answer.
  const channelOutcomes = await dispatchChannels({
    deps,
    reminderId: reminder.id,
    contentHash: currentHash,
    attemptNumber,
    email: {
      // The visible From display name — never the fixed generic string.
      // senderName is validated non-null above (the missing_sender_identity
      // refusal), so the recipient sees exactly who this is from.
      from: reminderFromHeader(senderName, REMINDER_FROM_ADDRESS),
      to: reminder.emailTo,
      replyTo: deps.userEmail ?? undefined,
      subject,
      html,
      text,
    },
    sms: { to: phone.e164, body: smsBody },
    now: now(),
    log,
  });

  const aggregate = aggregateChannelOutcomes(channelOutcomes.outcomes);
  const channelStates = statusesByChannel(channelOutcomes.finalStates);
  const partialSummary = partialSendSummary(channelStates);

  // ── ALL CHANNELS DEFINITELY REJECTED ─────────────────────────────────────
  //
  // Nothing reached anyone, so the unit goes back and the reminder becomes
  // claimable again. This is the ONLY branch that releases: one acceptance
  // means the customer was contacted, and one ambiguity means they may have
  // been.
  if (aggregate.parentStatus === "failed") {
    await deps.db.recordSubmissionOutcome({
      id: reminder.id,
      status: "failed",
      error: channelOutcomes.errorSummary || "All channels were rejected",
    });
    await deps.allowance.release(reminder.id);
    return {
      status: 500,
      body: {
        success: false,
        state: "failed",
        channels: channelStates,
        message: "This reminder couldn't be sent. Nothing reached your customer — you can try again.",
      },
      outcome: "rejected",
      attemptKey,
    };
  }

  // ── ANY CHANNEL AMBIGUOUS ────────────────────────────────────────────────
  //
  // Conservative by design: delivery_unknown is not claimable, so nothing
  // retries and no second copy can be produced. The unit stays spent.
  if (aggregate.parentStatus === "delivery_unknown") {
    await deps.db.recordSubmissionOutcome({
      id: reminder.id,
      status: "delivery_unknown",
      error: channelOutcomes.errorSummary || "A channel result could not be confirmed",
    });
    return {
      status: 409,
      body: {
        success: false,
        state: "delivery_unknown",
        channels: channelStates,
        partiallySent: aggregate.partiallySent,
        message:
          "We couldn't confirm the delivery result. Don't resend yet — your customer may already have received this.",
      },
      outcome: "delivery_unknown",
      attemptKey,
    };
  }

  // ── AT LEAST ONE CHANNEL ACCEPTED ────────────────────────────────────────
  const persisted = await deps.db.recordAccepted({
    id: reminder.id,
    // The EMAIL provider id stays on the parent for backward compatibility
    // with reconciliation, which polls reminder_logs.provider_message_id.
    // Twilio's SID lives on the SMS channel row — see recordChannelAccepted.
    providerMessageId: channelOutcomes.emailProviderId,
    sentAt: now().toISOString(),
  });

  if (!persisted.ok) {
    // A provider ACCEPTED, but our record failed. Never reported as a failure
    // and never retried automatically — the customer very likely has it.
    // Marked uncertain so reconciliation can settle it from the provider ids,
    // which are logged here because they may not have reached a row.
    log(
      "error",
      `[send-reminder] A provider ACCEPTED reminder ${reminder.id} ` +
        `(email ${channelOutcomes.emailProviderId ?? "none"}, sms ${channelOutcomes.smsProviderId ?? "none"}) ` +
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
        channels: channelStates,
        message:
          "We couldn't confirm the delivery result. Don't resend yet — your customer may already have received this.",
      },
      outcome: "delivery_unknown",
      attemptKey,
    };
  }

  await deps.db.appendScheduleSent(reminder.invoiceId, reminder.schedule);

  // ── PARTIAL SUCCESS ──────────────────────────────────────────────────────
  //
  // The parent is `sent` — a unit is spent and the customer was contacted —
  // but one channel did not get through. Reported as success:false so no
  // surface can render this as a clean send, while `state` stays "sent" so the
  // durable lifecycle and the two database triggers see the truth they act on.
  //
  // The failed channel is named in plain words ("Email sent · SMS failed"),
  // never as a provider code, and only that channel is retryable — see
  // channelRetryable in lib/reminder-aggregate.ts.
  if (aggregate.partiallySent) {
    const retryable = (["email", "sms"] as const).find((c) =>
      channelRetryable(channelStates, c)
    ) ?? null;
    log(
      "warn",
      `[send-reminder] Reminder ${reminder.id} PARTIALLY sent: ${partialSummary ?? "mixed channels"}.`
    );
    return {
      status: 207,
      body: {
        success: false,
        // ── THE API STATE IS NOT THE DATABASE STATE ─────────────────────
        //
        // reminder_logs.status stays `sent` — the durable lifecycle both live
        // triggers act on. This field is the API's answer to "what happened",
        // and it must NOT be "sent": ReminderReviewPanel treats state "sent"
        // as unsafe-to-retry and disables the action permanently, which would
        // leave a partial send visible as an error with no way out.
        //
        // `partially_sent` exists only here and in application code. It is
        // never written to a column, so migration 010's CHECK constraint is
        // untouched.
        state: "partially_sent",
        partiallySent: true,
        channels: channelStates,
        // The channel that can be attempted again, so the client does not have
        // to re-derive it from the statuses.
        retryableChannel: retryable,
        summary: partialSummary,
        message: `${partialSummary}. Your customer received part of this reminder — you can retry the channel that didn't send.`,
      },
      outcome: "partially_sent",
      attemptKey,
    };
  }

  return {
    status: 200,
    body: { success: true, state: "sent", channels: channelStates, message: "Reminder sent." },
    outcome: "sent",
    attemptKey,
  };
}

// ── Single-channel recovery ─────────────────────────────────────────────────

export interface ChannelRetryRequest {
  reminderId: string;
  channel: ReminderChannel;
}

/**
 * Retries ONE channel of a partially-sent reminder.
 *
 * ── WHY THIS IS A SEPARATE ENTRY POINT ───────────────────────────────────
 *
 * After a partial send the parent is `sent`, which is deliberately NOT
 * claimable — that is what stops the ordinary approve path from resending the
 * channel that already worked. Making the parent claimable again to enable
 * recovery would reopen exactly the duplicate-send hole the status model
 * exists to close, and migration 011's dispatched-final trigger would refuse
 * the transition anyway.
 *
 * So recovery is its own operation over the CHILD row, and the parent is never
 * touched. Three guarantees hold it together:
 *
 *   1. channelRetryable() requires the target channel to have NOT reached the
 *      provider AND another channel to have reached it. Both-failed is the
 *      ordinary approve path (parent `failed`, claimable); an unresolved
 *      channel is never retryable because the message may already be
 *      delivered.
 *   2. The claim is the same atomic conditional UPDATE, on the child row.
 *   3. Only the named channel is dispatched. The successful channel's provider
 *      is never called — structurally, because it is never passed.
 *
 * NO ALLOWANCE IS CLAIMED. The unit was consumed when the first channel was
 * accepted, and the contract is one unit per logical reminder. Claiming again
 * would charge a customer twice for one reminder; releasing would refund a
 * reminder they received.
 *
 * NO REVIEW TOKEN. The content was already reviewed and approved — this resends
 * the SAME stored body to the SAME recipient. Requiring a fresh token would
 * mean re-approving a message the owner already approved, and the content hash
 * is unchanged by definition because nothing here composes anything new.
 */
export async function retryReminderChannel(
  deps: ApprovalDeps,
  request: ChannelRetryRequest
): Promise<ApprovalResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const { channel } = request;

  const reminder = await deps.db.loadReminder(request.reminderId);
  if (!reminder) return refuse(404, { success: false, message: "Reminder not found." });

  // Paid is the kill switch here too: a paid invoice never contacts the
  // customer again, whatever state its channels are in.
  if (reminder.invoice.status === "paid") {
    return refuse(409, {
      success: false,
      message: "This invoice has already been marked paid. Reminders are stopped.",
    });
  }

  const states = await deps.channelDb.loadChannelStates(reminder.id);
  const byChannel = statusesByChannel(states);

  if (!channelRetryable(byChannel, channel)) {
    // One answer for every ineligible shape, and it names the rule rather than
    // the row's internal status.
    return refuse(409, {
      success: false,
      state: "not_retryable",
      channels: byChannel,
      message:
        "This channel can't be retried on its own. Either nothing was sent, " +
        "or the result hasn't been confirmed yet.",
    });
  }

  const transport = channel === "email" ? deps.mailer : deps.texter;
  if (!transport) {
    return {
      status: 503,
      body: {
        success: false,
        state: "failed",
        message: channel === "email"
          ? "Email service is not configured."
          : "SMS service is not configured.",
      },
      outcome: "not_configured",
    };
  }

  // FRESH read — independent of whatever the original approval resolved.
  // Same no-cross-fallback rule as approveAndSendReminder.
  const senderInputs = await deps.db.loadSenderIdentityInputs(deps.userId);
  const identity = resolveSenderIdentity(senderInputs);

  if (!identity) {
    const reason = senderIdentityMissingReason(senderInputs);
    log("warn", `[retry-channel] Reminder ${reminder.id} refused: sender identity unresolved (${reason}).`);
    return refuse(409, {
      success: false,
      state: "missing_sender_identity",
      reason,
      message: missingSenderIdentityMessage(reason, "sending reminders"),
    });
  }
  const senderName = identity.senderName;

  // ── IDENTITY COHERENCE — same rule and same position as approveAndSendReminder ──
  //
  // A retry must not let an old stored channel body reach the provider under a
  // newly-selected identity just because ONE channel already sent under the
  // old one and the other is being recovered now. Checked before this channel's
  // content is composed, before the phone re-check, before dispatch.
  if (identityHasDrifted(reminder.storedContent ?? { email: null, sms: null }, reminder.generatedSenderName, senderName)) {
    log(
      "warn",
      `[retry-channel] Reminder ${reminder.id} refused: sender identity changed since preparation ` +
        `(generated under "${reminder.generatedSenderName ?? "unknown"}", now "${senderName}").`
    );
    return refuse(409, {
      success: false,
      state: "identity_drift",
      message:
        "Your sender identity has changed since this reminder was prepared, so it can't be sent — " +
        "the message would show one name in the From address and sign off as another.",
    });
  }

  const { subject, html, text, smsBody, hash } = composeReminderContent(
    reminder,
    senderName,
    identity.kind,
    deps.userEmail
  );

  // The SMS path re-checks the number, because a partial send may be being
  // retried days later against an invoice whose phone has since been edited.
  let smsTo = "";
  if (channel === "sms") {
    const phone = normaliseUkMobile(reminder.invoice.customerPhone);
    if (!phone.ok) {
      return refuse(409, {
        success: false,
        state: "missing_phone",
        reason: phone.problem,
        message: PHONE_PROBLEM_MESSAGE[phone.problem],
      });
    }
    const problem = validateSmsBody(smsBody);
    if (problem) {
      return refuse(409, {
        success: false,
        state: "invalid_sms",
        message: SMS_VALIDATION_MESSAGE[problem],
      });
    }
    smsTo = phone.e164;
  }

  // ONE channel is dispatched. The other is not named, not loaded into a
  // message, and its provider is never constructed — so "the successful channel
  // is not resent" is structural rather than a check that could be forgotten.
  const dispatched = await dispatchChannels({
    deps,
    reminderId: reminder.id,
    contentHash: hash,
    attemptNumber: (states.find((s) => s.channel === channel)?.sendAttemptCount ?? 0) + 1,
    only: channel,
    email: {
      // Same identity-aware header as the approve path — a retried channel
      // must never show a different sender than the one the owner reviewed.
      from: reminderFromHeader(senderName, REMINDER_FROM_ADDRESS),
      to: reminder.emailTo,
      replyTo: deps.userEmail ?? undefined,
      subject,
      html,
      text,
    },
    sms: { to: smsTo, body: smsBody },
    now: now(),
    log,
  });

  const outcome = dispatched.outcomes[0]?.outcome ?? "unknown";
  const after = statusesByChannel([
    ...states.filter((s) => s.channel !== channel),
    ...dispatched.finalStates,
  ]);
  const summary = partialSendSummary(after);

  if (outcome === "accepted") {
    log("warn", `[retry-channel] ${channel} recovered for reminder ${reminder.id}.`);
    return {
      status: 200,
      body: {
        success: true,
        state: "sent",
        channels: after,
        message: `${CHANNEL_LABEL[channel]} sent.`,
      },
      outcome: "sent",
    };
  }

  if (outcome === "unknown") {
    // The parent is ALREADY `sent` and stays there — the dispatched-final
    // trigger would refuse a move anyway. Only the child records the
    // ambiguity, and channelRetryable() will refuse a further attempt.
    return {
      status: 409,
      body: {
        success: false,
        state: "delivery_unknown",
        channels: after,
        message:
          "We couldn't confirm the result of that attempt. Don't try again yet — " +
          "your customer may already have received it.",
      },
      outcome: "delivery_unknown",
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      state: "partially_sent",
      partiallySent: true,
      channels: after,
      retryableChannel: channelRetryable(after, channel) ? channel : null,
      summary,
      message: `${CHANNEL_LABEL[channel]} didn't send. Nothing else was affected — you can try that channel again.`,
    },
    outcome: "partially_sent",
  };
}
