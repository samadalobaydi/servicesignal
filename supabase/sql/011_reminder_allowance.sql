-- =============================================================================
-- ServiceSignal — Founding Beta reminder allowance (hard cap)
-- NOT RUN AUTOMATICALLY. Review and run manually in the Supabase SQL editor.
-- NOT YET APPLIED TO ANY REMOTE PROJECT.
--
-- ⚠ .env.local currently points at the project identified as "main — PRODUCTION".
--   Read this file in full before running it anywhere.
-- =============================================================================
--
-- WHY THE APPLICATION CANNOT DO THIS ALONE
-- ----------------------------------------
-- The allowance cap is a per-USER resource. The existing concurrency primitive
-- in app/api/reminders/[id]/approve is a conditional UPDATE on one
-- reminder_logs row:
--
--     update reminder_logs set status = 'sending', send_attempt_count = n+1
--      where id = ? and status in (...) and send_attempt_count = n
--
-- That makes exactly one caller win FOR ONE REMINDER. It says nothing at all
-- about two DIFFERENT reminders. At 9 of 10 consumed:
--
--     request A  →  claims reminder X   (its own row, succeeds)
--     request B  →  claims reminder Y   (a different row, also succeeds)
--     both read "used = 9", both believe one slot remains, both send
--     → the customer received 11 free reminders
--
-- Counting rows in the application and then acting on the count is the classic
-- read-then-write race, and no amount of care in TypeScript closes it: the two
-- requests can be in different serverless instances, in different regions, at
-- the same microsecond. The decision has to be made once, by the one component
-- both requests share — Postgres.
--
-- THE MECHANISM
-- -------------
-- A slot table where each of the ten allowance units is a NUMBERED row, and
-- `unique (user_id, slot_number)` is the thing that decides the race.
--
--   - Two racers at 9 of 10 both compute "the lowest free slot is 10".
--   - Both attempt `insert ... (user_id, 10)`.
--   - Postgres accepts exactly one. The other raises unique_violation.
--   - The loser recomputes, finds no free slot, and is told `exhausted`.
--
-- The database is not being asked to be careful. It is being asked to enforce
-- a constraint, which it cannot fail to do.
--
-- WHY SLOT NUMBERS RATHER THAN A COUNTER COLUMN
-- ---------------------------------------------
-- `update ... set consumed = consumed + 1 where consumed < 10` would also be
-- atomic, but it stores a number instead of facts. It cannot say WHICH
-- reminders consumed the allowance, cannot be audited against reminder_logs,
-- and silently becomes wrong forever if any code path ever forgets to
-- decrement. Here, `used` is `count(*)` over rows that each name their
-- reminder — so the number is always reconstructible from evidence.
--
-- WHY reminder_log_id IS THE PRIMARY KEY
-- --------------------------------------
-- This is the no-double-charge guarantee, and it is structural rather than
-- procedural. One logical reminder can hold at most one slot because the
-- database will not store a second row for it. Every retry path in the
-- product — a transport retry, a duplicate approval request, a browser
-- re-submit, a provider retry, a reconciliation pass, a per-channel retry —
-- names the same reminder_logs.id, so all of them collapse onto one slot.
--
-- The SMS and the email of one reminder are rows in reminder_channel_messages,
-- a CHILD of reminder_logs. Neither is named here. There is no expressible way
-- for a channel to consume allowance.
--
-- DEPENDS ON: migration 010, which added
--     alter table public.reminder_logs add constraint reminder_logs_id_user_key
--       unique (id, user_id);
-- The composite foreign key below needs it.
-- =============================================================================

-- ── The slot table ─────────────────────────────────────────────────────────

create table if not exists public.reminder_allowance_slots (
  -- One slot per LOGICAL reminder. Not per channel, not per attempt, not per
  -- delivery. A second insert for the same reminder is rejected by the
  -- database, which is what makes retries free.
  reminder_log_id uuid primary key,

  user_id uuid not null,

  -- Which of the N allowance units this reminder is holding. The value carries
  -- no meaning beyond being the token two concurrent requests must compete
  -- for; `used` is always count(*), never max(slot_number).
  slot_number integer not null check (slot_number >= 1),

  claimed_at timestamptz not null default now(),

  -- ── THE RACE GUARD ────────────────────────────────────────────────────
  -- Two simultaneous requests that both compute the same free slot cannot
  -- both insert. This single constraint is the entire concurrency argument.
  constraint reminder_allowance_slots_user_slot_key unique (user_id, slot_number),

  -- ── OWNERSHIP INVARIANT ───────────────────────────────────────────────
  -- The same defence migration 010 established for channel rows. With two
  -- independent foreign keys nothing would connect them, and a row could name
  -- User A's reminder while claiming User B's allowance — draining someone
  -- else's credits, or hiding your own usage under another account.
  -- MATCH FULL, so a partially-NULL pair cannot slip past.
  constraint reminder_allowance_slots_owner_fk
    foreign key (reminder_log_id, user_id)
    references public.reminder_logs (id, user_id)
    match full
    on delete cascade
);

