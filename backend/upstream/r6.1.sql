-- 福缘寺 r6.1 (after r6.sql). One transaction; safe to re-run. QA r6-v12-audit H1/H2/M2 (server side):
--  * every 功德 purchase (merit_spend and avatar_buy) goes through one locked charge: server price, per-user advisory lock,
--    idempotency key (p_req) so a double click / retry can't buy 2 for 1, and a server-side balance estimate (merit_wallet)
--    instead of trusting the client's claimed balance;
--  * merit_prices also lists the accessories and titles (r6-economy §4.1); aliases jade -> jade_pendant, whitehorse -> white_horse …;
--  * accessories/titles bought through either RPC land in avatar_owned; merit mounts are owned only if bought (mounts_save drops
--    unbought white_horse / white_deer / green_ox from the stored copy);
--  * merit_catalog() gives the client the server price list.
begin;

-- ---------- limits ----------
create or replace function public.tg_limit(p_kind text) returns bigint language sql immutable as $$
  select case p_kind
    when 'earn_coins'   then 40      -- r6-economy §6: coins/day from sell + daily task + merit exchange (S.daily.coinsEarned)
    when 'merit_coins'  then 8       -- §5: coins/day from the 25:1 merit exchange (also counts in earn_coins)
    when 'steal_coins'  then 15      -- §6: thief coins/day (S.daily.stealCoins)
    when 'market_coins' then 500     -- coins/day paid out by market_my_sales_claim (player-to-player; rest waits for tomorrow)
    when 'koi'          then 3       -- §3: 放生 per day (2 merit each, client-side)
    when 'slip'         then 3       -- 许愿签 per day
    when 'lantern'      then 3       -- 河灯 per day
    when 'tea_post'     then 30      -- 留言 per day
    when 'avatar_buy'   then 30      -- merit purchases per day
    when 'tea_gap_s'    then 20      -- seconds between two wall posts
    when 'merit_day'    then 80      -- r6.1: max merit a player can earn per day (§3 honest ceiling 73 + slack); server balance growth
    else 0 end
$$;

-- ---------- price list: decor / mounts (r6) + accessories / titles (§4.1, from avatar_catalog) + aliases ----------
insert into public.merit_prices(id, kind, price)
  select id, kind, price from public.avatar_catalog where price > 0 and active
on conflict (id) do update set kind = excluded.kind, price = excluded.price;
create table if not exists public.merit_alias (alias text primary key, id text not null references public.merit_prices(id) on delete cascade);
alter table public.merit_alias enable row level security;
insert into public.merit_alias(alias, id) values
  ('jade', 'jade_pendant'), ('whitehorse', 'white_horse'), ('whitedeer', 'white_deer'), ('greenox', 'green_ox'), ('bells', 'saddle_bell')
on conflict (alias) do update set id = excluded.id;

-- ---------- ledger: idempotency key ----------
alter table public.merit_ledger add column if not exists req text;
create unique index if not exists merit_ledger_req_uq on public.merit_ledger (owner, req) where req is not null;

-- ---------- server balance estimate ----------
-- The game keeps 功德 on the client. The server can't know the exact balance, but it can bound it:
-- first contact trusts the claimed balance (baseline); after that the balance can only grow by merit_day per day, minus what
-- was bought here. A lower claim re-bases (the client spent merit elsewhere). Purchases need min(claim, estimate) >= price.
create table if not exists public.merit_wallet (
  owner uuid primary key references auth.users on delete cascade,
  baseline bigint not null, baseline_at timestamptz not null default now(), spent bigint not null default 0);
alter table public.merit_wallet enable row level security;

create or replace function public.tg_merit_id(p_item text) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select id from merit_alias where alias = p_item), p_item)
$$;

