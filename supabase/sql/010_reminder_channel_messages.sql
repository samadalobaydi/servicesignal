-- =============================================================================
-- ServiceSignal — reminder channel messages (SMS + email as equal channels)
-- NOT RUN AUTOMATICALLY. Review and run manually in the Supabase SQL editor.
-- NOT YET APPLIED TO ANY REMOTE PROJECT.
-- =============================================================================
--
-- WHY A CHILD TABLE RATHER THAN MORE COLUMNS ON reminder_logs
--
-- Three shapes were considered.
--
--   A. One row, more columns: generated/edited subject+body for email, the same
--      for SMS, and then — because delivery state must stay independent per
--      channel — a second copy of EVERY column migration 009 added: status,
--      send_started_at, send_attempt_key, send_attempt_count,
--      provider_message_id, provider_last_event, last_send_error,
--      last_reconciled_at. Sixteen delivery columns on one row, and a third
--      set the day a WhatsApp or voice channel appears. Rejected: the whole
--      009 lifecycle would have to be duplicated per channel in code as well as
--      in schema, and every query would have to know which suffix it meant.
--
--   B. THIS. reminder_logs stays the reminder EVENT — one checkpoint, one
--      eligibility decision, one approval. Each channel gets a child row
--      carrying its own content and its own copy of the 009 delivery
--      lifecycle. Adding a channel is a row, not a migration.
--
--   C. One reminder_logs row per channel. Rejected: reminder_logs has a
--      UNIQUE(invoice_id, schedule) that the daily cron relies on to avoid
--      preparing a duplicate reminder, and splitting rows per channel breaks
--      that dedupe. It would also turn one atomic approval claim into two, on
--      the most safety-critical path in the product.
--
-- B keeps migrations 004-009 untouched, keeps the cron's dedupe intact, gives
-- per-channel delivery state for free, and matches the product decision: ONE
-- approval for the reviewed pair, INDEPENDENT delivery tracking per channel.
--
-- CONTENT IS NOW STORED, AND THAT IS THE POINT. Until now the message existed
-- nowhere and was recomposed at send time. That made the Note 41 guarantee work
-- but made customer editing impossible. Storing the generated original and the
-- customer's edit separately is what lets the send path read the exact bytes
-- the owner approved instead of rebuilding its own version over the top.

begin;

-- ── Prerequisite for the ownership invariant below ───────────────────────
--
-- A composite foreign key needs a UNIQUE key on the parent covering exactly the
-- referenced columns. `id` is already the primary key, so (id, user_id) is
-- trivially unique and this constraint cannot fail on existing data — it adds
-- no new restriction to reminder_logs, it only makes the pair targetable by a
-- foreign key.
--
-- This is the ONLY statement in this migration that touches reminder_logs, and
-- it is purely additive. Migrations 004-009 are not modified.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reminder_logs_id_user_key'
  ) then
    alter table public.reminder_logs
      add constraint reminder_logs_id_user_key unique (id, user_id);
  end if;
end $$;

create table if not exists public.reminder_channel_messages (
  id uuid primary key default gen_random_uuid(),

  -- The reminder EVENT this message belongs to. A channel message has no
  -- meaning without its reminder, and orphans here would be invisible rows
  -- holding customer-authored text — hence the cascade on the composite key
  -- below.
  reminder_log_id uuid not null,

  -- Denormalised owner. reminder_logs already carries user_id; repeating it
  -- lets RLS evaluate ownership without a join on every read, which matters
  -- because this table is read on every review-page render.
  --
  -- The auth.users reference guarantees the account exists and cascades when it
  -- is deleted. It does NOT, on its own, guarantee that this is the same user
  -- who owns the parent reminder — see the composite key below.
  user_id uuid not null references auth.users (id) on delete cascade,

  channel text not null check (channel in ('email', 'sms')),

  -- ── Content ────────────────────────────────────────────────────────────
  --
  -- generated_* is written ONCE at preparation and never rewritten. It is what
  -- "Restore original" returns, verbatim — restore must not call the generator
  -- again, or a due-date rollover between preparation and restore would hand
  -- back a message the owner never saw.
  --
  -- edited_* is NULL until the owner saves a change, and returns to NULL when
  -- they restore. NULL therefore means exactly "unedited", with no sentinel
  -- value to misread.
  --
  -- subject columns are NULL for SMS: an SMS has no subject, and inventing an
  -- empty string would let a bug write one into a text message.
  generated_subject text,
  generated_body    text not null,
  edited_subject    text,
  edited_body       text,
  content_edited_at timestamptz,

  -- ── Per-channel delivery lifecycle ─────────────────────────────────────
  --
  -- The same vocabulary migration 009 established for email, now per channel,
  -- because one channel can be delivered while the other bounces.
  --   pending | sending | sent | dismissed | failed | delivery_unknown |
  --   undelivered
  status text not null default 'pending'
    check (status in ('pending','sending','sent','dismissed','failed','delivery_unknown','undelivered')),
  send_started_at     timestamptz,
  send_attempt_key    text,
  send_attempt_count  integer not null default 0,
  provider_message_id text,
  provider_last_event text,
  last_send_error     text,
  last_reconciled_at  timestamptz,
  sent_at             timestamptz,

  created_at timestamptz not null default now(),

  -- ── OWNERSHIP INVARIANT ────────────────────────────────────────────────
  --
  -- THE PROBLEM THIS SOLVES. With two independent foreign keys — one from
  -- reminder_log_id to reminder_logs, another from user_id to auth.users —
  -- nothing connected them. The database would happily accept a row whose
  -- reminder_log_id belongs to User A while its user_id says User B.
  --
  -- That is not a theoretical tidiness point. RLS on this table trusts the
  -- denormalised user_id (`auth.uid() = user_id`), so such a row would grant
  -- User B both READ and UPDATE on User A's customer-facing reminder text: a
  -- cross-tenant disclosure and tamper vector, created by a single wrong value
  -- in one insert.
  --
  -- The composite key makes it structurally impossible. A child row can only
  -- exist if (reminder_log_id, user_id) matches a real (id, user_id) pair in
  -- reminder_logs, so the denormalised owner can never disagree with the
  -- parent's owner. RLS is unchanged and still enforced — this is defence in
  -- depth beneath it, not a replacement for it.
  --
  -- MATCH FULL rather than the default MATCH SIMPLE: both columns are NOT NULL
  -- today so the two behave identically, but MATCH SIMPLE silently passes when
  -- any referenced column is NULL. Stating FULL means the invariant survives if
  -- either column is ever made nullable.
  --
  -- ON DELETE CASCADE replaces the single-column FK that previously carried it,
  -- so deleting a reminder still removes its channel messages. ON UPDATE
  -- CASCADE keeps the pair aligned if a reminder is ever reassigned.
  constraint reminder_channel_messages_owner_matches_parent
    foreign key (reminder_log_id, user_id)
    references public.reminder_logs (id, user_id)
    match full
    on update cascade
    on delete cascade,

  -- One message per channel per reminder. This is the idempotency guarantee at
  -- the data layer: a repeated preparation cannot create a second SMS for the
  -- same checkpoint, however many times it runs.
  constraint reminder_channel_messages_one_per_channel
    unique (reminder_log_id, channel),

  -- SMS has no subject; email must have one. Enforced here so no code path can
  -- produce a subjectless email or a subject-bearing text message.
  constraint reminder_channel_messages_subject_shape
    check (
      (channel = 'sms'   and generated_subject is null) or
      (channel = 'email' and generated_subject is not null)
    )
);

