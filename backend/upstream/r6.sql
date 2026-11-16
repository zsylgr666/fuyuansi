-- 福缘寺 round 6 (run after r5.sql). One transaction; safe to re-run.
--  1) 捏人/饰品/头衔: avatars (server-persisted, public read), merit-bought accessories + titles with a server
--     catalog, ownership table and merit ledger (merit balance itself is client-side: price is enforced here,
--     the client's claimed balance is checked and logged). Mount location (yard post / with player) persisted.
--  2) 茶馆 (public scene 'teahouse'): message wall (rate/length limits, text filter, reports -> auto-hide),
--     河灯 wishes (24 h). Tea-table seats are realtime presence only (client).
--  3) 荷花池: daily koi release + wish slips with server daily limits.
--  4) Economy: crop rules table (min grow per crop, 24 h clamp), market per-unit price caps,
--     daily caps on coins from shop selling (soft, client asks) and from market sales (hard, in claim).
-- All writes go through SECURITY DEFINER RPCs; tables have RLS on with no policies.
begin;

-- ---------- shared helpers ----------
create or replace function public.tg_day() returns date language sql stable as
$$ select (now() at time zone 'Asia/Shanghai')::date $$;

create table if not exists public.daily_counts (
  owner uuid not null references auth.users on delete cascade,
  day date not null,
  kind text not null,
  n bigint not null default 0,
  primary key (owner, day, kind));
alter table public.daily_counts enable row level security;

-- take up to p_amt of today's allowance for p_kind (cap p_cap); returns the granted amount (0 = limit reached)
create or replace function public.tg_take_daily(p_uid uuid, p_kind text, p_cap bigint, p_amt bigint default 1) returns bigint
language plpgsql security definer set search_path = public as $$
declare cur bigint; g bigint;
begin
  if p_amt is null or p_amt <= 0 then return 0; end if;
  insert into daily_counts(owner, day, kind, n) values (p_uid, tg_day(), p_kind, 0) on conflict do nothing;
  select n into cur from daily_counts where owner = p_uid and day = tg_day() and kind = p_kind for update;
  g := greatest(0, least(p_amt, p_cap - cur));
  if g > 0 then update daily_counts set n = n + g where owner = p_uid and day = tg_day() and kind = p_kind; end if;
  return g;
end $$;
create or replace function public.tg_daily_used(p_uid uuid, p_kind text) returns bigint
language sql stable security definer set search_path = public as
$$ select coalesce((select n from daily_counts where owner = p_uid and day = tg_day() and kind = p_kind), 0) $$;

-- tunable limits in one place (change here, re-run)
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
    else 0 end
$$;

-- text filter: returns cleaned text, or null when rejected (reason via tg_text_reason)
create table if not exists public.tg_banned_words (word text primary key);
alter table public.tg_banned_words enable row level security;
insert into public.tg_banned_words(word) values
  ('傻逼'), ('煞笔'), ('操你'), ('草你'), ('你妈'), ('尼玛'), ('妈的'), ('他妈'), ('滚蛋'), ('去死'), ('废物'), ('贱人'), ('婊'),
  ('fuck'), ('shit'), ('bitch'), ('色情'), ('约炮'), ('裸聊'), ('赌博'), ('博彩'), ('代孕'), ('毒品'), ('冰毒'), ('枪支'),
  ('加微信'), ('加v'), ('vx'), ('微信号'), ('qq群'), ('加群'), ('兼职刷单'), ('贷款')
on conflict do nothing;
create or replace function public.tg_text_reason(p text, p_max int) returns text
language plpgsql stable security definer set search_path = public as $$
declare t text; low text;
begin
  t := regexp_replace(coalesce(p, ''), '[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]', ' ', 'g');
  t := btrim(regexp_replace(t, '\s+', ' ', 'g'));
  if t = '' then return 'empty'; end if;
  if char_length(t) > p_max then return 'too_long'; end if;
  low := lower(regexp_replace(t, '[\s\.\-_*·]', '', 'g'));
  if t ~* '(https?:|www\.|\.(com|cn|net|org|top|xyz|cc|io|me)(\W|$))' then return 'link'; end if;
  if regexp_replace(t, '[^0-9０-９]', '', 'g') ~ '[0-9０-９]{7,}' then return 'number'; end if;
  if exists (select 1 from tg_banned_words w where position(lower(w.word) in low) > 0) then return 'blocked'; end if;
  return null;
end $$;
create or replace function public.tg_text_clean(p text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- ---------- 1) avatars, accessories, titles, mounts ----------
create table if not exists public.avatar_catalog (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]{1,31}$'),
  kind text not null check (kind in ('accessory', 'title')),
  name text not null,
  emoji text not null default '',
  price int not null default 0 check (price between 0 and 1000000),   -- 功德; 0 = free
  slot text check (slot is null or slot ~ '^[a-z]{1,16}$'),           -- avatar.js acc slot (head/neck/waist/back/hand)
  part text check (part is null or part ~ '^[a-z][a-z0-9_-]{0,23}$'), -- avatar.js part id in that slot
  sort int not null default 0,
  active boolean not null default true);
