import type {
  ApprovalDb,
  ApprovalDeps,
  ApprovalReminder,
  ClaimInput,
  Mailer,
  MailerMessage,
  MailerResult,
} from "@/lib/reminder-approval";
import { composeReminderContent, resolveBusinessName } from "@/lib/reminder-approval";
import { issueReviewToken } from "@/lib/review-token";
import type {
  ProviderLookup,
  ProviderLookupResult,
  ReconcileDb,
  ReconcileRow,
} from "@/lib/reminder-reconcile";
import { isStaleSendingLease, type ReminderSendStatus } from "@/lib/reminder-send-state";
import type { StoredReminderContent } from "@/lib/reminder-content";
import type { ReminderSchedule } from "@/types";
import type { AllowanceStore, AllowanceResult } from "@/lib/allowance-claim";
import { FOUNDING_BETA_ALLOWANCE } from "@/lib/beta-allowance";

/**
 * In-memory doubles for the two ports the send lifecycle depends on.
 *
 * These are not mocks that assert on calls made — they are working fakes with
 * real state, because the properties under test (atomic claiming, attempt
 * allocation, conditional reconciliation writes) only exist in the interaction
 * between reads and writes. A mock that returned canned values would prove
 * nothing about them.
 *
 * FakeApprovalDb.claim() reproduces the exact predicate the Supabase adapter
 * issues: id AND status ∈ fromStatuses AND send_attempt_count = expected. That
 * is the one line the whole double-send guarantee rests on.
 */

export const OWNER = "user-owner";
export const OTHER_USER = "user-other";
export const REMINDER_ID = "rem-1";
export const INVOICE_ID = "inv-1";

export interface StoredReminder {
  id: string;
  userId: string;
  invoiceId: string;
  schedule: ReminderSchedule;
  status: ReminderSendStatus;
  emailTo: string;
  sendAttemptCount: number;
  sendAttemptKey: string | null;
  sendStartedAt: string | null;
  providerMessageId: string | null;
  providerLastEvent: string | null;
  reviewedContentHash: string | null;
  lastSendError: string | null;
  sentAt: string | null;
  lastReconciledAt: string | null;
  /** null = legacy reminder with no stored channel rows. */
  storedContent: StoredReminderContent | null;
  invoice: ApprovalReminder["invoice"];
}

