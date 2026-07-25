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
}

/** Shape sent to Supabase on INSERT — user_id omitted (DB sets via DEFAULT auth.uid()) */
export interface InvoiceInsert {
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  amount: number;
  due_date: string;
  payment_link: string;
  reminder_tone: ReminderTone;
  reminder_schedules: ReminderSchedule[];
  status: "unpaid";
  reminders_sent: ReminderSchedule[];
}

export interface InvoiceFormData {
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

export type ReminderLogStatus = "pending" | "sent" | "dismissed" | "failed";

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
  created_at: string;
}

export interface ProfileUpdate {
  business_name?: string;
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

export interface ApiResponse {
  success: boolean;
  message: string;
  error?: string;
}
