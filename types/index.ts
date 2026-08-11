// ── Invoice / Dashboard types ──────────────────────────────────────────────

export type InvoiceStatus = "unpaid" | "overdue" | "paid";
export type ReminderTone = "friendly" | "firm" | "final";

/**
 * Current escalation state of an invoice. Matches the DB CHECK constraint
 * invoices_escalation_status_check exactly.
 *   active       — normal, chasing as usual
 *   promised     — customer promised to pay
 *   disputed     — invoice disputed
 *   paused       — chasing paused by the user
 *   written_off  — given up / written off
 * (paid is tracked separately by invoices.status = 'paid')
 */
export type EscalationStatus =
  | "active"
  | "promised"
  | "disputed"
  | "paused"
  | "written_off";

/**
 * Action types recorded in invoice_actions. Matches the DB CHECK constraint
 * invoice_actions_action_type_check exactly.
 */
export type InvoiceActionType =
  | "call_logged"
  | "promised_to_pay"
  | "disputed"
  | "paused"
  | "final_notice"
  | "written_off"
  | "marked_paid";

export interface InvoiceAction {
  id: string;
  user_id: string;
  invoice_id: string;
  action_type: InvoiceActionType;
  note: string | null;
  created_at: string;
}

/**
 * Explicit reminder schedule keys — describe timing relative to due_date.
 *   before_due_3_days → 3 days BEFORE the invoice is due
 *   due_today         → on the due date itself
 *   overdue_3_days    → 3 days AFTER the due date
 *   overdue_7_days    → 7 days AFTER the due date
 *   overdue_14_days   → 14 days AFTER the due date
 */
export type ReminderSchedule =
  | "before_due_3_days"
  | "due_today"
  | "overdue_3_days"
  | "overdue_7_days"
  | "overdue_14_days";

export interface Invoice {
  id: string;
  user_id?: string;           // Set by DB DEFAULT auth.uid() — never passed from client
  /**
   * Migration 007. NULL on every invoice created before it.
   *
   * Required-but-nullable, not optional: after the migration the column always
   * exists, so `select *` always returns the key. Typing it `?` would let code
   * treat "column absent" and "no reference recorded" as the same thing.
   */
  invoice_reference: string | null;
  /** Migration 007. Optional context shown in reminders. NULL when unset. */
  job_description: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  amount: number;
  due_date: string;           // ISO date string YYYY-MM-DD
  payment_link: string;
  reminder_tone: ReminderTone;
  reminder_schedules: ReminderSchedule[];
  status: InvoiceStatus;      // DB stores "unpaid" | "paid" — client derives "overdue"
  created_at: string;         // ISO timestamp
  paid_at: string | null;
  reminders_sent: ReminderSchedule[];
  escalation_status: EscalationStatus; // current escalation state, DB default 'active'
  /**
   * Migration 012. NULL on every invoice that is still operational.
   *
   * Archiving removes an invoice from the workflow while preserving its
   * reminder history and the Founding Beta allowance it consumed. It is NOT a
   * payment state — an invoice may be archived paid or archived unpaid.
   */
  archived_at?: string | null;
}

/**
 * Shape sent to Supabase on INSERT — the ten fields a customer legitimately
 * supplies when creating an invoice, and nothing else.
 *
 * ── THIS TYPE IS THE AUTHORITY BOUNDARY ──────────────────────────────────
 *
 * It is deliberately NOT `Partial<Invoice>`. Every field absent from it is a
 * column the database or a trusted server path owns, and after migration 013
 * `authenticated` holds no INSERT privilege on any of them — so adding one
 * here does not merely widen a type, it produces a runtime
 * "permission denied for column" on Add Invoice.
 *
 * Owned by the database, VERIFIED on main — PRODUCTION:
 *   id                gen_random_uuid()
 *   user_id           auth.uid()        — with the insert_own_invoices policy
 *   created_at        now()
 *   status            'unpaid'
 *   reminders_sent    empty text[]
 *   escalation_status 'active'
 *
 * Owned by later lifecycle transitions, never set at creation:
 *   paid_at           nullable; set by the Mark Paid server route
 *   archived_at       nullable; set by archive_invoice_safely (migration 012)
 *
 * reminder_tone and reminder_schedules DO have defaults ('firm', empty text[])
 * but stay in the payload: they are user-chosen configuration that the Add
 * Invoice form always supplies, not lifecycle state.
 */
export interface InvoiceInsert {
  /**
   * OPTIONAL on insert, and that is the point.
   *
   * The column is nullable, so an insert that omits it is valid — which means
   * the dashboard's existing creation path compiles and behaves exactly as it
   * did before migration 007, with no field added to it. Onboarding requires a
   * non-blank reference in VALIDATION (see lib/invoice-form.ts), which is where
   * that rule belongs: it is a rule about one surface, not about the table.
   */
  invoice_reference?: string | null;
  job_description?: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  amount: number;
  due_date: string;
  payment_link: string;
  reminder_tone: ReminderTone;
  reminder_schedules: ReminderSchedule[];
}

