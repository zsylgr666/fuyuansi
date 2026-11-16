-- r9h-q2 HOLD ROLLBACK DRAFT. Not applied to any live database.
-- This is the only rollback for backend/r9h-q2-hold.sql.
-- Do NOT apply backend/r9f-uncap-rollback.sql by itself while the hold is
-- installed. That file replaces econ_earn and moves sell_policy, and it leaves
-- the hold's save_put in place, so a new earn can pay while save_put still
-- returns quarantine.
--
-- This file restores save_get and save_put to the r7.2 bodies, and econ_earn /
-- econ_status to the r9f forward bodies (the same text as backend/r9f-uncap.sql).
-- It does not bump or reset sell_policy.epoch. It does not drop econ_earn_reqs.
-- It does not drop the hold columns. It does clear crop_hold and the snapshot
-- values on every row. Copy crop_hold_review() first if that evidence must be
-- kept. Re-applying r9h-q2-hold.sql after this file must not treat those old
-- snapshots as a new freeze, because the flag and the values are gone.
-- Clearing the flag is the operator's explicit rollback. It is not a choice
-- of which device's coins win.
begin;

drop trigger if exists saves_hold on public.saves;
drop function if exists public.tg_saves_hold();
drop function if exists public.save_quarantine(bigint, jsonb, jsonb, jsonb, text, text);
drop function if exists public.crop_hold_review();
drop function if exists public.crop_hold_clear();

-- Clearing the flag must not bump saves.rev. Otherwise the next save_put
-- looks like a conflict with a write that never changed the game state.
select set_config('tg.save_rpc', '1', true);
update public.saves set crop_hold = false, hold_reason = null, hold_local = null,
  hold_remote = null, hold_base = null, hold_at = null, hold_rev = null,
  hold_device = null, hold_source = null
where crop_hold;

create or replace function public.save_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then jsonb_build_object('ok', false, 'reason', 'not_signed_in')
    else coalesce((select jsonb_build_object('ok', true, 'state', case when s.state = '{}'::jsonb then null else s.state end,
                                             'rev', s.rev, 'updated_at', s.updated_at)
                   from saves s where s.user_id = auth.uid()),
                  jsonb_build_object('ok', true, 'state', null, 'rev', 0, 'updated_at', null)) end
$$;

create or replace function public.save_put(p_state jsonb, p_base_rev bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur saves%rowtype; nrev bigint; m numeric;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_state'); end if;
  if pg_column_size(p_state) > 2000000 then return jsonb_build_object('ok', false, 'reason', 'too_big'); end if;
  perform pg_advisory_xact_lock(hashtext('tg_save:' || uid::text));
  select * into cur from saves where user_id = uid for update;
  if found and p_base_rev is not null and cur.rev <> p_base_rev then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'rev', cur.rev,
                              'state', case when cur.state = '{}'::jsonb then null else cur.state end, 'updated_at', cur.updated_at);
  end if;
  nrev := coalesce(cur.rev, 0) + 1;
  m := case when jsonb_typeof(p_state -> 'merit') = 'number' then (p_state ->> 'merit')::numeric else 0 end;
  perform set_config('tg.save_rpc', '1', true);
  insert into saves(user_id, state, merit, updated_at, rev) values (uid, p_state, greatest(least(round(m), 2000000000), -2000000000)::int, now(), nrev)
  on conflict (user_id) do update set state = excluded.state, merit = excluded.merit, updated_at = now(), rev = nrev;
  perform set_config('tg.save_rpc', '', true);
  return jsonb_build_object('ok', true, 'rev', nrev);
