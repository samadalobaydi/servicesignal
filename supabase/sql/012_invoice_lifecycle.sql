-- =============================================================================
-- ServiceSignal — invoice lifecycle: archive, and a delete guard
--
-- MIGRATION 012 of 2 — ADDITIVE. Safe to apply BEFORE the application deploys.
--
-- NOT RUN AUTOMATICALLY. Review and run manually in the Supabase SQL editor.
-- NOT YET APPLIED TO ANY REMOTE PROJECT.
--
-- ⚠ .env.local currently points at the project identified as "main — PRODUCTION".
--   Read this file in full before running it anywhere.
-- =============================================================================
--
-- ── DEPLOYMENT ORDER ───────────────────────────────────────────────────────
--
--   1. Apply THIS migration (012).
--   2. Deploy the application branch containing the new lifecycle APIs.
--   3. Manually verify existing AND new invoice operations.
--   4. Apply 013_invoice_permissions.sql.
--   5. Verify the final browser privilege matrix.
--
-- ── WHY THE SPLIT ──────────────────────────────────────────────────────────
--
-- An earlier draft of this file also revoked browser table privileges. That
-- created a deployment trap with no safe ordering:
--
--   privileges first  → the CURRENTLY DEPLOYED app loses Mark Paid the instant
--                       the revoke lands, for every customer, until the new
--                       deploy finishes.
--   app first         → the new app expects archived_at, the lifecycle RPCs and
--                       the guards, none of which exist yet.
--
-- So the two concerns are now separate migrations. THIS one is purely
-- additive: it creates a nullable column, an index, guards and functions.
-- Nothing here removes a capability the current application relies on.
--
-- ONE INTENTIONAL BEHAVIOUR CHANGE, and it is a safety fix: the delete guard
-- begins refusing deletion of invoices with dispatched reminders immediately.
-- The old Paid Invoices delete button will therefore fail for those — which is
-- the entire point, since that path could erase sent history and refund
-- consumed allowance. Ordinary non-destructive operations are unaffected.
-- =============================================================================
--
-- ── VERIFIED PRODUCTION FACT ───────────────────────────────────────────────
--
--   reminder_logs.invoice_id references invoices(id) ON DELETE CASCADE
--   — verified by read-only query on main — PRODUCTION, 2026-08-10.
--
-- Recorded here so nobody has to rediscover it. Everything below is designed
-- around it, and the worst case it implies is real:
--
--   delete invoices  →  CASCADE deletes reminder_logs
--                    →  CASCADE deletes reminder_channel_messages   (010)
--                    →  CASCADE deletes reminder_allowance_slots    (011)
--
-- One DELETE erases dispatched message history AND refunds consumed Founding
-- Beta allowance. Send ten, delete the invoices, send ten more, for ever.
--
-- ── TRIGGER TIMING, WHICH THE CASCADE MAKES CRITICAL ───────────────────────
--
-- PostgreSQL fires a BEFORE DELETE row trigger on `invoices` BEFORE the
-- referential-integrity action runs, so at the moment the guard executes the
-- reminder_logs rows it inspects still exist. An AFTER trigger would run once
-- the cascade had already destroyed the evidence it needed. BEFORE is not a
-- style choice here; it is the only timing that works.
--
-- ⚠⚠ THIS MIGRATION CLOSES A HOLE THAT IS LIVE RIGHT NOW ⚠⚠
--
-- lib/invoices.ts exported deleteInvoice(), a bare client-side
--
--     supabase.from("invoices").delete().eq("id", id)
--
-- wired into the Paid Invoices page, with no lifecycle check of any kind.
-- Combined with the verified CASCADE above, that button could erase sent
-- history and refund consumed allowance. It has been removed in the same
-- change as this migration and replaced by DELETE /api/invoices/[id].
--
-- The trigger below exists anyway, because removing one caller is not the same
-- as making the operation safe. It covers the API, a future caller, a
-- hand-run DELETE in the SQL editor, and the race the application cannot
-- close on its own.
--
-- WHY A TRIGGER RATHER THAN AN APPLICATION CHECK
--
-- The application check exists too (lib/invoice-lifecycle.ts). But a
-- check-then-delete in the application is a race: a reminder can move to
-- 'sending' between the check and the DELETE.
--
-- The trigger running inside the same statement is NECESSARY BUT NOT
-- SUFFICIENT — an earlier revision of this file claimed otherwise and was
-- wrong. A BEFORE DELETE trigger that only READS the reminder statuses can
-- still be overtaken: it sees 'pending', allows the delete, and a concurrent
-- approval claims that row before the cascade removes it. The guard therefore
-- LOCKS every reminder row for the invoice before deciding. See the note
-- inside the function.
-- =============================================================================

