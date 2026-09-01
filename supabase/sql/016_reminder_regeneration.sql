-- =============================================================================
-- Migration 016: regenerate_reminder_identity()
-- =============================================================================
--
-- THE GAP THIS CLOSES
--
-- Migration 015 gave Approve/Retry a fail-closed way to detect that a
-- reminder's stored content was generated under a sender identity that no
-- longer matches the account's current one (lib/reminder-content.ts's
-- identityHasDrifted). That is correct, and it is also a dead end on its
-- own: nothing in the application can REWRITE generated_subject/
-- generated_body/generated_sender_name once they are frozen, so a drifted
-- reminder was permanently unapprovable. This migration adds the one thing
-- missing — a way to regenerate a PENDING or FAILED reminder's stored
-- content from the CURRENT invoice and identity, safely.
--
-- WHY THIS MUST BE A DATABASE FUNCTION, NOT SEPARATE APPLICATION WRITES
--
-- Regeneration touches TWO tables (reminder_channel_messages for both
-- channels, and reminder_logs for the new fingerprint) and MUST NOT be
-- visible, even partially, to a concurrent Approve/Retry claim. Two
-- independent Supabase client calls cannot give that guarantee — a claim
-- could land in the gap between them. `for update` here takes the SAME lock
-- update_invoice_with_refresh (migration 012) already takes on
-- reminder_logs for the identical reason: a concurrent claim() UPDATE on
-- the same row blocks until this transaction commits or rolls back, then
-- re-evaluates its own WHERE clause against the committed result. There is
-- no window in which a claim can observe half-regenerated content.
--
-- WHY send_attempt_count IS BUMPED HERE TOO
--
-- Exactly the same reason migration 012's function bumps it on an invoice
-- edit: an Approve/Retry request that already READ the old attempt count
-- (before this transaction) will fail its own compare-and-set the moment it
-- tries to claim, even after this transaction commits and releases the
-- lock. It must reload before it can act on regenerated content.
--
-- WHAT THIS DOES NOT DO
--
--   - Does not touch invoices, profiles, or any other reminder.
--   - Does not send anything and does not touch allowance state — this is a
--     pure content rewrite, called from lib/reminder-regenerate.ts, which
--     has no Mailer/Texter/AllowanceStore dependency at all.
--   - Does not decide WHAT the new content is. subject/body/sms are
--     supplied by the caller, already composed in TypeScript by the same
--     generateReminderContent() Prepare uses — this function only commits
--     them atomically and only when the row is still safely editable.
--   - Does not run for a reminder with no stored content at all (a genuine
--     legacy reminder). identityHasDrifted() never flags those, so nothing
--     should ever call this for one; the 'no_stored_content' outcome exists
--     as a defensive backstop, not a path the application relies on.
--
-- edited_subject/edited_body ARE CLEARED, DELIBERATELY
--
-- A customer edit made under the OLD identity is not carried forward. It
-- could reference the old identity by name (a sign-off, a "call us at
-- Buildscape Ltd"), and silently layering it over freshly generated text
-- under a NEW identity is exactly the incoherent mixing this whole effort
-- exists to prevent. The owner sees a freshly generated message and can
-- re-edit it if they choose.
--
-- =============================================================================
-- REVISION — THE CHANNEL-PAIR INVARIANT (post-review fix)
-- =============================================================================
--
-- An earlier draft of this function proved only `exists(select 1 from
-- reminder_channel_messages where reminder_log_id = ...)` — "at least one
-- row of either channel" — before writing. That is not the invariant this
-- product needs. One logical reminder is BOTH channels together (see
-- generateReminderContent's own "called exactly once per reminder, so they
-- can never disagree" contract) — a reminder missing one channel row is not
-- a smaller valid reminder, it is inconsistent data, and regenerating only
-- the channel that happens to exist would have silently changed
-- generated_sender_name, bumped send_attempt_count and cleared
-- reviewed_content_hash while leaving the OTHER channel exactly as stale as
-- it was — an unprovable-again reminder that would then read as "coherent"
-- to identityHasDrifted() while one of its two channels was never touched.
--
-- This revision proves the pair EXPLICITLY, before any write: exactly one
-- 'email' row and exactly one 'sms' row for this (reminder_log_id, user_id)
-- pair. A missing, duplicated, or otherwise malformed pair refuses outright
-- — 'no_stored_content' when there is genuinely nothing (the legacy case),
-- 'invalid_channel_pair' for anything else short of exactly one of each —
-- with NO write to either table. The channel UPDATE below then proves, a
-- second time, that its own write actually landed on both rows (mirroring
-- update_invoice_with_refresh's v_applied <> 2 check, migration 012) and
-- raises — rolling back everything in this transaction, including the
-- reminder_logs update — if it did not. Two independent proofs of the same
-- invariant, one before the write and one after, because a function that
-- silently trusts its own precondition is exactly the kind of unproven
-- assumption this whole effort exists to stop making.
--
-- generated_sender_name IS ALSO NOW GUARDED: a blank or all-whitespace
-- p_generated_sender_name refuses BEFORE any write, structurally, rather
-- than persisting an unprovable identity a second time under a different
-- name. The caller (lib/reminder-regenerate.ts) can never actually supply
-- one — resolveSenderIdentity() refuses on a blank name before this
-- function is ever reached — but this function is service_role-callable by
-- design, not owned by that one caller, and must not assume every future
-- caller will have already checked.
--
-- OWNERSHIP SCOPING ON THE CHANNEL TABLE, TIGHTENED
--
-- reminder_channel_messages carries a denormalised user_id (migration 010),
-- kept in agreement with its parent by a composite foreign key so it can
-- never disagree. The pair count and the write below both now filter on
-- user_id = p_user_id in addition to reminder_log_id = p_reminder_id —
-- defence in depth beneath that FK, the same reasoning migration 010's own
-- comment gives for carrying the column at all, applied here explicitly
-- rather than relied upon implicitly.
--
-- =============================================================================
-- SECOND REVISION — THE SOURCE-STATE VERSION GUARD (post-review fix)
-- =============================================================================
--
-- The email/SMS subject and body this function writes are composed in
-- TypeScript (lib/reminder-regenerate.ts), from invoice and profile facts
-- read BEFORE this function is ever called. That read and this call are not
-- one transaction. If update_invoice_with_refresh (migration 012) commits an
-- invoice edit in the gap between them — locking this SAME reminder_logs
-- row, refreshing its stored content to the NEW invoice values, and bumping
-- send_attempt_count, all atomically — the earlier draft of this function
-- had no way to know its own composed content was now stale. Status would
-- still read 'pending'; the channel pair would still be exactly one of each
-- (the edit's own refresh guarantees that); generated_sender_name would
-- still read as a real, coherently-resolved identity. Nothing previously
-- checked here would have caught it, and the stale request would silently
-- overwrite the invoice edit's fresh content with content built from
-- superseded invoice data — invisible to identityHasDrifted(), which has no
-- opinion on invoice fields at all, only on sender identity.
--
-- p_expected_send_attempt_count closes this. The caller reads
-- send_attempt_count at the SAME moment it reads the invoice/profile facts
-- used to compose the replacement content, and passes it through. This
-- function re-reads the CURRENT value under the SAME row lock already taken
-- above, before the pair check and before any write, and refuses outright —
-- 'stale_regeneration', zero writes — the instant it disagrees. Because
-- update_invoice_with_refresh takes the identical lock on the identical row
-- for the identical reason, the two calls fully serialise: whichever
-- commits first is the one whose expected version the other's compare-and-
-- set can no longer match, exactly the same mechanism that already protects
-- a stale Approve claim from this class of race (see migration 012's own
-- comment on why it bumps this counter).
--
-- =============================================================================

create or replace function public.regenerate_reminder_identity(
  p_reminder_id                  uuid,
  p_user_id                      uuid,
  p_expected_send_attempt_count  integer,
  p_email_subject                text,
  p_email_body                   text,
  p_sms_body                     text,
  p_generated_sender_name        text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_status             text;
  v_send_attempt_count integer;
  v_email_count        integer;
  v_sms_count          integer;
  v_applied            integer;
begin
  -- ── OWNERSHIP ────────────────────────────────────────────────────────────
  --
  -- ⚠ NO auth.uid() CHECK, for the same reason migration 012's functions have
  -- none: this function is granted to service_role only, and the
  -- application calls it through the service-role client (see
  -- lib/regenerate-wiring.ts), where auth.uid() is always NULL. Ownership is
  -- established by the caller (the route authenticates the session, reads
  -- userId from it, never from the request body) and re-verified here by the
  -- WHERE clause below, which matches on (id, user_id) together.

  -- Lock the row for the rest of this transaction. A concurrent claim(), a
  -- concurrent update_invoice_with_refresh, or a concurrent regenerate call
  -- on the same reminder all block here until we commit or roll back.
  select status, send_attempt_count into v_status, v_send_attempt_count
    from public.reminder_logs
   where id = p_reminder_id and user_id = p_user_id
   for update;

  if not found then
    return 'not_found';
  end if;

  if v_status not in ('pending', 'failed') then
    return 'not_editable';
  end if;

  -- ── THE SOURCE-STATE VERSION GUARD ────────────────────────────────────────
  --
  -- Checked before the pair check and before any write: if this has moved
  -- since the caller read the facts it composed content from, that content
  -- is stale, however internally well-formed it looks. See the migration
  -- header above.
  --
  -- IS DISTINCT FROM, NOT <>. In PostgreSQL, `x <> NULL` evaluates to NULL,
  -- not TRUE — and PL/pgSQL's `IF` only enters its branch on a TRUE
  -- condition, so `IF v_send_attempt_count <> NULL THEN ... END IF;` is
  -- SILENTLY SKIPPED whenever p_expected_send_attempt_count is NULL,
  -- falling straight through to the pair check as though the version
  -- matched. That would let a NULL/missing expected version bypass this
  -- guard entirely. `IS DISTINCT FROM` is NULL-safe by definition — it
  -- always returns TRUE or FALSE, never NULL, treating NULL as a value
  -- distinct from any non-NULL integer — so a NULL here is correctly
  -- treated as "does not match" and refused, the same as any other mismatch.
  if v_send_attempt_count is distinct from p_expected_send_attempt_count then
    return 'stale_regeneration';
  end if;

  -- ── THE CHANNEL-PAIR INVARIANT, PROVEN BEFORE ANY WRITE ──────────────────
  --
  -- Exactly one 'email' row and exactly one 'sms' row for THIS reminder AND
  -- THIS owner. UNIQUE(reminder_log_id, channel) (migration 010) already
  -- makes a duplicate within one channel structurally impossible at the
  -- database level — this count can therefore only ever be 0 or 1 per
  -- channel, never higher, and what it is actually checking for is a
  -- MISSING member of the pair.
  select count(*) filter (where channel = 'email'),
         count(*) filter (where channel = 'sms')
    into v_email_count, v_sms_count
    from public.reminder_channel_messages
   where reminder_log_id = p_reminder_id
     and user_id = p_user_id;

  if v_email_count = 0 and v_sms_count = 0 then
    return 'no_stored_content';
  end if;

  if v_email_count <> 1 or v_sms_count <> 1 then
    return 'invalid_channel_pair';
  end if;

  -- ── THE IDENTITY BEING PERSISTED MUST NOT BE BLANK ───────────────────────
  --
  -- No substitute, no placeholder, no login email — a blank value here
  -- refuses outright, exactly like a missing one. Never fabricated.
  if p_generated_sender_name is null or btrim(p_generated_sender_name) = '' then
    return 'missing_generated_sender_name';
  end if;

  -- ── THE WRITE — both channels, one statement, proven to have landed on
  -- both before anything else changes ──────────────────────────────────────
  with supplied (channel, subject, body) as (
    values
      ('email', p_email_subject, p_email_body),
      ('sms',   null::text,      p_sms_body)
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
    -- Rolls back this ENTIRE transaction — nothing below runs, and nothing
    -- above (the row lock aside) was ever persisted. A second, independent
    -- proof of the same pair invariant the count check above already
    -- established, exactly as update_invoice_with_refresh (migration 012)
    -- proves its own p_channels write with v_applied <> 2.
    raise exception
      'reminder % had % of 2 expected channel rows updated; regeneration requires both',
      p_reminder_id, v_applied
      using errcode = '23514',
            hint = 'Regeneration was rolled back. Neither channel was changed.';
  end if;

  update public.reminder_logs
     set generated_sender_name = p_generated_sender_name,
         send_attempt_count    = send_attempt_count + 1,
         reviewed_content_hash = null
   where id = p_reminder_id
     and user_id = p_user_id;

  return 'ok';
end;
$$;

comment on function public.regenerate_reminder_identity(uuid, uuid, integer, text, text, text, text) is
  'Atomically rewrites a PENDING or FAILED reminder''s stored email/SMS content and generated_sender_name from freshly-supplied values, clearing any customer edit and bumping send_attempt_count so an in-flight claim cannot observe or survive a partial rewrite. Refuses with stale_regeneration (zero writes) if send_attempt_count has moved since the caller read the facts it composed content from — e.g. a concurrent update_invoice_with_refresh. Proves BEFORE writing that exactly one email and one sms channel row exist for this reminder and owner, and again AFTER writing that both were actually updated, refusing (no write at all) otherwise. Refuses a blank generated_sender_name outright, never substituting one. Refuses (no write) for any status other than pending/failed. Companion to migration 015''s identity-drift gate — see lib/reminder-regenerate.ts.';

revoke all on function public.regenerate_reminder_identity(uuid, uuid, integer, text, text, text, text) from public;
revoke all on function public.regenerate_reminder_identity(uuid, uuid, integer, text, text, text, text) from anon, authenticated;
grant execute on function public.regenerate_reminder_identity(uuid, uuid, integer, text, text, text, text) to service_role;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
--
-- Deploy application code that no longer calls regenerate_reminder_identity
-- BEFORE dropping it — the same ordering every prior migration in this file
-- uses.
--
--   begin;
--     drop function if exists public.regenerate_reminder_identity(uuid, uuid, integer, text, text, text, text);
--   commit;
