-- r7.1 — 福缘里 compliance follow-up (display text only). Apply AFTER r7.sql. Idempotent: safe to run again.
--  (a) avatar_catalog: neutral display names/icons for the religious titles and the 📿 accessory; ids, prices, slots unchanged.
--      Old names are kept in avatar_catalog.legacy_names so avatars saved / sent by older clients (avatar JSON 'title' = 居士 …)
--      still pass tg_avatar_reason. Player nicknames, stored avatars and messages are NOT touched.
--  (b) every SQL function whose fallback display name was '香客' is re-created with only that literal changed to '访客'
--      (latest definition of each, taken in order garden -> r3 -> r4 -> r4.1 -> r5 -> r6 -> r6.1 -> r7 -> social).
-- NOTE: r6.sql's avatar_catalog insert uses "on conflict do update set name = …"; re-running r6.sql would bring back the old
--       names — run r7.1.sql again after it if that ever happens.

-- ---------- (a) avatar_catalog ----------
alter table public.avatar_catalog add column if not exists legacy_names text[] not null default '{}';
update public.avatar_catalog c set name = v.name, emoji = v.emoji,
       legacy_names = (select array_agg(distinct x) from unnest(c.legacy_names || v.legacy) x where x <> v.name)
from (values
  ('title_shanxin',   '善友',   '🌱', array['善信']),
  ('title_jushi',     '雅士',   '🎋', array['居士']),
  ('title_xingzhe',   '旅人',   '🧭', array['修行者']),
  ('title_gongdezhu', '福缘主', '✨', array['功德主']),
  ('beads',           '珠串',   '💠', array['念珠'])
) as v(id, name, emoji, legacy)
where c.id = v.id;

-- a title in the avatar JSON may use the current name or a legacy one (older clients / saved avatars)
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
  if coalesce(p ->> 'title', '') <> '' and not exists (select 1 from avatar_catalog t where t.kind = 'title' and (t.name = p ->> 'title' or (p ->> 'title') = any (t.legacy_names)) and tg_owns(p_uid, t.id)) then
    return 'title_not_owned';
  end if;
  return null;
end $$;

-- avatar_save maps the title text to its id: accept legacy names too (the stored text is then normalized to the new name)
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
    select id into p_title from avatar_catalog where kind = 'title' and (name = p_avatar ->> 'title' or (p_avatar ->> 'title') = any (legacy_names)) limit 1;
  end if;
  if p_title is not null then p_avatar := p_avatar || jsonb_build_object('title', (select name from avatar_catalog where id = p_title)); end if;
  insert into avatars(owner, avatar, title, rev, updated_at) values (uid, p_avatar, p_title, tg_now_ms(), now())
    on conflict (owner) do update set avatar = excluded.avatar, title = excluded.title, rev = excluded.rev, updated_at = now();
  return jsonb_build_object('ok', true) || tg_avatar_json(uid);
end $$;

-- ---------- (b) '香客' -> '访客' fallback names ----------

-- list_invites: from r3.sql (2x)
create or replace function public.list_invites() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'guests', coalesce((select jsonb_agg(jsonb_build_object('id', i.guest, 'name', coalesce(p.nickname, '访客')) order by i.created_at desc)
                        from shrine_invites i left join profiles p on p.id = i.guest where i.owner = auth.uid()), '[]'::jsonb),
    'invited_by', coalesce((select jsonb_agg(jsonb_build_object('id', i.owner, 'name', coalesce(p.nickname, '访客')) order by i.created_at desc)
                        from shrine_invites i left join profiles p on p.id = i.owner where i.guest = auth.uid()), '[]'::jsonb),
    'has_password', exists (select 1 from shrine_locks where owner = auth.uid() and pass_hash is not null))
$$;

-- shrine_status: from r3.sql (1x)
create or replace function public.shrine_status(p_owner uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'is_owner', auth.uid() = p_owner,
    'has_password', exists (select 1 from shrine_locks where owner = p_owner and pass_hash is not null),
    'invited', exists (select 1 from shrine_invites where owner = p_owner and guest = auth.uid()),
    'pass_until', (select floor(extract(epoch from expires_at) * 1000)::bigint from shrine_passes where owner = p_owner and guest = auth.uid() and expires_at > now()),
    'access', tg_has_access(p_owner, 'hall'),
    'name', coalesce((select nickname from profiles where id = p_owner), '访客'))