export interface InvoiceFormData {
  /** Always a string in the form — "" means "not entered". */
  invoice_reference: string;
  job_description: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  amount: string;             // string in form, parsed to number on save
  due_date: string;
  payment_link: string;
  reminder_tone: ReminderTone;
  reminder_schedules: ReminderSchedule[];
}

// ── Reminder logs ───────────────────────────────────────────────────────────

/**
 * Migration 009 adds `sending`, `delivery_unknown` and `undelivered`.
 *
 *   sending           one request owns the active attempt (transient)
 *   delivery_unknown  we never learned whether the provider accepted it —
 *                     NOT safe to retry automatically
 *   undelivered       the provider DID accept it and final delivery failed
 *                     (bounced, complained, suppressed, provider-terminal).
 *                     A submission definitely happened, so this is not a
 *                     retryable transport rejection; a new reminder is a
 *                     deliberate new owner decision.
 *
 * `failed` now means a DEFINITE PRE-ACCEPTANCE rejection — the provider never
 * took the message — and is the only failure state that is freely retryable.
 */
export type ReminderLogStatus =
  | "pending"
  | "sending"
  | "sent"
  | "dismissed"
  | "failed"
  | "delivery_unknown"
  | "undelivered";

export interface ReminderLog {
  id: string;
  invoice_id: string;
  user_id: string;
  schedule: ReminderSchedule;
  status: ReminderLogStatus;
  email_to: string;
  subject: string | null;
  created_at: string;
  sent_at: string | null;
  error_message: string | null;
  /** Migration 009. NULL on every reminder created before it. */
  send_started_at: string | null;
  /** Migration 009. The Idempotency-Key used by the current logical attempt. */
  send_attempt_key: string | null;
  /**
   * Migration 009. Logical attempts allocated so far. Incremented ONLY by the
   * atomic claim, so it doubles as the compare-and-set guard and as the attempt
   * identity the idempotency key is derived from.
   */
  send_attempt_count: number;
  /** Migration 009. Resend email id, after confirmed acceptance. */
  provider_message_id: string | null;
  /** Migration 009. Last delivery event reported by the provider. */
  provider_last_event: string | null;
  last_send_error: string | null;
  /** Migration 009. Fingerprint of the content the owner approved. */
  reviewed_content_hash: string | null;
  /** Migration 009. When reconciliation last asked the provider about this row. */
  last_reconciled_at: string | null;
  // Joined fields (populated when fetched with invoice details for the UI)
  invoice?: {
    customer_name: string;
    amount: number;
    due_date: string;
    status?: InvoiceStatus;
  };
}

// ── Profile / settings ──────────────────────────────────────────────────────

export type ReminderMode = "approval" | "auto";

export interface Profile {
  user_id: string;
  business_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  default_tone: ReminderTone;
  reminder_mode: ReminderMode;
  terms_accepted_at: string | null;
  terms_version: string | null;
  privacy_version: string | null;
  /**
   * Migration 008. The account-level default payment link.
   *
   * NULL means none saved. Separate from invoices.payment_link so that an
   * invoice-specific override can never silently rewrite the account default.
   */
  default_payment_link: string | null;
  created_at: string;
}

export interface ProfileUpdate {
  business_name?: string;
  /** Migration 008. Explicit null clears the saved default. */
  default_payment_link?: string | null;
  contact_email?: string;
  contact_phone?: string;
  default_tone?: ReminderTone;
  reminder_mode?: ReminderMode;
}

// ── Landing page / Beta signup types ──────────────────────────────────────

export interface BetaSignupFormData {
  name: string;
  business_name: string;
  email: string;
  phone: string;
  business_type: string;
  unpaid_range: string;
  willingness_to_pay: string;
}

export interface BetaSignupErrors {
  name?: string;
  business_name?: string;
  email?: string;
}

/**
 * Outcome of a beta-signup attempt. Saving the row and sending the access
 * email are separate events, so the client can tell the visitor the truth
 * about each rather than inferring one from the other.
 */
export type SignupOutcome =
  | "saved_and_sent"   // row written AND access email accepted by Resend
  | "saved_no_email"   // row written, email failed or was suppressed
  | "already_listed"   // this address is already on the beta list
  | "invalid"          // validation failed
  | "rate_limited"     // too many attempts from this network
  | "not_saved";       // datastore unavailable — nothing was recorded

export interface ApiResponse {
  success: boolean;
  message: string;
  error?: string;
  /** Field-level validation errors, keyed by form field name. */
  fieldErrors?: Record<string, string>;
  /** Which of the five terminal states this request reached. */
  outcome?: SignupOutcome;
  /** True only when Resend accepted the access email for delivery. */
  emailSent?: boolean;
}