/** A due date far enough in the past that overdue_7_days is genuinely reached. */
export function eligibleDueDate(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

/** A due date far enough ahead that no checkpoint has been reached. */
export function ineligibleDueDate(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

export function makeStoredReminder(
  overrides: Partial<StoredReminder> = {}
): StoredReminder {
  return {
    id: REMINDER_ID,
    userId: OWNER,
    invoiceId: INVOICE_ID,
    schedule: "overdue_7_days",
    status: "pending",
    emailTo: "customer@example.com",
    sendAttemptCount: 0,
    sendAttemptKey: null,
    sendStartedAt: null,
    providerMessageId: null,
    providerLastEvent: null,
    reviewedContentHash: null,
    lastSendError: null,
    sentAt: null,
    lastReconciledAt: null,
    storedContent: null,
    ...overrides,
    invoice: {
      customerName: "Dave Wilson",
      customerEmail: "customer@example.com",
      customerPhone: "07700 900000",
      amount: 480.5,
      dueDate: eligibleDueDate(),
      paymentLink: null,
      reminderTone: "friendly",
      status: "unpaid",
      reminderSchedules: ["overdue_7_days"],
      remindersSent: [],
      invoiceReference: "INV-1042",
      jobDescription: "Boiler repair",
      ...(overrides.invoice ?? {}),
    },
  };
}

export class FakeApprovalDb implements ApprovalDb {
  rows: Map<string, StoredReminder> = new Map();
  /** Whose session this client is bound to — the RLS scope, in miniature. */
  scopeUserId: string = OWNER;
  businessName: string | null = "Wilson Plumbing";

  /** Fault injection. */
  claimError: string | null = null;
  recordAcceptedError: string | null = null;

  /** Observability for the tests. */
  claimAttempts: ClaimInput[] = [];
  claimsWon: number = 0;
  dismissed: string[] = [];
  scheduleAppends: Array<{ invoiceId: string; schedule: ReminderSchedule }> = [];

  /** Runs immediately before the claim's compare-and-set — used to interleave. */
  beforeClaim: ((input: ClaimInput) => void | Promise<void>) | null = null;

  constructor(rows: StoredReminder[] = [makeStoredReminder()]) {
    for (const row of rows) this.rows.set(row.id, row);
  }

  get(id: string = REMINDER_ID): StoredReminder {
    const row = this.rows.get(id);
    if (!row) throw new Error(`no such row ${id}`);
    return row;
  }

  async loadReminder(id: string): Promise<ApprovalReminder | null> {
    const row = this.rows.get(id);
    // The adapter's query is `.eq("id", id).eq("user_id", userId)` under RLS,
    // so a reminder belonging to someone else returns nothing at all.
    if (!row || row.userId !== this.scopeUserId) return null;
    return {
      id: row.id,
      invoiceId: row.invoiceId,
      schedule: row.schedule,
      status: row.status,
      emailTo: row.emailTo,
      sendAttemptCount: row.sendAttemptCount,
      storedContent: row.storedContent,
      invoice: row.invoice,
    };
  }

  async loadBusinessName(): Promise<string | null> {
    return this.businessName;
  }

  async dismiss(id: string): Promise<void> {
    this.dismissed.push(id);
    const row = this.rows.get(id);
    if (row) row.status = "dismissed";
  }

  async claim(input: ClaimInput): Promise<{ claimed: boolean; error?: string }> {
    this.claimAttempts.push(input);
    if (this.claimError) return { claimed: false, error: this.claimError };
    if (this.beforeClaim) await this.beforeClaim(input);

    const row = this.rows.get(input.id);
    if (!row) return { claimed: false };

    // The exact predicate the Supabase adapter issues.
    const statusMatches = input.fromStatuses.includes(row.status);
    const countMatches = row.sendAttemptCount === input.expectAttemptCount;
    if (!statusMatches || !countMatches) return { claimed: false };

    row.status = "sending";
    row.sendStartedAt = input.startedAt;
    row.sendAttemptKey = input.attemptKey;
    row.sendAttemptCount = input.nextAttemptCount;
    row.reviewedContentHash = input.contentHash;
    row.lastSendError = null;
    this.claimsWon++;
    return { claimed: true };
  }

  async recordSubmissionOutcome(input: {
    id: string;
    status: ReminderSendStatus;
    error: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const row = this.rows.get(input.id);
    if (!row) return { ok: false, error: "not found" };
    row.status = input.status;
    row.lastSendError = input.error;
    return { ok: true };
  }

  async recordAccepted(input: {
    id: string;
    providerMessageId: string | null;
    sentAt: string;
  }): Promise<{ ok: boolean; error?: string }> {
    if (this.recordAcceptedError) {
      return { ok: false, error: this.recordAcceptedError };
    }
    const row = this.rows.get(input.id);
    if (!row) return { ok: false, error: "not found" };
    row.status = "sent";
    row.providerMessageId = input.providerMessageId;
    row.sentAt = input.sentAt;
    row.lastSendError = null;
    return { ok: true };
  }

  async appendScheduleSent(invoiceId: string, schedule: ReminderSchedule): Promise<void> {
    this.scheduleAppends.push({ invoiceId, schedule });
  }
}

export class FakeMailer implements Mailer {
  calls: Array<{ message: MailerMessage; idempotencyKey: string }> = [];
  /** Replaced per test. Default: the provider accepts. */
  behaviour: (call: number) => MailerResult | Promise<MailerResult> = () => ({
    ok: true,
    id: "resend-msg-1",
  });
  /** When set, send() throws instead of returning. */
  throws: Error | null = null;

  async send(
    message: MailerMessage,
    options: { idempotencyKey: string }
  ): Promise<MailerResult> {
    this.calls.push({ message, idempotencyKey: options.idempotencyKey });
    if (this.throws) throw this.throws;
    return this.behaviour(this.calls.length);
  }

  get keys(): string[] {
    return this.calls.map((c) => c.idempotencyKey);
  }
}

/**
 * Mints the review authorisation the review page would have issued for the
 * CURRENT state of a fixture — using the service's own composer and its own
 * business-name fallback, so a test can never accidentally pass by
 * reimplementing the hash slightly differently.
 */
export async function freshToken(
  db: FakeApprovalDb,
  opts: { userId?: string; reminderId?: string; now?: Date; userEmail?: string | null } = {}
): Promise<string> {
  const reminderId = opts.reminderId ?? REMINDER_ID;
  const userEmail = opts.userEmail === undefined ? "owner@example.com" : opts.userEmail;
  // Compose from the reminder the caller ASKED for. This previously always
  // loaded REMINDER_ID while accepting an opts.reminderId it then ignored, so
  // no fixture with a different id could be tokenised at all.
  //
  // The fallback is deliberate and load-bearing: a token BOUND to a reminder
  // that does not exist ("wrong_reminder") is a real test case, and there is
  // nothing to compose from in that case, so the default fixture supplies the
  // content while the token still carries the bogus id.
  const reminder =
    (await db.loadReminder(reminderId)) ?? (await db.loadReminder(REMINDER_ID));
  if (!reminder) throw new Error(`fixture reminder ${reminderId} is not loadable`);

  const composed = composeReminderContent(
    reminder,
    resolveBusinessName(db.businessName, userEmail),
    userEmail
  );

  return issueReviewToken({
    userId: opts.userId ?? OWNER,
    reminderId,
    contentHash: composed.hash,
    now: opts.now,
  });
}


// ── Allowance store double ──────────────────────────────────────────────────

/**
 * An in-memory model of supabase/sql/011_reminder_allowance.sql.
 *
 * Faithfulness matters here more than anywhere else in this file, because the
 * concurrency tests are only worth anything if this behaves like the real
 * thing. It models the two constraints that carry the whole argument:
 *
 *   PRIMARY KEY (reminder_log_id)      one slot per logical reminder
 *   UNIQUE (user_id, slot_number)      one holder per allowance unit
 *
 * `settle` is the interleaving hook: an await point inside claim() between
 * choosing a free slot and inserting it. That is precisely the window in which
 * a naive count-then-send implementation loses the race, so a test can put two
 * requests inside it simultaneously.
 */
export class FakeAllowanceStore implements AllowanceStore {
  /** reminder_log_id → slot_number */
  slots = new Map<string, number>();
  allowance: number;
  /** Set to simulate the store being unreachable (e.g. migration not applied). */
  unavailable: string | null = null;
  /** Every claim outcome, in order — so a test can assert who won a race. */
  calls: string[] = [];
  /** Awaited between choosing a slot and taking it. */
  settle: () => Promise<void> = async () => {};

  constructor(allowance = FOUNDING_BETA_ALLOWANCE, used = 0) {
    this.allowance = allowance;
    for (let i = 1; i <= used; i++) this.slots.set(`seed-${i}`, i);
  }

  private used(): number {
    return this.slots.size;
  }

  async claim(reminderLogId: string): Promise<AllowanceResult> {
    if (this.unavailable) return { error: this.unavailable };

    if (this.slots.has(reminderLogId)) {
      this.calls.push("already_held");
      return { outcome: "already_held", used: this.used(), allowance: this.allowance };
    }

    // The lowest FREE slot, matching min(generate_series(...)) in the function
    // — releases leave gaps, and max+1 would march past the allowance while
    // units were still free.
    const taken = new Set(this.slots.values());
    let slot: number | null = null;
    for (let i = 1; i <= this.allowance; i++) {
      if (!taken.has(i)) { slot = i; break; }
    }

    if (slot === null) {
      this.calls.push("exhausted");
      return { outcome: "exhausted", used: this.used(), allowance: this.allowance };
    }

    // ── The race window ──────────────────────────────────────────────────
    await this.settle();

    // UNIQUE(user_id, slot_number): whoever inserted while we were suspended
    // wins, and we must not overwrite them.
    if (new Set(this.slots.values()).has(slot)) {
      if (this.slots.has(reminderLogId)) {
        this.calls.push("already_held");
        return { outcome: "already_held", used: this.used(), allowance: this.allowance };
      }
      // Recompute exactly as the function's retry loop does.
      return this.claim(reminderLogId);
    }

    this.slots.set(reminderLogId, slot);
    this.calls.push("claimed");
    return { outcome: "claimed", used: this.used(), allowance: this.allowance };
  }

  async release(reminderLogId: string): Promise<void> {
    this.slots.delete(reminderLogId);
    this.calls.push("released");
  }
}

export function makeDeps(
  db: FakeApprovalDb,
  mailer: Mailer | null,
  overrides: Partial<ApprovalDeps> = {}
): ApprovalDeps {
  return {
    db,
    mailer,
    allowance: new FakeAllowanceStore(),
    from: "ServiceSignal <reminders@servicesignal.app>",
    userId: OWNER,
    userEmail: "owner@example.com",
    log: () => {},
    ...overrides,
  };
}

// ── Reconciliation doubles ──────────────────────────────────────────────────

export class FakeReconcileDb implements ReconcileDb {
  rows: Map<string, StoredReminder> = new Map();
  writes: string[] = [];

  constructor(rows: StoredReminder[]) {
    for (const row of rows) this.rows.set(row.id, row);
  }

  private toRow(row: StoredReminder): ReconcileRow {
    return {
      id: row.id,
      status: row.status,
      sendStartedAt: row.sendStartedAt,
      providerMessageId: row.providerMessageId,
      providerLastEvent: row.providerLastEvent,
    };
  }

  async listStaleSending(limit: number): Promise<ReconcileRow[]> {
    return Array.from(this.rows.values())
      .filter((r) => r.status === "sending" && isStaleSendingLease(r.sendStartedAt))
      .slice(0, limit)
      .map((r) => this.toRow(r));
  }

  async listUnknownWithProviderId(limit: number): Promise<ReconcileRow[]> {
    return Array.from(this.rows.values())
      .filter((r) => r.status === "delivery_unknown" && r.providerMessageId)
      .slice(0, limit)
      .map((r) => this.toRow(r));
  }

  async listUnresolvedUndelivered(limit: number): Promise<ReconcileRow[]> {
    const unresolved = new Set(["queued", "scheduled", "delivery_delayed"]);
    return Array.from(this.rows.values())
      .filter(
        (r) =>
          r.status === "undelivered" &&
          r.providerMessageId &&
          r.providerLastEvent &&
          unresolved.has(r.providerLastEvent)
      )
      .slice(0, limit)
      .map((r) => this.toRow(r));
  }

  async markUnknown(input: { id: string; note: string; at: string }): Promise<boolean> {
    const row = this.rows.get(input.id);
    // Conditional on status — exactly as the adapter's `.eq("status","sending")`.
    if (!row || row.status !== "sending") return false;
    row.status = "delivery_unknown";
    row.lastSendError = input.note;
    row.lastReconciledAt = input.at;
    this.writes.push(`markUnknown:${input.id}`);
    return true;
  }

  async applyProviderEvent(input: {
    id: string;
    fromStatus: ReminderSendStatus;
    nextStatus: ReminderSendStatus;
    event: string;
    sentAt: string | null;
    note: string | null;
    at: string;
  }): Promise<boolean> {
    const row = this.rows.get(input.id);
    if (!row || row.status !== input.fromStatus) return false;
    row.status = input.nextStatus;
    row.providerLastEvent = input.event;
    row.lastReconciledAt = input.at;
    row.lastSendError = input.note;
    if (input.sentAt) row.sentAt = input.sentAt;
    this.writes.push(`apply:${input.id}:${input.nextStatus}`);
    return true;
  }

  async touchReconciled(input: {
    id: string;
    event: string | null;
    at: string;
  }): Promise<boolean> {
    const row = this.rows.get(input.id);
    if (!row) return false;
    row.providerLastEvent = input.event;
    row.lastReconciledAt = input.at;
    this.writes.push(`touch:${input.id}`);
    return true;
  }
}

export class FakeProviderLookup implements ProviderLookup {
  events: Map<string, ProviderLookupResult> = new Map();
  lookups: string[] = [];

  constructor(events: Record<string, ProviderLookupResult> = {}) {
    for (const [k, v] of Object.entries(events)) this.events.set(k, v);
  }

  async get(providerMessageId: string): Promise<ProviderLookupResult> {
    this.lookups.push(providerMessageId);
    return (
      this.events.get(providerMessageId) ?? { ok: false, reason: "no record" }
    );
  }
}