-- ── Archive ────────────────────────────────────────────────────────────────
--
-- A nullable timestamp, not a status value.
--
-- invoices.status is 'unpaid' | 'paid' and carries a CHECK constraint plus a
-- great deal of behaviour: the paid kill switch, the buckets, the KPI totals,
-- the reminder gate. Adding 'archived' to it would make archived-and-paid
-- unrepresentable and would silently reclassify every query that tests
-- status <> 'paid'. Archiving is orthogonal to payment — an invoice can be
-- archived paid or archived unpaid — so it gets its own column.
--
-- Nullable timestamp rather than a boolean because "when" is free and
-- occasionally decisive, and because `archived_at is null` is the natural
-- predicate every active query already wants.

alter table public.invoices
  add column if not exists archived_at timestamptz;

comment on column public.invoices.archived_at is
  'Set when the owner removes an invoice from active workflow without deleting it. Archived invoices are excluded from chasing and never receive new reminders. NOT a payment state — an invoice may be archived paid or unpaid.';

-- Every active-workflow query filters on this, and it is highly selective
-- (almost all rows are null), so a partial index on the null case is the one
-- that pays for itself.
create index if not exists invoices_active_idx
  on public.invoices (user_id, due_date)
  where archived_at is null;

-- ── The delete guard ───────────────────────────────────────────────────────
--
-- THE RULE, and it is the same one lib/invoice-lifecycle.ts applies:
--
--   sent | delivery_unknown | undelivered   dispatched. A customer received
--                                           something, and a Founding Beta
--                                           unit was consumed. Deleting the
--                                           invoice would erase the record and
--                                           refund the unit. Archive instead.
--   sending                                 a provider submission is in flight.
--                                           The row it is about to write its
--                                           outcome to must still exist.
--   pending | dismissed | failed            nothing was ever dispatched and no
--                                           unit is consumed. Deletable.
--
-- SECURITY DEFINER so the check sees reminder_logs regardless of the caller's
-- RLS view. A guard that could be evaded by the rows being invisible would not
-- be a guard.

create or replace function public.enforce_invoice_deletable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_status text;
begin
  -- ⚠ LOCK FIRST, DECIDE SECOND.
  --
  -- An earlier revision read the statuses without locking and the comment
  -- claimed the statement boundary closed the race. It did not:
  --
  --   1. DELETE begins; this trigger reads the reminder as 'pending'
  --   2. 'pending' is deletable, so the DELETE is allowed to continue
  --   3. a concurrent approval claims that row: pending → sending
  --   4. the CASCADE removes the reminder underneath the live submission
  --   → a customer is contacted while the evidence, the history and the
  --     allowance slot are deleted.
  --
  -- ALL reminder rows are locked, not merely the protected ones. Locking only
  -- rows already in a protected state would miss exactly the 'pending' row in
  -- step 1 — the one the race needs.
  --
  -- Lock order: the DELETE statement has already locked the invoice row, and
  -- this takes the reminders. invoice → reminders, matching
  -- archive_invoice_safely and update_invoice_with_refresh.
  perform 1
     from public.reminder_logs
    where invoice_id = old.id
      for update;

  -- With those locks held, the reading is stable: a concurrent claim is either
  -- already committed (and visible here) or blocked until this transaction
  -- ends.
  select r.status
    into v_status
    from public.reminder_logs r
   where r.invoice_id = old.id
     and r.status in ('sent', 'delivery_unknown', 'undelivered', 'sending')
   limit 1;

  if v_status is not null then
    raise exception
      'invoice % has a reminder in state ''%'' and cannot be deleted', old.id, v_status
      using errcode = '23514',
            hint = 'Archive this invoice instead. Dispatched reminders and the allowance they consumed are permanent.';
  end if;

  return old;
end;
$$;

comment on function public.enforce_invoice_deletable() is
  'Refuses deletion of any invoice with a dispatched or in-flight reminder. Protects sent history and the Founding Beta allowance ledger from being erased by a delete.';

drop trigger if exists invoices_deletable_guard on public.invoices;
create trigger invoices_deletable_guard
  before delete on public.invoices
  for each row
  execute function public.enforce_invoice_deletable();

-- Trigger functions are invoked BY THE TRIGGER; PostgreSQL checks EXECUTE at
-- creation time, not at fire time, so revoking does not stop it running for
-- ordinary users — it only stops anyone calling it directly.
revoke all on function public.enforce_invoice_deletable() from public;
revoke all on function public.enforce_invoice_deletable() from anon, authenticated;

-- ── The archive guard ──────────────────────────────────────────────────────
--
-- Archiving must stop future reminders. The application filters archived
-- invoices out of the cron scan and the manual prepare route, but both are
-- read-then-write: the daily job can select an invoice and insert a reminder
-- for it a moment after the owner archives it.
--
-- This closes that race where it actually has to be closed. An insert for an
-- archived invoice is refused, so the window between the cron's SELECT and its
-- INSERT does not matter.
--
-- BEFORE INSERT only. Existing reminders on a newly archived invoice are
-- untouched — archiving preserves history, it does not rewrite it.

