import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { loadApprovalReminder, loadSenderIdentityInputsFor } from "@/lib/approval-wiring";
import type { RegenerateDb, RegenerateDeps } from "@/lib/reminder-regenerate";

/**
 * POST /api/reminders/[id]/regenerate
 *
 * A THIN ADAPTER, matching lib/approval-wiring.ts's own shape: every rule —
 * status gating, the drifted-identity check, refusing a no-op regeneration —
 * lives in lib/reminder-regenerate.ts, exercised by executable tests. This
 * file only wires Supabase into that port.
 *
 * ── WHY THE ADMIN (SERVICE-ROLE) CLIENT FOR THE WRITE ────────────────────
 *
 * regenerate_reminder_identity() (migration 016) is granted to service_role
 * only — the same reasoning migration 012's update_invoice_with_refresh
 * documents at length: an authenticated-role grant would let a browser
 * session call the RPC directly with an arbitrary p_user_id, and the
 * function has no auth.uid() check to stop it (auth.uid() is meaningless
 * under service_role, so such a check would be a false defence). Ownership
 * is established the same three ways the allowance store already documents
 * this pattern: userId comes from the verified session, never the request
 * body; the reminder is loaded and its ownership confirmed via RLS under the
 * caller's OWN session BEFORE this is ever called; and the RPC itself
 * matches (id, user_id) together, independently, a third time.
 *
 * The READ path (loadApprovalReminder, loadSenderIdentityInputsFor) still
 * uses the caller's own session, exactly as Approve/Retry do — RLS is what
 * makes another user's reminder simply not exist for those reads.
 */
function makeRegenerateDb(supabase: SupabaseClient, userId: string): RegenerateDb {
  return {
    async loadReminder(id) {
      return loadApprovalReminder(supabase, userId, id);
    },

    async loadSenderIdentityInputs(uid) {
      return loadSenderIdentityInputsFor(supabase, uid);
    },

    async regenerate(input) {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return { outcome: "error", error: "Service-role client is not configured." };
      }

      const { data, error } = await admin.rpc("regenerate_reminder_identity", {
        p_reminder_id: input.reminderId,
        p_user_id: input.userId,
        p_expected_send_attempt_count: input.expectedSendAttemptCount,
        p_email_subject: input.emailSubject,
        p_email_body: input.emailBody,
        p_sms_body: input.smsBody,
        p_generated_sender_name: input.generatedSenderName,
      });

      if (error) {
        // Includes the case where migration 016 has not been applied yet
        // (function does not exist) — surfaced as a generic error, never as
        // a false 'ok'. Fails closed: nothing was written.
        return { outcome: "error", error: error.message };
      }

      const outcome = typeof data === "string" ? data : null;
      if (
        outcome === "ok" ||
        outcome === "not_found" ||
        outcome === "not_editable" ||
        outcome === "stale_regeneration" ||
        outcome === "no_stored_content" ||
        outcome === "invalid_channel_pair" ||
        outcome === "missing_generated_sender_name"
      ) {
        return { outcome };
      }
      return { outcome: "error", error: `Unexpected RPC result: ${JSON.stringify(data)}` };
    },
  };
}

export function makeRegenerateDeps(
  supabase: SupabaseClient,
  userId: string
): RegenerateDeps {
  return {
    db: makeRegenerateDb(supabase, userId),
    userId,
    log: (level, message) => {
      if (level === "warn") console.warn(message);
      else console.error(message);
    },
  };
}