end $$;

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
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_source is null or p_source not in ('sell', 'task', 'merit', 'steal') then return jsonb_build_object('ok', false, 'reason', 'bad_source'); end if;
  if p_req is not null and not tg_req_ok(p_req) then return jsonb_build_object('ok', false, 'reason', 'bad_req'); end if;
  if p_coins is null or p_coins <= 0 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;
  if p_source = 'sell' and p_coins > 9007199254740991 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;
  if p_source <> 'sell' and p_coins > 100000 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;

  perform pg_advisory_xact_lock(hashtext('tg_econ'), hashtext(uid::text));
  if p_req is not null then
    select result into v_prev from econ_earn_reqs where owner = uid and req = p_req;
    if found then return v_prev || jsonb_build_object('replay', true); end if;
  end if;

  select epoch, uncapped into v_epoch, v_uncapped from sell_policy where id = 1 for update;
  if not found then v_uncapped := false; end if;
  v_sell_left := case when v_uncapped then 100 else greatest(0, 100 - tg_daily_used(uid, 'sell_coins')) end;

  if p_source = 'sell' and v_uncapped then
    v_res := jsonb_build_object('ok', true, 'granted', p_coins, 'left', 100, 'cap', 100,
      'sell_uncapped', true, 'sell_epoch', v_epoch, 'sell_cap', 100, 'sell_left', 100);
    if p_req is not null then insert into econ_earn_reqs(owner, req, result) values (uid, p_req, v_res); end if;
    return v_res;
  end if;

  if p_source = 'sell' then
    want := least(want, v_sell_left);
    if want <= 0 or (p_exact and want < p_coins) then
      return jsonb_build_object('ok', false, 'granted', 0, 'reason', 'daily_cap', 'left', v_sell_left, 'cap', 100,
        'sell_uncapped', false, 'sell_epoch', v_epoch, 'sell_cap', 100, 'sell_left', v_sell_left);
    end if;
    g := tg_take_daily(uid, 'sell_coins', 100, want);
    v_sell_left := greatest(0, 100 - tg_daily_used(uid, 'sell_coins'));
    v_res := jsonb_build_object('ok', g > 0, 'granted', g, 'left', v_sell_left, 'cap', 100,
      'sell_uncapped', false, 'sell_epoch', v_epoch, 'sell_cap', 100, 'sell_left', v_sell_left);
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
      'sell_uncapped', v_uncapped, 'sell_epoch', v_epoch, 'sell_cap', 100, 'sell_left', v_sell_left);
  end if;
  g := tg_take_daily(uid, k, tg_limit(k), want);
  if p_source = 'merit' then perform tg_take_daily(uid, 'merit_coins', tg_limit('merit_coins'), g); end if;
  v_res := jsonb_build_object('ok', g > 0, 'granted', g, 'left', tg_limit(k) - tg_daily_used(uid, k), 'cap', tg_limit(k),
    'sell_uncapped', v_uncapped, 'sell_epoch', v_epoch, 'sell_cap', 100, 'sell_left', v_sell_left);
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
begin
  if uid is null then raise exception 'not signed in'; end if;
  select epoch, uncapped into v_epoch, v_uncapped from sell_policy where id = 1;
  if not found then v_uncapped := false; end if;
  v_sell_left := case when v_uncapped then 100 else greatest(0, 100 - tg_daily_used(uid, 'sell_coins')) end;
  return jsonb_build_object('day', tg_day(),
    'earn_cap', tg_limit('earn_coins'), 'earn_left', tg_limit('earn_coins') - tg_daily_used(uid, 'earn_coins'),
    'sell_uncapped', v_uncapped,
    'sell_epoch', v_epoch,
    'sell_cap', 100, 'sell_left', v_sell_left,
    'sellback_cap', tg_limit('sellback_coins'), 'sellback_left', tg_limit('sellback_coins') - tg_daily_used(uid, 'sellback_coins'),
    'merit_coins_left', tg_limit('merit_coins') - tg_daily_used(uid, 'merit_coins'),
    'steal_cap', tg_limit('steal_coins'), 'steal_left', tg_limit('steal_coins') - tg_daily_used(uid, 'steal_coins'),
    'market_cap', tg_limit('market_coins'), 'market_left', tg_limit('market_coins') - tg_daily_used(uid, 'market_coins'),
    'crops', coalesce((select jsonb_object_agg(id, grow_ms) from crop_rules), '{}'::jsonb));
end $$;

revoke all on function public.econ_earn(bigint, text, boolean, text), public.econ_status() from public, anon;
grant execute on function public.econ_earn(bigint, text, boolean, text), public.econ_status() to authenticated;
grant execute on function public.save_get(), public.save_put(jsonb, bigint) to authenticated;

commit;
notify pgrst, 'reload schema';