comment on table public.reminder_allowance_slots is
  'One row per logical reminder that holds or has consumed a Founding Beta allowance unit. used = count(*) per user. Written ONLY by claim_reminder_allowance / release_reminder_allowance.';

-- The only query patterns: count per user, and look up by reminder.
create index if not exists reminder_allowance_slots_user_idx
  on public.reminder_allowance_slots (user_id);

-- ── RLS: readable by the owner, writable by nobody ─────────────────────────
--
-- There are deliberately NO insert/update/delete policies. Even with a valid
-- session, a user cannot add themselves a slot, renumber one, or delete one to
-- win back a credit. The only writers are the SECURITY DEFINER functions
-- below, which apply the rules. The read policy exists so the Overview banner
-- can count the user's own slots directly.
--
-- NOT "force row level security", and that is deliberate. FORCE applies RLS to
-- the table OWNER as well, which is the role the SECURITY DEFINER functions
-- run as — the claim, release and trigger functions would all start failing
-- against their own table. The owner bypassing RLS is exactly what makes those
-- functions the only write path.

alter table public.reminder_allowance_slots enable row level security;

drop policy if exists "own allowance slots are readable" on public.reminder_allowance_slots;
create policy "own allowance slots are readable"
  on public.reminder_allowance_slots
  for select
  using (auth.uid() = user_id);

-- ── The allowance itself ───────────────────────────────────────────────────
--
-- ⚠ SECURITY FIX — BYPASS #1. This function exists because the cap used to be
-- a PARAMETER of claim_reminder_allowance:
--
--     claim_reminder_allowance(p_reminder_log_id, p_user_id, p_allowance)
--                                                            ^^^^^^^^^^^
--
-- and that function is granted to `authenticated`. Any logged-in user could
-- open a console and call it directly with a cap of their choosing:
--
--     supabase.rpc('claim_reminder_allowance', {
--       p_reminder_log_id: <their own 11th reminder>,
--       p_user_id: <their own id>,
--       p_allowance: 9999,          -- ← the cap, supplied by the attacker
--     })
--
-- That returns `claimed` and writes slot 11. The user then presses Approve
-- normally. The server calls claim with the real cap of 10, finds the reminder
-- ALREADY HOLDS a slot, returns `already_held` — which is not `exhausted` —
-- and the send proceeds. Repeat for unlimited free reminders.
--
-- The whole cap was defeated by one number in a request body. A limit is not a
-- limit if the person it constrains gets to pass it in.
--
-- The value now lives here, server-side, and no caller can influence it.
-- Callers receive it in the result rather than supplying it, so the
-- application displays whatever the database says.

create or replace function public.founding_beta_allowance()
returns integer
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$ select 10 $$;

comment on function public.founding_beta_allowance() is
  'The Founding Beta reminder allowance. Server-side and not caller-supplied — see the security note in migration 011.';

-- ── Claim ──────────────────────────────────────────────────────────────────

create or replace function public.claim_reminder_allowance(
  p_reminder_log_id uuid,
  p_user_id uuid
)
returns table (outcome text, used integer, allowance integer)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_slot      integer;
  v_tries     integer := 0;
  v_allowance integer := public.founding_beta_allowance();