alter table public.avatar_catalog enable row level security;
insert into public.avatar_catalog(id, kind, name, emoji, price, sort, slot, part) values      -- = v4/_src/r6-economy.md §4.1, mapped to avatar.js acc slots
  ('beads',           'accessory', '念珠',   '📿', 400,  10, 'neck',  'beads'),
  ('hairpin',         'accessory', '发簪',   '🪮', 500,  20, 'head',  'hairpin'),
  ('jade_pendant',    'accessory', '玉佩',   '🟢', 600,  30, 'waist', 'jade'),
  ('cape',            'accessory', '云肩',   '🧣', 700,  40, 'back',  'cape'),
  ('title_shanxin',   'title',     '善信',   '🌱', 150,  10, null, null),
  ('title_jushi',     'title',     '居士',   '📿', 300,  20, null, null),
  ('title_xingzhe',   'title',     '修行者', '🧘', 600,  30, null, null),
  ('title_gongdezhu', 'title',     '功德主', '✨', 1200, 40, null, null)
on conflict (id) do update set kind = excluded.kind, name = excluded.name, emoji = excluded.emoji, price = excluded.price, sort = excluded.sort,
  slot = excluded.slot, part = excluded.part, active = true;

create table if not exists public.avatars (
  owner uuid primary key references auth.users on delete cascade,
  avatar jsonb not null default '{}'::jsonb,
  title text references public.avatar_catalog(id) on delete set null,
  mounts jsonb,                -- S.mounts minus passenger: {owned:[{id,kind,deco,location}], riding}; riding is also live in presence
  rev bigint not null default 0,
  updated_at timestamptz not null default now());
alter table public.avatars enable row level security;
create table if not exists public.avatar_owned (
  owner uuid not null references auth.users on delete cascade,
  item text not null references public.avatar_catalog(id) on delete cascade,
  price int not null,
  bought_at timestamptz not null default now(),
  primary key (owner, item));
alter table public.avatar_owned enable row level security;
create table if not exists public.merit_ledger (
  id bigserial primary key,
  owner uuid not null references auth.users on delete cascade,
  kind text not null,              -- 'avatar_buy' (more later)
  item text,
  amount int not null,             -- merit spent (positive)
  balance_claim bigint,            -- the client's merit balance before spending (as claimed)
  at timestamptz not null default now());
create index if not exists merit_ledger_owner_idx on public.merit_ledger (owner, at desc);
alter table public.merit_ledger enable row level security;

create or replace function public.tg_owns(p_uid uuid, p_item text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from avatar_catalog c where c.id = p_item and c.active and c.price = 0)
      or exists (select 1 from avatar_owned o where o.owner = p_uid and o.item = p_item)
$$;

