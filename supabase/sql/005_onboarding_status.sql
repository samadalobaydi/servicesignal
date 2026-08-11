-- =============================================================================
-- ServiceSignal — first-run onboarding state migration
-- Adds two columns to the existing profiles table.
-- NOT RUN AUTOMATICALLY. Review and run manually in the Supabase SQL editor.
-- =============================================================================
--
-- WHY A STATUS ENUM RATHER THAN TIMESTAMPS
--
-- The obvious alternative is a pair of timestamps (onboarding_started_at /
-- onboarding_completed_at) with NULL meaning "not yet". It was rejected: every
-- profile that existed before this migration would need a completed_at value
-- to avoid being dragged into onboarding, and any value written would be a
-- fabricated date claiming they finished a flow that did not exist. A status
-- column lets those users be marked `exempt`, which is true.
--
-- The four states are distinct and all reachable:
--   required   — must complete onboarding before reaching the dashboard
--   skipped    — chose "I'll do this later"; goes straight to the dashboard,
--                and can return to /onboarding to finish, moving to
--                `completed`. `exempt` must never be offered that.
--   completed  — finished the flow
--   exempt     — predates onboarding entirely, or was created by a path that
--                should never be interrupted
--
-- `skipped` and `exempt` behave identically at the DASHBOARD gate — neither is
-- diverted — but differ at /onboarding itself: a skipped user who returns
-- resumes the flow, an exempt user is told they are already set up. That
-- difference is the whole reason they are separate values.
--
-- RUN ORDER MATTERS. The steps below must run in sequence. Adding the column
-- with a NOT NULL default in one statement would stamp every existing profile
-- as `required` and force established users through a first-run flow on their
-- next sign-in.
--
-- WHY THIS IS ONE TRANSACTION
--
-- There is a race between step 1 and step 3. Run as separate statements, a
-- signup landing in that window inserts a profile with onboarding_status NULL
-- — after step 2's backfill has already passed over it. Step 4 would then fail
-- on the leftover NULL and abort the migration part-applied, leaving the
-- column present, defaultless and nullable while the application had already
-- begun reading it.
--
-- Wrapping the whole thing in a transaction closes it: `alter table` takes an
-- ACCESS EXCLUSIVE lock held until COMMIT, so no concurrent insert can occur
-- between the steps. Either every step lands or none does. The lock is brief
-- and profiles is small, but note it does block writes to the table for the
-- duration — run it at a quiet moment.

begin;

-- 1. Add nullable. No default yet, so existing rows get NULL rather than a
--    claim about a flow they never saw.
alter table public.profiles
  add column if not exists onboarding_status text null;

-- 1b. When the status last changed. Nullable forever: a row that has never
--     transitioned has no transition date, and inventing one (the migration
--     date, say) would claim a decision the user never made. Only the status
--     API writes it, and only alongside a status change.
alter table public.profiles
  add column if not exists onboarding_status_at timestamptz null;

-- 2. Backfill every pre-existing row as exempt. Anyone who already has a
--    profile has already been using the product.
update public.profiles
   set onboarding_status = 'exempt'
 where onboarding_status is null;

-- 3. Now set the default, which applies only to rows created from here on.
alter table public.profiles
  alter column onboarding_status set default 'required';

-- 4. Lock it down once no NULLs remain.
alter table public.profiles
  alter column onboarding_status set not null;

-- 5. Constrain the vocabulary. A typo in application code should fail loudly
--    at the database rather than quietly creating a fifth state that the
--    redirect gate does not recognise.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_onboarding_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_onboarding_status_check
      check (onboarding_status in ('required', 'skipped', 'completed', 'exempt'));
  end if;
end $$;

commit;

-- =============================================================================
-- NOTES
-- =============================================================================
--
-- RLS. No policy changes needed. profiles' existing row-level policies
-- (insert_own_profile / select_own_profile / update_own_profile, all scoped to
-- auth.uid() = user_id) already govern this column as part of the same row —
-- RLS applies per-row, not per-column.
--
-- RELATIONSHIP TO MIGRATION 004. None. 004 creates public.signup_attempts and
-- touches no other table; this migration touches only public.profiles. They
-- share no object and may be applied in either order, or independently. 004
-- being unapplied does not affect this migration or onboarding.
--
-- RE-RUNNING. Steps 1, 3, 4 and 5 are idempotent. Step 2 only touches NULL
-- rows, so re-running after users have begun onboarding cannot reset anyone —
-- their status is non-NULL by then.
--
-- =============================================================================
-- ROLLBACK — run in this order, as one transaction
-- =============================================================================
--
-- Reverse order of creation: the constraint depends on the column, so it goes
-- first. Dropping the column would cascade the constraint anyway, but doing it
-- explicitly means a partial rollback cannot leave a constraint orphaned
-- against a column that is about to be re-added by a re-run.
--
-- Deploy the previous application build BEFORE rolling back. Application code
-- that reads onboarding_status treats a missing column as "feature
-- unavailable" and allows normal dashboard access (see lib/onboarding.ts,
-- isMigrationAbsentError), so the ordering is not strictly required — but
-- rolling back the database first means every request logs a warning until the
-- code follows.
--
-- This DISCARDS onboarding progress: who completed, who skipped. That data
-- exists nowhere else. Re-applying the migration afterwards marks every
-- existing profile `exempt`, so users who had not yet onboarded will never be
-- offered it. Export the column first if that matters.
--
--   begin;
--   alter table public.profiles
--     drop constraint if exists profiles_onboarding_status_check;
--   alter table public.profiles
--     drop column if exists onboarding_status_at;
--   alter table public.profiles
--     drop column if exists onboarding_status;
--   commit;