create or replace function public.enforce_reminder_not_archived()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_archived timestamptz;
begin
  -- ⚠ `for share` IS THE POINT, not defensive noise.
  --
  -- A plain SELECT here would read the last committed snapshot, so an INSERT
  -- racing an in-progress archive would see archived_at still null and be
  -- allowed — the invoice would finish archived while owning a brand-new
  -- sendable reminder. That is exactly the gap a read-only check cannot close.
  --
  -- `for share` conflicts with the `for update` that archive_invoice_safely
  -- holds on the same invoice row, so this INSERT BLOCKS until archive
  -- commits. Under READ COMMITTED, a statement that blocks on a row lock
  -- re-reads that row once the lock is released — so it then sees archived_at
  -- set and refuses. Serialised, not raced.
  select i.archived_at
    into v_archived
    from public.invoices i
   where i.id = new.invoice_id
   for share;

  if v_archived is not null then
    raise exception 'invoice % is archived and cannot receive new reminders', new.invoice_id
      using errcode = '23514',
            hint = 'Archived invoices keep their history but are out of the reminder workflow.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_reminder_not_archived() is
  'Refuses new reminder_logs rows for archived invoices. Closes the read-then-write race between the daily cron and an archive action.';

drop trigger if exists reminder_logs_archived_guard on public.reminder_logs;
create trigger reminder_logs_archived_guard
  before insert on public.reminder_logs
  for each row
  execute function public.enforce_reminder_not_archived();

revoke all on function public.enforce_reminder_not_archived() from public;
revoke all on function public.enforce_reminder_not_archived() from anon, authenticated;

-- ── The atomic edit ────────────────────────────────────────────────────────
--
-- ⚠ THE RACE THIS CLOSES
--
-- The edit path was: load reminders → check none is 'sending' → UPDATE the
-- invoice → regenerate the pending reminder's content. Three separate
-- statements with a send able to interleave between any two of them:
--
--   1. edit loads the reminder as 'pending'
--   2. approve claims it: pending → sending
--   3. edit UPDATEs the invoice to £1,200          ← already committed
--   4. edit tries to regenerate, sees 'sending', refuses
--   5. the customer gets an error, but the invoice HAS changed — and the
--      send now in flight is delivering £1,500 to their customer
--
-- Partial mutation, and the worst kind: the two halves disagree about money.
--
-- ── WHY ONE FUNCTION ───────────────────────────────────────────────────────
--
-- A function body is one transaction, so either every write below lands or
-- none does. `for update` on the reminder rows is what actually closes the
-- window: the approve route's claim is
--
--     update reminder_logs set status='sending', send_attempt_count = n+1
--      where id = ? and status in (...) and send_attempt_count = n
--
-- and that statement blocks on our row lock until we commit. When it resumes
-- it re-reads the row and finds send_attempt_count has moved, so its
-- compare-and-set fails and it refuses rather than sending stale content.
--
-- Bumping send_attempt_count is deliberate and is not an abuse of it: it is
-- already the row-version guard the send path compare-and-sets on. Replacing
-- the content IS a change that must invalidate an in-flight claim, so it moves
-- the version. The Resend idempotency key derives from the content hash as
-- well as the attempt number, so skipping a number is harmless.
--
-- ── WHY THE CONTENT IS PASSED IN, NOT GENERATED HERE ───────────────────────
--
-- Reminder wording is application logic — tone, schedule phrasing, SMS length
-- rules — and reimplementing it in PL/pgSQL would create a second generator to
-- keep in step with lib/reminder-content.ts. The caller composes both channels
-- from the PROPOSED invoice values first, then hands the finished text here so
-- the commit is one atomic step. Nothing is written until every part is ready.