-- avatar JSON = avatar.js config ({v,name,title,height,build,skin,face,hair,hairColor,outfit,color1,color2,trim,acc:{slot:part},capeColor,plate}).
-- Generic rules: <= 24 keys; key ^[a-z][a-zA-Z0-9_]{0,23}$; values = short ids/colors (^[A-Za-z0-9#_.-]{0,32}$), finite numbers, booleans;
-- 'name' (<= 12) / 'title' (<= 8) are filtered text; 'acc' = {slot: part} (<= 8); 'accessories' = [catalog ids] (<= 8).
-- Paid parts (avatar_catalog slot/part, price > 0) need ownership; a non-empty 'title' must be the name of an owned title.
create or replace function public.tg_avatar_reason(p_uid uuid, p jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare k text; v jsonb; a jsonb; c avatar_catalog%rowtype;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'bad_avatar'; end if;
  if (select count(*) from jsonb_object_keys(p)) > 24 or pg_column_size(p) > 4000 then return 'too_big'; end if;
  for k, v in select * from jsonb_each(p) loop
    if k !~ '^[a-z][a-zA-Z0-9_]{0,23}$' then return 'bad_key'; end if;
    if k = 'accessories' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 8 then return 'bad_accessories'; end if;
      for a in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(a) <> 'string' or not exists (select 1 from avatar_catalog c2 where c2.id = a #>> '{}' and c2.kind = 'accessory') then return 'unknown_accessory'; end if;
        if not tg_owns(p_uid, a #>> '{}') then return 'not_owned'; end if;
      end loop;
    elsif k = 'acc' then
      if jsonb_typeof(v) <> 'object' or (select count(*) from jsonb_object_keys(v)) > 8 then return 'bad_acc'; end if;
      for a in select value from jsonb_each(v) loop
        if jsonb_typeof(a) <> 'string' or (a #>> '{}') !~ '^[a-z][a-z0-9_-]{0,23}$' then return 'bad_acc'; end if;
      end loop;
    elsif k in ('name', 'title') then
      if jsonb_typeof(v) <> 'string' then return 'bad_value'; end if;
      if (v #>> '{}') <> '' and tg_text_reason(v #>> '{}', case when k = 'name' then 12 else 8 end) is not null then return 'bad_' || k; end if;
    elsif jsonb_typeof(v) = 'string' then
      if (v #>> '{}') !~ '^[A-Za-z0-9#_.-]{0,32}$' then return 'bad_value'; end if;
    elsif jsonb_typeof(v) not in ('number', 'boolean', 'null') then return 'bad_value';
    end if;
  end loop;
  for c in select * from avatar_catalog where slot is not null and price > 0 loop
    if p -> 'acc' ->> c.slot = c.part and not tg_owns(p_uid, c.id) then return 'not_owned'; end if;
  end loop;
  if coalesce(p ->> 'title', '') <> '' and not exists (select 1 from avatar_catalog t where t.kind = 'title' and t.name = p ->> 'title' and tg_owns(p_uid, t.id)) then
    return 'title_not_owned';
  end if;
  return null;
end $$;

create or replace function public.tg_avatar_json(p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('avatar', coalesce(a.avatar, '{}'::jsonb), 'title', a.title,
           'title_name', c.name, 'title_emoji', c.emoji, 'mounts', a.mounts, 'rev', coalesce(a.rev, 0))
  from (select 1) one left join avatars a on a.owner = p_uid left join avatar_catalog c on c.id = a.title
$$;

create or replace function public.avatar_get(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(a.owner::text, jsonb_build_object('avatar', a.avatar, 'title', a.title, 'title_name', c.name,
           'title_emoji', c.emoji, 'mounts', a.mounts, 'rev', a.rev)), '{}'::jsonb)
  from avatars a left join avatar_catalog c on c.id = a.title
  where auth.uid() is not null and a.owner = any ((p_ids)[1:100])
$$;
create or replace function public.avatar_catalog_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'name', name, 'emoji', emoji, 'price', price, 'slot', slot, 'part', part) order by kind, sort, id), '[]'::jsonb)
  from avatar_catalog where active
$$;
create or replace function public.avatar_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  return tg_avatar_json(uid) || jsonb_build_object(
    'owned', coalesce((select jsonb_agg(item order by bought_at) from avatar_owned where owner = uid), '[]'::jsonb),
    'merit_spent', coalesce((select sum(amount) from merit_ledger where owner = uid), 0),
    'catalog', avatar_catalog_list());
end $$;
create or replace function public.avatar_save(p_avatar jsonb, p_title text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); why text;
begin
  if uid is null then raise exception 'not signed in'; end if;
  why := tg_avatar_reason(uid, p_avatar);
  if why is not null then return jsonb_build_object('ok', false, 'reason', why); end if;
  if p_title is not null and (not exists (select 1 from avatar_catalog where id = p_title and kind = 'title') or not tg_owns(uid, p_title)) then
    return jsonb_build_object('ok', false, 'reason', 'title_not_owned');
  end if;
  if p_title is null and coalesce(p_avatar ->> 'title', '') <> '' then
    select id into p_title from avatar_catalog where kind = 'title' and name = p_avatar ->> 'title' limit 1;
  end if;
  if p_title is not null then p_avatar := p_avatar || jsonb_build_object('title', (select name from avatar_catalog where id = p_title)); end if;
  insert into avatars(owner, avatar, title, rev, updated_at) values (uid, p_avatar, p_title, tg_now_ms(), now())
    on conflict (owner) do update set avatar = excluded.avatar, title = excluded.title, rev = excluded.rev, updated_at = now();
  return jsonb_build_object('ok', true) || tg_avatar_json(uid);
end $$;
-- buy an accessory/title with 功德. p_balance = the client's merit before paying (the client deducts it).
create or replace function public.avatar_buy(p_item text, p_balance bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c avatar_catalog%rowtype;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into c from avatar_catalog where id = p_item and active;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  perform pg_advisory_xact_lock(hashtext('tg_avatar_buy'), hashtext(uid::text));
  if exists (select 1 from avatar_owned where owner = uid and item = p_item) then return jsonb_build_object('ok', false, 'reason', 'owned'); end if;
  if c.price = 0 then return jsonb_build_object('ok', false, 'reason', 'free'); end if;
  if p_balance is null or p_balance < c.price then return jsonb_build_object('ok', false, 'reason', 'poor', 'price', c.price); end if;
  if tg_take_daily(uid, 'avatar_buy', tg_limit('avatar_buy')) = 0 then return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
  insert into avatar_owned(owner, item, price) values (uid, p_item, c.price);
  insert into merit_ledger(owner, kind, item, amount, balance_claim) values (uid, 'avatar_buy', p_item, c.price, p_balance);
  return jsonb_build_object('ok', true, 'item', p_item, 'kind', c.kind, 'price', c.price);
end $$;
-- mounts (r6-economy §9.3): {owned:[{id, kind, deco:{k:bool|safe-string} (TG_MOUNTS.toJSON), location:'yard-post'|'following'|{scene,x,z}}], riding:null|id}
create or replace function public.tg_mounts_reason(p jsonb) returns text
language plpgsql immutable as $$
declare m jsonb; loc jsonb; k text; v jsonb; nfollow int := 0; ids text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'bad_mounts'; end if;
  if jsonb_typeof(coalesce(p->'owned', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p->'owned', '[]'::jsonb)) > 12 then return 'bad_owned'; end if;
  for m in select * from jsonb_array_elements(coalesce(p->'owned', '[]'::jsonb)) loop
    if jsonb_typeof(m) <> 'object' or coalesce(m->>'id', '') !~ '^[a-z][a-z0-9_-]{1,31}$' or coalesce(m->>'kind', '') !~ '^[a-z][a-z0-9_]{1,23}$' then return 'bad_mount'; end if;
    if m->>'id' = any (ids) then return 'dup_id'; end if; ids := ids || (m->>'id');
    -- deco = TG_MOUNTS.toJSON() shape {saddle,bridle,bells,saddleColor,bridleColor}; legacy key 'decor' accepted
    v := coalesce(case when jsonb_typeof(m->'deco') = 'object' then m->'deco' end, m->'deco', m->'decor');
    if v is not null and jsonb_typeof(v) <> 'null' then
      if jsonb_typeof(v) <> 'object' or (select count(*) from jsonb_object_keys(v)) > 8 then return 'bad_decor'; end if;
      for k in select jsonb_object_keys(v) loop
        if k !~ '^[a-z][A-Za-z0-9_]{0,23}$' or not (jsonb_typeof(v->k) in ('boolean', 'null')
           or (jsonb_typeof(v->k) = 'string' and (v->>k) ~ '^[A-Za-z0-9#_.-]{0,32}$')) then return 'bad_decor'; end if;
      end loop;
    end if;
    loc := m->'location';
    if loc is null or (jsonb_typeof(loc) = 'string' and loc #>> '{}' = 'yard-post') then null;
    elsif jsonb_typeof(loc) = 'string' and loc #>> '{}' = 'following' then nfollow := nfollow + 1;
    elsif jsonb_typeof(loc) = 'object' and coalesce(loc->>'scene', '') ~ '^[a-z][a-z0-9_-]{1,23}$'
          and jsonb_typeof(loc->'x') = 'number' and jsonb_typeof(loc->'z') = 'number'
          and abs((loc->>'x')::numeric) <= 200 and abs((loc->>'z')::numeric) <= 200 then null;
    else return 'bad_location'; end if;
  end loop;
  if nfollow > 1 then return 'two_following'; end if;
  if p ? 'riding' and jsonb_typeof(p->'riding') <> 'null' and not ((p->>'riding') = any (ids)) then return 'bad_riding'; end if;
  return null;
end $$;
create or replace function public.mounts_save(p_mounts jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); why text; clean jsonb;
begin
  if uid is null then raise exception 'not signed in'; end if;
  why := tg_mounts_reason(p_mounts);
  if why is not null then return jsonb_build_object('ok', false, 'reason', why); end if;
  clean := jsonb_build_object('owned', coalesce((select jsonb_agg(jsonb_build_object('id', m->>'id', 'kind', m->>'kind',
              'deco', coalesce(case when jsonb_typeof(m->'deco') = 'object' then m->'deco' end, case when jsonb_typeof(m->'decor') = 'object' then m->'decor' end, '{}'::jsonb),
              'location', coalesce(m->'location', '"yard-post"'::jsonb)))
            from jsonb_array_elements(coalesce(p_mounts->'owned', '[]'::jsonb)) m), '[]'::jsonb),
           'riding', case when jsonb_typeof(p_mounts->'riding') = 'string' then p_mounts->'riding' else 'null'::jsonb end);
  insert into avatars(owner, mounts, rev) values (uid, clean, tg_now_ms())
    on conflict (owner) do update set mounts = excluded.mounts, rev = excluded.rev, updated_at = now();
  return jsonb_build_object('ok', true, 'mounts', clean);
end $$;
-- 黄牛车 passenger check: is p_other in my family (or me)?
create or replace function public.family_same(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and p_other is not null and (p_other = auth.uid() or exists (
    select 1 from family_members a join family_members b on a.head = b.head where a.member = auth.uid() and b.member = p_other)
    or exists (select 1 from family_members m where m.head = auth.uid() and m.member = p_other)
    or exists (select 1 from family_members m where m.member = auth.uid() and m.head = p_other))
$$;

-- other 功德 sinks the client sells (merit decor, merit mounts, 鞍铃): server price list + ledger
create table if not exists public.merit_prices (
  id text primary key, kind text not null, price int not null check (price > 0));
alter table public.merit_prices enable row level security;
insert into public.merit_prices(id, kind, price) values      -- = r6-economy §4 / §9
  ('glazed_lamp', 'decor', 1000), ('ginkgo_bonsai', 'decor', 1400), ('guqin', 'decor', 1800), ('koi_screen', 'decor', 2200),
  ('golden_buddha', 'decor', 2800), ('white_horse', 'mount', 5000), ('white_deer', 'mount', 9000), ('green_ox', 'mount', 9000),
  ('saddle_bell', 'mount_decor', 2000)
on conflict (id) do update set kind = excluded.kind, price = excluded.price;
create or replace function public.merit_spend(p_item text, p_balance bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); pr merit_prices%rowtype;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into pr from merit_prices where id = p_item;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if p_balance is null or p_balance < pr.price then return jsonb_build_object('ok', false, 'reason', 'poor', 'price', pr.price); end if;
  if tg_take_daily(uid, 'avatar_buy', tg_limit('avatar_buy')) = 0 then return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
  insert into merit_ledger(owner, kind, item, amount, balance_claim) values (uid, 'merit_' || pr.kind, p_item, pr.price, p_balance);
  return jsonb_build_object('ok', true, 'item', p_item, 'kind', pr.kind, 'price', pr.price);
end $$;

-- ---------- 2) 茶馆: message wall + 河灯 ----------
create table if not exists public.tea_posts (
  id bigserial primary key,
  author uuid not null references auth.users on delete cascade,
  body text not null check (char_length(body) between 1 and 120),
  created_at timestamptz not null default now(),
  hidden boolean not null default false);
create index if not exists tea_posts_time_idx on public.tea_posts (created_at desc);
create index if not exists tea_posts_author_idx on public.tea_posts (author, created_at desc);
alter table public.tea_posts enable row level security;
create table if not exists public.tea_reports (
  post bigint not null references public.tea_posts on delete cascade,
  reporter uuid not null references auth.users on delete cascade,
  at timestamptz not null default now(),
  primary key (post, reporter));
alter table public.tea_reports enable row level security;

create or replace function public.tea_post(p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); why text; last timestamptz; nid bigint; b text;
begin
  if uid is null then raise exception 'not signed in'; end if;
  why := tg_text_reason(p_body, 120);
  if why is not null then return jsonb_build_object('ok', false, 'reason', why); end if;
  perform pg_advisory_xact_lock(hashtext('tg_tea_post'), hashtext(uid::text));
  select max(created_at) into last from tea_posts where author = uid;
  if last is not null and last > now() - make_interval(secs => tg_limit('tea_gap_s')) then
    return jsonb_build_object('ok', false, 'reason', 'slow', 'wait_s', ceil(extract(epoch from last + make_interval(secs => tg_limit('tea_gap_s')) - now())));
  end if;
  if tg_take_daily(uid, 'tea_post', tg_limit('tea_post')) = 0 then return jsonb_build_object('ok', false, 'reason', 'daily'); end if;
  b := tg_text_clean(p_body);
  insert into tea_posts(author, body) values (uid, b) returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid, 'body', b);
end $$;
create or replace function public.tea_wall(p_limit int default 50, p_before bigint default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.id desc), '[]'::jsonb) from (
    select t.id, t.author, coalesce(p.nickname, '香客') as name, t.body, t.created_at, t.author = auth.uid() as mine,
           c.name as title_name, c.emoji as title_emoji
    from tea_posts t left join profiles p on p.id = t.author left join avatars a on a.owner = t.author left join avatar_catalog c on c.id = a.title
    where auth.uid() is not null and not t.hidden and t.created_at > now() - interval '7 days'
      and (p_before is null or t.id < p_before)
      and (not tg_is_test(t.author) or tg_is_test(auth.uid()))
    order by t.id desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) x
$$;
create or replace function public.tea_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from tea_posts where id = p_id and author = auth.uid();
  return jsonb_build_object('ok', found);
end $$;
-- 3 distinct reporters hide a post
create or replace function public.tea_report(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from tea_posts where id = p_id and author <> uid) then return jsonb_build_object('ok', false, 'reason', 'bad_post'); end if;
  insert into tea_reports(post, reporter) values (p_id, uid) on conflict do nothing;
  select count(*) into n from tea_reports where post = p_id;
  if n >= 3 then update tea_posts set hidden = true where id = p_id; end if;
  return jsonb_build_object('ok', true, 'hidden', n >= 3);
end $$;

create table if not exists public.wishes (
  id bigserial primary key,
  author uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('lantern', 'slip')),
  body text not null check (char_length(body) between 1 and 60),
  color text not null default 'red' check (color ~ '^[a-z]{1,12}$'),
  created_at timestamptz not null default now());
create index if not exists wishes_kind_time_idx on public.wishes (kind, created_at desc);
create index if not exists wishes_author_idx on public.wishes (author, kind, created_at desc);
alter table public.wishes enable row level security;

create or replace function public.lantern_release(p_body text, p_color text default 'red') returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); why text; nid bigint;
begin
  if uid is null then raise exception 'not signed in'; end if;
  why := tg_text_reason(p_body, 60);
  if why is not null then return jsonb_build_object('ok', false, 'reason', why); end if;
  if coalesce(p_color, 'red') !~ '^[a-z]{1,12}$' then return jsonb_build_object('ok', false, 'reason', 'bad_color'); end if;
  if tg_take_daily(uid, 'lantern', tg_limit('lantern')) = 0 then return jsonb_build_object('ok', false, 'reason', 'daily', 'limit', tg_limit('lantern')); end if;
  insert into wishes(author, kind, body, color) values (uid, 'lantern', tg_text_clean(p_body), coalesce(p_color, 'red')) returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid, 'left', tg_limit('lantern') - tg_daily_used(uid, 'lantern'));
end $$;
create or replace function public.lantern_list(p_limit int default 60) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.id desc), '[]'::jsonb) from (
    select w.id, w.author, coalesce(p.nickname, '香客') as name, w.body, w.color, w.created_at, w.author = auth.uid() as mine
    from wishes w left join profiles p on p.id = w.author
    where auth.uid() is not null and w.kind = 'lantern' and w.created_at > now() - interval '24 hours'
      and (not tg_is_test(w.author) or tg_is_test(auth.uid()))
    order by w.id desc limit least(greatest(coalesce(p_limit, 60), 1), 100)) x
$$;

-- ---------- 3) 荷花池 ----------
create or replace function public.lotus_koi() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  if tg_take_daily(uid, 'koi', tg_limit('koi')) = 0 then return jsonb_build_object('ok', false, 'reason', 'daily', 'limit', tg_limit('koi')); end if;
  return jsonb_build_object('ok', true, 'day', tg_day(), 'left', tg_limit('koi') - tg_daily_used(uid, 'koi'));
