-- =============================================================================
-- ServiceSignal — terms/privacy acceptance tracking migration (v8.9.0)
-- Adds three nullable columns to the existing profiles table.
-- NOT RUN AUTOMATICALLY. Review and run manually in the Supabase SQL editor.
-- =============================================================================

alter table public.profiles
  add column if not exists terms_accepted_at timestamptz null,
  add column if not exists terms_version     text        null,
  add column if not exists privacy_version   text        null;

-- No RLS policy changes needed. profiles' existing row-level policies
-- (insert_own_profile / select_own_profile / update_own_profile, all
-- scoped to auth.uid() = user_id) already govern these new columns as
-- part of the same row — RLS applies per-row, not per-column.
--
-- No backfill for existing users: these three columns are simply left
-- NULL for any profile row that existed before this migration. Nothing
-- in the application reads these fields as an access gate, so existing
-- users are entirely unaffected — this is a forward-looking record for
-- new signups, not a retroactive consent requirement.
