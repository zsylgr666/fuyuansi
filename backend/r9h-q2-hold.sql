-- r9h-q2 CANDIDATE — account crop hold. DRAFT. Not applied to any live database.
-- Apply AFTER backend/r9f-uncap.sql. Idempotent. Does not bump sell_policy.epoch.
-- Does not add crop stock. Does not change furniture, task, merit, or steal caps.
--
-- Lock order, the same in every function that takes more than one of these:
--   1. pg_advisory_xact_lock(hashtext('tg_save:' || uid))
--   2. saves row FOR UPDATE
--   3. pg_advisory_xact_lock(hashtext('tg_econ'), hashtext(uid))   -- earn only
--   4. sell_policy row FOR UPDATE                                 -- earn only
-- save_put and save_quarantine stop at step 2, so they cannot deadlock with earn.
-- A sell grant is inserted only after step 2 has seen crop_hold = false.
-- A hold that commits first makes the waiting earn return reason quarantine
-- and insert nothing. A grant that commits first stays; later calls replay it.
-- The account is always auth.uid(). No function here takes a caller-chosen owner.
begin;

alter table public.saves add column if not exists crop_hold boolean not null default false;
alter table public.saves add column if not exists hold_reason text;
alter table public.saves add column if not exists hold_local jsonb;
alter table public.saves add column if not exists hold_remote jsonb;
alter table public.saves add column if not exists hold_base jsonb;
alter table public.saves add column if not exists hold_at timestamptz;
alter table public.saves add column if not exists hold_rev bigint;
alter table public.saves add column if not exists hold_device text;
alter table public.saves add column if not exists hold_source text;

-- Direct table writes bypass save_put. While the hold is set they must not
-- replace the state or clear the evidence. crop_hold_clear sets tg.crop_hold_mgr.
create or replace function public.tg_saves_hold() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.crop_hold and coalesce(current_setting('tg.crop_hold_mgr', true), '') <> '1' then
    raise exception 'crop_hold' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists saves_hold on public.saves;
create trigger saves_hold before update on public.saves
  for each row execute function public.tg_saves_hold();

create or replace function public.save_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then jsonb_build_object('ok', false, 'reason', 'not_signed_in')
    else coalesce((select jsonb_build_object(
        'ok', true,
        'state', case when s.state = '{}'::jsonb then null else s.state end,
        'rev', s.rev, 'updated_at', s.updated_at,
        'crop_hold', s.crop_hold,
        'hold_reason', s.hold_reason,
        'hold_local', s.hold_local, 'hold_remote', s.hold_remote, 'hold_base', s.hold_base,
        'hold_at', s.hold_at, 'hold_rev', s.hold_rev,
        'hold_device', s.hold_device, 'hold_source', s.hold_source)
      from saves s where s.user_id = auth.uid()),
      jsonb_build_object('ok', true, 'state', null, 'rev', 0, 'updated_at', null, 'crop_hold', false)) end
$$;

-- p_base_rev null remains the unconditional reset, and it is refused while held.
create or replace function public.save_put(p_state jsonb, p_base_rev bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur saves%rowtype; nrev bigint; m numeric;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_state'); end if;
  if pg_column_size(p_state) > 2000000 then return jsonb_build_object('ok', false, 'reason', 'too_big'); end if;
  perform pg_advisory_xact_lock(hashtext('tg_save:' || uid::text));
  select * into cur from saves where user_id = uid for update;
  if found and cur.crop_hold then
    return jsonb_build_object('ok', false, 'reason', 'quarantine', 'crop_hold', true, 'rev', cur.rev,
      'state', case when cur.state = '{}'::jsonb then null else cur.state end, 'updated_at', cur.updated_at,
      'hold_reason', cur.hold_reason, 'hold_local', cur.hold_local, 'hold_remote', cur.hold_remote,
      'hold_base', cur.hold_base, 'hold_at', cur.hold_at, 'hold_rev', cur.hold_rev,
      'hold_device', cur.hold_device, 'hold_source', cur.hold_source);
  end if;
  if found and p_base_rev is not null and cur.rev <> p_base_rev then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'crop_hold', false, 'rev', cur.rev,
      'state', case when cur.state = '{}'::jsonb then null else cur.state end, 'updated_at', cur.updated_at);
  end if;
  nrev := coalesce(cur.rev, 0) + 1;
  m := case when jsonb_typeof(p_state -> 'merit') = 'number' then (p_state ->> 'merit')::numeric else 0 end;
  perform set_config('tg.save_rpc', '1', true);
  insert into saves(user_id, state, merit, updated_at, rev) values (uid, p_state, greatest(least(round(m), 2000000000), -2000000000)::int, now(), nrev)
  on conflict (user_id) do update set state = excluded.state, merit = excluded.merit, updated_at = now(), rev = nrev;
  perform set_config('tg.save_rpc', '', true);
  return jsonb_build_object('ok', true, 'rev', nrev, 'crop_hold', false);