end $$;
create or replace function public.lotus_wish(p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); why text; nid bigint;
begin
  if uid is null then raise exception 'not signed in'; end if;
  why := tg_text_reason(p_body, 60);
  if why is not null then return jsonb_build_object('ok', false, 'reason', why); end if;
  if tg_take_daily(uid, 'slip', tg_limit('slip')) = 0 then return jsonb_build_object('ok', false, 'reason', 'daily', 'limit', tg_limit('slip')); end if;
  insert into wishes(author, kind, body) values (uid, 'slip', tg_text_clean(p_body)) returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid, 'left', tg_limit('slip') - tg_daily_used(uid, 'slip'));
end $$;
create or replace function public.lotus_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  return jsonb_build_object('day', tg_day(),
    'koi_left', tg_limit('koi') - tg_daily_used(uid, 'koi'), 'slips_left', tg_limit('slip') - tg_daily_used(uid, 'slip'),
    'lanterns_left', tg_limit('lantern') - tg_daily_used(uid, 'lantern'),
    'slips', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'body', body, 'created_at', created_at) order by id desc)
                       from wishes where author = uid and kind = 'slip' and created_at > now() - interval '7 days'), '[]'::jsonb));
end $$;

-- ---------- 4) economy ----------
create table if not exists public.crop_rules (
  id text primary key,
  grow_ms bigint not null check (grow_ms > 0),
  min_factor numeric not null default 0.5 check (min_factor between 0 and 1));   -- watering may skip at most (1-min_factor)
