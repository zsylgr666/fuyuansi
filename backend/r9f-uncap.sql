-- r9f FORWARD DRAFT — crop sales stay uncapped, and a stale earn reply cannot turn uncapped back on.
-- Apply AFTER r9.sql (and after r9e-uncap.sql if that was already applied). Idempotent.
-- Does not change furniture sell-back (400), task/merit earn_coins (40), merit_coins (8), steal,
-- shop prices, credit, sell-back ledgers, market_buy, or family decor.
--
-- sell_policy is one row. epoch only increases. uncapped is the live crop mode.
-- econ_earn and econ_status read that row. A committed earn stores the epoch it decided under.
-- Replaying that request returns the stored grant and the old epoch. It does not change the row,
-- so a grant decided before rollback cannot turn unlimited back on.
-- While uncapped, tg_limit('sell_coins') stays NULL and the sale does not call tg_take_daily.
-- sell_cap/sell_left 100 are the legacy advertisement for an already-open r9b/r9c page.
-- While the row is capped, the ceiling passed to tg_take_daily is the literal 100. It is not a larger number.
-- p_req is optional. Old callers that omit it still run. A crop confirmation sends p_req and is replayed.
-- The 3-argument econ_earn is dropped so PostgREST has one function; the 4th argument defaults to null.
-- Inventory stays client-side. This file is a DRAFT. The agent did not run it on a live database.
begin;

create table if not exists public.sell_policy (
  id int primary key check (id = 1),
  epoch bigint not null check (epoch >= 1),
  uncapped boolean not null
);
create table if not exists public.econ_earn_reqs (
  owner uuid not null references auth.users(id),
  req text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner, req)
);
alter table public.sell_policy enable row level security;
alter table public.econ_earn_reqs enable row level security;
revoke all on table public.sell_policy from public, anon, authenticated;
revoke all on table public.econ_earn_reqs from public, anon, authenticated;

lock table public.sell_policy in exclusive mode;
insert into public.sell_policy(id, epoch, uncapped) values (1, 1, true)
on conflict (id) do update set epoch = public.sell_policy.epoch + 1, uncapped = true;

create or replace function public.tg_limit(p_kind text) returns bigint language sql immutable as $$
  select case p_kind
    when 'earn_coins'   then 40
    when 'sell_coins'   then null::bigint  -- no numeric crop ceiling. The live mode is sell_policy.uncapped.
    when 'sellback_coins' then 400
    when 'shop_buy'     then 60
    when 'merit_coins'  then 8
    when 'steal_coins'  then 15
    when 'market_coins' then 500
    when 'koi'          then 3
    when 'slip'         then 3
    when 'lantern'      then 3
    when 'tea_post'     then 30
    when 'avatar_buy'   then 30
    when 'tea_gap_s'    then 20
    when 'merit_day'    then 80
    when 'suggest'      then 3
    when 'suggest_fu'   then 10
    when 'wish'         then 5
    when 'wish_gap_s'   then 10
    else 0 end
$$;

-- r9f-econ-earn (this body is identical in r9f-uncap-rollback.sql)
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

revoke all on function public.tg_limit(text) from public, anon, authenticated;
revoke all on function public.econ_earn(bigint, text, boolean, text), public.econ_status() from public, anon;
grant execute on function public.econ_earn(bigint, text, boolean, text), public.econ_status() to authenticated;

commit;
notify pgrst, 'reload schema';
