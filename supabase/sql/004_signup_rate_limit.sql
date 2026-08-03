-- =============================================================================
-- ServiceSignal — beta-signup rate limiting
-- NOT RUN AUTOMATICALLY. Review and run manually in the Supabase SQL editor.
--
-- Why this exists
-- ---------------
-- POST /api/signup now SENDS EMAIL. Without a durable limiter the endpoint is
-- an open relay for one message type: an attacker can make ServiceSignal
-- deliver mail to any address they choose, at any rate, from the same domain
-- the reminder product depends on. Getting servicesignal.app blocklisted would
-- break the actual product, not just the landing page.
--
-- Durable, not in-memory: the app runs on serverless functions, so an
-- in-process counter is reset on every cold start and is not shared between
-- concurrent instances. It would look like protection without being any.
--
-- Privacy
-- -------
-- No raw IP address is stored. The application writes a salted SHA-256 hash,
-- so this table cannot be used to identify a visitor, and rows are disposable.
-- =============================================================================

create table if not exists public.signup_attempts (
  id          bigint generated always as identity primary key,
  ip_hash     text        not null,
  created_at  timestamptz not null default now()
);

-- The only query pattern: count recent attempts for one hash.
create index if not exists signup_attempts_ip_hash_created_at_idx
  on public.signup_attempts (ip_hash, created_at desc);

-- Cheap cleanup of expired rows.
create index if not exists signup_attempts_created_at_idx
  on public.signup_attempts (created_at);

-- RLS on with NO policies: every anon/authenticated request is denied. Only
-- the service-role key (used server-side in app/api/signup) bypasses RLS, so
-- this table is unreachable from the browser.
alter table public.signup_attempts enable row level security;

comment on table public.signup_attempts is
  'Salted IP hashes for beta-signup rate limiting. No raw IPs. Safe to purge.';

-- Optional housekeeping — rows older than a day have no further use.
-- Run manually, or schedule with pg_cron if it is enabled on the project:
--   delete from public.signup_attempts where created_at < now() - interval '1 day';