alter table public.crop_rules enable row level security;
insert into public.crop_rules(id, grow_ms) values
  ('cabbage', 900000), ('carrot', 1500000), ('tomato', 2400000), ('corn', 6000000), ('peach', 21600000), ('melon', 43200000)   -- §1 growMs
on conflict (id) do update set grow_ms = excluded.grow_ms;
create or replace function public.tg_max_grow_ms() returns bigint language sql immutable as $$ select 86400000::bigint $$;   -- 24 h
-- earliest server ripe time for a fresh plant: max(now + clamp(r), plantedAt(k) + grow*min_factor)
create or replace function public.tg_ripe_at(p_crop text, p_key text, p_r bigint) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare nowms bigint := tg_now_ms(); r bigint; k bigint; cr crop_rules%rowtype; floor_ms bigint := 0;
begin
  r := nowms + least(greatest(coalesce(p_r, 0), 0), tg_max_grow_ms());
  select * into cr from crop_rules where id = p_crop;
  if found then
    k := case when coalesce(p_key, '') ~ '^[0-9]{12,14}$' then p_key::bigint end;
    if k is null or k > nowms + 60000 or k < nowms - 7 * 86400000 then k := nowms; end if;
    floor_ms := k + floor(cr.grow_ms * cr.min_factor)::bigint;
  end if;
  return greatest(r, floor_ms);
