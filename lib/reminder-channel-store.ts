import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReminderChannel, StoredReminderContent, ReminderFacts } from "./reminder-content";
import { generateReminderContent } from "./reminder-content";

/**
 * Persistence for reminder_channel_messages (migration 010).
 *
 * Kept apart from lib/reminder-content.ts on purpose: that module is pure and
 * testable without a database, and this one is the only place that knows the
 * table exists. Everything here degrades safely when the migration has not been
 * applied — a missing table produces a legacy reminder, never a crash on the
 * review page or, worse, on the send path.
 */

/** The row shape as selected. */
export interface ChannelRow {
  channel: ReminderChannel;
  generated_subject: string | null;
  generated_body: string;
  edited_subject: string | null;
  edited_body: string | null;
}

/** Postgres codes meaning "migration 010 has not been applied here". */
const TABLE_ABSENT = new Set(["42P01", "PGRST205", "PGRST200", "42703", "PGRST204"]);

export function isTableAbsent(code: string | null | undefined): boolean {
  return !!code && TABLE_ABSENT.has(code);
}

/**
 * Folds the child rows into the shape lib/reminder-content.ts consumes.
 *
 * An absent channel stays null rather than being invented, which is what lets
 * currentContent() tell a legacy reminder (compose live, offer no editing) from
 * a stored one.
 */
export function storedContentFromRows(rows: ChannelRow[] | null | undefined): StoredReminderContent {
  const list = rows ?? [];
  const email = list.find((r) => r.channel === "email");
  const sms = list.find((r) => r.channel === "sms");

  // `?? null` is load-bearing, not defensive noise. An absent key arrives as
  // undefined, and `undefined !== null` would make currentContent() report the
  // reminder as EDITED when the owner has never touched it — showing "Edited ·
  // Restore original" on a freshly generated message.
  return {
    email: email
      ? {
          generatedSubject: email.generated_subject ?? "",
          generatedBody: email.generated_body,
          editedSubject: email.edited_subject ?? null,
          editedBody: email.edited_body ?? null,
        }
      : null,
    sms: sms
      ? { generatedBody: sms.generated_body, editedBody: sms.edited_body ?? null }
      : null,
  };
}

export const CHANNEL_SELECT =
  "channel, generated_subject, generated_body, edited_subject, edited_body";

/** Reads both channels for one reminder. Never throws. */
export async function loadStoredContent(
  supabase: SupabaseClient,
  reminderLogId: string
): Promise<StoredReminderContent> {
  const { data, error } = await supabase
    .from("reminder_channel_messages")
    .select(CHANNEL_SELECT)
    .eq("reminder_log_id", reminderLogId);

  if (error) {
    if (!isTableAbsent(error.code)) {
      console.error("[channel-store] read failed:", error.message);
    }
    return { email: null, sms: null };
  }
  return storedContentFromRows(data as unknown as ChannelRow[]);
}

/**
 * Writes the generated originals for BOTH channels, once, when a reminder is
 * prepared.
 *
 * Idempotent by constraint, not by check-then-write: the unique index on
 * (reminder_log_id, channel) means a repeated preparation collides rather than
 * creating a second SMS. A 23505 here is the constraint doing its job, so it is
 * treated as success — the content already exists and must not be overwritten,
 * because overwriting would replace an original the owner may already have
 * reviewed or edited against.
 */
export async function persistGeneratedContent(
  admin: SupabaseClient,
  params: {
    reminderLogId: string;
    userId: string;
    facts: ReminderFacts;
    now?: Date;
  }
): Promise<{ ok: boolean; skipped?: "table_absent" }> {
  const generated = generateReminderContent(params.facts, params.now ?? new Date());

  const { error } = await admin.from("reminder_channel_messages").insert([
    {
      reminder_log_id: params.reminderLogId,
      user_id: params.userId,
      channel: "email",
      generated_subject: generated.email.subject,
      generated_body: generated.email.body,
    },
    {
      reminder_log_id: params.reminderLogId,
      user_id: params.userId,
      channel: "sms",
      generated_subject: null,
      generated_body: generated.sms.body,
    },
  ]);

  if (!error) return { ok: true };

  // Already prepared. The originals stand.
  if (error.code === "23505") return { ok: true };

  if (isTableAbsent(error.code)) {
    console.error(
      "[channel-store] reminder_channel_messages is unavailable — apply " +
        "supabase/sql/010_reminder_channel_messages.sql. The reminder was still " +
        "prepared and will fall back to live composition."
    );
    return { ok: false, skipped: "table_absent" };
  }

  console.error("[channel-store] could not persist generated content:", error.message);
  return { ok: false };
}

/** Saves an edit for ONE channel. RLS scopes it to the owner. */
export async function saveChannelEdit(
  supabase: SupabaseClient,
  params: {
    reminderLogId: string;
    channel: ReminderChannel;
    editedSubject: string | null;
    editedBody: string | null;
    at: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  const patch: Record<string, unknown> = {
    edited_body: params.editedBody,
    content_edited_at: params.editedBody === null && params.editedSubject === null ? null : params.at,
  };
  // Never write a subject onto an SMS row — the CHECK constraint forbids it and
  // the column is meaningless there.
  if (params.channel === "email") patch.edited_subject = params.editedSubject;

  const { data, error } = await supabase
    .from("reminder_channel_messages")
    .update(patch)
    .eq("reminder_log_id", params.reminderLogId)
    .eq("channel", params.channel)
    .select("channel");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "not_found" };
  return { ok: true };
}
