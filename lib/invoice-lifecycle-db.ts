import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type LifecycleDb,
  type LifecycleInvoice,
} from "./invoice-lifecycle-service";
import { CHANNEL_SELECT, type ChannelRow } from "./reminder-channel-store";
import { generateReminderContent } from "./reminder-content";
import { resolveBusinessName } from "./reminder-approval";
import type { Invoice } from "@/types";

/**
 * The persistence half of the invoice lifecycle, shared by every route that
 * mutates an invoice. One adapter, so edit / delete / archive cannot drift
 * into three different ideas of ownership scoping.
 */
export function makeLifecycleDb(supabase: SupabaseClient, admin: SupabaseClient | null): LifecycleDb {
  return {
    async loadInvoice(id, userId): Promise<LifecycleInvoice | null> {
      const { data } = await supabase
        .from("invoices")
        .select(
          "id, user_id, customer_name, customer_email, customer_phone, invoice_reference, " +
            "job_description, amount, due_date, payment_link, archived_at"
        )
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();

      if (!data) return null;
      const row = data as unknown as Record<string, unknown>;
      return {
        id: row.id as string,
        userId: row.user_id as string,
        customer_name: (row.customer_name as string) ?? "",
        customer_email: (row.customer_email as string) ?? "",
        customer_phone: (row.customer_phone as string) ?? "",
        invoice_reference: (row.invoice_reference as string | null) ?? null,
        job_description: (row.job_description as string | null) ?? null,
        amount: Number(row.amount ?? 0),
        due_date: (row.due_date as string) ?? "",
        payment_link: (row.payment_link as string) ?? "",
        archived_at: null,
        archivedAt: (row.archived_at as string | null) ?? null,
      } as LifecycleInvoice;
    },

    async loadReminders(invoiceId, userId) {
      const { data } = await supabase
        .from("reminder_logs")
        .select(`id, status, reminder_channel_messages(${CHANNEL_SELECT})`)
        .eq("invoice_id", invoiceId)
        .eq("user_id", userId);

      return (data ?? []).map((r) => {
        const row = r as unknown as { id: string; status: string; reminder_channel_messages?: ChannelRow[] };
        return {
          id: row.id,
          status: row.status,
          // An owner edit is a non-null edited_body on either channel.
          ownerEdited: (row.reminder_channel_messages ?? []).some((c) => c.edited_body != null),
        };
      });
    },

    /**
     * Composes both channels from the PROPOSED values. Writes NOTHING —
     * failure here means nothing to roll back, because nothing was committed.
     */
    async composeRefresh(invoiceId, userId, reminderId, patch) {
      const { data: rem } = await supabase
        .from("reminder_logs")
        .select("id, schedule, status")
        .eq("id", reminderId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!rem || (rem as { status: string }).status !== "pending") return null;

      const { data: inv } = await supabase
        .from("invoices")
        .select("reminder_tone")
        .eq("id", invoiceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!inv) return null;

      const { data: profile } = await supabase
        .from("profiles")
        .select("business_name")
        .eq("user_id", userId)
        .maybeSingle();

      // The SAME generator the prepare path uses, fed the proposed values.
      const content = generateReminderContent({
        tone: (inv as { reminder_tone: Invoice["reminder_tone"] }).reminder_tone,
        schedule: (rem as { schedule: string }).schedule as Invoice["reminder_schedules"][number],
        customerName: patch.customer_name,
        businessName: resolveBusinessName(profile?.business_name ?? null, null),
        amount: patch.amount,
        dueDate: patch.due_date,
        paymentLink: patch.payment_link || null,
        invoiceReference: patch.invoice_reference,
        jobDescription: patch.job_description,
      });

      return [
        { channel: "email" as const, subject: content.email.subject, body: content.email.body },
        { channel: "sms" as const, subject: null, body: content.sms.body },
      ];
    },

    /** One transaction — see update_invoice_with_refresh in migration 012. */
    async commitEdit({ invoiceId, userId, patch, reminderId, channels }) {
      const { data, error } = await (admin ?? supabase).rpc("update_invoice_with_refresh", {
        p_invoice_id: invoiceId,
        p_user_id: userId,
        p_patch: {
          customer_name: patch.customer_name,
          customer_email: patch.customer_email,
          customer_phone: patch.customer_phone,
          invoice_reference: patch.invoice_reference ?? "",
          job_description: patch.job_description ?? "",
          amount: patch.amount,
          due_date: patch.due_date,
          payment_link: patch.payment_link,
        },
        p_reminder_id: reminderId,
        p_channels: channels,
      });
      if (error) {
        console.error(`[invoice-edit] commit failed: ${error.message}`);
        return "error";
      }
      const outcome = typeof data === "string" ? data : String(data ?? "");
      return (["updated", "in_flight", "not_found", "reminder_changed"].includes(outcome)
        ? outcome
        : "error") as "updated" | "in_flight" | "not_found" | "reminder_changed" | "error";
    },

    async deleteInvoice(id, userId) {
      const { error } = await supabase.from("invoices").delete().eq("id", id).eq("user_id", userId);
      if (!error) return { ok: true };
      // 23514 is the check-violation the migration-012 guard raises.
      const refusedByDatabase = (error as { code?: string }).code === "23514";
      return { ok: false, refusedByDatabase };
    },

    /**
     * Archive means NO FUTURE CUSTOMER CONTACT — so an unsent draft must be
     * stood down, not merely hidden.
     *
     * Setting archived_at alone left any `pending` reminder claimable: the
     * approve route does not look at archived_at, so a bookmarked review URL
     * would still have sent it. Dismissing first closes that, and `dismissed`
     * is the honest status — the owner chose not to send it.
     *
     * It also releases the allowance reservation, via the pending → dismissed
     * trigger from migration 011. That is correct and is NOT a refund of
     * anything consumed: a pending reminder was never dispatched.
     *
     * Order matters. Dismissal first, archive second: if dismissal fails
     * nothing is archived, which leaves the invoice exactly as it was rather
     * than archived-with-a-live-draft.
     */
    /**
     * ONE TRANSACTION — see archive_invoice_safely in migration 012.
     *
     * This replaced a two-statement sequence (dismiss the drafts, then set
     * archived_at). Both gaps in that sequence were exploitable: a cron
     * insertion could land between them, and a send claim could take the draft
     * before the dismiss ran. Neither is expressible any more — the function
     * holds the invoice lock and the reminder locks for the whole decision.
     */
    async archiveInvoice(id, userId) {
      // No timestamp argument. The caller decides WHETHER to archive; the
      // database decides when it happened. A caller-supplied time can be
      // skewed or back-dated and nothing downstream would know.
      const { data, error } = await (admin ?? supabase).rpc("archive_invoice_safely", {
        p_invoice_id: id,
        p_user_id: userId,
      });
      if (error) {
        console.error(`[invoice-archive] failed for ${id}: ${error.message}`);
        return "error";
      }
      const outcome = typeof data === "string" ? data : String(data ?? "");
      return (["archived", "in_flight", "not_found"].includes(outcome)
        ? outcome
        : "error") as "archived" | "in_flight" | "not_found" | "error";
    },
  };
}