end $$;
-- garden_sync / space_plant: same as r5 plus the per-crop minimum
create or replace function public.garden_sync(p_plots jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); old jsonb; newp jsonb := '[]'::jsonb; i int; inp jsonb; o jsonb; r bigint; ripe bigint; nowms bigint := tg_now_ms();
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_plots is null or jsonb_typeof(p_plots) <> 'array' or jsonb_array_length(p_plots) > 12 then raise exception 'bad plots'; end if;
  if tg_frozen(uid) then return jsonb_build_object('archived', true, 'space_owner', tg_family_space(uid), 'plots', '[]'::jsonb, 'now', nowms); end if;
  insert into gardens(owner) values (uid) on conflict (owner) do nothing;
  select plots into old from gardens where owner = uid for update;
  for i in 0..11 loop
    inp := p_plots -> i; o := old -> i;
    if o is not null and jsonb_typeof(o) = 'object' and coalesce(o->>'by', uid::text) <> uid::text then
      newp := newp || jsonb_build_array(o); continue;      -- a family member's plant: only space_harvest clears it
    end if;
    if inp is null or jsonb_typeof(inp) <> 'object' or not tg_crop_ok(inp->>'c') or coalesce(inp->>'k','') = '' then
      newp := newp || jsonb_build_array(null::jsonb); continue;
    end if;
    r := least(greatest(coalesce(floor((inp->>'r')::numeric)::bigint, 0), 0), tg_max_grow_ms());
    ripe := tg_ripe_at(inp->>'c', inp->>'k', r);   -- r6: per-crop minimum grow
    if o is not null and jsonb_typeof(o) = 'object' and o->>'c' = inp->>'c' and o->>'k' = inp->>'k' then
      newp := newp || jsonb_build_array(o || jsonb_build_object('ripe', least(ripe, (o->>'ripe')::bigint)));
    else
      newp := newp || jsonb_build_array(jsonb_build_object('c', inp->>'c', 'k', left(inp->>'k', 32), 'ripe', ripe, 's', 0, 't', '[]'::jsonb));
    end if;
  end loop;
  update gardens set plots = newp, updated_at = now() where owner = uid;
  return jsonb_build_object('plots', newp, 'now', nowms);
