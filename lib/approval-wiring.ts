import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getResendClient } from "@/lib/resend";
import { getTwilioConfig, sendTwilioSms } from "@/lib/twilio";
import { isAcceptedTwilioStatus } from "@/lib/twilio-send-state";
import type {
  ApprovalDb,
  ApprovalDeps,
  ApprovalReminder,
  Mailer,
  Texter,
} from "@/lib/reminder-approval";
import { FOUNDING_BETA_ALLOWANCE } from "@/lib/beta-allowance";
import type { AllowanceStore, AllowanceResult } from "@/lib/allowance-claim";
import { setRemindersSentForOwner } from "@/lib/invoice-owner-writes";
import {
  storedContentFromRows,
  CHANNEL_SELECT,
  isTableAbsent,
  type ChannelRow,
} from "@/lib/reminder-channel-store";
import {
  CHANNEL_CLAIMABLE_STATUSES,
  type ChannelDb,
  type ChannelRowState,
} from "@/lib/reminder-channel-state";
import type { ReminderChannel } from "@/lib/reminder-content";
import type { ReminderSendStatus } from "@/lib/reminder-send-state";
import type { ReminderSchedule } from "@/types";

/**
 * Supabase / Resend / Twilio wiring for the send paths.
 *
 * ── WHY THIS IS SHARED ────────────────────────────────────────────────────
 *
 * /approve sends both channels; /channels/[channel]/retry recovers one. If each
 * built its own adapters they could drift — different Twilio classification,
 * different ownership scoping, a different allowance store — and the recovery
 * path is exactly where a divergence would duplicate a customer message. One
 * factory means both routes are given the same rules by construction.
 */

/**
 * The Founding Beta cap.
 *
 * Every rule lives in the database function — see
 * supabase/sql/011_reminder_allowance.sql. This adapter deliberately does no
 * counting and makes no decision: an adapter that decided whether there was
 * room would reintroduce the read-then-write race the function exists to
 * close.
 *
 * ── WHY THE SERVICE-ROLE CLIENT, ON A ROUTE THAT OTHERWISE FORBIDS IT ─────
 *
 * The rest of this route uses the caller's own session precisely so RLS
 * enforces ownership. The allowance RPCs are the exception, because
 * `authenticated` has been REVOKED from them: both bypasses found in review
 * were only reachable because a browser session could call these functions at
 * all. Constraining what they do removed the exploits; removing the browser's
 * reach removes the class.
 *
 * This is not a loosening of ownership:
 *
 *   - `userId` comes from supabase.auth.getUser() — the session cookie,
 *     verified server-side. It is never read from the request body.
 *   - The reminder has ALREADY been loaded under the user's own session and
 *     RLS by makeDb().loadReminder before any claim happens, so another
 *     user's reminder does not exist by this point.
 *   - claim_reminder_allowance re-verifies that the reminder belongs to the
 *     user whose allowance is being spent, independently of all of the above.
 *
 * Three checks, none of which trust the client.
 */
function makeAllowanceStore(userId: string): AllowanceStore {
  const admin = getSupabaseAdmin();

  // No service-role key configured. Fails closed through the same
  // `allowance_unavailable` path as a missing migration — never as
  // `exhausted`, and never by sending.
  if (!admin) {
    return {
      async claim() {
        return { error: "Service-role client is not configured; allowance cannot be checked." };
      },
      async release() {},
    };
  }

  const supabase = admin;

  return {
    async claim(reminderLogId): Promise<AllowanceResult> {
      // NOTE: the cap is NOT passed. It used to be a p_allowance argument,
      // which meant any authenticated user could call this RPC directly with a
      // cap of their own choosing and pre-claim an unlimited number of slots.
      // The value now lives in the database (founding_beta_allowance()) and
      // comes back in the result.
      const { data, error } = await supabase.rpc("claim_reminder_allowance", {
        p_reminder_log_id: reminderLogId,
        p_user_id: userId,
      });

      // Includes the case where migration 011 has not been applied and the
      // function does not exist. Surfaced as unavailable, never as exhausted,
      // and the service fails closed on it.
      if (error) return { error: error.message };

      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.outcome) return { error: "Allowance claim returned no outcome" };

      return {
        outcome: row.outcome,
        used: Number(row.used ?? 0),
        allowance: Number(row.allowance ?? FOUNDING_BETA_ALLOWANCE),
      };
    },

    async release(reminderLogId) {
      const { error } = await supabase.rpc("release_reminder_allowance", {
        p_reminder_log_id: reminderLogId,
        p_user_id: userId,
      });
      // A failed release costs the owner one credit and sends nothing. Logged
      // rather than thrown: the caller is already returning a send failure,
      // and turning that into a 500 would hide the reason the send failed.
      if (error) console.error(`[allowance] release failed for ${reminderLogId}: ${error.message}`);
    },
  };
}

