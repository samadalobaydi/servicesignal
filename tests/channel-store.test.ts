import { test } from "node:test";
import assert from "node:assert/strict";

import {
  storedContentFromRows,
  isTableAbsent,
  persistGeneratedContent,
  saveChannelEdit,
  loadStoredContent,
  type ChannelRow,
} from "@/lib/reminder-channel-store";
import { currentContent, type ReminderFacts } from "@/lib/reminder-content";

/**
 * The persistence layer, driven against a fake Supabase client.
 *
 * These are the paths that decide whether an edit survives a refresh, whether a
 * repeated preparation can duplicate a message, and whether an unapplied
 * migration takes the product down or degrades quietly. None of that is
 * observable from the pure content model alone.
 */

const FACTS: ReminderFacts = {
  tone: "firm",
  schedule: "overdue_7_days",
  customerName: "Dave Morrison",
  senderName: "Oakfield Plumbing",
  senderKind: "business",
  amount: 1240,
  dueDate: "2026-07-26",
  paymentLink: null,
  invoiceReference: "INV-1042",
  jobDescription: "bathroom leak repair",
};

/**
 * Minimal Supabase double.
 *
 * Chainable and thenable, because that is how supabase-js actually behaves:
 * `.update(...).eq(...).eq(...).select(...)` is one awaitable builder, and a
 * fake that resolved earlier than the real client would test a shape the code
 * never meets.
 */
function fakeSupabase(opts: {
  rows?: Record<string, unknown>[];
  insertError?: { code?: string; message: string } | null;
  updateError?: { code?: string; message: string } | null;
  selectError?: { code?: string; message: string } | null;
} = {}) {
  const rows = opts.rows ?? [];
  const calls = { inserts: 0, updates: 0 };

  function from() {
    const filters: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;

    const matched = () =>
      rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));

    const resolve = () => {
      if (patch) {
        if (opts.updateError) return { data: null, error: opts.updateError };
        const hit = matched();
        for (const r of hit) Object.assign(r, patch);
        return { data: hit, error: null };
      }
      if (opts.selectError) return { data: null, error: opts.selectError };
      return { data: matched(), error: null };
    };

    const q = {
      select() { return q; },
      eq(key: string, value: unknown) { filters[key] = value; return q; },
      update(next: Record<string, unknown>) { calls.updates++; patch = next; return q; },
      insert(payload: Record<string, unknown>[]) {
        calls.inserts++;
        if (opts.insertError) return Promise.resolve({ data: null, error: opts.insertError });
        rows.push(...payload);
        return Promise.resolve({ data: payload, error: null });
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then(onOk: any, onErr: any) { return Promise.resolve(resolve()).then(onOk, onErr); },
    };
    return q;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { rows, calls, from } as any;
}

test("a missing migration is detected, not crashed on", () => {
  assert.equal(isTableAbsent("42P01"), true, "undefined_table");
  assert.equal(isTableAbsent("PGRST205"), true, "PostgREST schema cache miss");
  assert.equal(isTableAbsent("23505"), false, "a unique violation is NOT a missing table");
  assert.equal(isTableAbsent(null), false);
});

test("preparation writes exactly one row per channel", async () => {
  const supabase = fakeSupabase();
  const result = await persistGeneratedContent(supabase, {
    reminderLogId: "rem-1",
    userId: "user-1",
    facts: FACTS,
  });

  assert.equal(result.ok, true);
  assert.equal(supabase.rows.length, 2);

  const email = supabase.rows.find((r: Record<string, unknown>) => r.channel === "email")!;
  const sms = supabase.rows.find((r: Record<string, unknown>) => r.channel === "sms")!;

  assert.ok(email.generated_subject, "email carries a subject");
  assert.ok(email.generated_body);
  assert.equal(sms.generated_subject, null, "an SMS must never carry a subject");
  assert.ok(sms.generated_body);
  assert.notEqual(sms.generated_body, email.generated_body);
});

test("a repeated preparation cannot create a second message", async () => {
  // The unique index fires; that is success, not failure — the originals stand
  // and must not be overwritten with freshly generated wording.
  const supabase = fakeSupabase({ insertError: { code: "23505", message: "duplicate key" } });
  const result = await persistGeneratedContent(supabase, {
    reminderLogId: "rem-1",
    userId: "user-1",
    facts: FACTS,
  });
  assert.equal(result.ok, true);
  assert.equal(supabase.rows.length, 0, "nothing was overwritten");
});