end $$;

create or replace function public.space_plant(p_owner uuid, p_plot int, p_crop text, p_key text, p_r bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); o jsonb; np jsonb;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not tg_can_edit(p_owner) then raise exception 'not allowed'; end if;
  if p_plot is null or p_plot < 0 or p_plot > 11 or not tg_crop_ok(p_crop) or coalesce(p_key, '') = '' then raise exception 'bad plant'; end if;
  insert into gardens(owner) values (p_owner) on conflict (owner) do nothing;
  select plots -> p_plot into o from gardens where owner = p_owner for update;
  if o is not null and jsonb_typeof(o) = 'object' then
    return jsonb_build_object('ok', o->>'k' = p_key, 'reason', case when o->>'k' = p_key then 'same' else 'occupied' end, 'plot', o);
  end if;
  np := jsonb_build_object('c', p_crop, 'k', left(p_key, 32), 'ripe', tg_ripe_at(p_crop, p_key, p_r), 's', 0, 't', '[]'::jsonb, 'by', uid::text);
  update gardens set plots = (select jsonb_agg(case when i = p_plot then np else coalesce(plots -> i, 'null'::jsonb) end order by i)
                              from generate_series(0, 11) i),
                     updated_at = now()
    where owner = p_owner;
  return jsonb_build_object('ok', true, 'plot', np, 'now', tg_now_ms());
end $$;

