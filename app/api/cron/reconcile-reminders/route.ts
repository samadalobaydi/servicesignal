import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTwilioConfig, fetchTwilioMessage } from "@/lib/twilio";
import {
  reconcileSmsChannels,
  SMS_RECONCILE_STATUSES,
  type SmsReconcileDb,
  type SmsReconcileSummary,
} from "@/lib/sms-reconcile";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getResendClient } from "@/lib/resend";
import { isAuthorisedCronRequest } from "@/lib/cron-auth";
import {
  reconcileReminders,
  DEFAULT_MAX_ROWS_PER_RUN,
  type ProviderLookup,
  type ReconcileDb,
  type ReconcileRow,
} from "@/lib/reminder-reconcile";
import { SEND_LEASE_SECONDS, type ReminderSendStatus } from "@/lib/reminder-send-state";

/**
 * GET /api/cron/reconcile-reminders
 *
 * Registered in vercel.json. A THIN ADAPTER — all reconciliation rules live in
 * lib/reminder-reconcile.ts, where tests drive them without a database or a
 * network.
 *
 * AUTH. Vercel does not authenticate cron invocations on its own. It sends the
 * value of the CRON_SECRET environment variable as `Authorization: Bearer
 * <CRON_SECRET>` — but ONLY if that variable is set on the project, and the
 * endpoint is a normal public URL that anyone can request. Verification here is
 * therefore mandatory, and it fails CLOSED: with no CRON_SECRET configured this
 * route returns 401 and does nothing, rather than running unauthenticated.
 *
 * This matches /api/cron/send-reminders, which uses the same header and the
 * same variable.
 *
 * An ordinary signed-in user cannot invoke it: there is no session path in, and
 * a browser request carries no CRON_SECRET.
 */

export const dynamic = "force-dynamic";

/** Bounded so one run cannot become unbounded work inside a function timeout. */
const MAX_ROWS_PER_RUN = DEFAULT_MAX_ROWS_PER_RUN;

function mapRow(row: {
  id: string;
  status: string;
  send_started_at: string | null;
  provider_message_id: string | null;
  provider_last_event: string | null;
}): ReconcileRow {
  return {
    id: row.id,
    status: row.status as ReminderSendStatus,
    sendStartedAt: row.send_started_at,
    providerMessageId: row.provider_message_id,
    providerLastEvent: row.provider_last_event,
  };
}

const SELECT = "id, status, send_started_at, provider_message_id, provider_last_event";

/**
 * How many SMS channel rows one run may ask Twilio about.
 *
 * Deliberately modest: each is a separate HTTP call, and a cron that spends
 * minutes polling is one that gets killed halfway through.
 */
const SMS_RECONCILE_LIMIT = 25;

/**
 * Phase 4 — SMS DELIVERY.
 *
 * ── WHY THIS IS A SEPARATE PASS AND NOT AN EXTENSION OF PHASES 1-3 ───────
 *
 * Those phases read reminder_logs, whose status answers "did anything reach the
 * customer". SMS delivery is a per-CHANNEL question and lives on
 * reminder_channel_messages, so it needs its own query, its own provider and
 * its own classifier — Twilio's `sent` means "handed to the carrier, receipt
 * pending", the opposite of Resend's.
 *
 * THE PARENT IS NEVER TOUCHED HERE. reminder_logs.status stays exactly where it
 * is: a carrier rejection on one channel does not change whether the reminder
 * as a whole reached the customer, and migration 011's dispatched-final trigger
 * would refuse the write anyway. Only the child row moves.
 *
 * Nothing is ever written unless the outcome is CERTAIN — see
 * lib/sms-reconcile.ts. In flight, unrecognised, and lookup-failed all leave
 * the row alone for the next run.
 */