test("an unapplied migration degrades to legacy rather than failing preparation", async () => {
  const supabase = fakeSupabase({ insertError: { code: "42P01", message: "no such table" } });
  const result = await persistGeneratedContent(supabase, {
    reminderLogId: "rem-1",
    userId: "user-1",
    facts: FACTS,
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, "table_absent");
});

test("reading with the table absent yields a legacy reminder, never a throw", async () => {
  const supabase = fakeSupabase({ selectError: { code: "42P01", message: "no such table" } });
  const stored = await loadStoredContent(supabase, "rem-1");
  assert.deepEqual(stored, { email: null, sms: null });
  assert.equal(currentContent(stored, FACTS).legacy, true);
});

test("saving an SMS edit touches only the SMS row", async () => {
  const supabase = fakeSupabase({
    rows: [
      { reminder_log_id: "rem-1", channel: "email", generated_subject: "S", generated_body: "E", edited_subject: null, edited_body: null },
      { reminder_log_id: "rem-1", channel: "sms", generated_subject: null, generated_body: "T", edited_subject: null, edited_body: null },
    ],
  });

  const result = await saveChannelEdit(supabase, {
    reminderLogId: "rem-1",
    channel: "sms",
    editedSubject: null,
    editedBody: "My own text",
    at: "2026-08-07T12:00:00Z",
  });

  assert.equal(result.ok, true);
  const sms = supabase.rows.find((r: Record<string, unknown>) => r.channel === "sms")!;
  const email = supabase.rows.find((r: Record<string, unknown>) => r.channel === "email")!;
  assert.equal(sms.edited_body, "My own text");
  assert.equal(sms.content_edited_at, "2026-08-07T12:00:00Z");
  assert.equal(email.edited_body, null, "the email row is untouched");
  assert.equal("edited_subject" in sms && sms.edited_subject === null, true, "no subject written to SMS");
});

test("restore clears the edit and the edited timestamp, leaving the original", async () => {
  const supabase = fakeSupabase({
    rows: [
      {
        reminder_log_id: "rem-1", channel: "email",
        generated_subject: "Original subject", generated_body: "Original body",
        edited_subject: "Mine", edited_body: "My body",
        content_edited_at: "2026-08-01T00:00:00Z",
      },
    ],
  });

  const result = await saveChannelEdit(supabase, {
    reminderLogId: "rem-1",
    channel: "email",
    editedSubject: null,
    editedBody: null,
    at: "2026-08-07T12:00:00Z",
  });

  assert.equal(result.ok, true);
  const row = supabase.rows[0];
  assert.equal(row.edited_subject, null);
  assert.equal(row.edited_body, null);
  assert.equal(row.content_edited_at, null, "no longer edited");
  assert.equal(row.generated_subject, "Original subject", "the original is never touched");
  assert.equal(row.generated_body, "Original body");
});

test("a failed save reports failure and changes nothing", async () => {
  const supabase = fakeSupabase({
    rows: [{ reminder_log_id: "rem-1", channel: "sms", generated_body: "T", edited_body: "Saved earlier" }],
    updateError: { message: "connection lost" },
  });

  const result = await saveChannelEdit(supabase, {
    reminderLogId: "rem-1",
    channel: "sms",
    editedSubject: null,
    editedBody: "New attempt",
    at: "2026-08-07T12:00:00Z",
  });

  assert.equal(result.ok, false);
  assert.equal(
    supabase.rows[0].edited_body,
    "Saved earlier",
    "the last SAVED version must survive a failed save"
  );
});

test("a saved edit is what a later read returns — persistence across a refresh", async () => {
  const supabase = fakeSupabase();
  await persistGeneratedContent(supabase, { reminderLogId: "rem-1", userId: "u", facts: FACTS });

  await saveChannelEdit(supabase, {
    reminderLogId: "rem-1",
    channel: "sms",
    editedSubject: null,
    editedBody: "Owner's own SMS.",
    at: "2026-08-07T12:00:00Z",
  });

  // A fresh read, as a page reload or a /continue resume would do.
  const stored = await loadStoredContent(supabase, "rem-1");
  const current = currentContent(stored, FACTS);

  assert.equal(current.sms.body, "Owner's own SMS.");
  assert.equal(current.sms.edited, true);
  assert.equal(current.email.edited, false, "the email is still the original");
  assert.equal(current.legacy, false);
});

test("the row folder never invents a channel that was not stored", () => {
  const emailOnly: ChannelRow[] = [
    { channel: "email", generated_subject: "S", generated_body: "B", edited_subject: null, edited_body: null },
  ];
  const stored = storedContentFromRows(emailOnly);
  assert.ok(stored.email);
  assert.equal(stored.sms, null, "an absent SMS row stays absent");
});

// ── Migration 010: the ownership invariant ──────────────────────────────────
//
// STATIC CHECKS on the migration SQL, and labelled as such. They cannot execute
// Postgres, so they do not prove the constraint works — that is Postgres's job.
// What they DO prove is that the invariant is still present and still shaped
// the way it was reviewed. Without them, the composite key is one careless edit
// away from silently becoming two independent foreign keys again, which is the
// exact state that made a cross-tenant write possible.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const MIGRATION = readFileSync(
  join(fileURLToPath(new URL("../", import.meta.url)), "supabase/sql/010_reminder_channel_messages.sql"),
  "utf8"
);

