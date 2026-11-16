-- r7.4 — free avatar titles (r7h). Apply AFTER r7.3.sql. Idempotent: safe to run again. No price / economy change to anything existing.
--  (a) the 8 free palette titles become avatar_catalog rows (kind 'title', price 0) so tg_owns() is true for everyone.
--      Ids are ascii (the id column only allows ^[a-z][a-z0-9_-]{1,31}$); the r7h client sends the NAME (e.g. '茶客') as p_title,
--      so avatar_save now also accepts a title name (current or legacy) and maps it to the id. 雅士 / 旅人 are NOT added again:
--      they stay the paid title_jushi / title_xingzhe. Free titles are not in merit_prices, so they never show up in the 善缘阁 shop.
--  (b) avatar_get / tg_avatar_json: title_name falls back to avatar->>'title' when the title id is null (safety net).
-- Backward compatible with live r7g clients: ids still work exactly as before; a name that matches no title is still refused.
begin;

-- ---------- (a) free titles ----------
insert into public.avatar_catalog(id, kind, name, emoji, price, sort, slot, part)
select v.id, 'title', v.name, '', 0, v.sort, null, null
from (values
  ('free_chake',     '茶客',   100),
  ('free_yuanding',  '园丁',   101),
  ('free_chaboshi',  '茶博士', 102),
  ('free_yuanzhu',   '园主',   103),
  ('free_youfangke', '游方客', 104),
  ('free_huashi',    '画师',   105),
  ('free_yaoshi',    '药师',   106),
  ('free_zhanggui',  '掌柜',   107)
) as v(id, name, sort)
where not exists (select 1 from public.avatar_catalog c                 -- never a second row for a name that already exists
                  where c.kind = 'title' and (c.name = v.name or v.name = any (c.legacy_names)))
on conflict (id) do nothing;

-- p_title may be an id (r6/r7g clients) or a title name / legacy name (r7h sends the free title's name)
create or replace function public.tg_title_id(p text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from avatar_catalog where id = p and kind = 'title'),
    (select id from avatar_catalog where kind = 'title' and name = p order by price desc, id limit 1),
    (select id from avatar_catalog where kind = 'title' and p = any (legacy_names) order by price desc, id limit 1))
$$;

create or replace function public.avatar_save(p_avatar jsonb, p_title text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); why text; tid text;
begin
  if uid is null then raise exception 'not signed in'; end if;
  why := tg_avatar_reason(uid, p_avatar);
  if why is not null then return jsonb_build_object('ok', false, 'reason', why); end if;
  if nullif(p_title, '') is not null then
    tid := tg_title_id(p_title);
    if tid is null or not tg_owns(uid, tid) then return jsonb_build_object('ok', false, 'reason', 'title_not_owned'); end if;
    p_title := tid;
  else
    p_title := null;
  end if;
  if p_title is null and coalesce(p_avatar ->> 'title', '') <> '' then
    p_title := tg_title_id(p_avatar ->> 'title');
  end if;
  if p_title is not null then p_avatar := p_avatar || jsonb_build_object('title', (select name from avatar_catalog where id = p_title)); end if;
  insert into avatars(owner, avatar, title, rev, updated_at) values (uid, p_avatar, p_title, tg_now_ms(), now())
    on conflict (owner) do update set avatar = excluded.avatar, title = excluded.title, rev = excluded.rev, updated_at = now();
  return jsonb_build_object('ok', true) || tg_avatar_json(uid);
end $$;

-- ---------- (b) title_name fallback ----------
create or replace function public.tg_avatar_json(p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('avatar', coalesce(a.avatar, '{}'::jsonb), 'title', a.title,
           'title_name', coalesce(c.name, nullif(a.avatar ->> 'title', '')), 'title_emoji', c.emoji, 'mounts', a.mounts, 'rev', coalesce(a.rev, 0))
  from (select 1) one left join avatars a on a.owner = p_uid left join avatar_catalog c on c.id = a.title
$$;
create or replace function public.avatar_get(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(a.owner::text, jsonb_build_object('avatar', a.avatar, 'title', a.title,
           'title_name', coalesce(c.name, nullif(a.avatar ->> 'title', '')),
           'title_emoji', c.emoji, 'mounts', a.mounts, 'rev', a.rev)), '{}'::jsonb)
  from avatars a left join avatar_catalog c on c.id = a.title
  where auth.uid() is not null and a.owner = any ((p_ids)[1:100])
$$;

revoke all on function public.tg_title_id(text) from public, anon, authenticated;
revoke all on function public.avatar_save(jsonb, text), public.avatar_get(uuid[]) from public, anon;   -- same grants as r6.sql
grant execute on function public.avatar_save(jsonb, text), public.avatar_get(uuid[]) to authenticated;
commit;
notify pgrst, 'reload schema';
