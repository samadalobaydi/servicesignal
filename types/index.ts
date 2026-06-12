// ── Invoice / Dashboard types ──────────────────────────────────────────────

export type InvoiceStatus = "unpaid" | "overdue" | "paid";
export type ReminderTone = "friendly" | "firm" | "final";
export type ReminderSchedule = "1_day" | "3_days" | "7_days";

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
