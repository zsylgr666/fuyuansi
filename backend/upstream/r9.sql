-- r9 — 福缘里 · 心田小院: 出售 / 回收 economy (方案 B) + two exploit fixes. Apply AFTER r7.4.1.sql (r8-nick.sql has no DDL). Idempotent: safe to re-run.
-- Rollback: r9-rollback.sql.   Coins / backpack / placed decor stay client-side (saves.state); the server keeps caps, credit and ledgers.
--  1  tg_limit (whole function, copy of r7.3.sql + r9 keys):
--       sell_coins 100   crops/produce sold to the shop per day (econ_earn source 'sell' only)        [方案 B]
--       earn_coins 40    unchanged, now only 今日事项 'task' (10) + 善缘兑换 'merit' (merit_coins 8)
--       sellback_coins 400  furniture/decor sold back to the shop per day (econ_sellback; not part of sell_coins)
--       shop_buy 60      shop purchases logged per day (econ_shop_buy)
--  2  econ_earn: 'sell' -> sell_coins. econ_status: + sell_cap / sell_left / sellback_cap / sellback_left.
--  3  shop_prices (11 coin items, buy-back = floor(sell_base/2), sell_base never rises), shop_credit (shop-bought units not
--     yet sold back), sellback_ledger (buy / sell / seed). RLS on, no policies.
--  4  RPCs (authenticated only): econ_shop_buy(item, qty, req), econ_sellback(item, qty, unit, req) all-or-nothing with the
--     server price, econ_sellback_seed(items) one-time credit for pre-r9 saves (<=10 per item, <=1000 coins of buy-back value
--     per account, starter cushion+vase excluded, clamped to what the cloud save holds minus post-r9 shop credit and 集市 buys,
--     accounts created before r9 only; no_save / stale_save are retryable and record nothing).
--  5  fix: 集市 market_buy gets an idempotency key p_req (market_buy_reqs). A retry after a lost response replays the result
--     instead of failing, so the client no longer refunds an item that the server already sold to it.
--  6  fix: family shared decor — space_take_decor() removes ONE placed item atomically (row lock), so of two members stowing
--     the same item only one gets it; space_save() drops a taken item that a stale client pushes back (10 min window).
-- Market / econ_earn keep their old call shapes: live clients (no p_req, no new RPCs) work unchanged.
begin;

-- ---------- 1. limits ----------
create or replace function public.tg_limit(p_kind text) returns bigint language sql immutable as $$
  select case p_kind
    when 'earn_coins'   then 40      -- r9: task + merit only ('sell' moved to sell_coins)
    when 'sell_coins'   then 100     -- r9: crops/produce sold to the shop per day
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
-- p_source: 'sell' -> sell_coins 100/day | 'task' | 'merit' -> earn_coins 40/day ('merit' also merit_coins 8/day) | 'steal' -> steal_coins 15/day
-- p_exact: true = all-or-nothing (a sale that would exceed the cap is refused, nothing taken)
create or replace function public.econ_earn(p_coins bigint, p_source text default 'sell', p_exact boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); want bigint := p_coins; g bigint; k text;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_coins is null or p_coins <= 0 or p_coins > 100000 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;
  if p_source is null or p_source not in ('sell', 'task', 'merit', 'steal') then return jsonb_build_object('ok', false, 'reason', 'bad_source'); end if;
  perform pg_advisory_xact_lock(hashtext('tg_econ'), hashtext(uid::text));
  k := case when p_source = 'steal' then 'steal_coins' when p_source = 'sell' then 'sell_coins' else 'earn_coins' end;   -- r9
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
    'sell_cap', tg_limit('sell_coins'), 'sell_left', tg_limit('sell_coins') - tg_daily_used(uid, 'sell_coins'),                     -- r9
    'sellback_cap', tg_limit('sellback_coins'), 'sellback_left', tg_limit('sellback_coins') - tg_daily_used(uid, 'sellback_coins'), -- r9
    'merit_coins_left', tg_limit('merit_coins') - tg_daily_used(uid, 'merit_coins'),
    'steal_cap', tg_limit('steal_coins'), 'steal_left', tg_limit('steal_coins') - tg_daily_used(uid, 'steal_coins'),
    'market_cap', tg_limit('market_coins'), 'market_left', tg_limit('market_coins') - tg_daily_used(uid, 'market_coins'),
    'crops', coalesce((select jsonb_object_agg(id, grow_ms) from crop_rules), '{}'::jsonb));
