-- =============================================================================
-- ServiceSignal — founding-beta email verification
-- Creates public.beta_verifications.
-- NOT RUN AUTOMATICALLY. Review and run manually in the Supabase SQL editor.
-- =============================================================================
--
-- WHY A SEPARATE TABLE RATHER THAN COLUMNS ON beta_signups
--
-- beta_signups has no migration in this repository (001 and 002 predate it and
-- were never committed), so its live schema is unversioned. Adding auth-
-- critical columns to a table whose baseline nobody can read from source is a
-- poor place to put security state.
--
-- A separate table also lets a verification be RE-ISSUED without touching the
-- lead record: a second row supersedes the first, and the applicant's original
-- submission is never mutated. One row per issued token, not one per applicant.
--
-- WHAT THIS REPLACES
--
-- Previously the journey verified email twice: the founding-beta email linked
-- straight to /signup, and Supabase then sent its own generic confirmation.
-- With this table, ServiceSignal verifies the address ONCE, before the account
-- exists, and the account is then created already-confirmed.

create table if not exists public.beta_verifications (
  id uuid primary key default gen_random_uuid(),

  -- The applicant this token was issued for. No FK to beta_signups: that
  -- table's schema is unversioned, so a hard reference could fail to create on
  -- an environment whose column types differ. The email below is the join key
  -- that actually matters, and it is what gets verified.
  beta_signup_email text not null,

  -- Carried so account setup can prefill without ever putting the value in a
  -- URL. Snapshotted at issue time deliberately: the account is created from
  -- what the applicant actually submitted and verified.
  business_name text,

  -- SHA-256 of the raw token, hex. The raw token exists only in the email
  -- link and is never stored — a database disclosure therefore does not yield
  -- usable verification links. Unique so a lookup is an indexed point read
  -- rather than a scan, and so the same token cannot be issued twice.
  token_hash text not null unique,

  -- Lifecycle. All nullable: a freshly issued row has none of them.
  --   verified_at   — the link was clicked and the address proven
  --   claimed_at    — a provisioning attempt is IN FLIGHT (see below)
  --   consumed_at   — the account exists; the token is permanently spent
  --   superseded_at — a newer token was issued for this email
  expires_at   timestamptz not null,
  verified_at  timestamptz,
  claimed_at   timestamptz,
  consumed_at  timestamptz,
  superseded_at timestamptz,

  -- WHY claimed_at IS SEPARATE FROM consumed_at
  --
  -- Creating the account spans two systems: this table (Postgres) and Supabase
  -- Auth. There is no transaction across them. Consuming the token before
  -- calling createUser meant a transient Auth failure permanently stranded a
  -- verified applicant holding a dead link.
  --
  -- claimed_at is a short-lived LEASE, not a terminal state. One request takes
  -- it, attempts provisioning, and either consumes (success) or releases
  -- (failure). A crashed request leaves a stale claim that simply expires, so
  -- the applicant can retry. Only consumed_at is permanent, and it is written
  -- only once the account is known to exist.

  -- Bounded guessing. Incremented on every failed lookup against this row's
  -- email so a token cannot be brute-forced by repeated requests.
  attempts int not null default 0,

  created_at timestamptz not null default now()
);

-- Point lookup by token hash is the hot path (every click on a link).
create index if not exists beta_verifications_token_hash_idx
  on public.beta_verifications (token_hash);

-- Finding the live token for an address when re-issuing. Plain column, because
-- the application always lowercases before writing and before querying, so the
-- lookups are equality on the stored value.
create index if not exists beta_verifications_email_idx
  on public.beta_verifications (beta_signup_email);

-- ── AT MOST ONE ACTIVE VERIFICATION PER ADDRESS ──────────────────────────
--
-- The application supersedes earlier tokens before inserting a new one, but
-- that is two statements: two concurrent re-issues can both supersede, then
-- both insert, leaving TWO usable tokens for one email. Application ordering
-- cannot fix that on its own — only the database can.
--
-- This partial unique index makes the second insert fail with 23505 instead.
-- issueVerification() catches that, re-supersedes and retries once, so the
-- end state is always exactly one active row.
--
-- lower() rather than the plain column: the code lowercases everything it
-- writes, but this constraint is the last line of defence and should not
-- depend on that continuing to be true.
create unique index if not exists beta_verifications_one_active_per_email
  on public.beta_verifications (lower(beta_signup_email))
  where consumed_at is null and superseded_at is null;

-- ── RLS ──────────────────────────────────────────────────────────────────
--
-- Enabled with NO policies, deliberately.
--
-- Every row here is written and read by server code holding the service-role
-- key, which bypasses RLS. Anonymous and authenticated clients must never
-- touch this table directly — a browser that could read it could read token
-- hashes and enumerate which addresses have pending invitations. RLS on with
-- zero policies is the strongest possible statement of that: the anon and
-- authenticated roles can do nothing at all.
alter table public.beta_verifications enable row level security;

-- =============================================================================
-- NOTES
-- =============================================================================
--
-- RELATIONSHIP TO OTHER MIGRATIONS. None. 003 and 005 alter public.profiles,
-- 004 creates public.signup_attempts. This creates a table none of them
-- reference, so it may be applied in any order relative to them.
--
-- EXPIRY. Enforced in application code against expires_at rather than by a
-- scheduled job, so an expired row still exists and can be reported to the
-- user as "this link has expired" instead of "invalid link". A periodic
-- cleanup of rows older than, say, 30 days is optional housekeeping and is
-- deliberately NOT automated here.
--
-- =============================================================================
-- ROLLBACK
-- =============================================================================
--
-- Discards all pending verifications: anyone mid-journey would need a new
-- invitation. Already-created accounts are unaffected — they live in
-- auth.users and public.profiles, not here.
--
--   drop table if exists public.beta_verifications;