function makeSmsDb(admin: SupabaseClient): SmsReconcileDb {
  return {
    async listReconcilable(limit) {
      const { data, error } = await admin
        .from("reminder_channel_messages")
        .select(
          "id, status, provider_message_id, provider_last_event, send_attempt_count, last_reconciled_at"
        )
        .eq("channel", "sms")
        // A READ filter — which rows are worth a Twilio call. The WRITE is
        // guarded on the snapshot below, not on this set.
        .in("status", SMS_RECONCILE_STATUSES as string[])
        .not("provider_message_id", "is", null)
        // Oldest-reconciled first, so a backlog drains rather than one slice of
        // it being re-asked every run.
        .order("last_reconciled_at", { ascending: true, nullsFirst: true })
        .limit(limit);

      if (error) throw new Error(error.message);

      return (data ?? []).map((row) => ({
        id: row.id as string,
        status: row.status as string,
        providerMessageId: row.provider_message_id as string,
        providerLastEvent: (row.provider_last_event as string | null) ?? null,
        sendAttemptCount: (row.send_attempt_count as number | null) ?? 0,
        lastReconciledAt: (row.last_reconciled_at as string | null) ?? null,
      }));
    },

    async applyIfUnchanged({ snapshot, patch }) {
      // COMPARE-AND-SET against the exact row that was read. Every column of the
      // snapshot is in the predicate; a broad `.in("status", …)` set is NOT a
      // substitute, because it matches rows a concurrent run has already
      // rewritten within the same status.
      //
      // `.is` rather than `.eq` for the nullable columns: in PostgREST `eq.null`
      // compares with `= NULL`, which is never true, so a first-ever
      // reconciliation would silently match nothing.
      let query = admin
        .from("reminder_channel_messages")
        .update(patch)
        .eq("id", snapshot.id)
        .eq("status", snapshot.status)
        .eq("provider_message_id", snapshot.providerMessageId)
        .eq("send_attempt_count", snapshot.sendAttemptCount);

      query =
        snapshot.providerLastEvent === null
          ? query.is("provider_last_event", null)
          : query.eq("provider_last_event", snapshot.providerLastEvent);

      query =
        snapshot.lastReconciledAt === null
          ? query.is("last_reconciled_at", null)
          : query.eq("last_reconciled_at", snapshot.lastReconciledAt);

      // `.select("id")` is what makes the zero-row case VISIBLE. Without it
      // PostgREST returns no rows and no error, and a CAS that matched nothing
      // is indistinguishable from one that succeeded.
      const { data, error } = await query.select("id");

      if (error) return { kind: "error", message: error.message };
      return (data?.length ?? 0) > 0 ? { kind: "applied" } : { kind: "stale" };
    },
  };
}

async function reconcileSmsDelivery(
  admin: SupabaseClient,
  at: string
): Promise<SmsReconcileSummary> {
  const empty: SmsReconcileSummary = {
    checked: 0,
    delivered: 0,
    undelivered: 0,
    unresolved: 0,
    stale: 0,
    errors: 0,
  };

  const config = getTwilioConfig();
  if (!config) return empty;

  return reconcileSmsChannels(
    {
      db: makeSmsDb(admin),
      provider: { lookup: (sid) => fetchTwilioMessage(config, sid) },
      limit: SMS_RECONCILE_LIMIT,
      log: (level, message) =>
        level === "error" ? console.error(message) : console.warn(message),
    },
    at
  );
}

/** Non-terminal provider events — the only ones phase 3 re-asks about. */
const UNRESOLVED_EVENTS = ["queued", "scheduled", "delivery_delayed"];

