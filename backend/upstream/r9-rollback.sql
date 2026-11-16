-- r9-rollback — undo r9.sql: restore tg_limit (r7.3), econ_earn / econ_status (r6), market_buy (r5), space_save (r4); drop the r9
-- functions and tables. Idempotent. NOTE: drops shop_credit / sellback_ledger / market_buy_reqs / space_decor_taken (their data is lost;
-- coins and items already granted stay in players' saves). sell_coins / sellback_coins / shop_buy rows in daily_counts are left (harmless).
begin;
drop function if exists public.econ_shop_buy(text, int, text);
drop function if exists public.econ_sellback(text, int, int, text);
drop function if exists public.econ_sellback_seed(jsonb);
drop function if exists public.econ_sellback_credit();
drop function if exists public.space_take_decor(uuid, text, text, double precision, double precision, text);
drop function if exists public.market_buy(bigint, text);
drop table if exists public.sellback_ledger;
drop table if exists public.shop_credit;
drop table if exists public.shop_prices;
drop table if exists public.market_buy_reqs;
drop table if exists public.space_decor_taken;
drop table if exists public.r9_meta;

-- tg_limit: r7.3.sql
create or replace function public.tg_limit(p_kind text) returns bigint language sql immutable as $$
  select case p_kind
    when 'earn_coins'   then 40
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
    when 'suggest'      then 3       -- r7: suggestions per player per day (Asia/Shanghai day)
    when 'suggest_fu'   then 10      -- r7: follow-up answers per player per day
    when 'wish'         then 5       -- r7.3: wish plaques per player per day (= the altar's 5 slots)
    when 'wish_gap_s'   then 10      -- r7.3: seconds between two plaques
    else 0 end
$$;

-- econ_earn / econ_status: r6.sql
create or replace function public.econ_earn(p_coins bigint, p_source text default 'sell', p_exact boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); want bigint := p_coins; g bigint; k text;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_coins is null or p_coins <= 0 or p_coins > 100000 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;
  if p_source is null or p_source not in ('sell', 'task', 'merit', 'steal') then return jsonb_build_object('ok', false, 'reason', 'bad_source'); end if;
  perform pg_advisory_xact_lock(hashtext('tg_econ'), hashtext(uid::text));
  k := case when p_source = 'steal' then 'steal_coins' else 'earn_coins' end;
  want := least(want, tg_limit(k) - tg_daily_used(uid, k));
  if p_source = 'merit' then want := least(want, tg_limit('merit_coins') - tg_daily_used(uid, 'merit_coins')); end if;
  if want <= 0 or (p_exact and want < p_coins) then
    return jsonb_build_object('ok', false, 'granted', 0, 'reason', 'daily_cap', 'left', greatest(0, tg_limit(k) - tg_daily_used(uid, k)));
  end if;
  g := tg_take_daily(uid, k, tg_limit(k), want);
  if p_source = 'merit' then perform tg_take_daily(uid, 'merit_coins', tg_limit('merit_coins'), g); end if;
  return jsonb_build_object('ok', g > 0, 'granted', g, 'left', tg_limit(k) - tg_daily_used(uid, k), 'cap', tg_limit(k));
end $$;
create or replace function public.econ_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  return jsonb_build_object('day', tg_day(),
    'earn_cap', tg_limit('earn_coins'), 'earn_left', tg_limit('earn_coins') - tg_daily_used(uid, 'earn_coins'),
    'merit_coins_left', tg_limit('merit_coins') - tg_daily_used(uid, 'merit_coins'),
    'steal_cap', tg_limit('steal_coins'), 'steal_left', tg_limit('steal_coins') - tg_daily_used(uid, 'steal_coins'),
    'market_cap', tg_limit('market_coins'), 'market_left', tg_limit('market_coins') - tg_daily_used(uid, 'market_coins'),
    'crops', coalesce((select jsonb_object_agg(id, grow_ms) from crop_rules), '{}'::jsonb));
end $$;
-- market_buy: r5.sql
create or replace function public.market_buy(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); l market_listings%rowtype; n int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into l from market_listings where id = p_id for update;
  if not found or l.status <> 'active' or l.created_at <= now() - tg_market_ttl() then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  if l.seller = uid then return jsonb_build_object('ok', false, 'reason', 'own'); end if;
  select count(*) into n from market_listings where buyer = uid and closed_at > now() - interval '1 hour';
  if n >= 30 then return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
  update market_listings set status = 'sold', buyer = uid, closed_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'id', l.id, 'item_kind', l.item_kind, 'item_id', l.item_id, 'qty', l.qty, 'price', l.price);
end $$;
-- space_save: r4.sql
create or replace function public.space_save(p_owner uuid, p_shrine jsonb default null, p_decor jsonb default null, p_animals jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); nrev bigint;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not tg_can_edit(p_owner) then raise exception 'not allowed'; end if;
  if p_decor is not null and jsonb_typeof(p_decor) <> 'object' then raise exception 'bad decor'; end if;
  if pg_column_size(coalesce(p_shrine, '{}'::jsonb)) + pg_column_size(coalesce(p_decor, '{}'::jsonb)) + pg_column_size(coalesce(p_animals, '[]'::jsonb)) > 200000 then
    raise exception 'space too large'; end if;
  insert into showcases(owner) values (p_owner) on conflict (owner) do nothing;
  update showcases set
      shrine = coalesce(p_shrine, shrine),
      decor = case when p_decor is null then decor else coalesce(decor, '{}'::jsonb) || p_decor end,
      animals = coalesce(p_animals, animals),
      rev = rev + 1, editor = uid, updated_at = now()
    where owner = p_owner returning rev into nrev;
  if pg_column_size((select decor from showcases where owner = p_owner)) > 200000 then raise exception 'space too large'; end if;
  return jsonb_build_object('ok', true, 'rev', nrev);
end $$;
drop function if exists public.tg_decor_match(jsonb, text, double precision, double precision);
drop function if exists public.tg_req_ok(text);

revoke all on function public.tg_limit(text) from public, anon, authenticated;
revoke all on function public.econ_earn(bigint, text, boolean), public.econ_status(), public.market_buy(bigint), public.space_save(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.econ_earn(bigint, text, boolean), public.econ_status(), public.market_buy(bigint), public.space_save(uuid, jsonb, jsonb, jsonb) to authenticated;
commit;
notify pgrst, 'reload schema';