$$;

-- space_get: from r4.sql (1x)
create or replace function public.space_get(p_owner uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not tg_can_edit(p_owner) then jsonb_build_object('denied', true) else jsonb_build_object(
    'owner', p_owner,
    'name', coalesce((select nickname from profiles where id = p_owner), '访客'),
    'shrine', (select shrine from showcases where owner = p_owner),
    'decor', coalesce((select decor from showcases where owner = p_owner), '{}'::jsonb),
    'animals', (select animals from showcases where owner = p_owner),
    'rev', coalesce((select rev from showcases where owner = p_owner), 0),
    'editor', (select editor from showcases where owner = p_owner),
    'plots', coalesce((select plots from gardens where owner = p_owner), '[]'::jsonb),
    'dog', coalesce((select dog_on_duty from gardens where owner = p_owner), false),
    'now', tg_now_ms()) end
$$;

-- family_info: from r5.sql (3x)
create or replace function public.family_info() returns jsonb
language sql stable security definer set search_path = public as $$
  with h as (select tg_family_head(auth.uid()) as head),
       y as (select coalesce(f.yard_owner, f.head) as yo from families f where f.head = (select head from h))
  select jsonb_build_object(
    'me', auth.uid(),
    'head', (select head from h),
    'head_name', (select nickname from profiles where id = (select head from h)),
    'is_head', (select head from h) = auth.uid(),
    'yard_owner', (select yo from y),
    'yard_owner_name', (select nickname from profiles where id = (select yo from y)),
    'is_yard_owner', (select yo from y) = auth.uid(),
    'archived', exists (select 1 from family_yard_archive where owner = auth.uid()),
    'my_yard', tg_space_summary(auth.uid()),
    'max', 6,
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.member, 'name', coalesce(p.nickname, '访客'), 'is_head', m.member = m.head,
                                                             'is_yard_owner', m.member = (select yo from y)) order by m.member <> m.head, m.joined_at)
                         from family_members m left join profiles p on p.id = m.member where m.head = (select head from h)), '[]'::jsonb),
    'invites_out', coalesce((select jsonb_agg(jsonb_build_object('id', i.guest, 'name', coalesce(p.nickname, '访客')) order by i.created_at desc)
                         from family_invites i left join profiles p on p.id = i.guest where i.head = auth.uid()), '[]'::jsonb),
    'invites_in', coalesce((select jsonb_agg(jsonb_build_object('head', i.head, 'name', coalesce(p.nickname, '访客'),
                                                                'members', (select count(*) from family_members where head = i.head),
                                                                'yard', tg_space_summary(coalesce(f.yard_owner, i.head))) order by i.created_at desc)
                         from family_invites i join families f on f.head = i.head left join profiles p on p.id = i.head where i.guest = auth.uid()), '[]'::jsonb))
$$;

