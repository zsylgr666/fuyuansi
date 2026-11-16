-- r7.4.1 — (a) avatar JSON 'title' may also be a title ID (e.g. free_chake / title_jushi); (b) free title 游方客 is renamed 行客.
-- Apply AFTER r7.4.sql. Idempotent.
--  r7.4 already accepts an id or a name in avatar_save's p_title. But when a client also puts the id into the avatar JSON
--  (r7h save(cfg, 'free_chake') with a title-less cfg copies it there), tg_avatar_reason refused it ('bad_title': ids are
--  longer than the 8-char title text limit / 'title_not_owned': ids never matched a name). Now an existing title id is accepted
--  (ownership still required via tg_owns), and avatar_save stores the catalog NAME as before (it overwrites avatar.title).
--  (a) only tg_avatar_reason changes (= the r7.1 version + the two marked id checks).
--  (b) free_youfangke keeps its id; display name 行客, 游方客 kept in legacy_names (old clients / saves still map to it).
--      Stored avatars whose title is '游方客' are rewritten to '行客' (rev bumped so other players refetch).
--  No price / economy / table change.
begin;

-- ---------- (b) 游方客 -> 行客 ----------
update public.avatar_catalog
   set name = '行客',
       legacy_names = (select coalesce(array_agg(distinct x), '{}') from unnest(legacy_names || array['游方客']) x where x <> '行客')
 where id = 'free_youfangke' and (name <> '行客' or not ('游方客' = any (legacy_names)));
update public.avatars set avatar = jsonb_set(avatar, '{title}', '"行客"'), rev = tg_now_ms(), updated_at = now()
 where avatar ->> 'title' = '游方客';

-- ---------- (a) title ids in the avatar JSON ----------
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
      if k = 'title' and exists (select 1 from avatar_catalog t where t.kind = 'title' and t.id = v #>> '{}') then continue; end if;   -- r7.4.1: a title id
      if (v #>> '{}') <> '' and tg_text_reason(v #>> '{}', case when k = 'name' then 12 else 8 end) is not null then return 'bad_' || k; end if;
    elsif jsonb_typeof(v) = 'string' then
      if (v #>> '{}') !~ '^[A-Za-z0-9#_.-]{0,32}$' then return 'bad_value'; end if;
    elsif jsonb_typeof(v) not in ('number', 'boolean', 'null') then return 'bad_value';
    end if;
  end loop;
  for c in select * from avatar_catalog where slot is not null and price > 0 loop
    if p -> 'acc' ->> c.slot = c.part and not tg_owns(p_uid, c.id) then return 'not_owned'; end if;
  end loop;
  if coalesce(p ->> 'title', '') <> '' and not exists (select 1 from avatar_catalog t where t.kind = 'title' and (t.id = p ->> 'title' or t.name = p ->> 'title' or (p ->> 'title') = any (t.legacy_names)) and tg_owns(p_uid, t.id)) then
    return 'title_not_owned';
  end if;
  return null;
end $$;
commit;
notify pgrst, 'reload schema';