end $$;

-- ---------- 3. shop buy-back tables ----------
create table if not exists public.r9_meta (k text primary key, v timestamptz not null);
insert into public.r9_meta(k, v) values ('applied_at', now()) on conflict (k) do nothing;   -- first apply only: seed cutoff
alter table public.r9_meta enable row level security;

create table if not exists public.shop_prices (
  id text primary key,
  cat text not null check (cat in ('furniture', 'decor')),
  price int not null check (price > 0),
  sell_base int not null check (sell_base >= 0),   -- buy-back = floor(sell_base/2); upsert keeps the lower value, never raises it
  sellable boolean not null default true);
alter table public.shop_prices enable row level security;
insert into public.shop_prices(id, cat, price, sell_base) values
  ('wood-table','furniture',60,60), ('bench','furniture',30,30), ('cabinet','furniture',100,100), ('daybed','furniture',160,160),
  ('altar-table','furniture',90,90), ('rocking-chair','furniture',85,85),
  ('vase','decor',25,25), ('lantern','decor',40,40), ('bonsai','decor',55,55), ('screen','decor',80,80), ('cushion','decor',20,20)
on conflict (id) do update set cat = excluded.cat, price = excluded.price, sell_base = least(public.shop_prices.sell_base, excluded.sell_base);

create table if not exists public.shop_credit (            -- shop-bought, coin-paid units not yet sold back
  owner uuid not null references auth.users on delete cascade,
  item text not null references public.shop_prices(id),
  qty int not null default 0 check (qty >= 0),
  primary key (owner, item));
alter table public.shop_credit enable row level security;

create table if not exists public.sellback_ledger (
  id bigserial primary key,
  owner uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('buy', 'sell', 'seed')),
  item text not null, qty int not null, unit int not null, coins int not null,
  req text,                                                  -- client idempotency key (buy / sell)
  created_at timestamptz not null default now());
alter table public.sellback_ledger enable row level security;
create index if not exists sellback_ledger_owner on public.sellback_ledger(owner, created_at desc);
create unique index if not exists sellback_ledger_req on public.sellback_ledger(owner, kind, req) where req is not null;
create unique index if not exists sellback_ledger_seed_once on public.sellback_ledger(owner) where kind = 'seed';

-- ---------- 4. RPCs ----------
create or replace function public.tg_req_ok(p_req text) returns boolean language sql immutable as
$$ select p_req is null or p_req ~ '^[A-Za-z0-9_.:-]{8,64}$' $$;

-- after a coin purchase in the shop (client: fire-and-forget, retry with the same p_req)
create or replace function public.econ_shop_buy(p_item text, p_qty int default 1, p_req text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); pr shop_prices%rowtype; old sellback_ledger%rowtype; c int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 20 then return jsonb_build_object('ok', false, 'reason', 'bad_qty'); end if;
  if not tg_req_ok(p_req) then return jsonb_build_object('ok', false, 'reason', 'bad_req'); end if;
  select * into pr from shop_prices where id = p_item;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;   -- merit / offering / other items never get credit
  perform pg_advisory_xact_lock(hashtext('tg_shop'), hashtext(uid::text));
  if p_req is not null then
    select * into old from sellback_ledger where owner = uid and kind = 'buy' and req = p_req;
    if found then
      if old.item <> p_item or old.qty <> p_qty then return jsonb_build_object('ok', false, 'reason', 'bad_req'); end if;
      select qty into c from shop_credit where owner = uid and item = p_item;
      return jsonb_build_object('ok', true, 'replay', true, 'item', p_item, 'price', old.unit, 'credit', coalesce(c, 0));
    end if;
  end if;
  if tg_daily_used(uid, 'shop_buy') + p_qty > tg_limit('shop_buy') then return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
  perform tg_take_daily(uid, 'shop_buy', tg_limit('shop_buy'), p_qty);
  insert into shop_credit(owner, item, qty) values (uid, p_item, p_qty)
    on conflict (owner, item) do update set qty = shop_credit.qty + excluded.qty returning qty into c;
  insert into sellback_ledger(owner, kind, item, qty, unit, coins, req) values (uid, 'buy', p_item, p_qty, pr.price, pr.price * p_qty, p_req);
  return jsonb_build_object('ok', true, 'item', p_item, 'price', pr.price, 'credit', c);
end $$;

