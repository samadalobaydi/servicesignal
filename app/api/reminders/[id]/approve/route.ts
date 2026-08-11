import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getResendClient, REMINDER_FROM } from "@/lib/resend";
import {
  approveAndSendReminder,
  type ApprovalDb,
  type ApprovalReminder,
  type Mailer,
} from "@/lib/reminder-approval";
import type { ReminderSchedule } from "@/types";
import type { ReminderSendStatus } from "@/lib/reminder-send-state";
import { storedContentFromRows, CHANNEL_SELECT, type ChannelRow } from "@/lib/reminder-channel-store";
import { FOUNDING_BETA_ALLOWANCE } from "@/lib/beta-allowance";
import type { AllowanceStore, AllowanceResult } from "@/lib/allowance-claim";
import { setRemindersSentForOwner } from "@/lib/invoice-owner-writes";

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

function makeDb(supabase: SupabaseClient, userId: string): ApprovalDb {
  return {
    async loadReminder(id) {
      const { data, error } = await supabase
        .from("reminder_logs")
        .select(
          "id, invoice_id, schedule, status, email_to, send_attempt_count, " +
            // Both channels, so the send path uses the stored version the owner
            // actually reviewed rather than recomposing over the top of it.
            `reminder_channel_messages(${CHANNEL_SELECT}), ` +
            "invoices!inner(customer_name, customer_email, customer_phone, amount, due_date, payment_link, " +
            "reminder_tone, status, reminder_schedules, reminders_sent, " +
            "invoice_reference, job_description)"
        )
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();

      if (error || !data) return null;

      const row = data as unknown as ReminderRow;
      const reminder: ApprovalReminder = {
        id: row.id,
        invoiceId: row.invoice_id,
        schedule: row.schedule,
        status: row.status as ReminderSendStatus,
        emailTo: row.email_to,
        sendAttemptCount: row.send_attempt_count ?? 0,
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
    },

    async loadBusinessName(uid) {
      const { data } = await supabase
        .from("profiles")
        .select("business_name")
        .eq("user_id", uid)
        .maybeSingle();
      return data?.business_name ?? null;
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

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  // Untrusted. Verified against a server-minted HMAC inside the service.
  let reviewToken: string | null = null;
  try {
    const body = await request.json();
    reviewToken = typeof body?.review_token === "string" ? body.review_token : null;
  } catch {
    reviewToken = null;
  }

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
            return {
              ok: false,
              code: (error as { name?: string }).name ?? null,
              message: error.message,
            };
          }
          return { ok: true, id: data?.id ?? null };
        },
      }
    : null;

  const result = await approveAndSendReminder(
    {
      db: makeDb(supabase, user.id),
      allowance: makeAllowanceStore(user.id),
      mailer,
      from: REMINDER_FROM,
      userId: user.id,
      userEmail: user.email ?? null,
      log: (level, message) => {
        if (level === "warn") console.warn(message);
        else console.error(message);
      },
    },
    { reminderId: params.id, reviewToken }
  );

  return NextResponse.json(result.body, { status: result.status });
}