-- get_garden: from r5.sql (1x)
create or replace function public.get_garden(p_owner uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with o as (select tg_family_space(p_owner) as id)
  select jsonb_build_object(
    'owner', (select id from o),
    'requested', p_owner,
    'space_owner', (select id from o),
    'name', coalesce((select nickname from profiles where id = (select id from o)), '访客'),
    'plots', coalesce((select plots from gardens where owner = (select id from o)), '[]'::jsonb),
    'guard_until', (select floor(extract(epoch from guard_until) * 1000)::bigint from gardens where owner = (select id from o) and guard_until > now()),
    'dog', coalesce((select dog_on_duty from gardens where owner = (select id from o)), false),
    'family', coalesce(tg_family_space(auth.uid()) = (select id from o) and auth.uid() <> (select id from o), false),
    'now', tg_now_ms())
$$;

-- get_showcase: from r5.sql (1x)
create or replace function public.get_showcase(p_owner uuid, p_scene text default 'hall') returns jsonb
language sql stable security definer set search_path = public as $$
  with o as (select tg_family_space(p_owner) as id)
  select case
    when not tg_has_access(p_owner, p_scene) then jsonb_build_object('denied', true)
    else jsonb_build_object(
      'owner', p_owner,
      'space_owner', (select id from o),
      'name', coalesce((select nickname from profiles where id = p_owner), '访客'),
      'shrine', case when p_scene = 'yard' and auth.uid() <> p_owner and not tg_has_access(p_owner, 'hall') then null
                     else (select shrine from showcases where owner = (select id from o)) end,
      'decor', (select decor -> p_scene from showcases where owner = (select id from o)),
      'animals', coalesce((select case when jsonb_typeof(animals) = 'array' then animals end from showcases where owner = (select id from o)), '[]'::jsonb),
      'scene', p_scene)
  end
$$;

-- list_neighbors: from r5.sql (1x)
create or replace function public.list_neighbors() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.stealable desc, x.updated_at desc), '[]'::jsonb) from (
    select g.owner as id, coalesce(p.nickname, '访客') as name, g.updated_at,
      (select count(*) from jsonb_array_elements(g.plots) e
        where jsonb_typeof(e) = 'object' and (e->>'ripe')::bigint <= tg_now_ms()
          and coalesce((e->>'s')::int, 0) < 1 and not (coalesce(e->'t','[]'::jsonb) ? coalesce(auth.uid()::text, ''))) as stealable,
      (select count(*) from jsonb_array_elements(g.plots) e where jsonb_typeof(e) = 'object') as planted,
      coalesce(g.dog_on_duty or g.guard_until > now(), g.dog_on_duty) as guarded,
      coalesce(tg_family_space(auth.uid()) = g.owner, false) as family
    from gardens g
      join saves s on s.user_id = g.owner and s.state <> '{}'::jsonb
      left join profiles p on p.id = g.owner
    where g.owner <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
      and g.owner <> tg_family_space(coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid))
      and not tg_frozen(g.owner)
      and g.updated_at > now() - interval '7 days'
      and (not tg_is_test(g.owner) or tg_is_test(auth.uid()))
    order by 4 desc, g.updated_at desc
    limit 30) x
$$;

-- market_browse: from r5.sql (1x)
create or replace function public.market_browse(p_kind text default null, p_limit int default 60) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'listings', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select l.id, l.seller, coalesce(p.nickname, '访客') as seller_name, l.item_kind, l.item_id, l.qty, l.price, l.created_at,
               l.seller = auth.uid() as mine
        from market_listings l left join profiles p on p.id = l.seller
        where l.status = 'active' and l.created_at > now() - tg_market_ttl()
          and (p_kind is null or l.item_kind = p_kind)
          and (not tg_is_test(l.seller) or tg_is_test(auth.uid()))
        order by l.created_at desc limit least(greatest(coalesce(p_limit, 60), 1), 100)) x), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'item_kind', item_kind, 'item_id', item_id, 'qty', qty, 'price', price, 'created_at', created_at) order by created_at desc)
        from market_listings where seller = auth.uid() and status = 'active' and created_at > now() - tg_market_ttl()), '[]'::jsonb),
    'to_claim', (select count(*) from market_listings
        where (seller = auth.uid() and not seller_done and (status <> 'active' or created_at <= now() - tg_market_ttl()))
           or (buyer = auth.uid() and status = 'sold' and not buyer_done)),
    'max_active', 10)
$$;

-- steal_crop: from r5.sql (1x)
create or replace function public.steal_crop(p_owner uuid, p_plot int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); o_id uuid := tg_family_space(p_owner); g gardens%rowtype; o jsonb; nick text; recent int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if uid = o_id or tg_family_space(uid) = o_id or tg_same_family(uid, p_owner) then return jsonb_build_object('ok', false, 'reason', 'own'); end if;
  if p_plot is null or p_plot < 0 or p_plot > 11 then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  select * into g from gardens where owner = o_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  o := g.plots -> p_plot;
  if o is null or jsonb_typeof(o) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  if (o->>'ripe')::bigint > tg_now_ms() then return jsonb_build_object('ok', false, 'reason', 'unripe', 'ripe', (o->>'ripe')::bigint, 'now', tg_now_ms()); end if;
  if coalesce(o->'t', '[]'::jsonb) ? uid::text then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  if coalesce((o->>'s')::int, 0) >= 1 then return jsonb_build_object('ok', false, 'reason', 'cap'); end if;
  select count(*) into recent from steal_log where thief = uid and owner = o_id and at > now() - interval '1 hour';
  if recent >= 6 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  nick := coalesce((select nickname from profiles where id = uid), '访客');
  if g.dog_on_duty or (g.guard_until is not null and g.guard_until > now()) then
    update gardens set plots = jsonb_set(plots, array[p_plot::text], o || jsonb_build_object('t', coalesce(o->'t','[]'::jsonb) || to_jsonb(uid::text)))
      where owner = o_id;
    insert into steal_log(owner, thief, thief_name, plot, crop, caught) values (o_id, uid, nick, p_plot, o->>'c', true);
    return jsonb_build_object('ok', false, 'reason', 'caught', 'by', case when g.dog_on_duty then 'dog' else 'bark' end, 'crop', o->>'c', 'space_owner', o_id);
  end if;
  update gardens set plots = jsonb_set(plots, array[p_plot::text],
      o || jsonb_build_object('s', coalesce((o->>'s')::int, 0) + 1, 't', coalesce(o->'t','[]'::jsonb) || to_jsonb(uid::text))),
    updated_at = now()
    where owner = o_id;
  insert into steal_log(owner, thief, thief_name, plot, crop) values (o_id, uid, nick, p_plot, o->>'c');
  return jsonb_build_object('ok', true, 'crop', o->>'c', 'plot', p_plot, 'space_owner', o_id);