create or replace function public.update_invoice_with_refresh(
  p_invoice_id  uuid,
  p_user_id     uuid,
  p_patch       jsonb,
  p_reminder_id uuid    default null,
  p_channels    jsonb   default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_sending  boolean;
  v_status   text;
  v_applied  integer;
  v_unknown  text[];
  v_archived timestamptz;
begin
  -- An authenticated caller may only ever edit their own invoice. service_role
  -- has no auth.uid() and is a trusted server process acting on their behalf.
  -- ── OWNERSHIP ──────────────────────────────────────────────────────────
  --
  -- ⚠ THERE IS DELIBERATELY NO auth.uid() CHECK HERE.
  --
  -- An earlier revision carried `if auth.uid() is not null and auth.uid() <>
  -- p_user_id then raise`. That was a FALSE DEFENCE. This function is granted
  -- to service_role ONLY, and the application calls it through the
  -- service-role client (lib/invoice-lifecycle-db.ts) — where auth.uid() is
  -- always NULL. The guard could therefore never fire in production. Security
  -- code whose semantics do not match the runtime is worse than none: it
  -- invites the next reader to believe a protection exists.
  --
  -- The real chain, and the only one:
  --
  --   1. the route authenticates the session server-side (auth.getUser())
  --   2. userId is taken from THAT, never from the request body
  --   3. it is passed here as p_user_id
  --   4. every statement below is scoped `and user_id = p_user_id`
  --
  -- So substituting another owner's invoice id matches no row, and the
  -- function returns not_found having written nothing. p_user_id is an
  -- identity supplied by trusted server code, not an eligibility flag a
  -- caller can set to change what is permitted.

  -- ── THE PATCH WHITELIST ────────────────────────────────────────────────
  --
  -- Every assignment below is an explicit named column, so an unexpected key
  -- in p_patch is already inert — it is read by nothing. This check exists so
  -- it also cannot be sent SILENTLY.
  --
  -- Rejecting rather than ignoring: a caller who thinks they set `status` and
  -- gets a success response has been misled, and the next person to read that
  -- code will believe the field is editable. An error says what is true.
  --
  -- The forbidden set is not enumerated — it is everything not on this list.
  -- id, user_id, status, archived_at, created_at, paid_at, reminders_sent,
  -- reminder_schedules, reminder_tone and escalation_status are all excluded
  -- by construction, and so is any column added to the table in future.
  select array_agg(k)
    into v_unknown
    from jsonb_object_keys(p_patch) as k
   where k not in (
     'customer_name', 'customer_email', 'customer_phone',
     'invoice_reference', 'job_description',
     'amount', 'due_date', 'payment_link'
   );

  if v_unknown is not null then
    raise exception 'patch contains fields that are not editable: %', array_to_string(v_unknown, ', ')
      using errcode = '22023',
            hint = 'Only customer, reference, job, amount, due date and payment link may be edited.';
  end if;

  -- Lock the invoice. Two concurrent edits serialise here, and archived_at is
  -- read under that lock so an archive committing alongside cannot be missed.
  select archived_at into v_archived
    from public.invoices
   where id = p_invoice_id and user_id = p_user_id
   for update;

  if not found then
    return 'not_found';
  end if;

  -- The Archived view is read only, and a stale Active Chasing tab in another
  -- window must not be able to edit an invoice that has since been archived.
  -- Checked under the lock, before any write.
  if v_archived is not null then
    return 'invoice_archived';
  end if;

  -- Lock every reminder for this invoice. THIS is the guard: an approve
  -- claim touching any of these rows waits for this transaction.
  perform 1 from public.reminder_logs
   where invoice_id = p_invoice_id and user_id = p_user_id
   for update;

  select exists (
    select 1 from public.reminder_logs
     where invoice_id = p_invoice_id and user_id = p_user_id and status = 'sending'
  ) into v_sending;

  -- Returning before any write means nothing has been changed at all.
  if v_sending then
    return 'in_flight';
  end if;

  if p_reminder_id is not null then
    -- ⚠ BOUND TO THE INVOICE, not merely to the owner.
    --
    -- This previously matched on (id, user_id) alone. A caller could then pass
    -- Invoice A with Reminder B — both legitimately theirs — and the function
    -- would update Invoice A while invalidating and rewriting a reminder that
    -- belongs to Invoice B, and which was never in the set locked above.
    -- The invoice binding is the trusted link: reminder_channel_messages only
    -- knows reminder_log_id, so it must be proven here before any channel row
    -- is touched.
    select status into v_status
      from public.reminder_logs
     where id = p_reminder_id
       and user_id = p_user_id
       and invoice_id = p_invoice_id;

    -- Covers BOTH "no longer an unsent draft" and "not this invoice's
    -- reminder": v_status is null when the binding above fails, so a
    -- mismatched pair returns before any write and leaks nothing about
    -- whether the other reminder exists.
    if v_status is distinct from 'pending' then
      return 'reminder_changed';
    end if;
  end if;

  update public.invoices
     set customer_name     = p_patch ->> 'customer_name',
         customer_email    = p_patch ->> 'customer_email',
         customer_phone    = p_patch ->> 'customer_phone',
         invoice_reference = nullif(p_patch ->> 'invoice_reference', ''),
         job_description   = nullif(p_patch ->> 'job_description', ''),
         amount            = (p_patch ->> 'amount')::numeric,
         due_date          = (p_patch ->> 'due_date')::date,
         payment_link      = coalesce(p_patch ->> 'payment_link', '')
   where id = p_invoice_id and user_id = p_user_id;

  if p_reminder_id is not null then
    -- Recipient follows the invoice, or the refreshed reminder goes to the
    -- address the owner just corrected away from.
    update public.reminder_logs
       set email_to              = p_patch ->> 'customer_email',
           reviewed_content_hash = null,
           send_attempt_count    = send_attempt_count + 1
     where id = p_reminder_id
       and user_id = p_user_id
       and invoice_id = p_invoice_id;

    -- ── THE PAIR IS ENFORCED, NOT ASSUMED ────────────────────────────────
    --
    -- SMS and email are equal channels and one logical reminder is the pair.
    -- A comment saying so does not prevent an email-only refresh leaving an
    -- SMS quoting the old amount. Two checks, both before/around the write.
    --
    -- 1. INPUT SHAPE. Exactly two elements, exactly one 'email' and one
    --    'sms', each with a non-empty body. Null, a single channel, a
    --    duplicate, or an unknown channel all raise here — before any row is
    --    touched, so nothing to roll back.
    if p_channels is null or jsonb_typeof(p_channels) <> 'array' then
      raise exception 'a reminder refresh requires both channels'
        using errcode = '22023';
    end if;

    if (select count(*) from jsonb_array_elements(p_channels)) <> 2 then
      raise exception 'a reminder refresh requires exactly two channels, got %',
        (select count(*) from jsonb_array_elements(p_channels))
        using errcode = '22023';
    end if;

    if (
      select count(distinct c ->> 'channel')
        from jsonb_array_elements(p_channels) c
       where c ->> 'channel' in ('email', 'sms')
         and coalesce(c ->> 'body', '') <> ''
    ) <> 2 then
      raise exception 'a reminder refresh requires one email and one sms, each with a body'
        using errcode = '22023';
    end if;

    -- 2. PERSISTED EFFECT. Set-based, so the row count is the truth rather
    --    than a loop that silently matches nothing. Stored rows are UPDATEd
    --    only — migration 010 creates both channel rows when a reminder is
    --    prepared, so a missing row means the data is already inconsistent and
    --    inserting one here would paper over that. Raising rolls the whole
    --    transaction back, invoice update included.
    with supplied as (
      select c ->> 'channel' as channel,
             c ->> 'subject' as subject,
             c ->> 'body'    as body
        from jsonb_array_elements(p_channels) c
    ), applied as (
      update public.reminder_channel_messages m
         set generated_subject = s.subject,
             generated_body    = s.body,
             -- The owner's edit is replaced, not merged. They were warned.
             edited_subject    = null,
             edited_body       = null,
             content_edited_at = null
        from supplied s
       where m.reminder_log_id = p_reminder_id
         and m.user_id = p_user_id
         and m.channel = s.channel
      returning 1
    )
    select count(*) into v_applied from applied;

    if v_applied <> 2 then
      raise exception
        'reminder % has % stored channel rows; both SMS and email must refresh together',
        p_reminder_id, v_applied
        using errcode = '23514',
              hint = 'The invoice edit was rolled back. Neither channel was changed.';
    end if;
  end if;

  return 'updated';
end;
$$;

comment on function public.update_invoice_with_refresh(uuid, uuid, jsonb, uuid, jsonb) is
  'Atomically updates an invoice and refreshes its unsent reminder content. Locks the reminder rows so a concurrent send cannot claim stale content, and bumps send_attempt_count so an in-flight claim fails its compare-and-set. All or nothing.';

revoke all on function public.update_invoice_with_refresh(uuid, uuid, jsonb, uuid, jsonb) from public;
revoke all on function public.update_invoice_with_refresh(uuid, uuid, jsonb, uuid, jsonb) from anon, authenticated;
grant execute on function public.update_invoice_with_refresh(uuid, uuid, jsonb, uuid, jsonb) to service_role;

-- ── The atomic archive ─────────────────────────────────────────────────────
--
-- ⚠ THE TWO RACES THIS CLOSES
--
-- Archive was two application statements: dismiss the pending drafts, then set
-- archived_at. Both windows are exploitable.
--
--   RACE A — preparation slips between them
--     1. archive dismisses the current pending reminder
--     2. archived_at is still null
--     3. the cron (or the prepare route) INSERTs a new pending reminder
--     4. archive sets archived_at
--     → an archived invoice owning a brand-new sendable reminder.
--     The BEFORE INSERT guard did not help: at step 3 the invoice was not yet
--     archived. Closing this needed the guard to LOCK — see
--     enforce_reminder_not_archived above.
--
--   RACE B — a send claim slips in before the dismiss
--     1. archive sees pending, nothing sending
--     2. approve claims it: pending → sending
--     3. the dismiss `where status = 'pending'` now matches nothing
--     4. archive sets archived_at
--     → the customer receives a reminder from an invoice just archived.
--
-- Both are the same defect: a decision in one statement and the action in
-- another. One transaction removes the gap.
--
-- ── LOCK ORDER, AND WHY IT IS THIS ORDER ───────────────────────────────────
--
--   1. invoice FOR UPDATE      — conflicts with the insert guard's FOR SHARE,
--                                so no new reminder can be created for this
--                                invoice for the rest of the transaction
--   2. reminder rows FOR UPDATE — conflicts with the approve route's claim
--                                UPDATE, so no draft can become 'sending'
--   3. re-check 'sending'      — with both locks held, this reading is stable
--   4. refuse, or mutate
--
-- Invoice before reminders, consistently, in every function here. Two
-- transactions that take the same two locks in the same order cannot deadlock
-- on each other; reversing it anywhere would reintroduce that possibility.
--
-- ── WHY THE ORDER OF THE WRITES DOES NOT MATTER ────────────────────────────
--
-- archived_at is set before the drafts are stood down, but under READ
-- COMMITTED no other transaction sees either write until commit — so the two
-- are indistinguishable from outside. What makes insertion safe is the LOCK
-- taken in step 1, not the order of the writes. Setting archived_at first is
-- simply the clearer read.

-- The timestamp is NOT a parameter. The caller decides WHETHER to archive;
-- the database decides when it happened. A caller-supplied time can be wrong,
-- skewed, or back-dated, and nothing downstream would know.
create or replace function public.archive_invoice_safely(
  p_invoice_id uuid,
  p_user_id    uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_archived timestamptz;
  v_sending  boolean;
begin
  -- ── OWNERSHIP ──────────────────────────────────────────────────────────
  --
  -- ⚠ THERE IS DELIBERATELY NO auth.uid() CHECK HERE.
  --
  -- An earlier revision carried `if auth.uid() is not null and auth.uid() <>
  -- p_user_id then raise`. That was a FALSE DEFENCE. This function is granted
  -- to service_role ONLY, and the application calls it through the
  -- service-role client (lib/invoice-lifecycle-db.ts) — where auth.uid() is
  -- always NULL. The guard could therefore never fire in production. Security
  -- code whose semantics do not match the runtime is worse than none: it
  -- invites the next reader to believe a protection exists.
  --
  -- The real chain, and the only one:
  --
  --   1. the route authenticates the session server-side (auth.getUser())
  --   2. userId is taken from THAT, never from the request body
  --   3. it is passed here as p_user_id
  --   4. every statement below is scoped `and user_id = p_user_id`
  --
  -- So substituting another owner's invoice id matches no row, and the
  -- function returns not_found having written nothing. p_user_id is an
  -- identity supplied by trusted server code, not an eligibility flag a
  -- caller can set to change what is permitted.

  -- 1. Lock the invoice. From here, enforce_reminder_not_archived's FOR SHARE
  --    blocks, so the cron and the prepare route cannot insert a reminder for
  --    this invoice until this transaction ends.
  select i.archived_at
    into v_archived
    from public.invoices i
   where i.id = p_invoice_id and i.user_id = p_user_id
   for update;

  if not found then
    return 'not_found';
  end if;

  -- Idempotent. Archiving twice is the state the caller asked for.
  if v_archived is not null then
    return 'archived';
  end if;

  -- 2. Lock every reminder. The approve claim is an UPDATE on these rows, so
  --    it now blocks; when it resumes it re-reads and finds the draft
  --    dismissed, so its WHERE status in ('pending','failed') matches nothing.
  --    RACE A also lands here: a reminder inserted just before we locked is
  --    included, and gets stood down below like any other.
  perform 1 from public.reminder_logs
   where invoice_id = p_invoice_id and user_id = p_user_id
   for update;

  -- 3. Now that both locks are held, this reading cannot change under us.
  select exists (
    select 1 from public.reminder_logs
     where invoice_id = p_invoice_id and user_id = p_user_id and status = 'sending'
  ) into v_sending;

  -- 4. Refuse BEFORE any mutation. A send already handed to a provider is not
  --    something an archive may cancel — and returning here leaves the invoice
  --    completely unarchived rather than half-archived.
  if v_sending then
    return 'in_flight';
  end if;

  update public.invoices
     set archived_at = pg_catalog.now()
   where id = p_invoice_id and user_id = p_user_id;

  -- Unsent drafts only. 'dismissed' is the honest status: the owner chose not
  -- to send them. This is what makes a bookmarked review URL harmless — the
  -- approve route's CLAIMABLE_STATUSES is ('pending','failed'), so a dismissed
  -- reminder cannot be claimed.
  --
  -- It also releases the reservation via migration 011's pending → dismissed
  -- trigger. That is NOT a refund of anything consumed: a pending reminder was
  -- never dispatched.
  --
  -- 'sent', 'delivery_unknown' and 'undelivered' are untouched history, and
  -- their allowance units stay consumed. 'failed' is left alone: it is already
  -- unsendable in practice and rewriting it would lose the distinction between
  -- "the provider rejected this" and "the owner declined it".
  update public.reminder_logs
     set status = 'dismissed'
   where invoice_id = p_invoice_id
     and user_id = p_user_id
     and status = 'pending';

  return 'archived';
end;
$$;

comment on function public.archive_invoice_safely(uuid, uuid) is
  'Atomically archives an invoice and stands down its unsent drafts. Locks the invoice (blocking the archived-insert guard) and every reminder (blocking the send claim), refuses before any mutation if one is already sending. All or nothing.';

revoke all on function public.archive_invoice_safely(uuid, uuid) from public;
revoke all on function public.archive_invoice_safely(uuid, uuid) from anon, authenticated;
grant execute on function public.archive_invoice_safely(uuid, uuid) to service_role;

-- ── The archived-send guard ────────────────────────────────────────────────
--
-- ⚠ THE HOLE THIS CLOSES
--
-- CLAIMABLE_STATUSES in lib/reminder-send-state.ts is ('pending', 'failed').
-- archive_invoice_safely stands down 'pending' drafts but deliberately leaves
-- 'failed' alone — rewriting a provider rejection as "the owner declined it"
-- would destroy a real distinction.
--
-- That leaves 'failed' CLAIMABLE on an archived invoice:
--
--   1. a reminder fails (provider rejected it, nothing sent)
--   2. the owner archives the invoice
--   3. the row stays 'failed'
--   4. a retry — bookmarked review URL, direct API call, future code path —
--      claims it, because 'failed' is claimable
--   5. an archived invoice contacts the customer
--
-- Standing down 'failed' would fix it and lose the history. Guarding the
-- TRANSITION fixes it and keeps the history: the row stays truthfully
-- 'failed', it simply can never become 'sending' again.
--
-- ── WHY THIS READ IS DELIBERATELY UNLOCKED ─────────────────────────────────
--
-- `select ... from invoices` with NO `for share`, and that is load-bearing.
--
-- The statement that fires this trigger is
--     update reminder_logs set status = 'sending' where ...
-- which has ALREADY locked the reminder row. Taking an invoice lock here would
-- mean reminder-then-invoice, while archive_invoice_safely takes
-- invoice-then-reminder. Two transactions acquiring the same pair in opposite
-- orders is the textbook deadlock, and it would be a deadlock between the two
-- most important operations in the product.
--
-- An unlocked read is also SUFFICIENT, which is the part worth checking:
--
--   archive already committed  → this read sees archived_at set → refused. ✓
--   archive still in progress  → this read sees archived_at null → the claim
--                                proceeds and the row becomes 'sending'. The
--                                archive is meanwhile blocked on its own
--                                `for update` over this reminder row; when it
--                                resumes it sees 'sending' and returns
--                                in_flight WITHOUT archiving. ✓
--
-- The second case is exactly "send wins": final state is an unarchived invoice
-- with a live send. There is no interleaving that yields archived + sending.

create or replace function public.enforce_send_not_archived()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_archived timestamptz;
begin
  -- Unlocked on purpose — see the note above. Reversing the lock order here
  -- would deadlock against archive_invoice_safely.
  select i.archived_at
    into v_archived
    from public.invoices i
   where i.id = new.invoice_id;

  if v_archived is not null then
    raise exception 'invoice % is archived and can no longer send reminders', new.invoice_id
      using errcode = '23514',
            hint = 'Archived invoices keep their history but never contact the customer again.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_send_not_archived() is
  'Refuses any reminder transition into sending when the parent invoice is archived. Covers pending AND failed, so a retry cannot resurrect a reminder on an archived invoice. Reads the invoice WITHOUT a lock to preserve the invoice-then-reminder lock order.';

-- Fires ONLY on the transition that matters. `when` keeps it off every
-- unrelated update — reconciliation, attempt counters, content hashes — so the
-- trigger costs one indexed lookup on exactly the statement that could contact
-- a customer.
drop trigger if exists reminder_logs_archived_send_guard on public.reminder_logs;
create trigger reminder_logs_archived_send_guard
  before update of status on public.reminder_logs
  for each row
  when (new.status = 'sending' and old.status is distinct from 'sending')
  execute function public.enforce_send_not_archived();

revoke all on function public.enforce_send_not_archived() from public;
revoke all on function public.enforce_send_not_archived() from anon, authenticated;

-- ── Verification (run manually after applying) ─────────────────────────────
--
--   -- 1. The column and index exist:
--   select column_name from information_schema.columns
--    where table_name = 'invoices' and column_name = 'archived_at';
--
--   -- 2. The guard is attached:
--   select tgname from pg_trigger where tgname = 'invoices_deletable_guard';
--
--   -- 3. The guard actually refuses. Pick a REAL invoice of yours that has a
--   --    sent reminder, and confirm this ROLLS BACK rather than deleting:
--   --      begin;
--   --        delete from public.invoices where id = '<one with a sent reminder>';
--   --      rollback;   -- expect: ERROR ... cannot be deleted
--   --
--   --    Run it inside an explicit transaction exactly as written. If the
--   --    guard is broken this is the statement that would destroy real data.
--
--   -- 4. Nothing was archived by the migration itself:
--   select count(*) from public.invoices where archived_at is not null;  -- expect 0
--
--   -- 5. An archived invoice cannot receive a NEW reminder. Pick one of your
--   --    own archived invoices, or archive a test one first.
--   --      begin;
--   --        insert into public.reminder_logs (invoice_id, user_id, schedule, status, email_to)
--   --        values ('<archived invoice id>', '<your user id>', 'overdue_7_days', 'pending', 'x@example.com');
--   --      rollback;   -- expect: ERROR ... is archived and cannot receive new reminders
--
--   -- 6. An archived invoice's reminder cannot transition into sending —
--   --    INCLUDING a 'failed' one, which is still claimable by the app.
--   --      begin;
--   --        update public.reminder_logs set status = 'sending'
--   --         where id = '<a failed reminder on an archived invoice>';
--   --      rollback;   -- expect: ERROR ... is archived and can no longer send reminders
--
--   -- 7. Archive is atomic and neutralises pending drafts. Run against a test
--   --    invoice that has a pending reminder:
--   --      begin;
--   --        select public.archive_invoice_safely('<invoice id>', '<your user id>');
--   --        select id, status from public.reminder_logs where invoice_id = '<invoice id>';
--   --        select archived_at from public.invoices where id = '<invoice id>';
--   --      rollback;   -- expect: 'archived', pending → dismissed, archived_at set by the DB
--
--   -- 8. The edit RPC rejects non-editable keys rather than ignoring them:
--   --      begin;
--   --        select public.update_invoice_with_refresh(
--   --          '<invoice id>', '<your user id>',
--   --          '{"customer_name":"X","status":"paid"}'::jsonb);
--   --      rollback;   -- expect: ERROR ... fields that are not editable: status
--
--   -- 13. The edit RPC's reminder must belong to the invoice. Same owner, two
--   --     invoices — this must return 'reminder_changed' and change nothing:
--   --      begin;
--   --        select public.update_invoice_with_refresh(
--   --          '<invoice A>', '<your user id>', '{"amount":1}'::jsonb,
--   --          '<a reminder of invoice B>', null);
--   --        select amount from public.invoices where id = '<invoice A>';
--   --      rollback;
--
--   -- 14. An incomplete channel pair rolls the whole edit back.
--   --
--   --     p_patch MUST be COMPLETE editable state, not a sparse diff. Every
--   --     editable column is assigned unconditionally from the patch, so an
--   --     omitted key writes NULL — and a partial patch like '{"amount":1}'
--   --     fails on customer_name's NOT NULL constraint at the UPDATE, which
--   --     runs BEFORE the channel-pair check. That error would look like a
--   --     pass while proving nothing about the guard being tested.
--   --
--   --     So the patch below carries all eight editable fields, taken from
--   --     the invoice itself, leaving the single supplied channel as the ONLY
--   --     thing wrong with the call.
--   --
--   --      begin;
--   --        select public.update_invoice_with_refresh(
--   --          i.id,
--   --          i.user_id,
--   --          jsonb_build_object(
--   --            'customer_name',     i.customer_name,
--   --            'customer_email',    i.customer_email,
--   --            'customer_phone',    coalesce(i.customer_phone, ''),
--   --            'invoice_reference', coalesce(i.invoice_reference, ''),
--   --            'job_description',   coalesce(i.job_description, ''),
--   --            'amount',            i.amount,
--   --            'due_date',          i.due_date,
--   --            'payment_link',      coalesce(i.payment_link, '')
--   --          ),
--   --          (select id from public.reminder_logs
--   --            where invoice_id = i.id and status = 'pending' limit 1),
--   --          '[{"channel":"email","subject":"s","body":"b"}]'::jsonb)
--   --        from public.invoices i
--   --       where i.id = '<invoice with a pending reminder>';
--   --      rollback;
--   --      -- EXPECT: ERROR a reminder refresh requires exactly two channels, got 1
--   --      -- NOT a null-value / NOT NULL violation. If you see one of those,
--   --      -- the patch was incomplete and the guard was never reached.
--
--   -- 15. DELETE vs SEND needs TWO SQL sessions; one transaction cannot show
--   --     it. Session A:
--   --       begin;
--   --         delete from public.invoices where id = '<invoice with a pending reminder>';
--   --       -- leave open, do NOT commit
--   --     Session B:
--   --       update public.reminder_logs set status = 'sending'
--   --        where id = '<that pending reminder>';
--   --       -- expect: B BLOCKS on A's row lock
--   --     Session A:
--   --       rollback;   -- B then proceeds
--   --     Reverse the order to see A refused once B holds 'sending'.
--   --     ROLLBACK BOTH. Never commit either against real data.
--
--   -- 16. Ownership is real: another owner's invoice id matches no row.
--   --      select public.archive_invoice_safely('<someone else''s invoice id>', '<your user id>');
--   --      -- expect: 'not_found', and nothing changed
--
-- ── Rollback ───────────────────────────────────────────────────────────────
--
-- ORDER MATTERS. Top to bottom.
--
--   drop trigger if exists reminder_logs_archived_send_guard on public.reminder_logs;
--   drop function if exists public.enforce_send_not_archived();
--   drop function if exists public.archive_invoice_safely(uuid, uuid);
--   drop function if exists public.update_invoice_with_refresh(uuid, uuid, jsonb, uuid, jsonb);
--   drop trigger if exists reminder_logs_archived_guard on public.reminder_logs;
--   drop function if exists public.enforce_reminder_not_archived();
--   drop trigger if exists invoices_deletable_guard on public.invoices;
--   drop function if exists public.enforce_invoice_deletable();
--   drop index if exists public.invoices_active_idx;
--
--   -- Only if you are certain nothing is archived; this DESTROYS that state:
--   -- alter table public.invoices drop column if exists archived_at;
--
-- The trigger drops before its function for the same reason as migration 011:
-- PostgreSQL does not track dependencies through function bodies, and a
-- trigger whose function has gone raises on every delete.
--
-- Dropping the column is left commented deliberately. Rolling back the guard
-- restores the pre-existing unguarded delete described at the top of this
-- file; rolling back the column additionally loses every archive decision a
-- customer has made. Neither is reversible.