begin
  -- ── Authorisation ──────────────────────────────────────────────────────
  -- An authenticated caller may only ever spend their OWN allowance. The
  -- daily cron runs as service_role, where auth.uid() is null; that is a
  -- trusted server process acting on a user's behalf and is allowed to pass
  -- an explicit p_user_id.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- The reminder must actually belong to the user whose allowance is being
  -- spent. Without this a caller could name someone else's reminder and the
  -- composite FK would reject the insert with a confusing constraint error
  -- rather than a clear refusal.
  if not exists (
    select 1 from public.reminder_logs r
     where r.id = p_reminder_log_id and r.user_id = p_user_id
  ) then
    raise exception 'reminder not found' using errcode = '42501';
  end if;

  -- ── Idempotency ────────────────────────────────────────────────────────
  -- This reminder already holds a slot: a retry, a duplicate request, a
  -- re-submit. It stays at one. No second unit is spent.
  if exists (
    select 1 from public.reminder_allowance_slots s
     where s.reminder_log_id = p_reminder_log_id
  ) then
    return query
      select 'already_held'::text,
             (select count(*)::integer from public.reminder_allowance_slots
               where user_id = p_user_id),
             v_allowance;
    return;
  end if;

  loop
    v_tries := v_tries + 1;

    -- The LOWEST free slot, not max+1. Releases (see below) leave gaps, and
    -- max+1 would march past the allowance while units were still free —
    -- refusing a customer who had credits left.
    select min(g) into v_slot
      from generate_series(1, v_allowance) g
     where not exists (
       select 1 from public.reminder_allowance_slots s
        where s.user_id = p_user_id and s.slot_number = g
     );

    if v_slot is null then
      return query
        select 'exhausted'::text,
               (select count(*)::integer from public.reminder_allowance_slots
                 where user_id = p_user_id),
               v_allowance;
      return;
    end if;

    begin
      insert into public.reminder_allowance_slots (reminder_log_id, user_id, slot_number)
      values (p_reminder_log_id, p_user_id, v_slot);

      return query
        select 'claimed'::text,
               (select count(*)::integer from public.reminder_allowance_slots
                 where user_id = p_user_id),
               v_allowance;
      return;

    exception when unique_violation then
      -- Someone else got here first. Two distinct causes, and they need
      -- different answers:
      --
      --   PK violation   another request claimed a slot for THIS reminder in
      --                  the gap since the check above. Idempotent: report the
      --                  slot it now holds, do not spend another.
      --   (user, slot)   another request took this slot number for a DIFFERENT
      --                  reminder. Recompute and compete for the next one.
      if exists (
        select 1 from public.reminder_allowance_slots s
         where s.reminder_log_id = p_reminder_log_id
      ) then
        return query
          select 'already_held'::text,
                 (select count(*)::integer from public.reminder_allowance_slots
                   where user_id = p_user_id),
                 v_allowance;
        return;
      end if;

      -- Bounded. At most v_allowance rivals can take a slot from us before
      -- none is left, so this terminates; the margin exists so a pathological
      -- interleaving surfaces as an error rather than spinning.
      if v_tries > v_allowance + 5 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

comment on function public.claim_reminder_allowance(uuid, uuid) is
  'Atomically reserves one allowance unit for a logical reminder. Returns claimed | already_held | exhausted. Idempotent per reminder_log_id.';

-- ── Release ────────────────────────────────────────────────────────────────
--
-- Called on exactly one condition: a DEFINITE pre-acceptance failure, where
-- the email provider certainly never took the message. A customer must not
-- permanently lose a credit to a technical fault that reached nobody.
--
-- It is NOT called for an ambiguous outcome (delivery_unknown) or for a
-- provider-accepted delivery failure (undelivered). In both of those a
-- submission may well have happened, and handing the credit back would let a
-- repeatedly-ambiguous send become an unlimited free tier.
--
-- ⚠ SECURITY FIX — BYPASS #2. This function is granted to `authenticated` and
-- previously deleted the named slot unconditionally. The trigger below
-- enforces "consumed is final", but the trigger fires on reminder_logs — and
-- this function writes to the SLOT TABLE DIRECTLY, so it went straight past it:
--
--     supabase.rpc('release_reminder_allowance', {
--       p_reminder_log_id: <a reminder they already SENT>,
--       p_user_id: <their own id>,
--     })
--
-- One call per sent reminder and the ledger empties. Ten sends, ten refunds,
-- ten more sends, forever. The entire cap defeated from the browser console by
-- a user acting only on their own data — so no ownership check could have
-- caught it.
--
-- The status test below is the fix. It makes this function a strict SUBSET of
-- what the trigger already does: it can only delete a slot whose reminder is
-- in a NON-CONSUMING state, which is exactly the set the trigger would delete
-- for anyway. Calling it directly therefore grants no power that dismissing
-- the reminder would not.
--
-- 'sending' is excluded as well as the three consumed states. Releasing an
-- in-flight attempt is how a second request slips into the gap and an eleventh
-- reminder goes out.