end $$;

-- tg_space_summary: from r5.sql (1x)
create or replace function public.tg_space_summary(p_owner uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'owner', p_owner,
    'name', coalesce((select nickname from profiles where id = p_owner), '访客'),
    'crops', coalesce((select count(*) from gardens g, jsonb_array_elements(case when jsonb_typeof(g.plots) = 'array' then g.plots else '[]'::jsonb end) e
                       where g.owner = p_owner and jsonb_typeof(e) = 'object'), 0),
    'animals', coalesce((select jsonb_array_length(animals) from showcases where owner = p_owner and jsonb_typeof(animals) = 'array'), 0),
    'decor', coalesce((select jsonb_array_length(decor -> 'yard') from showcases where owner = p_owner and jsonb_typeof(decor -> 'yard') = 'array'), 0),
    'plaques', coalesce((select jsonb_array_length(shrine -> 'plaques') from showcases where owner = p_owner and jsonb_typeof(shrine -> 'plaques') = 'array'), 0))
$$;

-- lantern_list: from r6.sql (1x)
create or replace function public.lantern_list(p_limit int default 60) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.id desc), '[]'::jsonb) from (
    select w.id, w.author, coalesce(p.nickname, '访客') as name, w.body, w.color, w.created_at, w.author = auth.uid() as mine
    from wishes w left join profiles p on p.id = w.author
    where auth.uid() is not null and w.kind = 'lantern' and w.created_at > now() - interval '24 hours'
      and (not tg_is_test(w.author) or tg_is_test(auth.uid()))
    order by w.id desc limit least(greatest(coalesce(p_limit, 60), 1), 100)) x
$$;

-- tea_wall: from r6.sql (1x)
create or replace function public.tea_wall(p_limit int default 50, p_before bigint default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.id desc), '[]'::jsonb) from (
    select t.id, t.author, coalesce(p.nickname, '访客') as name, t.body, t.created_at, t.author = auth.uid() as mine,
           c.name as title_name, c.emoji as title_emoji
    from tea_posts t left join profiles p on p.id = t.author left join avatars a on a.owner = t.author left join avatar_catalog c on c.id = a.title
    where auth.uid() is not null and not t.hidden and t.created_at > now() - interval '7 days'
      and (p_before is null or t.id < p_before)
      and (not tg_is_test(t.author) or tg_is_test(auth.uid()))
    order by t.id desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) x
$$;

-- dm_threads: from social.sql (1x)
create or replace function public.dm_threads() returns jsonb
language sql stable security invoker set search_path = public as $$
  with mine as (
    select *, case when sender = auth.uid() then recipient else sender end as other
    from dm_messages where sender = auth.uid() or recipient = auth.uid()),
  last as (select distinct on (other) other, id, body, sender, created_at from mine order by other, id desc),
  unread as (select sender as other, count(*) n from mine where recipient = auth.uid() and read_at is null group by sender)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.other, 'name', coalesce(p.nickname, '访客'), 'last', l.body, 'last_from_me', l.sender = auth.uid(),
      'at', floor(extract(epoch from l.created_at) * 1000)::bigint, 'unread', coalesce(u.n, 0)) order by l.id desc), '[]'::jsonb)
  from last l left join unread u on u.other = l.other left join profiles p on p.id = l.other
$$;