end $$;

create or replace function public.save_quarantine(
  p_base_rev bigint, p_local jsonb, p_remote jsonb, p_base jsonb, p_device text, p_source text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur saves%rowtype;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_local is null or jsonb_typeof(p_local) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_snapshot'); end if;
  if p_remote is null or jsonb_typeof(p_remote) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_snapshot'); end if;
  if p_base is not null and jsonb_typeof(p_base) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_snapshot'); end if;
  if pg_column_size(p_local) > 2000000 or pg_column_size(p_remote) > 2000000
     or (p_base is not null and pg_column_size(p_base) > 2000000) then
    return jsonb_build_object('ok', false, 'reason', 'too_big');
  end if;
  if p_device is not null and p_device !~ '^[A-Za-z0-9_.:-]{8,64}$' then return jsonb_build_object('ok', false, 'reason', 'bad_device'); end if;
  if p_source is distinct from 'save_conflict' then return jsonb_build_object('ok', false, 'reason', 'bad_source'); end if;
  perform pg_advisory_xact_lock(hashtext('tg_save:' || uid::text));
  select * into cur from saves where user_id = uid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_save'); end if;
  if cur.crop_hold then
    return jsonb_build_object('ok', true, 'already', true, 'crop_hold', true, 'reason', 'quarantine', 'rev', cur.rev,
      'state', case when cur.state = '{}'::jsonb then null else cur.state end,
      'hold_reason', cur.hold_reason, 'hold_local', cur.hold_local, 'hold_remote', cur.hold_remote,
      'hold_base', cur.hold_base, 'hold_at', cur.hold_at, 'hold_rev', cur.hold_rev,
      'hold_device', cur.hold_device, 'hold_source', cur.hold_source);
  end if;
  if p_base_rev is null or cur.rev is distinct from p_base_rev then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'crop_hold', false, 'rev', cur.rev,
      'state', case when cur.state = '{}'::jsonb then null else cur.state end);
  end if;
  perform set_config('tg.save_rpc', '1', true);
  update saves set crop_hold = true, hold_reason = 'save_conflict',
    hold_local = p_local, hold_remote = p_remote, hold_base = p_base,
    hold_at = now(), hold_rev = cur.rev, hold_device = p_device, hold_source = p_source
  where user_id = uid;
  perform set_config('tg.save_rpc', '', true);
  return jsonb_build_object('ok', true, 'already', false, 'crop_hold', true, 'rev', cur.rev,
    'state', case when cur.state = '{}'::jsonb then null else cur.state end,
    'hold_reason', 'save_conflict', 'hold_local', p_local, 'hold_remote', p_remote, 'hold_base', p_base,
    'hold_rev', cur.rev, 'hold_device', p_device, 'hold_source', p_source);
end $$;

-- Read path for the signed-in account only. Clearing is a separate function and is not granted here.
create or replace function public.crop_hold_review() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur saves%rowtype;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into cur from saves where user_id = uid;
  if not found then return jsonb_build_object('ok', true, 'crop_hold', false); end if;
  return jsonb_build_object('ok', true, 'crop_hold', cur.crop_hold, 'rev', cur.rev,
    'hold_reason', cur.hold_reason, 'hold_local', cur.hold_local, 'hold_remote', cur.hold_remote,
    'hold_base', cur.hold_base, 'hold_at', cur.hold_at, 'hold_rev', cur.hold_rev,
    'hold_device', cur.hold_device, 'hold_source', cur.hold_source);
end $$;