-- ── Indexes ──────────────────────────────────────────────────────────────

-- The review page and the send path both fetch every channel for one reminder.
create index if not exists reminder_channel_messages_reminder_idx
  on public.reminder_channel_messages (reminder_log_id);

-- Reconciliation sweeps, mirroring the partial indexes migration 009 added.
create index if not exists reminder_channel_messages_sending_idx
  on public.reminder_channel_messages (send_started_at)
  where status = 'sending';

create index if not exists reminder_channel_messages_unresolved_idx
  on public.reminder_channel_messages (last_reconciled_at)
  where status in ('delivery_unknown', 'undelivered')
    and provider_message_id is not null;

-- ── RLS ──────────────────────────────────────────────────────────────────
--
-- KEPT IN FULL, alongside the composite key above. The two guard different
-- things and neither replaces the other: the foreign key guarantees the stored
-- user_id is the true owner, and RLS guarantees only that owner can reach the
-- row. Without the key, RLS would faithfully enforce a lie; without RLS, the
-- key would be correct but unenforced at query time.
--
-- Same shape as reminder_logs: the owner may read and update their own rows;
-- INSERT is deliberately NOT granted to the anon/authenticated role, because
-- channel messages are only ever created by trusted server code preparing a
-- reminder. The service-role client bypasses RLS as it does elsewhere.
--
-- UPDATE is granted because that is how a customer edit and a restore are
-- saved. The WITH CHECK clause repeats the USING predicate so a row cannot be
-- updated INTO another user's ownership.
alter table public.reminder_channel_messages enable row level security;

drop policy if exists select_own_channel_messages on public.reminder_channel_messages;
create policy select_own_channel_messages
  on public.reminder_channel_messages
  for select
  using (auth.uid() = user_id);

drop policy if exists update_own_channel_messages on public.reminder_channel_messages;
create policy update_own_channel_messages
  on public.reminder_channel_messages
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

commit;

-- =============================================================================
-- NOTES
-- =============================================================================
--
-- NO BACKFILL, DELIBERATELY. Every reminder_logs row that predates this table
-- simply has no children. lib/reminder-content.ts detects that and composes
-- live, exactly as the product did before, and marks the result `legacy` so the
-- review UI offers no editing rather than appearing to save into storage that
-- does not exist for that row.
--
-- Back-filling would be worse than leaving them: it would manufacture an
-- "original" that no owner has ever seen, and would make an untouched legacy
-- reminder indistinguishable from a deliberately authored one.
--
-- MIGRATIONS 004-009 ARE UNTOUCHED. reminder_logs keeps its own status and its
-- own 009 columns, which continue to describe the reminder event and the email
-- channel's historical delivery state. Nothing existing is dropped or renamed,
-- so this migration is additive and safe to apply to a database with live data.
--
-- =============================================================================
-- ROLLBACK
-- =============================================================================
--
-- Destructive: dropping this table discards customer-authored reminder text
-- that exists nowhere else. Export it first if any row has edited_body set.
--
--   begin;
--   drop policy if exists update_own_channel_messages on public.reminder_channel_messages;
--   drop policy if exists select_own_channel_messages on public.reminder_channel_messages;
--   drop index if exists reminder_channel_messages_unresolved_idx;
--   drop index if exists reminder_channel_messages_sending_idx;
--   drop index if exists reminder_channel_messages_reminder_idx;
--   drop table if exists public.reminder_channel_messages;
--   -- Only after the table is gone: the composite FK depends on this key.
--   -- Dropping it restores reminder_logs exactly as migrations 004-009 left it.
--   alter table public.reminder_logs
--     drop constraint if exists reminder_logs_id_user_key;
--   commit;
