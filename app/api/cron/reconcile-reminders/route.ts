import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
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

  return NextResponse.json({
    success: true,
    summary,
    staleAfterSeconds: SEND_LEASE_SECONDS,
    maxRowsPerRun: MAX_ROWS_PER_RUN,
  });
}
