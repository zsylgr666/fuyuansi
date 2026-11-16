-- DRAFT ONLY. Do not apply. Do not run this against any database, local or remote.
-- This is not a stock ledger and it does not make the candidate safe to ship.
--
-- Why a server change is in this file:
-- A page can pause only after it has seen a save_put conflict. The other device
-- can still call econ_earn and receive a committed grant before either page syncs.
-- A later client merge cannot undo that grant. A direct save_put, or any client
-- that ignores the local journal, can also replace public.saves.state and drop
-- the pause from the cloud. The candidate test recorded both of those limits.
--
-- What this draft adds, and what it refuses to add:
-- It adds an account-scoped crop_hold flag on the existing saves row, stores the
-- two original snapshots the detecting client sends, makes save_put refuse while
-- the flag is set, and makes a new crop econ_earn return reason quarantine
-- without inserting econ_earn_reqs. It does not add crop stock, harvests, gifts,
-- or meals. Client-reported balances are not authority.

-- Columns on the existing r7.2 saves row. rev stays the CAS counter already there.
alter table public.saves add column if not exists crop_hold boolean not null default false;
alter table public.saves add column if not exists hold_reason text;
alter table public.saves add column if not exists hold_local jsonb;
alter table public.saves add column if not exists hold_remote jsonb;
alter table public.saves add column if not exists hold_base jsonb;
alter table public.saves add column if not exists hold_at timestamptz;

-- save_get (sketch of the extra fields; keep the current body and add these keys)
--   'crop_hold', coalesce(s.crop_hold, false),
--   'hold_local', s.hold_local,
--   'hold_remote', s.hold_remote,
--   'hold_base', s.hold_base,
--   'hold_reason', s.hold_reason
-- The other device reads this on load / checkRemote and pauses. It must not
-- overwrite hold_local / hold_remote.

-- save_put predicate, after the row lock and BEFORE the rev mismatch return
-- and BEFORE the insert. p_base_rev null is the current unconditional reset;
-- while crop_hold it must also refuse, or clear() would delete the pause.
--
--   if found and cur.crop_hold then
--     return jsonb_build_object(
--       'ok', false, 'reason', 'quarantine', 'rev', cur.rev,
--       'state', case when cur.state = '{}'::jsonb then null else cur.state end,
--       'hold_local', cur.hold_local, 'hold_remote', cur.hold_remote,
--       'hold_base', cur.hold_base, 'hold_reason', cur.hold_reason);
--   end if;

-- First detector stores both snapshots at the current rev. A second caller sees
-- crop_hold and does not replace the pair. The client still has to send the
-- snapshots; a hostile client can store a false pair. The flag is the pause.
-- The pair is evidence, not a ledger.
create or replace function public.save_quarantine(p_base_rev bigint, p_local jsonb, p_remote jsonb, p_base jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); cur saves%rowtype;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  perform pg_advisory_xact_lock(hashtext('tg_save:' || uid::text));
  select * into cur from saves where user_id = uid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_save'); end if;
  if cur.rev is distinct from p_base_rev then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'rev', cur.rev, 'crop_hold', cur.crop_hold);
  end if;
  if cur.crop_hold then
    return jsonb_build_object('ok', true, 'already', true, 'rev', cur.rev,
      'hold_local', cur.hold_local, 'hold_remote', cur.hold_remote, 'hold_base', cur.hold_base);
  end if;
  update saves set crop_hold = true, hold_reason = 'save_conflict',
    hold_local = p_local, hold_remote = p_remote, hold_base = p_base, hold_at = now()
  where user_id = uid;
  return jsonb_build_object('ok', true, 'rev', cur.rev, 'crop_hold', true);
end $$;

-- revoke all on function public.save_quarantine(bigint, jsonb, jsonb, jsonb) from public, anon;
-- grant execute on function public.save_quarantine(bigint, jsonb, jsonb, jsonb) to authenticated;

-- econ_earn, source sell only, AFTER auth and BEFORE the econ_earn_reqs insert:
--   if p_source = 'sell' and exists (select 1 from saves s where s.user_id = uid and s.crop_hold) then
--     return jsonb_build_object('ok', false, 'reason', 'quarantine');
--   end if;
-- Do not insert econ_earn_reqs for that refusal, so it is not a committed grant
-- and the same req can be judged again after a human clears the hold.
-- A row already in econ_earn_reqs stays. Replay still returns it. This draft
-- does not delete or rewrite a grant that has already committed.

-- Optional, still not a stock ledger. Narrows the "both devices earn before
-- either save_put" hole. Old clients never call it, so they bypass it.
-- A crashed holder is cleared only by the TTL, which also reopens the hole.
-- One device can still oversell locally: harvest, gifts, and meals are not
-- on the server, and this table does not count stock.
create table if not exists public.crop_session (
  owner uuid primary key references auth.users(id) on delete cascade,
  device text not null,
  req text,
  acquired_at timestamptz not null default now()
);

create or replace function public.crop_begin(p_device text, p_req text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); cur public.crop_session%rowtype;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_device is null or length(p_device) < 8 or length(p_device) > 64 then
    return jsonb_build_object('ok', false, 'reason', 'bad_device');
  end if;
  if exists (select 1 from saves s where s.user_id = uid and s.crop_hold) then
    return jsonb_build_object('ok', false, 'reason', 'quarantine');
  end if;
  perform pg_advisory_xact_lock(hashtext('tg_crop:' || uid::text));
  select * into cur from crop_session where owner = uid for update;
  if found and cur.device is distinct from p_device and cur.acquired_at > now() - interval '120 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'other_device');
  end if;
  insert into crop_session(owner, device, req, acquired_at) values (uid, p_device, p_req, now())
  on conflict (owner) do update set device = excluded.device, req = excluded.req, acquired_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- revoke all on function public.crop_begin(text, text) from public, anon;
-- grant execute on function public.crop_begin(text, text) to authenticated;

-- Rollout risks, if this draft is ever applied:
-- Page first, SQL later: the pause is local to the device that saw the conflict.
--   The other device still gets a crop grant. A raw save_put still replaces the blob.
-- SQL first, page later: an old open page has already credited coins before the
--   RPC returns. reason quarantine does not claw those coins back. An old page
--   that treats any ok:false as "restore the stack" can also restore stock for
--   a pause, which this candidate explicitly does not do.
-- crop_begin is optional and bypassable. It is not a substitute for the hold
--   flag, and neither one is a stock ledger.
-- There is no human-clear function in this draft. Clearing crop_hold is a
--   separate reviewed action. This file does not provide one.
