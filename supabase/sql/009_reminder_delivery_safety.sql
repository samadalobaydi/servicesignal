-- =============================================================================
-- ServiceSignal — reminder delivery safety
-- Adds the send-lifecycle columns and three statuses public.reminder_logs needs.
-- NOT RUN AUTOMATICALLY. Review and run manually in the Supabase SQL editor.
-- =============================================================================
--
-- WHY THIS IS NEEDED
--
-- The original approval route acquired its concurrency lock by flipping
-- pending -> sent BEFORE calling Resend. That closed the double-send window but
-- created two worse problems:
--
--   1. A row said "sent" while the request was still in flight, so a crash or
--      timeout left a permanent lie in the customer's history.
--   2. On failure it wrote 'failed' — but the claim only matched 'pending', so
--      a failed reminder could NEVER be retried. The UI offered a retry the
--      database could not honour.
--
-- And there was no way to represent the two cases that matter most:
--
--   * Resend accepted the email but we never learned the outcome. NOT a
--     failure, and must never be blindly resent — the customer may have it.
--   * Resend accepted the email and DELIVERY then failed (bounce, complaint,
--     suppression). Also not a transport rejection: a submission definitely
--     happened, so resending is a new decision about a corrected recipient,
--     not a retry.
--
-- THE HONEST LIMIT. Exactly-once delivery across a database and a third-party
-- provider is not achievable. What IS achievable, and what this migration
-- supports: one logical attempt at a time, at-most-once provider submission per
-- attempt via Resend's Idempotency-Key, atomic internal claiming, and a
-- truthful three-way split between known rejection, unknown outcome and
-- accepted-but-undelivered.
--
-- EVERY COLUMN BELOW IS READ OR WRITTEN BY THE SHIPPED CODE. Nothing is added
-- speculatively — see the "written by / read by" note on each one.

begin;

-- ── Send lifecycle columns ───────────────────────────────────────────────

-- When the current attempt claimed the row.
-- Written by: lib/reminder-approval.ts (claim)
-- Read by:    lib/reminder-reconcile.ts (stale-lease detection)
-- Used to detect a 'sending' row abandoned by a crashed process — NOT to
-- auto-retry it, see the recovery policy at the foot of this file.
alter table public.reminder_logs
  add column if not exists send_started_at timestamptz null;

-- The Idempotency-Key submitted to Resend for the CURRENT logical attempt.
-- Written by: lib/reminder-approval.ts (claim)
-- Read by:    humans, during manual reconciliation.
--
-- The key is DERIVED, not invented: sha256(reminder id + reviewed content hash
-- + send_attempt_count). It is stored because an operator settling a
-- delivery_unknown row by hand needs to know exactly which key was submitted.
-- Deliberately NOT unique — a reminder that is definitely rejected and later
-- re-approved holds a succession of keys over its life.
alter table public.reminder_logs
  add column if not exists send_attempt_key text null;

-- Logical attempts allocated so far. 0 means never attempted.
-- Written by: lib/reminder-approval.ts (claim, expect N -> set N+1)
-- Read by:    lib/reminder-approval.ts (attempt identity + CAS guard)
--
-- This is the attempt identity the idempotency key is bound to, AND the
-- compare-and-set guard that makes the claim atomic. It can only ever increase
-- through a successful claim, and 'delivery_unknown' and 'undelivered' are not
-- claimable — which is precisely what stops an ambiguous or bounced outcome
-- from ever obtaining a fresh key.
--
-- NOT NULL with a default is safe on an existing table: Postgres 11+ stores the
-- default in the catalogue rather than rewriting every row.
alter table public.reminder_logs
  add column if not exists send_attempt_count integer not null default 0;

-- Resend's email id, persisted immediately after confirmed acceptance.
-- Written by: lib/reminder-approval.ts (recordAccepted)
-- Read by:    lib/reminder-reconcile.ts, lib/reminder-review.ts
-- This is the handle reconciliation needs: resend.emails.get(id) can establish
-- what actually happened when our own record is uncertain.
alter table public.reminder_logs
  add column if not exists provider_message_id text null;

-- The last delivery event the provider reported for that message.
-- Written by: lib/reminder-reconcile.ts (applyProviderEvent, touchReconciled)
-- Read by:    lib/reminder-reconcile.ts (which rows are still unresolved),
--             lib/reminder-review.ts (truthful copy on the review page)
--
-- Free text rather than an enum: it records what the provider said, and a
-- provider adding a new event must not break an insert. Classification into
-- delivered / undelivered / in-flight / unrecognised is done in code
-- (lib/reminder-send-state.ts), where an unrecognised value is never guessed at.
alter table public.reminder_logs
  add column if not exists provider_last_event text null;

-- Last error or delivery note, for display and diagnosis.
-- Written by: lib/reminder-approval.ts, lib/reminder-reconcile.ts
-- Read by:    lib/reminder-review.ts
-- Provider error messages describe the problem (unverified domain, invalid
-- recipient) and carry no secrets.
alter table public.reminder_logs
  add column if not exists last_send_error text null;

-- Fingerprint of the exact content the owner reviewed and approved.
-- Written by: lib/reminder-approval.ts (claim)
-- The approve route recomputes it and refuses to send when it no longer
-- matches, so an invoice edited after review cannot be sent under a stale
-- approval. Persisted so the record shows WHAT was approved, not just that
-- something was.
alter table public.reminder_logs
  add column if not exists reviewed_content_hash text null;