-- sell stowed, shop-bought units back at floor(sell_base/2); all-or-nothing; the server price wins (p_unit = stale-UI check only)
create or replace function public.econ_sellback(p_item text, p_qty int default 1, p_unit int default null, p_req text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); pr shop_prices%rowtype; old sellback_ledger%rowtype; have int; unit int; total bigint; room bigint;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 20 then return jsonb_build_object('ok', false, 'reason', 'bad_qty'); end if;
  if not tg_req_ok(p_req) then return jsonb_build_object('ok', false, 'reason', 'bad_req'); end if;
  select * into pr from shop_prices where id = p_item;
  if not found or not pr.sellable then return jsonb_build_object('ok', false, 'reason', 'not_sellable'); end if;
  unit := pr.sell_base / 2;                                  -- integer division = floor
  if unit <= 0 then return jsonb_build_object('ok', false, 'reason', 'not_sellable'); end if;
  perform pg_advisory_xact_lock(hashtext('tg_shop'), hashtext(uid::text));
  if p_req is not null then                                  -- retry after a lost response: same answer, nothing taken twice
    select * into old from sellback_ledger where owner = uid and kind = 'sell' and req = p_req;
    if found then
      if old.item <> p_item or old.qty <> p_qty then return jsonb_build_object('ok', false, 'reason', 'bad_req'); end if;
      select qty into have from shop_credit where owner = uid and item = p_item;
      return jsonb_build_object('ok', true, 'replay', true, 'granted', old.coins, 'unit', old.unit, 'credit_left', coalesce(have, 0),
                                'left', tg_limit('sellback_coins') - tg_daily_used(uid, 'sellback_coins'));
    end if;
  end if;
  if p_unit is not null and p_unit <> unit then return jsonb_build_object('ok', false, 'reason', 'price_changed', 'unit', unit); end if;
  select qty into have from shop_credit where owner = uid and item = p_item for update;
  if coalesce(have, 0) < p_qty then return jsonb_build_object('ok', false, 'reason', 'no_credit', 'credit', coalesce(have, 0)); end if;
  total := unit::bigint * p_qty;
  room := tg_limit('sellback_coins') - tg_daily_used(uid, 'sellback_coins');
  if room < total then return jsonb_build_object('ok', false, 'reason', 'daily_cap', 'left', greatest(room, 0)); end if;
  perform tg_take_daily(uid, 'sellback_coins', tg_limit('sellback_coins'), total);
  update shop_credit set qty = qty - p_qty where owner = uid and item = p_item;
  insert into sellback_ledger(owner, kind, item, qty, unit, coins, req) values (uid, 'sell', p_item, p_qty, unit, total, p_req);
  return jsonb_build_object('ok', true, 'granted', total, 'unit', unit, 'credit_left', have - p_qty,
                            'left', tg_limit('sellback_coins') - tg_daily_used(uid, 'sellback_coins'));
end $$;