/**
 * POST /api/reminders/[id]/approve
 *
 * A THIN ADAPTER. Every decision — status gating, the paid-invoice kill switch,
 * eligibility revalidation, review-token verification, atomic claiming, the
 * known-vs-ambiguous split — lives in lib/reminder-approval.ts, where it is
 * exercised by executable tests. This file only wires Supabase and Resend into
 * those ports and turns the result into an HTTP response.
 *
 * Security: uses lib/supabase-server.ts — the AUTHENTICATED USER's session
 * (anon key + cookies), NOT the service role key. RLS policies on
 * reminder_logs mean a select for someone else's reminder returns null and an
 * update affects 0 rows, so cross-user approval is impossible at the database
 * level. user_id is matched explicitly as well, belt and braces.
 */

interface ReminderRow {
  id: string;
  invoice_id: string;
  schedule: ReminderSchedule;
  status: string;
  email_to: string;
  send_attempt_count: number | null;
  generated_sender_name: string | null;
  invoices: {
    customer_name: string;
    customer_email: string;
    customer_phone: string | null;
    amount: number;
    due_date: string;
    payment_link: string | null;
    reminder_tone: "friendly" | "firm" | "final";
    status: string;
    reminder_schedules: ReminderSchedule[] | null;
    reminders_sent: ReminderSchedule[] | null;
    invoice_reference: string | null;
    job_description: string | null;
  };
}

const INVOICE_SELECT =
  "invoices!inner(customer_name, customer_email, customer_phone, amount, due_date, payment_link, " +
  "reminder_tone, status, reminder_schedules, reminders_sent, " +
  "invoice_reference, job_description)";

/**
 * Shared by makeDb().loadReminder (Approve/Retry) and
 * lib/regenerate-wiring.ts's regenerate path, so the two can never read this
 * row into two different shapes. Exported rather than duplicated — a second
 * hand-written copy of this select+mapping is exactly the kind of drift that
 * has caused real bugs elsewhere in this codebase (see reminder-review.ts's
 * comment on reading the SAME stored content the send path reads).
 */
export async function loadApprovalReminder(
  supabase: SupabaseClient,
  userId: string,
  id: string
): Promise<ApprovalReminder | null> {
  let { data, error } = await supabase
    .from("reminder_logs")
    .select(
      "id, invoice_id, schedule, status, email_to, send_attempt_count, generated_sender_name, " +
        // Both channels, so the send path uses the stored version the owner
        // actually reviewed rather than recomposing over the top of it.
        `reminder_channel_messages(${CHANNEL_SELECT}), ` +
        INVOICE_SELECT
    )
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  // Migration 015 not yet applied here: generated_sender_name does not
  // exist. Degrade the same way the channel-content read already does for
  // migration 010 — never crash the send path over an unapplied migration.
  // The identity-coherence gate below treats a null generatedSenderName on
  // a non-legacy reminder as drifted, so this degrades SAFELY (Approve and
  // Retry refuse until the migration lands) rather than by skipping the
  // check.
  if (error && isTableAbsent(error.code)) {
    const fallback = await supabase
      .from("reminder_logs")
      .select(
        "id, invoice_id, schedule, status, email_to, send_attempt_count, " +
          `reminder_channel_messages(${CHANNEL_SELECT}), ` +
          INVOICE_SELECT
      )
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    data = fallback.data
      ? ({ ...(fallback.data as unknown as Record<string, unknown>), generated_sender_name: null } as unknown as typeof data)
      : (fallback.data as unknown as typeof data);
    error = fallback.error;
  }

  if (error || !data) return null;

  const row = data as unknown as ReminderRow;
  const reminder: ApprovalReminder = {
    id: row.id,
    invoiceId: row.invoice_id,
    schedule: row.schedule,
    status: row.status as ReminderSendStatus,
    emailTo: row.email_to,
    sendAttemptCount: row.send_attempt_count ?? 0,
    generatedSenderName: row.generated_sender_name ?? null,
    storedContent: storedContentFromRows(
      (data as unknown as { reminder_channel_messages?: ChannelRow[] }).reminder_channel_messages ?? []
    ),
    invoice: {
      customerName: row.invoices.customer_name,
      customerEmail: row.invoices.customer_email,
      customerPhone: row.invoices.customer_phone,
      amount: row.invoices.amount,
      dueDate: row.invoices.due_date,
      paymentLink: row.invoices.payment_link,
      reminderTone: row.invoices.reminder_tone,
      status: row.invoices.status,
      reminderSchedules: row.invoices.reminder_schedules,
      remindersSent: row.invoices.reminders_sent,
      invoiceReference: row.invoices.invoice_reference,
      jobDescription: row.invoices.job_description,
    },
  };
  return reminder;
}