-- Operator draft. Not granted to anon or authenticated. The game never calls it.
-- There is no TTL. Logout and save_put reset do not call it.
create or replace function public.crop_hold_clear() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  perform pg_advisory_xact_lock(hashtext('tg_save:' || uid::text));
  perform set_config('tg.crop_hold_mgr', '1', true);
  perform set_config('tg.save_rpc', '1', true);
  update saves set crop_hold = false where user_id = uid and crop_hold;
  perform set_config('tg.save_rpc', '', true);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'cleared', n);
end $$;

-- r9f-econ-earn plus the hold check. Replay of a stored req stays a stored req.
drop function if exists public.econ_earn(bigint, text, boolean);
create or replace function public.econ_earn(p_coins bigint, p_source text default 'sell', p_exact boolean default false, p_req text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  want bigint := p_coins;
  g bigint;
  k text;
  v_epoch bigint;
  v_uncapped boolean := false;
  v_prev jsonb;
  v_res jsonb;
  v_sell_left bigint;
  v_save saves%rowtype;
  v_hold boolean := false;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_source is null or p_source not in ('sell', 'task', 'merit', 'steal') then return jsonb_build_object('ok', false, 'reason', 'bad_source'); end if;
  if p_req is not null and not tg_req_ok(p_req) then return jsonb_build_object('ok', false, 'reason', 'bad_req'); end if;
  if p_coins is null or p_coins <= 0 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;
  if p_source = 'sell' and p_coins > 9007199254740991 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;
  if p_source <> 'sell' and p_coins > 100000 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;

  perform pg_advisory_xact_lock(hashtext('tg_save:' || uid::text));
  perform pg_advisory_xact_lock(hashtext('tg_econ'), hashtext(uid::text));
  select * into v_save from saves where user_id = uid for update;
  v_hold := found and v_save.crop_hold;
  if p_req is not null then
    select result into v_prev from econ_earn_reqs where owner = uid and req = p_req;
    if found then return v_prev || jsonb_build_object('replay', true, 'crop_hold', v_hold); end if;
  end if;
  if p_source = 'sell' and v_hold then
    select epoch, uncapped into v_epoch, v_uncapped from sell_policy where id = 1 for update;
    if not found then v_uncapped := false; end if;
    return jsonb_build_object('ok', false, 'reason', 'quarantine', 'granted', 0, 'crop_hold', true,
      'sell_uncapped', v_uncapped, 'sell_epoch', v_epoch, 'sell_cap', 100, 'sell_left', 100,
      'hold_rev', v_save.hold_rev, 'hold_device', v_save.hold_device, 'hold_source', v_save.hold_source);
  end if;

  select epoch, uncapped into v_epoch, v_uncapped from sell_policy where id = 1 for update;
  if not found then v_uncapped := false; end if;
  v_sell_left := case when v_uncapped then 100 else greatest(0, 100 - tg_daily_used(uid, 'sell_coins')) end;

  if p_source = 'sell' and v_uncapped then
    v_res := jsonb_build_object('ok', true, 'granted', p_coins, 'left', 100, 'cap', 100,
      'sell_uncapped', true, 'sell_epoch', v_epoch, 'sell_cap', 100, 'sell_left', 100, 'crop_hold', false);
    if p_req is not null then insert into econ_earn_reqs(owner, req, result) values (uid, p_req, v_res); end if;
    return v_res;
  end if;

  if p_source = 'sell' then
    want := least(want, v_sell_left);
    if want <= 0 or (p_exact and want < p_coins) then
      return jsonb_build_object('ok', false, 'granted', 0, 'reason', 'daily_cap', 'left', v_sell_left, 'cap', 100,
        'sell_uncapped', false, 'sell_epoch', v_epoch, 'sell_cap', 100, 'sell_left', v_sell_left, 'crop_hold', false);
    end if;
    g := tg_take_daily(uid, 'sell_coins', 100, want);
    v_sell_left := greatest(0, 100 - tg_daily_used(uid, 'sell_coins'));
    v_res := jsonb_build_object('ok', g > 0, 'granted', g, 'left', v_sell_left, 'cap', 100,
      'sell_uncapped', false, 'sell_epoch', v_epoch, 'sell_cap', 100, 'sell_left', v_sell_left, 'crop_hold', false);
    if p_req is not null then insert into econ_earn_reqs(owner, req, result) values (uid, p_req, v_res); end if;
    return v_res;
  end if;

  k := case when p_source = 'steal' then 'steal_coins' else 'earn_coins' end;
  want := least(want, tg_limit(k) - tg_daily_used(uid, k));
  if p_source = 'merit' then want := least(want, tg_limit('merit_coins') - tg_daily_used(uid, 'merit_coins')); end if;
  if want <= 0 or (p_exact and want < p_coins) then
    return jsonb_build_object('ok', false, 'granted', 0, 'reason', 'daily_cap',
      'left', greatest(0, tg_limit(k) - tg_daily_used(uid, k)),
      'merit_left', case when p_source = 'merit' then greatest(0, tg_limit('merit_coins') - tg_daily_used(uid, 'merit_coins')) end,
      'sell_uncapped', v_uncapped, 'sell_epoch', v_epoch, 'sell_cap', 100, 'sell_left', v_sell_left, 'crop_hold', false);
  end if;
  g := tg_take_daily(uid, k, tg_limit(k), want);
  if p_source = 'merit' then perform tg_take_daily(uid, 'merit_coins', tg_limit('merit_coins'), g); end if;
  v_res := jsonb_build_object('ok', g > 0, 'granted', g, 'left', tg_limit(k) - tg_daily_used(uid, k), 'cap', tg_limit(k),
    'sell_uncapped', v_uncapped, 'sell_epoch', v_epoch, 'sell_cap', 100, 'sell_left', v_sell_left, 'crop_hold', false);
  if p_req is not null then insert into econ_earn_reqs(owner, req, result) values (uid, p_req, v_res); end if;
  return v_res;
end $$;

create or replace function public.econ_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_epoch bigint;
  v_uncapped boolean := false;
  v_sell_left bigint;
  v_save saves%rowtype;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select epoch, uncapped into v_epoch, v_uncapped from sell_policy where id = 1;
  if not found then v_uncapped := false; end if;
  v_sell_left := case when v_uncapped then 100 else greatest(0, 100 - tg_daily_used(uid, 'sell_coins')) end;
  select * into v_save from saves where user_id = uid;
  return jsonb_build_object('day', tg_day(),
    'earn_cap', tg_limit('earn_coins'), 'earn_left', tg_limit('earn_coins') - tg_daily_used(uid, 'earn_coins'),
    'sell_uncapped', v_uncapped,
    'sell_epoch', v_epoch,
    'sell_cap', 100, 'sell_left', v_sell_left,
    'sellback_cap', tg_limit('sellback_coins'), 'sellback_left', tg_limit('sellback_coins') - tg_daily_used(uid, 'sellback_coins'),
    'merit_coins_left', tg_limit('merit_coins') - tg_daily_used(uid, 'merit_coins'),
    'steal_cap', tg_limit('steal_coins'), 'steal_left', tg_limit('steal_coins') - tg_daily_used(uid, 'steal_coins'),
    'market_cap', tg_limit('market_coins'), 'market_left', tg_limit('market_coins') - tg_daily_used(uid, 'market_coins'),
    'crops', coalesce((select jsonb_object_agg(id, grow_ms) from crop_rules), '{}'::jsonb),
    'crop_hold', coalesce(v_save.crop_hold, false),
    'hold_reason', v_save.hold_reason, 'hold_local', v_save.hold_local, 'hold_remote', v_save.hold_remote,
    'hold_base', v_save.hold_base, 'hold_rev', v_save.hold_rev, 'hold_device', v_save.hold_device, 'hold_source', v_save.hold_source);
end $$;

revoke all on function public.tg_saves_hold() from public, anon, authenticated;
revoke all on function public.save_quarantine(bigint, jsonb, jsonb, jsonb, text, text) from public, anon;
revoke all on function public.crop_hold_review() from public, anon;
revoke all on function public.crop_hold_clear() from public, anon, authenticated;
grant execute on function public.save_quarantine(bigint, jsonb, jsonb, jsonb, text, text) to authenticated;
grant execute on function public.crop_hold_review() to authenticated;
grant execute on function public.econ_earn(bigint, text, boolean, text), public.econ_status() to authenticated;
grant execute on function public.save_get(), public.save_put(jsonb, bigint) to authenticated;

commit;
notify pgrst, 'reload schema';
