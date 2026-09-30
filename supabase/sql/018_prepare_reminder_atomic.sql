-- =============================================================================
-- Migration 018: prepare_reminder_atomic()
-- =============================================================================
--
-- ⚠ DRAFTED FOR REVIEW. NOT YET APPLIED ANYWHERE — not to production, not
-- even to a local harness — and NOT YET WIRED UP BY APPLICATION CODE. This
-- header follows the same convention migration 017 used for the same
-- reason: authoring and application are separate, deliberate steps.
--
-- THIS MIGRATION DOES NOT DEPEND ON MIGRATION 017. It calls
-- update_invoice_with_refresh nowhere, and does not assume that function's
-- 6-argument (017) signature exists — the captured production baseline this
-- was designed against still has the 5-argument (migration 012) signature.
-- generated_sender_name is written here directly, using the column migration
-- 015 already added; that is unrelated to 017, which only concerns keeping
-- that column in step with the INVOICE EDIT/refresh path, a different
-- feature entirely.
--
-- THE GAP THIS CLOSES
--
-- app/api/reminders/prepare/route.ts today makes its eligibility decision
-- (lib/reminder-schedule.ts's prepareEligibility/scheduleToPrepare) from an
-- UNLOCKED read of the invoice, then performs three separate, unguarded
-- writes: INSERT reminder_logs, then (service-role) INSERT x2 into
-- reminder_channel_messages via persistGeneratedContent. Every one of those
-- steps can be individually stale or individually fail:
--
--   - the eligibility decision can be based on an invoice that a concurrent
--     edit or archive changes before the INSERT lands;
--   - persistGeneratedContent's failure is DELIBERATELY non-fatal (see its
--     own comment: "must not fail the request or lose the reminder"), which
--     means a reminder_logs row can persist with ZERO channel rows and the
--     request still reports success;
--   - two concurrent Prepare calls for the same invoice have no lock
--     ordering at all between them beyond the UNIQUE(invoice_id, schedule)
--     constraint's own conflict handling.
--
-- This function closes all three: ONE transaction locks the invoice first,
-- makes the eligibility decision from the LOCKED row's own columns (never
-- from a caller-supplied belief about what they are), and then creates or
-- revives the reminder AND both channel rows together, proving the pair
-- exists before returning success. Any failure anywhere rolls back
-- everything — there is no state in which a parent reminder exists without
-- both an email and an SMS row.
--
-- ── LOCK ORDER ───────────────────────────────────────────────────────────
--
-- invoice FOR UPDATE, then reminder_logs rows FOR UPDATE — the same order
-- archive_invoice_safely, update_invoice_with_refresh and
-- enforce_invoice_deletable already use (migration 012). Two transactions
-- taking the same two locks in the same order cannot deadlock on each
-- other; this is why the order is invariant across every function in this
-- product that touches both tables.
--
-- Because Prepare calls for the SAME invoice all take that invoice lock
-- FIRST, they fully serialise against each other: a second concurrent call
-- blocks on the first call's invoice lock and does not resume until the
-- first commits or rolls back. When it resumes, it re-reads reminder_logs
-- under ITS OWN lock and finds whatever the first call left — so a genuine
-- (invoice_id, schedule) unique-constraint race is not reachable from two
-- calls to this function; the lock ordering itself is what "handles
-- duplicate concurrent Prepare calls deterministically" (no
-- exception-catching insert-and-retry loop is needed here, unlike
-- claim_reminder_allowance in migration 011, which contends across MANY
-- reminders sharing one user's slot pool rather than serialising on a
-- single invoice row).
--
-- ── THE AUTHORITATIVE DECISION DATE ─────────────────────────────────────
--
-- Captured ONCE, immediately after the invoice lock is acquired, and reused
-- for the entire eligibility and candidate-schedule decision:
--
--     v_today := (clock_timestamp() at time zone 'Europe/London')::date;
--
-- clock_timestamp(), not statement_timestamp() or now() — this must be the
-- real wall-clock instant AFTER the lock is granted, not the time the
-- calling statement began (which could be stale by however long this
-- transaction waited for the lock). Called exactly once; nothing below
-- calls it again. "Authoritative" here means "as of one post-lock
-- serialised decision timestamp" — not "as of commit time", which
-- PostgreSQL cannot give a running function anyway.
--
-- EUROPE/LONDON, NOT UTC. This is deliberate and matches the application's
-- own single source of truth: lib/date-status.ts's getTodayLondonDate(),
-- which every eligibility computation in this product (prepareEligibility,
-- scheduleToPrepare, and everything the dashboard displays) is built on,
-- states plainly: "'Today' is a Europe/London calendar date (no UTC
-- drift)." Using UTC here would make this function disagree with its own
-- TypeScript counterpart for up to an hour a day during BST — exactly the
-- parity this migration exists to guarantee, not break.
--
-- ── WHY CONTENT IS SUPPLIED, NOT GENERATED HERE ─────────────────────────
--
-- Same reasoning as update_invoice_with_refresh (migration 012) and
-- regenerate_reminder_identity (migration 016): reminder wording is
-- application logic (tone, schedule phrasing, SMS length rules), and
-- reimplementing it in PL/pgSQL would create a second generator to keep in
-- step with lib/reminder-content.ts. The caller supplies pre-generated
-- content for EVERY schedule (p_content, keyed by schedule name) rather
-- than only the one it guesses will be eligible, because the eligible
-- schedule is not authoritatively known until AFTER the lock is taken —
-- passing all five candidates (cheap, pure string generation, no I/O) is
-- what lets the content decision and the eligibility decision both be made
-- from data at rest in this one transaction, with no second round trip.
--
-- ── WHY THE CHANNEL-PAIR WRITE IS FACTORED INTO A HELPER ────────────────
--
-- prepare_reminder_ensure_channel_pair() is called from THREE branches
-- below (fresh creation, revival of a dismissed/failed row, and the
-- already-pending idempotent return) because all three must guarantee the
-- same invariant: exactly one email row and exactly one SMS row. Writing
-- that insert-and-prove logic three times would let a future fix land in
-- one copy and not the others — exactly the kind of drift this product's
-- existing migrations (see migration 016's very similar reasoning) go out
-- of their way to avoid. It is a private helper: revoked from every
-- app-facing role, callable only from within this function's own
-- SECURITY DEFINER context (an object owner always retains implicit
-- privileges on functions it owns, regardless of REVOKE ALL FROM PUBLIC).
--
-- ── REVIVE SEMANTICS, PROVEN FROM THE EXISTING ROUTE, NOT INVENTED ──────
--
-- app/api/reminders/prepare/route.ts today:
--   - status = 'pending'              -> returns the existing row as-is
--                                         (idempotent, no allowance spent)
--   - status in ('dismissed','failed') -> revives to 'pending', touching
--                                         ONLY status/error_message/
--                                         sent_at/email_to — NEVER
--                                         generated_sender_name and NEVER
--                                         the stored channel content, which
--                                         is left exactly as originally
--                                         generated
--   - any other status (sent, sending, delivery_unknown, undelivered)
--                                      -> refused, "already been sent"
--
-- This function reproduces exactly that branching and exactly that set of
-- touched columns on revive. It does NOT regenerate channel content or
-- generated_sender_name on revive, because the existing application code
-- provably does not either — inventing that would be a new, unproven
-- behaviour change smuggled into an "atomicity" migration. What IS new here
-- is that all three branches now also close the historical silent
-- channel-row-loss gap: even a pre-existing 'pending' or revived
-- 'dismissed'/'failed' row that predates this migration and is missing one
-- or both channel rows (because persistGeneratedContent's old failure was
-- deliberately non-fatal) gets its missing row(s) filled in, using the
-- caller-supplied content for that schedule, before this function returns
-- success. This is exactly what Task D asks this migration to make
-- structurally impossible going forward, applied uniformly rather than
-- only on the fresh-creation path.
--
-- ── ALLOWANCE ────────────────────────────────────────────────────────────
--
-- This function NEVER calls claim_reminder_allowance and NEVER inserts
-- into reminder_allowance_slots. It only READS the current count, and only
-- to refuse (informationally, as 'allowance_exhausted') the two branches
-- that would create new send capacity — a fresh reminder or a revival —
-- exactly mirroring the UX-only "preflight" the route performed before
-- this migration (lib/allowance-preflight.ts), which is documented there
-- as "fails open... the authoritative cap is the atomic slot claim at send
-- time". Moving that same read inside this transaction makes it more
-- correct than before (no gap between the read and the decision it gates),
-- not less — it does not change what gets refused or why. The
-- authoritative cap remains claim_reminder_allowance, called only at
-- Approve/Send.
--
-- =============================================================================

-- ── Private helper: prove the channel pair, filling in only what is missing ─
--
-- Idempotent by ON CONFLICT DO NOTHING on the (reminder_log_id, channel)
-- unique index (migration 010) — an already-existing channel row (from an
-- earlier, successful preparation, possibly with an owner's edit already on
-- it) is never touched, let alone overwritten. Only a genuinely missing row
-- is inserted. Raises — rolling back the ENTIRE calling transaction,
-- reminder_logs write included — if, after the insert, the pair is not
-- proven to be exactly one of each. No caller of this helper may proceed
-- past it with an incomplete pair.
BEGIN;
create or replace function public.prepare_reminder_ensure_channel_pair(
  p_reminder_id    uuid,
  p_user_id        uuid,
  p_email_subject  text,
  p_email_body     text,
  p_sms_body       text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_email_count integer;
  v_sms_count   integer;
begin
  insert into public.reminder_channel_messages
    (reminder_log_id, user_id, channel, generated_subject, generated_body)
  values
    (p_reminder_id, p_user_id, 'email', p_email_subject, p_email_body),
    (p_reminder_id, p_user_id, 'sms',   null,             p_sms_body)
  on conflict (reminder_log_id, channel) do nothing;

  select count(*) filter (where channel = 'email'),
         count(*) filter (where channel = 'sms')
    into v_email_count, v_sms_count
    from public.reminder_channel_messages
   where reminder_log_id = p_reminder_id
     and user_id = p_user_id;

  if v_email_count <> 1 or v_sms_count <> 1 then
    raise exception
      'reminder % has % email / % sms channel rows; exactly one of each is required',
      p_reminder_id, v_email_count, v_sms_count
      using errcode = '23514',
            hint = 'Prepare was rolled back. Neither the parent reminder nor its channels were left in an inconsistent state.';
  end if;
end;
$$;

comment on function public.prepare_reminder_ensure_channel_pair(uuid, uuid, text, text, text) is
  'Private helper for prepare_reminder_atomic. Inserts any MISSING channel row (never overwrites an existing one) then proves exactly one email and one sms row exist, raising (rolling back the whole calling transaction) otherwise. Not for direct use — revoked from every app-facing role.';

revoke all on function public.prepare_reminder_ensure_channel_pair(uuid, uuid, text, text, text) from public;
revoke all on function public.prepare_reminder_ensure_channel_pair(uuid, uuid, text, text, text) from anon, authenticated, service_role;

-- =============================================================================
-- The atomic Prepare RPC
-- =============================================================================
--
-- p_content is a JSON OBJECT keyed by schedule name, one entry per schedule
-- the caller has pre-generated content for (the caller is expected to
-- supply all five — before_due_3_days, due_today, overdue_3_days,
-- overdue_7_days, overdue_14_days — since which one is authoritatively
-- eligible is not known until after the lock). Each value:
--   { "email_subject": text, "email_body": text, "sms_body": text }
--
-- Returns exactly one row. `outcome` vocabulary:
--
--   not_found            no such invoice for this (id, user_id)
--   invoice_archived      invoice is archived (checked fresh, under the
--                          lock — closes the same read-then-write race
--                          enforce_reminder_not_archived closes for the
--                          cron, see migration 012)
--   already_paid           invoice.status = 'paid'
--   no_customer_email      invoice.customer_email is null/blank
--   none_selected           invoice.reminder_schedules is empty
--   all_sent                every selected schedule is already in
--                            reminders_sent
--   not_yet_due             schedules remain, but none has been reached yet
--                            as of the authoritative decision date
--                            (eligible_from is set)
--   allowance_exhausted     the account's Founding Beta allowance is fully
--                            reserved/consumed; would-be creation or
--                            revival refused (informational read only —
--                            see the header note on allowance)
--   not_revivable           a reminder for the winning schedule already
--                            exists and is dispatched or in flight (sent,
--                            sending, delivery_unknown, undelivered)
--   already_pending         a reminder for the winning schedule already
--                            exists and is pending — returned as-is
--                            (idempotent, nothing charged)
--   revived                 an existing dismissed/failed reminder for the
--                            winning schedule was revived to pending
--   created                 a brand-new reminder (and both channel rows)
--                            was created
--
-- reminder_id and schedule are set for every outcome from not_revivable
-- onward; eligible_from is set only for not_yet_due; allowance_used /
-- allowance_cap are always returned (current values) for caller visibility,
-- even on outcomes where they were not the deciding factor.

create or replace function public.prepare_reminder_atomic(
  p_invoice_id            uuid,
  p_user_id               uuid,
  p_generated_sender_name text,
  p_content               jsonb
)
returns table (
  outcome         text,
  reminder_id     uuid,
  schedule        text,
  eligible_from   date,
  allowance_used  integer,
  allowance_cap   integer
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_archived        timestamptz;
  v_invoice_status  text;
  v_customer_email  text;
  v_selected        text[];
  v_sent            text[];
  v_due_date        date;
  v_today           date;
  v_days            integer;
  v_schedule        text;
  v_unsent_count    integer;
  v_min_offset      integer;
  v_eligible_from   date;
  v_existing_id     uuid;
  v_existing_status text;
  v_used            integer;
  v_allowance       integer;
  v_reminder_id     uuid;
  v_email_subject   text;
  v_email_body      text;
  v_sms_body        text;
begin
  -- ── OWNERSHIP ──────────────────────────────────────────────────────────
  --
  -- ⚠ THERE IS DELIBERATELY NO auth.uid() CHECK HERE — the same reasoning as
  -- every other multi-table SECURITY DEFINER function in this product
  -- (migrations 012, 016). This function is granted to service_role only
  -- and is called through the service-role client, where auth.uid() is
  -- always NULL. The real chain: the route authenticates the session
  -- server-side, reads userId from THAT (never the request body), and
  -- passes it here as p_user_id. Every statement below is scoped
  -- `and user_id = p_user_id`, so a mismatched invoice id matches no row.

  -- ── LOCK THE INVOICE FIRST ────────────────────────────────────────────
  select archived_at, status, customer_email, reminder_schedules,
         reminders_sent, due_date
    into v_archived, v_invoice_status, v_customer_email, v_selected,
         v_sent, v_due_date
    from public.invoices
   where id = p_invoice_id and user_id = p_user_id
   for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::date, null::integer, null::integer;
    return;
  end if;

  if v_archived is not null then
    return query select 'invoice_archived'::text, null::uuid, null::text, null::date, null::integer, null::integer;
    return;
  end if;

  if v_invoice_status = 'paid' then
    return query select 'already_paid'::text, null::uuid, null::text, null::date, null::integer, null::integer;
    return;
  end if;

  if v_customer_email is null or btrim(v_customer_email) = '' then
    return query select 'no_customer_email'::text, null::uuid, null::text, null::date, null::integer, null::integer;
    return;
  end if;

  if coalesce(cardinality(v_selected), 0) = 0 then
    return query select 'none_selected'::text, null::uuid, null::text, null::date, null::integer, null::integer;
    return;
  end if;

  -- ── THE ONE AUTHORITATIVE POST-LOCK DECISION DATE ────────────────────
  --
  -- clock_timestamp(), called exactly once, AFTER the lock above is held.
  -- Europe/London, matching lib/date-status.ts's getTodayLondonDate() — see
  -- the migration header for why. Reused for the entire eligibility and
  -- candidate-schedule decision below; nothing after this line calls
  -- clock_timestamp() again.
  v_today := (clock_timestamp() at time zone 'Europe/London')::date;
  v_days  := v_today - v_due_date;

  -- ── ELIGIBILITY, REPLICATING lib/reminder-schedule.ts EXACTLY ────────
  --
  -- SCHEDULE_DAY (the fixed five checkpoints) as a literal VALUES list —
  -- this table never changes independently of the TypeScript union it
  -- mirrors, so it is inlined rather than stored.
  --
  -- unsent = selected minus already-sent. "Reached" = the unsent schedule
  -- with the LARGEST day-offset that is <= v_days (the furthest-along
  -- checkpoint today has reached or passed) — exactly
  -- scheduleToPrepare()'s `reached[reached.length - 1]`, since
  -- SCHEDULE_CHRONOLOGY is ascending by day-offset.
  select
    (select sd.schedule
       from (values
               ('before_due_3_days', -3, 1),
               ('due_today',          0, 2),
               ('overdue_3_days',     3, 3),
               ('overdue_7_days',     7, 4),
               ('overdue_14_days',   14, 5)
            ) as sd(schedule, day_offset, ord)
      where sd.schedule = any(v_selected)
        and not (sd.schedule = any(coalesce(v_sent, array[]::text[])))
        and sd.day_offset <= v_days
      order by sd.ord desc
      limit 1),
    (select count(*)
       from (values
               ('before_due_3_days', -3, 1),
               ('due_today',          0, 2),
               ('overdue_3_days',     3, 3),
               ('overdue_7_days',     7, 4),
               ('overdue_14_days',   14, 5)
            ) as sd(schedule, day_offset, ord)
      where sd.schedule = any(v_selected)
        and not (sd.schedule = any(coalesce(v_sent, array[]::text[])))),
    (select min(sd.day_offset)
       from (values
               ('before_due_3_days', -3, 1),
               ('due_today',          0, 2),
               ('overdue_3_days',     3, 3),
               ('overdue_7_days',     7, 4),
               ('overdue_14_days',   14, 5)
            ) as sd(schedule, day_offset, ord)
      where sd.schedule = any(v_selected)
        and not (sd.schedule = any(coalesce(v_sent, array[]::text[]))))
    into v_schedule, v_unsent_count, v_min_offset;

  -- unsent.length === 0 is checked FIRST, exactly matching
  -- prepareEligibility()'s own ordering (checked before scheduleToPrepare
  -- is even consulted).
  if v_unsent_count = 0 then
    return query select 'all_sent'::text, null::uuid, null::text, null::date, null::integer, null::integer;
    return;
  end if;

  if v_schedule is null then
    -- Nothing reached yet. NOT eligible — see reminder-schedule.ts's own
    -- safety note (v8.9.2) on why this must never fall back to unsent[0].
    v_eligible_from := v_due_date + v_min_offset;
    return query select 'not_yet_due'::text, null::uuid, null::text, v_eligible_from, null::integer, null::integer;
    return;
  end if;

  -- ── LOCK EVERY REMINDER FOR THIS INVOICE ─────────────────────────────
  --
  -- invoice -> reminders, the same order as archive_invoice_safely,
  -- update_invoice_with_refresh and enforce_invoice_deletable (migration
  -- 012). Locking ALL rows, not merely the one matching v_schedule,
  -- matches enforce_invoice_deletable's own reasoning: the row that
  -- matters is exactly the one a concurrent transaction might be about to
  -- change.
  perform 1 from public.reminder_logs
   where invoice_id = p_invoice_id and user_id = p_user_id
   for update;

  select id, status
    into v_existing_id, v_existing_status
    from public.reminder_logs
   where invoice_id = p_invoice_id
     and user_id = p_user_id
     and reminder_logs.schedule = v_schedule;

  -- ── THE CONTENT FOR THE WINNING SCHEDULE, FROM WHAT THE CALLER SUPPLIED
  --
  -- A missing entry is a caller contract violation (the caller is expected
  -- to have generated content for every schedule in the invoice's
  -- reminder_schedules), not a user-facing state — raised, not returned as
  -- an outcome.
  v_email_subject := p_content -> v_schedule ->> 'email_subject';
  v_email_body    := p_content -> v_schedule ->> 'email_body';
  v_sms_body      := p_content -> v_schedule ->> 'sms_body';

  if v_email_subject is null or v_email_body is null or v_sms_body is null then
    raise exception
      'prepare_reminder_atomic: caller did not supply generated content for schedule %', v_schedule
      using errcode = '22023';
  end if;

  if p_generated_sender_name is null or btrim(p_generated_sender_name) = '' then
    raise exception
      'prepare_reminder_atomic: p_generated_sender_name must not be blank'
      using errcode = '22023';
  end if;

  -- ── ALLOWANCE — READ ONLY, NEVER CLAIMED HERE. See migration header. ──
  select count(*) into v_used
    from public.reminder_allowance_slots
   where user_id = p_user_id;
  v_allowance := public.founding_beta_allowance();

  if v_existing_id is not null then
    if v_existing_status = 'pending' then
      -- Idempotent: nothing charged, nothing about reminder_logs changes.
      -- Still closes the historical channel-row-loss gap for THIS row.
      perform public.prepare_reminder_ensure_channel_pair(
        v_existing_id, p_user_id, v_email_subject, v_email_body, v_sms_body
      );
      return query select 'already_pending'::text, v_existing_id, v_schedule, null::date, v_used, v_allowance;
      return;
    end if;

    if v_existing_status in ('dismissed', 'failed') then
      -- Reviving is creation from the allowance's point of view — see
      -- app/api/reminders/prepare/route.ts's own comment on this exact
      -- point, reproduced here: a dismissed or failed row becoming a
      -- sendable draft again needs the same protection as a fresh insert.
      if v_used >= v_allowance then
        return query select 'allowance_exhausted'::text, null::uuid, v_schedule, null::date, v_used, v_allowance;
        return;
      end if;

      -- ONLY status/error_message/sent_at/email_to — never
      -- generated_sender_name, never the stored channel content. See the
      -- migration header's "REVIVE SEMANTICS" note: this is exactly what
      -- the existing route does today, not a new behaviour.
      update public.reminder_logs
         set status        = 'pending',
             error_message = null,
             sent_at       = null,
             email_to      = v_customer_email
       where id = v_existing_id and user_id = p_user_id;

      perform public.prepare_reminder_ensure_channel_pair(
        v_existing_id, p_user_id, v_email_subject, v_email_body, v_sms_body
      );
      return query select 'revived'::text, v_existing_id, v_schedule, null::date, v_used, v_allowance;
      return;
    end if;

    -- sent / sending / delivery_unknown / undelivered — dispatched or
    -- in-flight, never revivable. Matches the route's existing fallback
    -- exactly (same outcome for all four statuses, same as today).
    return query select 'not_revivable'::text, v_existing_id, v_schedule, null::date, v_used, v_allowance;
    return;
  end if;

  -- ── BRAND NEW REMINDER ────────────────────────────────────────────────
  if v_used >= v_allowance then
    return query select 'allowance_exhausted'::text, null::uuid, v_schedule, null::date, v_used, v_allowance;
    return;
  end if;

  -- subject is the fixed display placeholder the route has always used —
  -- NOT the generated email subject (that lives on the email channel row,
  -- see below). Preserved verbatim from app/api/reminders/prepare/route.ts.
  insert into public.reminder_logs
    (invoice_id, user_id, schedule, status, email_to, subject, generated_sender_name)
  values
    (p_invoice_id, p_user_id, v_schedule, 'pending', v_customer_email,
     'Reminder: invoice from your business', p_generated_sender_name)
  returning id into v_reminder_id;

  perform public.prepare_reminder_ensure_channel_pair(
    v_reminder_id, p_user_id, v_email_subject, v_email_body, v_sms_body
  );

  return query select 'created'::text, v_reminder_id, v_schedule, null::date, v_used, v_allowance;
end;
$$;

comment on function public.prepare_reminder_atomic(uuid, uuid, text, jsonb) is
  'Atomically decides eligibility (locked invoice, one post-lock Europe/London decision date) and creates or revives exactly one logical reminder with exactly one email and one sms channel row. Never claims a Founding Beta allowance slot. Lock order invoice -> reminder_logs, matching migration 012. See migration 018 header for full contract.';

revoke all on function public.prepare_reminder_atomic(uuid, uuid, text, jsonb) from public;
revoke all on function public.prepare_reminder_atomic(uuid, uuid, text, jsonb) from anon, authenticated;
grant execute on function public.prepare_reminder_atomic(uuid, uuid, text, jsonb) to service_role;
COMMIT;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
--
-- Deploy application code that no longer calls prepare_reminder_atomic
-- BEFORE dropping it — the same ordering every prior migration in this
-- directory uses.
--
--   begin;
--     drop function if exists public.prepare_reminder_atomic(uuid, uuid, text, jsonb);
--     drop function if exists public.prepare_reminder_ensure_channel_pair(uuid, uuid, text, text, text);
--   commit;