function makeDb(admin: SupabaseClient): ReconcileDb {
  return {
    async listStaleSending(limit) {
      const cutoff = new Date(Date.now() - SEND_LEASE_SECONDS * 1000).toISOString();
      const { data, error } = await admin
        .from("reminder_logs")
        .select(SELECT)
        .eq("status", "sending")
        .or(`send_started_at.is.null,send_started_at.lt.${cutoff}`)
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map(mapRow);
    },

    async listUnknownWithProviderId(limit) {
      const { data, error } = await admin
        .from("reminder_logs")
        .select(SELECT)
        .eq("status", "delivery_unknown")
        .not("provider_message_id", "is", null)
        // Oldest-reconciled first, so a backlog drains instead of one slice of
        // it being re-asked every run.
        .order("last_reconciled_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map(mapRow);
    },

    async listUnresolvedUndelivered(limit) {
      const { data, error } = await admin
        .from("reminder_logs")
        .select(SELECT)
        .eq("status", "undelivered")
        .not("provider_message_id", "is", null)
        .in("provider_last_event", UNRESOLVED_EVENTS)
        .order("last_reconciled_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map(mapRow);
    },

    async markUnknown({ id, note, at }) {
      const { data, error } = await admin
        .from("reminder_logs")
        .update({ status: "delivery_unknown", last_send_error: note, last_reconciled_at: at })
        .eq("id", id)
        .eq("status", "sending") // still stale when we get there
        .select("id");
      if (error) throw new Error(error.message);
      return (data?.length ?? 0) > 0;
    },

    async applyProviderEvent({ id, fromStatus, nextStatus, event, sentAt, note, at }) {
      const patch: Record<string, unknown> = {
        status: nextStatus,
        provider_last_event: event,
        last_reconciled_at: at,
        last_send_error: note,
      };
      if (sentAt) patch.sent_at = sentAt;

      const { data, error } = await admin
        .from("reminder_logs")
        .update(patch)
        .eq("id", id)
        .eq("status", fromStatus) // nothing changed underneath us
        .select("id");
      if (error) throw new Error(error.message);
      return (data?.length ?? 0) > 0;
    },

    async touchReconciled({ id, event, at }) {
      const { data, error } = await admin
        .from("reminder_logs")
        .update({ provider_last_event: event, last_reconciled_at: at })
        .eq("id", id)
        .select("id");
      if (error) throw new Error(error.message);
      return (data?.length ?? 0) > 0;
    },
  };
}

export async function GET(request: NextRequest) {
  if (!isAuthorisedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ success: false, message: "Unauthorised." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { success: false, message: "Admin client unavailable." },
      { status: 500 }
    );
  }

  const resend = getResendClient();

  const provider: ProviderLookup | null = resend
    ? {
        async get(providerMessageId) {
          const { data, error } = await resend.emails.get(providerMessageId);
          if (error || !data) {
            return { ok: false, reason: error?.message ?? "no record returned" };
          }
          return {
            ok: true,
            lastEvent: (data as { last_event?: string }).last_event ?? null,
            createdAt: (data as { created_at?: string }).created_at ?? null,
          };
        },
      }
    : null;

  const summary = await reconcileReminders({
    db: makeDb(admin),
    provider,
    maxRowsPerRun: MAX_ROWS_PER_RUN,
  });

  // Ids and counts only — no recipient addresses, message bodies or payment
  // links, so operational logs never carry customer data.
  console.log(
    `[reconcile-reminders] scanned=${summary.scanned} stale=${summary.staleSendingFound} ` +
      `->unknown=${summary.movedToUnknown} sent=${summary.resolvedSent} ` +
      `undelivered=${summary.resolvedUndelivered} inFlight=${summary.stillInFlight} ` +
      `stillUnknown=${summary.stillUnknown} errors=${summary.errors.length}`
  );

  // Phase 4. Runs AFTER the parent phases and never touches reminder_logs, so
  // it cannot interfere with them — a failure here leaves the email
  // reconciliation results intact.
  const sms = await reconcileSmsDelivery(admin, new Date().toISOString());

  return NextResponse.json({
    success: true,
    summary,
    sms,
    staleAfterSeconds: SEND_LEASE_SECONDS,
    maxRowsPerRun: MAX_ROWS_PER_RUN,
  });
}