-- one-time credit for furniture bought before r9 (the server never saw those purchases).
-- p_items = {"wood-table": 2, ...} as the client counts them (backpack + placed in own spaces). Per item: least(claim, 10, owned)
-- minus the starter gift (cushion 1, vase 1); total buy-back value <= 1000. Only accounts created before r9 was applied.
-- owned = cloud save backpack (clamped 0..1000) + placed decor (0..1000) - current shop_credit (post-r9 shop buys, already credited)
--         - 集市 decor bought since r9 (no credit by design; blocks buy-cheap-on-market / sell-back-at-half).
-- reasons: bad_items | done | new_account | no_save (no cloud save yet: nothing recorded, retry after upload)
--          | stale_save (a sell-back is newer than saves.updated_at: client flushes its save and retries).
-- family space owner: their save also holds furniture members placed in the shared yard; accepted (counted for the owner,
-- bounded by 10/item and 1000/account). Stricter option (backpack only for shared-space owners) left commented below.
create or replace function public.econ_sellback_seed(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r record; n int; budget bigint := 1000; used bigint := 0; got jsonb := '{}'::jsonb;
        st jsonb; saved_at timestamptz; cutoff timestamptz; owned bigint; bp int; placed int; raw jsonb; unit int;
        shared boolean := false;   -- family owner: false = count members' placed furniture for the owner (accepted)
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_items'); end if;
  perform pg_advisory_xact_lock(hashtext('tg_shop'), hashtext(uid::text));
  if exists (select 1 from sellback_ledger where owner = uid and kind = 'seed') then return jsonb_build_object('ok', false, 'reason', 'done'); end if;
  select v into cutoff from r9_meta where k = 'applied_at';
  if not exists (select 1 from auth.users u where u.id = uid and u.created_at < cutoff) then
    return jsonb_build_object('ok', false, 'reason', 'new_account'); end if;
  select s.state, s.updated_at into st, saved_at from saves s where s.user_id = uid;
  -- no cloud save yet (new device / offline-first / reset to {}): retryable, nothing recorded
  if st is null or jsonb_typeof(st) <> 'object' or jsonb_typeof(st -> 'backpack') is distinct from 'object' then
    return jsonb_build_object('ok', false, 'reason', 'no_save'); end if;
  -- a sell-back happened after the last upload: the blob may still show the sold unit
  if exists (select 1 from sellback_ledger where owner = uid and kind = 'sell' and created_at >= coalesce(saved_at, '-infinity'::timestamptz)) then
    return jsonb_build_object('ok', false, 'reason', 'stale_save'); end if;
  -- stricter family option (backpack only for owners of a multi-member shared space):
  -- shared := tg_family_space(uid) = uid and exists (select 1 from family_members m join families f on f.head = m.head
  --                                                  where coalesce(f.yard_owner, f.head) = uid and m.member <> uid);
  for r in select p.id, p.sell_base from shop_prices p where p.sellable order by p.sell_base desc, p.id loop
    unit := r.sell_base / 2;
    if unit <= 0 then continue; end if;
    n := 0;
    if jsonb_typeof(p_items -> r.id) = 'number' then n := least(greatest(floor((p_items ->> r.id)::numeric), 0), 10)::int; end if;
    raw := st #> array['backpack', r.id];
    bp := case when jsonb_typeof(raw) = 'number' then least(greatest(floor((raw #>> '{}')::numeric), 0), 1000)::int
               when jsonb_typeof(raw) = 'string' and (raw #>> '{}') ~ '^[0-9]{1,4}$' then least((raw #>> '{}')::int, 1000)
               else 0 end;
    placed := case when shared then 0 else least(coalesce((select count(*) from jsonb_each(case when jsonb_typeof(st -> 'decor') = 'object' then st -> 'decor' else '{}'::jsonb end) s(k, a),
                       jsonb_array_elements(case when jsonb_typeof(s.a) = 'array' then s.a else '[]'::jsonb end) e
                       where jsonb_typeof(e) = 'object' and e ->> 'id' = r.id), 0), 1000)::int end;
    owned := bp + placed
           - coalesce((select c.qty from shop_credit c where c.owner = uid and c.item = r.id), 0)
           - coalesce((select sum(l.qty) from market_listings l where l.buyer = uid and l.item_kind = 'decor' and l.item_id = r.id
                         and l.status = 'sold' and l.closed_at >= cutoff), 0);
    n := least(n, greatest(owned, 0))::int;
    n := n - case when r.id in ('cushion', 'vase') then 1 else 0 end;      -- starter gifts (gameplay.js:92) never sellable
    n := least(greatest(n, 0), ((budget - used) / unit)::int);
    if n > 0 then
      insert into shop_credit(owner, item, qty) values (uid, r.id, n) on conflict (owner, item) do update set qty = shop_credit.qty + excluded.qty;
      used := used + n * unit; got := got || jsonb_build_object(r.id, n);
    end if;
  end loop;
  insert into sellback_ledger(owner, kind, item, qty, unit, coins) values (uid, 'seed', '*', 0, 0, used);   -- real save: once, even if 0
  return jsonb_build_object('ok', true, 'credit', got, 'value', used);
end $$;

create or replace function public.econ_sellback_credit() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('credit', coalesce((select jsonb_object_agg(item, qty) from shop_credit where owner = auth.uid() and qty > 0), '{}'::jsonb),
    'prices', (select jsonb_object_agg(id, sell_base / 2) from shop_prices where sellable),
    'seeded', exists (select 1 from sellback_ledger where owner = auth.uid() and kind = 'seed'),
    'left', tg_limit('sellback_coins') - tg_daily_used(auth.uid(), 'sellback_coins'))
$$;

-- ---------- 5. fix: market_buy idempotency ----------
create table if not exists public.market_buy_reqs (
  owner uuid not null references auth.users on delete cascade,
  req text not null,
  listing_id bigint not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner, req));
alter table public.market_buy_reqs enable row level security;

drop function if exists public.market_buy(bigint);          -- replaced by the 2-arg version (p_req defaults to null: old calls unchanged)
create or replace function public.market_buy(p_id bigint, p_req text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); l market_listings%rowtype; n int; res jsonb; old market_buy_reqs%rowtype;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not tg_req_ok(p_req) then return jsonb_build_object('ok', false, 'reason', 'bad_req'); end if;
  if p_req is not null then
    perform pg_advisory_xact_lock(hashtext('tg_market_buy'), hashtext(uid::text));
    select * into old from market_buy_reqs where owner = uid and req = p_req;
    if found then
      if old.listing_id <> p_id then return jsonb_build_object('ok', false, 'reason', 'bad_req'); end if;
      return old.result || jsonb_build_object('replay', true);   -- already bought by this request: do NOT refund
    end if;
  end if;
  select * into l from market_listings where id = p_id for update;
  if not found or l.status <> 'active' or l.created_at <= now() - tg_market_ttl() then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  if l.seller = uid then return jsonb_build_object('ok', false, 'reason', 'own'); end if;
  select count(*) into n from market_listings where buyer = uid and closed_at > now() - interval '1 hour';
  if n >= 30 then return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
  update market_listings set status = 'sold', buyer = uid, closed_at = now() where id = p_id;
  res := jsonb_build_object('ok', true, 'id', l.id, 'item_kind', l.item_kind, 'item_id', l.item_id, 'qty', l.qty, 'price', l.price);
  if p_req is not null then insert into market_buy_reqs(owner, req, listing_id, result) values (uid, p_req, p_id, res); end if;
  return res;
end $$;

-- ---------- 6. fix: family shared decor stowed twice ----------
create table if not exists public.space_decor_taken (
  id bigserial primary key,
  owner uuid not null references auth.users on delete cascade,   -- space owner
  scene text not null,
  item text not null,
  x double precision not null,
  z double precision not null,
  taker uuid not null references auth.users on delete cascade,
  req text,
  taken_at timestamptz not null default now());
create index if not exists space_decor_taken_owner on public.space_decor_taken(owner, taken_at desc);
create unique index if not exists space_decor_taken_req on public.space_decor_taken(taker, req) where req is not null;
alter table public.space_decor_taken enable row level security;

create or replace function public.tg_decor_match(e jsonb, p_item text, p_x double precision, p_z double precision) returns boolean
language sql immutable as $$
  select jsonb_typeof(e) = 'object' and e ->> 'id' = p_item
     and jsonb_typeof(e -> 'x') = 'number' and jsonb_typeof(e -> 'z') = 'number'
     and abs((e ->> 'x')::double precision - p_x) < 0.05 and abs((e ->> 'z')::double precision - p_z) < 0.05
$$;

-- stow ONE placed item from a shared (family) space. Exactly one of two concurrent callers gets ok; the client adds the item to
-- its backpack only on ok (replay with the same p_req after a lost response).
create or replace function public.space_take_decor(p_owner uuid, p_scene text, p_item text, p_x double precision, p_z double precision, p_req text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); arr jsonb; idx int := -1; i int; nrev bigint; t space_decor_taken%rowtype;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not tg_can_edit(p_owner) then raise exception 'not allowed'; end if;
  if p_scene is null or p_scene !~ '^[A-Za-z0-9_-]{1,32}$' or p_item is null or p_item !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$'
     or p_x is null or p_z is null or not tg_req_ok(p_req) then return jsonb_build_object('ok', false, 'reason', 'bad_args'); end if;
  insert into showcases(owner) values (p_owner) on conflict (owner) do nothing;
  select coalesce(decor -> p_scene, '[]'::jsonb) into arr from showcases where owner = p_owner for update;   -- serializes takers
  if p_req is not null then
    select * into t from space_decor_taken where taker = uid and req = p_req;
    if found then
      return jsonb_build_object('ok', t.owner = p_owner and t.item = p_item, 'replay', true, 'decor', arr,
                                'rev', (select rev from showcases where owner = p_owner));
    end if;
  end if;
  if jsonb_typeof(arr) <> 'array' then arr := '[]'::jsonb; end if;
  for i in 0 .. jsonb_array_length(arr) - 1 loop
    if tg_decor_match(arr -> i, p_item, p_x, p_z) then idx := i; exit; end if;
  end loop;
  if idx < 0 then return jsonb_build_object('ok', false, 'reason', 'gone', 'decor', arr, 'rev', (select rev from showcases where owner = p_owner)); end if;
  arr := arr - idx;
  update showcases set decor = jsonb_set(coalesce(decor, '{}'::jsonb), array[p_scene], arr), rev = rev + 1, editor = uid, updated_at = now()
    where owner = p_owner returning rev into nrev;
  insert into space_decor_taken(owner, scene, item, x, z, taker, req) values (p_owner, p_scene, p_item, p_x, p_z, uid, p_req);
  delete from space_decor_taken where taken_at < now() - interval '1 day';
  return jsonb_build_object('ok', true, 'decor', arr, 'rev', nrev);
end $$;

-- space_save (r4.sql) + r9: a scene array pushed by another member that still holds an item taken in the last 10 minutes
-- (and absent on the server) gets that item removed, so a stale client can't put a stowed item back (= duplicate).
create or replace function public.space_save(p_owner uuid, p_shrine jsonb default null, p_decor jsonb default null, p_animals jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); nrev bigint; t record; cur jsonb; arr jsonb; i int; dropped int := 0; srv jsonb;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not tg_can_edit(p_owner) then raise exception 'not allowed'; end if;
  if p_decor is not null and jsonb_typeof(p_decor) <> 'object' then raise exception 'bad decor'; end if;
  if pg_column_size(coalesce(p_shrine, '{}'::jsonb)) + pg_column_size(coalesce(p_decor, '{}'::jsonb)) + pg_column_size(coalesce(p_animals, '[]'::jsonb)) > 200000 then
    raise exception 'space too large'; end if;
  insert into showcases(owner) values (p_owner) on conflict (owner) do nothing;
  select coalesce(decor, '{}'::jsonb) into srv from showcases where owner = p_owner for update;
  if p_decor is not null then                                                     -- r9
    for t in select * from space_decor_taken where owner = p_owner and taker <> uid and taken_at > now() - interval '10 minutes' order by id loop
      arr := p_decor -> t.scene;
      if arr is null or jsonb_typeof(arr) <> 'array' then continue; end if;
      cur := case when jsonb_typeof(srv -> t.scene) = 'array' then srv -> t.scene else '[]'::jsonb end;
      if exists (select 1 from jsonb_array_elements(cur) e where tg_decor_match(e, t.item, t.x, t.z)) then continue; end if;   -- re-placed since: legit
      for i in 0 .. jsonb_array_length(arr) - 1 loop
        if tg_decor_match(arr -> i, t.item, t.x, t.z) then
          p_decor := jsonb_set(p_decor, array[t.scene], arr - i); dropped := dropped + 1; exit;
        end if;
      end loop;
    end loop;
  end if;
  update showcases set
      shrine = coalesce(p_shrine, shrine),
      decor = case when p_decor is null then decor else coalesce(decor, '{}'::jsonb) || p_decor end,
      animals = coalesce(p_animals, animals),
      rev = rev + 1, editor = uid, updated_at = now()
    where owner = p_owner returning rev into nrev;
  if pg_column_size((select decor from showcases where owner = p_owner)) > 200000 then raise exception 'space too large'; end if;
  return jsonb_build_object('ok', true, 'rev', nrev, 'dropped', dropped);
end $$;

-- ---------- grants: client RPCs to authenticated only; internals to nobody ----------
revoke all on function public.tg_limit(text), public.tg_req_ok(text), public.tg_decor_match(jsonb, text, double precision, double precision)
  from public, anon, authenticated;
revoke all on function public.econ_earn(bigint, text, boolean), public.econ_status(), public.econ_shop_buy(text, int, text),
  public.econ_sellback(text, int, int, text), public.econ_sellback_seed(jsonb), public.econ_sellback_credit(),
  public.market_buy(bigint, text), public.space_take_decor(uuid, text, text, double precision, double precision, text),
  public.space_save(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.econ_earn(bigint, text, boolean), public.econ_status(), public.econ_shop_buy(text, int, text),
  public.econ_sellback(text, int, int, text), public.econ_sellback_seed(jsonb), public.econ_sellback_credit(),
  public.market_buy(bigint, text), public.space_take_decor(uuid, text, text, double precision, double precision, text),
  public.space_save(uuid, jsonb, jsonb, jsonb) to authenticated;
commit;
notify pgrst, 'reload schema';