-- market: per-unit price caps (crops/produce <= 50, offerings/decor <= 2000 per unit; r6 sell prices are 1-8)
create or replace function public.market_list(p_kind text, p_item text, p_qty int, p_price int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int; nid bigint; unit_cap int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_kind is null or p_kind not in ('crop', 'produce', 'offering', 'decor') then return jsonb_build_object('ok', false, 'reason', 'bad_item'); end if;
  if p_item is null or p_item !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$' then return jsonb_build_object('ok', false, 'reason', 'bad_item'); end if;
  if p_qty is null or p_qty < 1 or p_qty > 99 then return jsonb_build_object('ok', false, 'reason', 'bad_qty'); end if;
  unit_cap := case when p_kind in ('crop', 'produce') then 50 else 2000 end;
  if p_price is null or p_price < 1 or p_price > 99999 or p_price > p_qty * unit_cap then return jsonb_build_object('ok', false, 'reason', 'bad_price', 'max', least(99999, p_qty * unit_cap)); end if;
  perform pg_advisory_xact_lock(hashtext('tg_market_seller'), hashtext(uid::text));
  select count(*) into n from market_listings where seller = uid and status = 'active' and created_at > now() - tg_market_ttl();
  if n >= 10 then return jsonb_build_object('ok', false, 'reason', 'too_many'); end if;
  select count(*) into n from market_listings where seller = uid and created_at > now() - interval '1 hour';
  if n >= 20 then return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
  insert into market_listings(seller, item_kind, item_id, qty, price) values (uid, p_kind, p_item, p_qty, p_price) returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

-- market claim with a daily income cap: sold listings beyond today's cap stay unclaimed (paid on a later day)
create or replace function public.market_my_sales_claim() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); sold jsonb := '[]'::jsonb; ret jsonb; got jsonb; coins bigint := 0; l record; room bigint; pending int := 0;
begin
  if uid is null then raise exception 'not signed in'; end if;
  perform pg_advisory_xact_lock(hashtext('tg_market_claim'), hashtext(uid::text));
  update market_listings set status = 'expired', closed_at = now()
    where seller = uid and status = 'active' and created_at <= now() - tg_market_ttl();
  room := tg_limit('market_coins') - tg_daily_used(uid, 'market_coins');
  for l in select * from market_listings where seller = uid and not seller_done and status = 'sold' order by closed_at, id for update loop
    if l.price > room then pending := pending + 1; continue; end if;
    update market_listings set seller_done = true where id = l.id;
    room := room - l.price; coins := coins + l.price;
    sold := sold || jsonb_build_array(jsonb_build_object('id', l.id, 'item_kind', l.item_kind, 'item_id', l.item_id, 'qty', l.qty, 'price', l.price));
  end loop;
  if coins > 0 then perform tg_take_daily(uid, 'market_coins', tg_limit('market_coins'), coins); end if;
  with s as (update market_listings set seller_done = true
             where seller = uid and not seller_done and status in ('cancelled', 'expired') returning *)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'item_kind', item_kind, 'item_id', item_id, 'qty', qty, 'status', status)), '[]'::jsonb)
    into ret from s;
  with b as (update market_listings set buyer_done = true where buyer = uid and status = 'sold' and not buyer_done returning *)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'item_kind', item_kind, 'item_id', item_id, 'qty', qty, 'price', price)), '[]'::jsonb) into got from b;
  return jsonb_build_object('coins', coins, 'sold', sold, 'returned', ret, 'bought', got, 'pending', pending,
                            'cap', tg_limit('market_coins'), 'cap_left', tg_limit('market_coins') - tg_daily_used(uid, 'market_coins'));
end $$;

-- coin faucets (r6-economy §5/§6): the client asks first and credits only what is granted.
-- p_source: 'sell' | 'task' | 'merit' (count toward earn_coins 40/day; 'merit' also toward merit_coins 8/day) | 'steal' (steal_coins 15/day)
-- p_exact: true = all-or-nothing (a sale that would exceed the cap is refused, nothing taken)
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

-- ---------- grants: client RPCs to authenticated only; internals to nobody ----------
revoke all on function public.tg_day(), public.tg_take_daily(uuid, text, bigint, bigint), public.tg_daily_used(uuid, text), public.tg_limit(text),
  public.tg_text_reason(text, int), public.tg_text_clean(text), public.tg_owns(uuid, text), public.tg_avatar_reason(uuid, jsonb),
  public.tg_avatar_json(uuid), public.tg_mounts_reason(jsonb), public.tg_ripe_at(text, text, bigint), public.tg_max_grow_ms() from public, anon, authenticated;
revoke all on function public.avatar_get(uuid[]), public.avatar_catalog_list(), public.avatar_me(), public.avatar_save(jsonb, text),
  public.avatar_buy(text, bigint), public.mounts_save(jsonb), public.family_same(uuid), public.merit_spend(text, bigint), public.tea_post(text), public.tea_wall(int, bigint), public.tea_delete(bigint),
  public.tea_report(bigint), public.lantern_release(text, text), public.lantern_list(int), public.lotus_koi(), public.lotus_wish(text),
  public.lotus_status(), public.garden_sync(jsonb), public.space_plant(uuid, int, text, text, bigint), public.market_list(text, text, int, int),
  public.market_my_sales_claim(), public.econ_earn(bigint, text, boolean), public.econ_status() from public, anon;
grant execute on function public.avatar_get(uuid[]), public.avatar_catalog_list(), public.avatar_me(), public.avatar_save(jsonb, text),
  public.avatar_buy(text, bigint), public.mounts_save(jsonb), public.family_same(uuid), public.merit_spend(text, bigint), public.tea_post(text), public.tea_wall(int, bigint), public.tea_delete(bigint),
  public.tea_report(bigint), public.lantern_release(text, text), public.lantern_list(int), public.lotus_koi(), public.lotus_wish(text),
  public.lotus_status(), public.garden_sync(jsonb), public.space_plant(uuid, int, text, text, bigint), public.market_list(text, text, int, int),
  public.market_my_sales_claim(), public.econ_earn(bigint, text, boolean), public.econ_status() to authenticated;
commit;
notify pgrst, 'reload schema';
