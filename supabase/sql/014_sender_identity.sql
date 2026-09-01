-- =============================================================================
-- ServiceSignal — sender identity migration
-- Adds two nullable columns to the existing profiles table.
-- NOT RUN AUTOMATICALLY. Review and run manually in the Supabase SQL editor.
-- NOT YET APPLIED TO ANY REMOTE PROJECT.
-- =============================================================================
--
-- WHY NO DEFAULT ON sender_identity, UNLIKE onboarding_status (005)
--
-- Migration 005 gives onboarding_status a default of 'required' for new rows
-- and backfills every pre-existing row to 'exempt' — both are true statements
-- ("this row was created after onboarding existed" / "this row predates
-- onboarding"). There is no equivalent true statement for sender_identity.
-- An existing account whose reminders currently show business_name did not
-- choose Business under this model — the choice did not exist yet. Writing
-- 'business' into any existing row, or defaulting new rows to either value,
-- would be recording a decision nobody made. NULL is the only honest value
-- until a person actually picks one, in Settings or onboarding.
--
-- WHY THIS IS ONE TRANSACTION
--
-- Not required for correctness the way it was in 005 (there is no multi-step
-- NOT-NULL lockdown here to race against a concurrent insert), but kept for
-- consistency with this repository's migration style and because it costs
-- nothing: either both columns and the constraint land, or none do.

begin;

-- 1. The personal/full name an account holder may choose to sign reminders
--    with, as an alternative to business_name. Nullable, no default: an
--    account that chooses Business identity will likely never set this, and
--    NULL means "not provided" — never an empty string standing in for a
--    decision that was never made.
alter table public.profiles
  add column if not exists personal_name text null;

-- 2. Which of the two the customer has explicitly chosen. NULL for every
--    row until a person sets it — see the note above for why this has no
--    default and no backfill, on every existing row without exception.
alter table public.profiles
  add column if not exists sender_identity text null;

-- 3. Constrain the vocabulary once sender_identity IS set. A CHECK in
--    Postgres does not evaluate NULL against an IN-list — a NULL column
--    value always satisfies a CHECK constraint unless the constraint says
--    otherwise — so every unset row remains valid. This only rejects a
--    write of something other than exactly 'business' or 'personal'.
--
--    THE GUARD IS TABLE- AND TYPE-SCOPED, NOT NAME-ONLY. constraint names
--    are not globally unique across a Postgres database — two different
--    tables can each have their own constraint sharing this name (or one
--    could exist by coincidence, or from a past manual experiment). Keying
--    the existence check on conname alone risks a false positive: a
--    same-named constraint on a DIFFERENT table would make this block skip
--    adding the intended CHECK to public.profiles, silently leaving that
--    table's sender_identity column unconstrained. conrelid pins the check
--    to this exact table (via regclass, resolved once at execution time,
--    not a string comparison against a schema-qualified name) and contype
--    = 'c' confirms the existing object found really is a CHECK constraint
--    and not, say, a same-named unique or foreign-key constraint that
--    would not actually enforce the vocabulary this statement exists for.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'profiles_sender_identity_check'
       and conrelid = 'public.profiles'::regclass
       and contype = 'c'
  ) then
    alter table public.profiles
      add constraint profiles_sender_identity_check
      check (sender_identity in ('business', 'personal'));
  end if;
end $$;

commit;

-- =============================================================================
-- NOTES
-- =============================================================================
--
-- RLS. No policy changes needed. profiles' existing row-level policies
-- (insert_own_profile / select_own_profile / update_own_profile, all scoped
-- to auth.uid() = user_id) already govern these two columns as part of the
-- same row — RLS applies per-row, not per-column. Same note as 005.
--
-- NO BACKFILL, ANYWHERE IN THIS FILE. There is no UPDATE statement in this
-- migration. Every existing row's sender_identity and personal_name remain
-- NULL after this runs, with no exception — including rows that already
-- have a non-null business_name.
--
-- NO PHASED NOT-NULL STEP. Unlike 005's onboarding_status, neither column
-- here is ever intended to become NOT NULL. "Not yet chosen" is a
-- permanent, legitimate state for an account that never returns to
-- Settings — not a defect to be cleaned up later.
--
-- RELATIONSHIP TO MIGRATION 013. None. 013 concerns invoice table
-- privileges for browser roles and touches no column on profiles. This
-- migration is independent of 013 and does not require 013 to be applied
-- first, at the same time, or ever, in order to be safe on its own.
--
-- RELATIONSHIP TO business_name, invoices, reminder_logs,
-- reminder_channel_messages. None. This migration touches only two new
-- columns on public.profiles. No other table, and no existing column on
-- profiles (including business_name), is read, written, altered, or
-- referenced anywhere in this file.
--
-- RE-RUNNING. All three statements are idempotent: `add column if not
-- exists` and the table-and-type-scoped `do $$ ... $$` existence check both
-- no-op cleanly if run again after the migration has already applied.
--
-- =============================================================================
-- ROLLBACK — run in this order, as one transaction
-- =============================================================================
--
-- Reverse order of creation: the constraint depends on the column, so it
-- is dropped first.
--
-- Deploy application code that tolerates the missing columns BEFORE rolling
-- back the database (the same isMigrationAbsentError pattern lib/onboarding.ts
-- already uses for onboarding_status would need a sender-identity
-- equivalent) — otherwise every request that reads these columns logs an
-- error until the code catches up. Not strictly required for correctness
-- (a missing-column error is handled, not fatal) but avoids a noisy log
-- window.
--
-- This DISCARDS any sender-identity preference and personal name already
-- recorded. That data exists nowhere else. Export both columns first if
-- that matters.
--
--   begin;
--     alter table public.profiles
--       drop constraint if exists profiles_sender_identity_check;
--     alter table public.profiles
--       drop column if exists sender_identity;
--     alter table public.profiles
--       drop column if exists personal_name;
--   commit;