/** Shared by makeDb().loadSenderIdentityInputs and the regenerate wiring. */
export async function loadSenderIdentityInputsFor(
  supabase: SupabaseClient,
  uid: string
) {
  const { data } = await supabase
    .from("profiles")
    .select("sender_identity, business_name, personal_name")
    .eq("user_id", uid)
    .maybeSingle();
  return {
    preference: data?.sender_identity ?? null,
    businessName: data?.business_name ?? null,
    personalName: data?.personal_name ?? null,
  };
}

function makeDb(supabase: SupabaseClient, userId: string): ApprovalDb {
  return {
    async loadReminder(id) {
      return loadApprovalReminder(supabase, userId, id);
    },

    async loadSenderIdentityInputs(uid) {
      return loadSenderIdentityInputsFor(supabase, uid);
    },

    async dismiss(id) {
      await supabase.from("reminder_logs").update({ status: "dismissed" }).eq("id", id);
    },

    /**
     * The concurrency primitive. One statement, three predicates:
     *   id            this reminder
     *   status ∈ …    still claimable
     *   attempt count unchanged since we read it
     * Postgres serialises the matching rows, so of two simultaneous approvals
     * exactly one gets a row back and only that one submits.
     */
    async claim(input) {
      const { data, error } = await supabase
        .from("reminder_logs")
        .update({
          status: "sending",
          send_started_at: input.startedAt,
          send_attempt_key: input.attemptKey,
          send_attempt_count: input.nextAttemptCount,
          reviewed_content_hash: input.contentHash,
          last_send_error: null,
        })
        .eq("id", input.id)
        .in("status", input.fromStatuses as string[])
        .eq("send_attempt_count", input.expectAttemptCount)
        .select("id");

      if (error) {
        // Migration 012's archived-send guard raises 23514 when the parent
        // invoice is archived. That is a lifecycle answer, not a database
        // fault, so it is translated here rather than surfacing a SQLSTATE, a
        // trigger name or a Postgres message to the customer.
        if ((error as { code?: string }).code === "23514") {
          return { claimed: false, archived: true };
        }
        return { claimed: false, error: error.message };
      }
      return { claimed: (data?.length ?? 0) > 0 };
    },

    async recordSubmissionOutcome({ id, status, error }) {
      const { error: updateError } = await supabase
        .from("reminder_logs")
        .update({ status, last_send_error: error })
        .eq("id", id);
      return updateError ? { ok: false, error: updateError.message } : { ok: true };
    },

    async recordAccepted({ id, providerMessageId, sentAt }) {
      const { error } = await supabase
        .from("reminder_logs")
        .update({
          status: "sent",
          sent_at: sentAt,
          provider_message_id: providerMessageId,
          last_send_error: null,
        })
        .eq("id", id);
      return error ? { ok: false, error: error.message } : { ok: true };
    },

    /**
     * Records the dispatched checkpoint on the invoice.
     *
     * Through the SERVICE-ROLE client, because migration 012 revokes UPDATE on
     * invoices from `authenticated`. service_role bypasses RLS, so ownership is
     * re-established explicitly: the read and the write are both scoped to
     * userId, which came from the session verified in POST — never from the
     * request. A mismatched pair matches zero rows and writes nothing.
     */
    async appendScheduleSent(invoiceId, schedule) {
      const admin = getSupabaseAdmin();
      if (!admin) {
        console.error("[approve] service-role client unavailable; reminders_sent not recorded");
        return;
      }

      const { data } = await admin
        .from("invoices")
        .select("reminders_sent")
        .eq("id", invoiceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!data) return;

      const current: ReminderSchedule[] = data.reminders_sent ?? [];
      if (current.includes(schedule)) return;

      await setRemindersSentForOwner(admin, invoiceId, userId, [...current, schedule]);
    },

  };
}


/**
 * Per-channel lifecycle on reminder_channel_messages (migration 010).
 *
 * ── THE CLAIM IS GENUINELY ATOMIC, AND HERE IS THE MECHANISM ─────────────
 *
 * One statement, four predicates: reminder_log_id, channel, status still
 * claimable, and send_attempt_count unchanged since we read it. Postgres locks
 * the matching row for the duration of the UPDATE and re-evaluates the
 * predicate against the committed tuple, so of two concurrent callers exactly
 * one gets a row back. The compare-and-set on the count closes the ABA window.
 *
 * This is the same primitive the parent claim above uses, and the unique
 * (reminder_log_id, channel) constraint guarantees exactly one row to contend
 * for. No database helper function is needed.
 *
 * Runs under the caller's own session, so RLS scopes every statement to their
 * own rows — a reminder belonging to someone else matches nothing.
 */