create or replace function public.release_reminder_allowance(
  p_reminder_log_id uuid,
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_used integer;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  delete from public.reminder_allowance_slots s
   where s.reminder_log_id = p_reminder_log_id
     and s.user_id = p_user_id
     -- The reminder must be in a state that genuinely consumes nothing. Same
     -- rule as the trigger, same rule as releasesAllowance() in
     -- lib/beta-allowance.ts. Silent when it does not match: a refusal to
     -- refund is not an error the caller needs to handle, and the legitimate
     -- callers only ever release after writing one of these statuses.
     and exists (
       select 1
         from public.reminder_logs r
        where r.id = s.reminder_log_id
          and r.user_id = s.user_id
          and r.status in ('pending', 'dismissed', 'failed')
     );

  select count(*)::integer into v_used
    from public.reminder_allowance_slots
   where user_id = p_user_id;

  return v_used;
end;
$$;

comment on function public.release_reminder_allowance(uuid, uuid) is
  'Returns one allowance unit after a definite pre-acceptance send failure. Never called for delivery_unknown or undelivered.';

-- ── The lifecycle invariant, enforced by the database ──────────────────────
--
-- THE DEFECT THIS CLOSES
--
-- A reminder can hold a reserved unit and then move to a state that means it
-- will never be sent. Releasing that unit from application code required
-- getting it right in FIVE separate places:
--
--   POST /api/reminders/[id]/dismiss          pending → dismissed
--   lib/invoices.ts markInvoicePaid           pending → dismissed (bulk)
--   POST /api/invoices/actions                pending → dismissed (bulk)
--   approve route, paid kill switch           pending → dismissed
--   lib/reminder-sender.ts (auto mode) ×3     sending → failed
--
-- Four of those are bare `update reminder_logs` statements with no service
-- layer to hook, two are bulk updates that never name a single reminder, and
-- the sixth path is whatever someone adds next month. Patching each by hand
-- produces a rule that is correct on the day it is written and quietly wrong
-- afterwards.
--
-- The invariant belongs where the status actually changes. This trigger fires
-- on every status transition of every reminder, from every code path that
-- exists or ever will, including a hand-run UPDATE in the SQL editor.
--
-- THE RULE (mirrored in releasesAllowance() in lib/beta-allowance.ts, and
-- asserted against this text by tests/allowance-lifecycle.test.ts):
--
--   consumed is FINAL     — leaving sent / delivery_unknown / undelivered
--                           never refunds. Something was handed to a provider
--                           that accepted it, and no later UI action un-sends
--                           it. Without this clause "dismiss after sending"
--                           would be an unlimited free tier.
--   'sending' KEEPS it    — an in-flight attempt must not drop its
--                           reservation, or a second request slips into the
--                           gap and an eleventh reminder goes out.
--   entering pending /
--   dismissed / failed    — releases, because the reminder is not going to
--                           consume anything.
--
-- Idempotent by construction: DELETE of a row that is not there is a no-op, so
-- dismissing twice releases once. Keyed on NEW.id, so it can only ever affect
-- the reminder whose status just changed — never another reminder's unit.

create or replace function public.sync_reminder_allowance_slot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  -- Consumed is final. Checked FIRST so no ordering of the clauses below can
  -- ever refund a reminder that was actually dispatched.
  if old.status in ('sent', 'delivery_unknown', 'undelivered') then
    return new;
  end if;

  if new.status in ('pending', 'dismissed', 'failed') then
    delete from public.reminder_allowance_slots
     where reminder_log_id = new.id;
  end if;

  return new;
end;
$$;

comment on function public.sync_reminder_allowance_slot() is
  'Returns a reserved allowance unit when a not-yet-consumed reminder enters pending/dismissed/failed. Never refunds a consumed reminder.';

drop trigger if exists reminder_logs_allowance_sync on public.reminder_logs;
create trigger reminder_logs_allowance_sync
  after update of status on public.reminder_logs
  for each row
  when (old.status is distinct from new.status)
  execute function public.sync_reminder_allowance_slot();

-- ── The dispatched-state invariant ─────────────────────────────────────────
--
-- A dispatched reminder can never become un-dispatched.
--
-- WHY THIS IS SEPARATE FROM THE LEDGER RULE ABOVE
--
-- sync_reminder_allowance_slot protects the LEDGER: a sent reminder keeps its
-- unit whatever happens to its status. Necessary, but not sufficient — RLS on
-- reminder_logs permits `auth.uid() = user_id` updates, so a user can run this
-- against their own row from the browser:
--
--     update reminder_logs set status = 'pending'
--      where id = '<one they already sent>';
--
-- The ledger correctly refuses to refund, so the CAP holds. But 'pending' is
-- in CLAIMABLE_STATUSES, so the reminder becomes approvable again — and
-- re-approving finds it already_held, spends nothing further, and delivers the
-- same message to the customer a second time. Unlimited SENDS for one unit.
--
-- That is a duplicate-delivery hole, and it is worse than an allowance hole:
-- the person receiving the repeats is the trade's customer, and this product
-- exists to be trusted with that relationship.
--
-- BEFORE, not AFTER, and it RAISES rather than corrects: the write must never
-- land. Fires ahead of the allowance sync, so an attempted regression aborts
-- the whole statement and the ledger is never consulted.
--
-- SECURITY INVOKER deliberately — it reads only OLD and NEW and touches no
-- table, so it needs no elevated rights. Least privilege for a function that
-- runs on every reminder status change in the product.
--
-- WHAT REMAINS ALLOWED: movement WITHIN the dispatched set. Reconciliation
-- does exactly that when the provider finally answers —
-- delivery_unknown → sent, delivery_unknown → undelivered, undelivered → sent.
-- And entering the set (sending → sent, sending → delivery_unknown) is
-- untouched, because OLD is not dispatched.

create or replace function public.enforce_dispatched_reminder_final()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.status in ('sent', 'delivery_unknown', 'undelivered')
     and new.status not in ('sent', 'delivery_unknown', 'undelivered') then
    raise exception
      'reminder % was already dispatched (%) and cannot return to ''%''',
      old.id, old.status, new.status
      using errcode = '23514',
            hint = 'A dispatched reminder cannot be made sendable again. Prepare a new reminder instead.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_dispatched_reminder_final() is
  'Rejects any reminder_logs status change leaving sent/delivery_unknown/undelivered. Movement within that set stays allowed for reconciliation.';

drop trigger if exists reminder_logs_dispatched_final on public.reminder_logs;
create trigger reminder_logs_dispatched_final
  before update of status on public.reminder_logs
  for each row
  when (old.status is distinct from new.status)
  execute function public.enforce_dispatched_reminder_final();

-- ── Privileges ─────────────────────────────────────────────────────────────
--
-- THE MATRIX, for the two MUTATING RPCs:
--
--                     claim_reminder_allowance   release_reminder_allowance
--     PUBLIC          no execute                 no execute
--     anon            no execute                 no execute
--     authenticated   no execute                 no execute
--     service_role    EXECUTE                    EXECUTE
--
-- `authenticated` is REVOKED, not merely absent, and that is the change that
-- closes the two bypasses at the root rather than at the rule.
--
-- Both bypasses were only reachable because a browser session could call these
-- functions at all. Constraining what they DO (the server-side cap, the
-- status-guarded release) removes the exploit; removing the browser's ability
-- to reach them removes the entire class. A third mistake inside either
-- function is no longer a customer-exploitable one.
--
-- The application still works because /api/reminders/[id]/approve now calls
-- these through the SERVICE-ROLE client. That is not a loosening: the route
-- has already authenticated the session and verified the reminder under the
-- user's own RLS before the claim happens, and it passes a user id derived
-- from the session cookie, never from the request body. The functions
-- additionally re-verify that the reminder belongs to that user.
--
-- PostgreSQL grants EXECUTE to PUBLIC on every newly created function, so the
-- REVOKEs are REQUIRED rather than decorative, and they run after each CREATE
-- so a fresh install is covered as well as a replace.

revoke all on function public.claim_reminder_allowance(uuid, uuid) from public;
revoke all on function public.release_reminder_allowance(uuid, uuid) from public;
revoke all on function public.claim_reminder_allowance(uuid, uuid) from anon, authenticated;
revoke all on function public.release_reminder_allowance(uuid, uuid) from anon, authenticated;

grant execute on function public.claim_reminder_allowance(uuid, uuid) to service_role;
grant execute on function public.release_reminder_allowance(uuid, uuid) to service_role;

-- Trigger functions are invoked BY THE TRIGGER. PostgreSQL checks EXECUTE at
-- trigger-creation time, not at fire time, so revoking here does not stop them
-- running for ordinary users — it only stops anyone calling them directly.
revoke all on function public.sync_reminder_allowance_slot() from public;
revoke all on function public.sync_reminder_allowance_slot() from anon, authenticated;
revoke all on function public.enforce_dispatched_reminder_final() from public;
revoke all on function public.enforce_dispatched_reminder_final() from anon, authenticated;

-- The allowance constant is not mutating, but nothing outside the database
-- needs it either: the value travels back to the app inside the claim result.
revoke all on function public.founding_beta_allowance() from public;
revoke all on function public.founding_beta_allowance() from anon, authenticated;
grant execute on function public.founding_beta_allowance() to service_role;

-- ── Table privileges ───────────────────────────────────────────────────────
--
-- A SECOND, INDEPENDENT LAYER beneath RLS.
--
-- RLS already denies writes: the policy set is SELECT-only, so an insert or
-- delete finds no permissive policy and fails. But that is one mechanism, and
-- it is one `create policy` away from being wrong — Supabase projects also
-- carry default grants that hand `anon` and `authenticated` full DML on new
-- tables in `public`, which leaves RLS as the ONLY thing standing between a
-- browser session and this ledger.
--
-- Revoking the table privilege means a write is rejected before RLS is even
-- consulted. Both layers have to fail before a user can touch a slot.
--
-- SELECT is granted, because the Overview banner counts the user's own slots
-- directly from the browser; the RLS policy above scopes that to auth.uid().

revoke all on table public.reminder_allowance_slots from anon, authenticated;
grant select on table public.reminder_allowance_slots to authenticated;

-- ── Backfill ───────────────────────────────────────────────────────────────
--
-- Existing reminders that already consumed allowance under the display-only
-- model must carry that forward, or every current beta account silently gets
-- its ten reminders back on the day this runs.
--
-- The status set is the one the Overview banner has been using: a reminder was
-- DISPATCHED — handed to a provider that accepted it. `failed` (a definite
-- pre-acceptance rejection), `dismissed` and `pending` are excluded, as they
-- always have been.
--
-- row_number() assigns slot numbers densely from 1, oldest first. Capped at
-- the allowance: an account already past ten keeps ten slots and reads as
-- exhausted, which is the truthful outcome — it does not create slot 11.

insert into public.reminder_allowance_slots (reminder_log_id, user_id, slot_number, claimed_at)
select id, user_id, slot_number, created_at
from (
  select
    r.id,
    r.user_id,
    r.created_at,
    row_number() over (partition by r.user_id order by r.created_at, r.id) as slot_number
  from public.reminder_logs r
  where r.status in ('sent', 'delivery_unknown', 'undelivered')
    and r.user_id is not null
) ranked
where slot_number <= public.founding_beta_allowance()
on conflict (reminder_log_id) do nothing;

-- ── Verification (run manually after applying) ─────────────────────────────
--
--   -- Nobody may exceed the cap:
--   select user_id, count(*) from public.reminder_allowance_slots
--    group by user_id having count(*) > public.founding_beta_allowance();          -- expect zero rows
--
--   -- Slots agree with the dispatched reminders they name:
--   select s.reminder_log_id, r.status
--     from public.reminder_allowance_slots s
--     join public.reminder_logs r on r.id = s.reminder_log_id
--    where r.status not in ('sent','delivery_unknown','undelivered','sending');
--   -- expect zero rows, or only rows mid-send
--
-- ── Rollback ───────────────────────────────────────────────────────────────
--
-- ORDER MATTERS. Run these top to bottom.
--
--   -- 1. TRIGGERS FIRST, before anything they depend on.
--   drop trigger if exists reminder_logs_dispatched_final on public.reminder_logs;
--   drop function if exists public.enforce_dispatched_reminder_final();
--   drop trigger if exists reminder_logs_allowance_sync on public.reminder_logs;
--   drop function if exists public.sync_reminder_allowance_slot();
--
--   -- 2. Then the RPCs.
--   drop function if exists public.release_reminder_allowance(uuid, uuid);
--   drop function if exists public.claim_reminder_allowance(uuid, uuid);
--   drop function if exists public.founding_beta_allowance();
--
--   -- 3. The ledger last.
--   drop table if exists public.reminder_allowance_slots;
--
-- WHY THE ORDER IS NOT OPTIONAL. The trigger function references
-- reminder_allowance_slots inside its BODY, and PostgreSQL does not track
-- dependencies through function bodies. Dropping the table first therefore
-- succeeds — and leaves a trigger on reminder_logs that raises
-- "relation does not exist" on EVERY status update. Approving, dismissing and
-- reconciling a reminder would all fail, product-wide, from a rollback that
-- reported success.
--
-- Dropping the table removes the cap entirely and cannot be undone without
-- re-running the backfill. Nothing here touches reminder_logs data.
