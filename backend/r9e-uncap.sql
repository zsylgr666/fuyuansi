-- r9e FORWARD DRAFT — remove the daily coin ceiling on crops/produce ('sell').
-- Apply AFTER r9.sql. Idempotent (create or replace). Does not change furniture sell-back (400),
-- task/merit earn_coins (40), merit_coins (8), steal, shop prices, credit, request-id ledgers,
-- market_buy idempotency, or family decor.
-- 'sell' is not given a larger numeric cap. tg_limit('sell_coins') is NULL. econ_status reports
-- sell_uncapped true. sell_cap and sell_left are the legacy 100 advertisement for already-open r9b/r9c pages.
-- Those pages only keep their own crop pool when sell_left is a number; null makes them share the 40 and
-- add the coins to coinsEarned. 100 is the ceiling they already enforce. It is not raised and it is not unlimited.
-- A new page ignores both numbers while sell_uncapped is true. tg_limit('sell_coins') stays NULL: there is
-- still no server-side daily ceiling.
-- A single 'sell' call must still be a positive integer no larger than 9007199254740991
-- (the largest integer JavaScript can add safely). That bound is per call, not per day.
-- Inventory stays client-side, as in r9. This file is a DRAFT for the lead. The agent did not run it
-- on a live database and did not touch player rows.
begin;
create or replace function public.tg_limit(p_kind text) returns bigint language sql immutable as $$
  select case p_kind
    when 'earn_coins'   then 40      -- r9: task + merit only ('sell' moved to sell_coins)
    when 'sell_coins'   then null::bigint  -- r9d: no daily coin ceiling. NULL is not a coin amount and is not a stand-in for a large cap.
    when 'sellback_coins' then 400   -- r9: furniture/decor sold back to the shop per day
    when 'shop_buy'     then 60      -- r9: shop purchases logged per day
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

-- ---------- 2. econ_earn / econ_status ----------
-- p_source: 'sell' -> no daily ceiling (r9d) | 'task' | 'merit' -> earn_coins 40/day ('merit' also merit_coins 8/day) | 'steal' -> steal_coins 15/day
-- p_exact: true = all-or-nothing (a task/merit/steal that would exceed its cap is refused). 'sell' has no daily cap to exceed.
-- 'sell' still rejects a non-positive amount and any amount above the JS safe integer (arithmetic bound, not a day's allowance).
create or replace function public.econ_earn(p_coins bigint, p_source text default 'sell', p_exact boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); want bigint := p_coins; g bigint; k text;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_source is null or p_source not in ('sell', 'task', 'merit', 'steal') then return jsonb_build_object('ok', false, 'reason', 'bad_source'); end if;
  if p_coins is null or p_coins <= 0 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;
  if p_source = 'sell' then
    if p_coins > 9007199254740991 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;
    -- left/cap 100 advertise the legacy ceiling to an r9b earn() mirror. The amount granted is not clamped to them.
    return jsonb_build_object('ok', true, 'granted', p_coins, 'left', 100, 'cap', 100, 'sell_uncapped', true);
  end if;
  if p_coins > 100000 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;
  perform pg_advisory_xact_lock(hashtext('tg_econ'), hashtext(uid::text));
  k := case when p_source = 'steal' then 'steal_coins' else 'earn_coins' end;   -- r9d: 'sell' already returned; it does not use sell_coins
  want := least(want, tg_limit(k) - tg_daily_used(uid, k));
  if p_source = 'merit' then want := least(want, tg_limit('merit_coins') - tg_daily_used(uid, 'merit_coins')); end if;
  if want <= 0 or (p_exact and want < p_coins) then
    return jsonb_build_object('ok', false, 'granted', 0, 'reason', 'daily_cap', 'left', greatest(0, tg_limit(k) - tg_daily_used(uid, k)),
                              'merit_left', case when p_source = 'merit' then greatest(0, tg_limit('merit_coins') - tg_daily_used(uid, 'merit_coins')) end);
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
    'sell_uncapped', true,
    -- legacy advertisement for already-open r9 pages (see header). Not consulted by an r9e page.
    'sell_cap', 100, 'sell_left', 100,
    'sellback_cap', tg_limit('sellback_coins'), 'sellback_left', tg_limit('sellback_coins') - tg_daily_used(uid, 'sellback_coins'), -- r9
    'merit_coins_left', tg_limit('merit_coins') - tg_daily_used(uid, 'merit_coins'),
    'steal_cap', tg_limit('steal_coins'), 'steal_left', tg_limit('steal_coins') - tg_daily_used(uid, 'steal_coins'),
    'market_cap', tg_limit('market_coins'), 'market_left', tg_limit('market_coins') - tg_daily_used(uid, 'market_coins'),
    'crops', coalesce((select jsonb_object_agg(id, grow_ms) from crop_rules), '{}'::jsonb));
end $$;


revoke all on function public.tg_limit(text) from public, anon, authenticated;
revoke all on function public.econ_earn(bigint, text, boolean), public.econ_status() from public, anon;
grant execute on function public.econ_earn(bigint, text, boolean), public.econ_status() to authenticated;

commit;
notify pgrst, 'reload schema';