function makeChannelDb(supabase: SupabaseClient): ChannelDb {
  return {
    async loadChannelStates(reminderId) {
      const { data, error } = await supabase
        .from("reminder_channel_messages")
        .select("channel, status, send_attempt_count")
        .eq("reminder_log_id", reminderId);

      if (error || !data) {
        // A legacy reminder, or an unreadable table. Returning [] makes the
        // dispatcher treat both channels as fresh rather than crash a send.
        if (error) console.error("[channel-state] read failed:", error.message);
        return [];
      }

      return (data as { channel: string; status: string; send_attempt_count: number | null }[]).map(
        (r): ChannelRowState => ({
          channel: r.channel as ReminderChannel,
          status: r.status as ChannelRowState["status"],
          sendAttemptCount: r.send_attempt_count ?? 0,
        })
      );
    },

    async claimChannel(input) {
      const { data, error } = await supabase
        .from("reminder_channel_messages")
        .update({
          status: "sending",
          send_started_at: input.startedAt,
          send_attempt_key: input.attemptKey,
          send_attempt_count: input.nextAttemptCount,
          last_send_error: null,
        })
        .eq("reminder_log_id", input.reminderId)
        .eq("channel", input.channel)
        .in("status", CHANNEL_CLAIMABLE_STATUSES as unknown as string[])
        .eq("send_attempt_count", input.expectAttemptCount)
        .select("id");

      if (error) return { claimed: false, error: error.message };
      return { claimed: (data?.length ?? 0) > 0 };
    },

    async recordChannelAccepted({ reminderId, channel, providerMessageId, providerEvent, sentAt }) {
      const { error } = await supabase
        .from("reminder_channel_messages")
        .update({
          status: "sent",
          sent_at: sentAt,
          provider_message_id: providerMessageId,
          provider_last_event: providerEvent,
          last_send_error: null,
        })
        .eq("reminder_log_id", reminderId)
        .eq("channel", channel);

      return error ? { ok: false, error: error.message } : { ok: true };
    },

    async recordChannelOutcome({ reminderId, channel, status, error }) {
      const { error: updateError } = await supabase
        .from("reminder_channel_messages")
        .update({ status, last_send_error: error })
        .eq("reminder_log_id", reminderId)
        .eq("channel", channel);

      return updateError ? { ok: false, error: updateError.message } : { ok: true };
    },
  };
}


/**
 * Every port the approval service needs, wired to one authenticated session.
 *
 * `userId` comes from the caller's verified session, never the request body.
 * The Supabase client is the user's own, so RLS scopes every read and write.
 */
export function makeApprovalDeps(
  supabase: SupabaseClient,
  userId: string,
  userEmail: string | null
): ApprovalDeps {
  const twilio = getTwilioConfig();

  // classifyTwilioError already ran inside sendTwilioSms — `r.kind` IS the
  // classification. This adapter's own job is narrower now: confirm an
  // "accepted" 2xx+SID also carries a status we recognise as acceptance,
  // since sendTwilioSms deliberately does not check that itself.
  const texter: Texter | null = twilio
    ? {
        async send(message) {
          const r = await sendTwilioSms(twilio, { to: message.to, body: message.body });

          if (r.kind === "accepted") {
            if (isAcceptedTwilioStatus(r.status)) {
              return { ok: true, id: r.id, providerStatus: r.status };
            }
            // A 2xx carrying a status outside the accepted set is not a success
            // we can stand behind — ambiguous rather than assumed.
            return {
              ok: false,
              outcome: "unknown",
              message: `Twilio returned an unexpected status: ${r.status ?? "none"}`,
            };
          }

          return {
            ok: false,
            outcome: r.kind === "rejected" ? "rejected" : "unknown",
            message: r.code ? `${r.code}: ${r.message}` : r.message,
          };
        },
      }
    : null;

  const resend = getResendClient();
  const mailer: Mailer | null = resend
    ? {
        async send(message, options) {
          const { data, error } = await resend.emails.send(
            {
              from: message.from,
              to: message.to,
              replyTo: message.replyTo,
              subject: message.subject,
              html: message.html,
              text: message.text,
            },
            { idempotencyKey: options.idempotencyKey }
          );
          if (error) {
            return { ok: false, code: (error as { name?: string }).name ?? null, message: error.message };
          }
          return { ok: true, id: data?.id ?? null };
        },
      }
    : null;

  return {
    db: makeDb(supabase, userId),
    channelDb: makeChannelDb(supabase),
    allowance: makeAllowanceStore(userId),
    mailer,
    texter,
    userId,
    userEmail,
    log: (level, message) => {
      if (level === "warn") console.warn(message);
      else console.error(message);
    },
  };
}