test("[static] migration 010 ties a channel row's owner to its parent reminder's owner", () => {
  // The parent needs a unique key on exactly the referenced pair, or the
  // composite foreign key cannot be created at all.
  assert.match(
    MIGRATION,
    /add constraint reminder_logs_id_user_key unique \(id, user_id\)/,
    "reminder_logs needs a UNIQUE (id, user_id) for the composite FK to target"
  );

  // The invariant itself.
  const fk = MIGRATION.match(
    /foreign key \(reminder_log_id, user_id\)[\s\S]{0,200}?references public\.reminder_logs \(id, user_id\)[\s\S]{0,120}?on delete cascade/
  );
  assert.ok(fk, "the composite (reminder_log_id, user_id) foreign key must be present");
  assert.match(fk![0], /match full/, "MATCH FULL, so a nullable column can never bypass it");
  assert.match(fk![0], /on update cascade/);
});

test("[static] the superseded single-column FK is gone, not merely duplicated", () => {
  // Two foreign keys to the same parent would double the constraint checking
  // and, more importantly, would suggest the single-column one still carries
  // the cascade — it does not; the composite one does.
  assert.equal(
    /reminder_log_id uuid not null\s*\n\s*references public\.reminder_logs/.test(MIGRATION),
    false,
    "the independent reminder_log_id FK must be replaced by the composite key"
  );
  assert.match(MIGRATION, /reminder_log_id uuid not null,/);
});

test("[static] RLS is kept alongside the constraint, not replaced by it", () => {
  // Defence in depth: the FK guarantees the stored user_id is the true owner,
  // RLS guarantees only that owner can reach the row. Losing either is a
  // regression.
  assert.match(MIGRATION, /alter table public\.reminder_channel_messages enable row level security/);
  assert.match(MIGRATION, /create policy select_own_channel_messages[\s\S]*?using \(auth\.uid\(\) = user_id\)/);
  assert.match(
    MIGRATION,
    /create policy update_own_channel_messages[\s\S]*?using \(auth\.uid\(\) = user_id\)[\s\S]*?with check \(auth\.uid\(\) = user_id\)/,
    "UPDATE needs WITH CHECK too, or a row could be updated into another owner"
  );
  // No INSERT grant: channel content is created only by trusted server code.
  assert.equal(/create policy [a-z_]*insert/i.test(MIGRATION), false);
});

test("[static] the rollback undoes the parent constraint too, in a safe order", () => {
  const rollback = MIGRATION.slice(MIGRATION.indexOf("ROLLBACK"));
  const dropTable = rollback.indexOf("drop table if exists public.reminder_channel_messages");
  const dropKey = rollback.indexOf("drop constraint if exists reminder_logs_id_user_key");

  assert.ok(dropTable > -1 && dropKey > -1, "both drops must be documented");
  assert.ok(
    dropTable < dropKey,
    "the table must be dropped BEFORE the key it depends on, or the drop fails"
  );
});

test("[static] migrations 004-009 are untouched by this migration", () => {
  // The one permitted exception is the additive UNIQUE key the composite FK
  // needs. Anything else altering reminder_logs here would be out of scope.
  //
  // Comment lines are stripped first: the ROLLBACK section documents the
  // reverse statement as a comment, and counting it would be counting a note
  // rather than an executed statement.
  const executable = MIGRATION.replace(/^\s*--.*$/gm, "");
  const alters = executable.match(/alter table public\.reminder_logs[\s\S]*?;/g) ?? [];
  assert.equal(alters.length, 1, "exactly one statement may touch reminder_logs");
  assert.match(alters[0], /add constraint reminder_logs_id_user_key unique/);
});