-- When reconciliation last asked the provider about this row.
-- Written by: lib/reminder-reconcile.ts
-- Read by:    lib/reminder-reconcile.ts, to order the queue oldest-first so a
--             backlog drains instead of one slice being re-asked every run.
alter table public.reminder_logs
  add column if not exists last_reconciled_at timestamptz null;

-- ── Status vocabulary ────────────────────────────────────────────────────
--
-- Existing: pending | sent | dismissed | failed
-- Added:    sending | delivery_unknown | undelivered
--
--   sending           one server request owns the active attempt. Transient.
--   delivery_unknown  we do not know whether Resend accepted the message —
--                     timeout, dropped connection, or a database write that
--                     failed after acceptance. NOT retryable without
--                     reconciliation, because resending risks a second email.
--   undelivered       Resend DID accept the message and delivery failed or has
--                     not resolved (bounced, complained, suppressed, provider
--                     terminal failure, or still delayed). Not retryable
--                     either: the submission happened, and what needs
--                     attention is the recipient, not the transport.
--
-- 'failed' now means something narrower and more useful: a DEFINITE
-- PRE-ACCEPTANCE rejection, where the provider certainly did not take the
-- message. It is the only failure state that is freely retryable, and the only
-- one from which a new logical attempt may be allocated.
--
-- The column has no CHECK constraint in the live schema (reminder_logs predates
-- this repository's migrations — 001/002 were never committed), so nothing has
-- to be dropped. This adds one, which both documents the vocabulary and stops a
-- typo in application code silently creating an eighth state.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reminder_logs_status_check'
  ) then
    alter table public.reminder_logs
      add constraint reminder_logs_status_check
      check (status in (
        'pending', 'sending', 'sent', 'dismissed',
        'failed', 'delivery_unknown', 'undelivered'
      ));
  end if;
end $$;

-- ── Indexes for the reconciliation queries ───────────────────────────────
--
-- All partial: the overwhelming majority of rows are 'pending' or 'sent' and
-- are never touched by reconciliation, so these stay tiny.

-- Phase 1 — abandoned 'sending' rows, ordered by lease start.
create index if not exists reminder_logs_sending_idx
  on public.reminder_logs (send_started_at)
  where status = 'sending';

-- Phase 2 — delivery_unknown rows that have a provider id to ask about,
-- oldest-reconciled first.
create index if not exists reminder_logs_unknown_reconcile_idx
  on public.reminder_logs (last_reconciled_at)
  where status = 'delivery_unknown' and provider_message_id is not null;

-- Phase 3 — accepted rows whose delivery has not yet resolved.
create index if not exists reminder_logs_undelivered_reconcile_idx
  on public.reminder_logs (last_reconciled_at)
  where status = 'undelivered' and provider_message_id is not null;

commit;

-- =============================================================================
-- NOTES
-- =============================================================================
--
-- NO BACKFILL, and no fabricated history. Every existing row keeps its current
-- status; the new nullable columns are NULL, which correctly means "this
-- reminder predates delivery tracking", and send_attempt_count defaults to 0,
-- which correctly means "no logical attempt has been allocated under the new
-- model". A row already marked 'sent' is left alone — we do not know its
-- provider id or its delivery outcome and must not invent either.
--
-- A pre-existing 'sent' row therefore has send_attempt_count = 0. That is
-- harmless: 'sent' is not claimable, so the count is never consulted for it.
--
-- RLS. No policy changes, and nothing is weakened. reminder_logs' existing
-- row-level policies (scoped to auth.uid()) already govern these columns as
-- part of the same row — RLS applies per row, not per column. The reconciliation
-- cron uses the service-role client, which bypasses RLS by design and is
-- reachable only with the correct CRON_SECRET bearer token.
--
-- STALE 'sending' RECOVERY POLICY. A row stuck in 'sending' beyond the lease
-- window is NOT returned to 'pending'. Resend may already have accepted the
-- message, so resending could double-send. It is moved to 'delivery_unknown',
-- which preserves send_attempt_key and provider_message_id and requires
-- reconciliation — via resend.emails.get() — or a human to establish the truth.
--
-- IDEMPOTENCY-KEY RULE, in one line: the key is reused for every repetition of
-- the SAME logical attempt, and a new one exists only when a successful claim
-- allocates a new send_attempt_count, which only 'pending' and 'failed' allow.
--
-- =============================================================================
-- ROLLBACK
-- =============================================================================
--
-- Rows sitting in 'sending', 'delivery_unknown' or 'undelivered' would violate
-- the old vocabulary, so settle them first — to 'failed' if you have
-- established the message was never accepted, or to 'sent' if it was. Do not
-- guess, and do not resend as part of a rollback.
--
--   begin;
--   -- settle any transitional rows first, e.g.
--   -- update public.reminder_logs set status = 'failed'
--   --  where status in ('sending', 'delivery_unknown', 'undelivered');
--   drop index if exists reminder_logs_undelivered_reconcile_idx;
--   drop index if exists reminder_logs_unknown_reconcile_idx;
--   drop index if exists reminder_logs_sending_idx;
--   alter table public.reminder_logs drop constraint if exists reminder_logs_status_check;
--   alter table public.reminder_logs drop column if exists last_reconciled_at;
--   alter table public.reminder_logs drop column if exists reviewed_content_hash;
--   alter table public.reminder_logs drop column if exists last_send_error;
--   alter table public.reminder_logs drop column if exists provider_last_event;
--   alter table public.reminder_logs drop column if exists provider_message_id;
--   alter table public.reminder_logs drop column if exists send_attempt_count;
--   alter table public.reminder_logs drop column if exists send_attempt_key;
--   alter table public.reminder_logs drop column if exists send_started_at;
--   commit;