create or replace function public.tg_merit_charge(uid uuid, p_item text, p_balance bigint, p_req text, p_kinds text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare id_ text := tg_merit_id(p_item); pr merit_prices%rowtype; w merit_wallet%rowtype; est bigint; old merit_ledger%rowtype;
begin
  if p_req is not null and p_req !~ '^[A-Za-z0-9_.:-]{6,64}$' then return jsonb_build_object('ok', false, 'reason', 'bad_req'); end if;
  select * into pr from merit_prices where id = id_;
  if not found or (p_kinds is not null and not (pr.kind = any (p_kinds))) then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  perform pg_advisory_xact_lock(hashtext('tg_merit'), hashtext(uid::text));        -- one purchase at a time per player
  if p_req is not null then                                                           -- same request again (double click / retry)
    select * into old from merit_ledger where owner = uid and req = p_req;
    if found then return jsonb_build_object('ok', old.item = id_, 'reason', case when old.item = id_ then null else 'bad_req' end,
                                            'item', old.item, 'kind', pr.kind, 'price', old.amount, 'replay', true); end if;
  end if;
  if pr.kind in ('accessory', 'title') and exists (select 1 from avatar_owned where owner = uid and item = id_) then
    return jsonb_build_object('ok', false, 'reason', 'owned', 'item', id_); end if;
  if p_balance is null or p_balance < pr.price then return jsonb_build_object('ok', false, 'reason', 'poor', 'price', pr.price, 'item', id_); end if;
  select * into w from merit_wallet where owner = uid for update;
  if not found then
    insert into merit_wallet(owner, baseline) values (uid, p_balance) returning * into w;
  end if;
  est := w.baseline + floor(extract(epoch from (now() - w.baseline_at)) / 86400.0 * tg_limit('merit_day'))::bigint - w.spent;
  if p_balance < est then
    update merit_wallet set baseline = p_balance, baseline_at = now(), spent = 0 where owner = uid returning * into w; est := p_balance;
  end if;
  if est < pr.price then return jsonb_build_object('ok', false, 'reason', 'poor', 'price', pr.price, 'item', id_, 'server_balance', greatest(est, 0)); end if;
  if tg_take_daily(uid, 'avatar_buy', tg_limit('avatar_buy')) = 0 then return jsonb_build_object('ok', false, 'reason', 'rate', 'item', id_); end if;
  update merit_wallet set spent = spent + pr.price where owner = uid;
  insert into merit_ledger(owner, kind, item, amount, balance_claim, req)
    values (uid, case when pr.kind in ('accessory', 'title') then 'avatar_buy' else 'merit_' || pr.kind end, id_, pr.price, p_balance, p_req);
  if pr.kind in ('accessory', 'title') then insert into avatar_owned(owner, item, price) values (uid, id_, pr.price) on conflict do nothing; end if;
  return jsonb_build_object('ok', true, 'item', id_, 'kind', pr.kind, 'price', pr.price, 'server_balance', est - pr.price);
end $$;

-- old 2-arg signatures are replaced by (p_item, p_balance, p_req default null): live v12 clients calling {p_item, p_balance} still match
drop function if exists public.merit_spend(text, bigint);
drop function if exists public.avatar_buy(text, bigint);
create or replace function public.merit_spend(p_item text, p_balance bigint, p_req text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  return tg_merit_charge(auth.uid(), p_item, p_balance, p_req, null);          -- any merit item: decor, mount, mount_decor, accessory, title
end $$;
create or replace function public.avatar_buy(p_item text, p_balance bigint, p_req text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c avatar_catalog%rowtype;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into c from avatar_catalog where id = tg_merit_id(p_item) and active;
  if found and c.price = 0 then return jsonb_build_object('ok', false, 'reason', 'free'); end if;
  return tg_merit_charge(auth.uid(), p_item, p_balance, p_req, array['accessory', 'title']);
end $$;

-- price list + what I bought (merit mounts / decor counts, accessories/titles owned)
create or replace function public.merit_catalog() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'price', p.price,
                         'name', c.name, 'emoji', c.emoji, 'slot', c.slot, 'part', c.part) order by p.kind, p.price)
                       from merit_prices p left join avatar_catalog c on c.id = p.id), '[]'::jsonb),
    'aliases', coalesce((select jsonb_object_agg(alias, id) from merit_alias), '{}'::jsonb),
    'bought', coalesce((select jsonb_object_agg(item, n) from (select item, count(*) n from merit_ledger where owner = uid group by item) b), '{}'::jsonb),
    'owned', coalesce((select jsonb_agg(item order by bought_at) from avatar_owned where owner = uid), '[]'::jsonb));
end $$;

-- mounts_save: merit mounts must have been bought (count per kind); unbought ones are dropped from the stored copy
create or replace function public.mounts_save(p_mounts jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); why text; clean jsonb; kept jsonb := '[]'::jsonb; dropped jsonb := '[]'::jsonb; m jsonb; mid text;
        used jsonb := '{}'::jsonb; n int; rid text;
begin
  if uid is null then raise exception 'not signed in'; end if;
  why := tg_mounts_reason(p_mounts);
  if why is not null then return jsonb_build_object('ok', false, 'reason', why); end if;
  for m in select * from jsonb_array_elements(coalesce(p_mounts->'owned', '[]'::jsonb)) loop
    mid := tg_merit_id(m->>'kind');
    if exists (select 1 from merit_prices where id = mid and kind = 'mount') then
      n := coalesce((used->>mid)::int, 0) + 1;
      if n > (select count(*) from merit_ledger where owner = uid and item = mid) then dropped := dropped || to_jsonb(m->>'id'); continue; end if;
      used := used || jsonb_build_object(mid, n);
    end if;
    kept := kept || jsonb_build_object('id', m->>'id', 'kind', m->>'kind',
              'deco', coalesce(case when jsonb_typeof(m->'deco') = 'object' then m->'deco' end, case when jsonb_typeof(m->'decor') = 'object' then m->'decor' end, '{}'::jsonb),
              'location', coalesce(m->'location', '"yard-post"'::jsonb));
  end loop;
  rid := case when jsonb_typeof(p_mounts->'riding') = 'string' then p_mounts->>'riding' end;
  if rid is not null and dropped ? rid then rid := null; end if;
  clean := jsonb_build_object('owned', kept, 'riding', to_jsonb(rid));
  insert into avatars(owner, mounts, rev) values (uid, clean, tg_now_ms())
    on conflict (owner) do update set mounts = excluded.mounts, rev = excluded.rev, updated_at = now();
  return jsonb_build_object('ok', true, 'mounts', clean, 'dropped', dropped);
end $$;

-- ---------- grants ----------
revoke all on function public.tg_limit(text), public.tg_merit_id(text), public.tg_merit_charge(uuid, text, bigint, text, text[]) from public, anon, authenticated;
revoke all on function public.merit_spend(text, bigint, text), public.avatar_buy(text, bigint, text), public.merit_catalog(), public.mounts_save(jsonb) from public, anon;
grant execute on function public.merit_spend(text, bigint, text), public.avatar_buy(text, bigint, text), public.merit_catalog(), public.mounts_save(jsonb) to authenticated;
commit;
notify pgrst, 'reload schema';
