-- r7.2 — 福缘里 · 心田小院. Apply AFTER r7.1.sql. Idempotent (safe to run again).
--  H1  optimistic concurrency for cloud saves: saves.rev + save_get / save_put(p_state, p_base_rev) / save_rev.
--      A stale write (base rev <> current rev) is refused with reason 'conflict' and the current state+rev, so the
--      client can merge instead of silently overwriting the other device. Old clients (v13) that upsert the table
--      directly still work: the trigger accepts the write, bumps rev (so rev-aware clients notice) and counts it in
--      saves.legacy_writes / last_legacy_at ("accept but warn"). After v14 has been live a while, direct writes
--      can be revoked (see the commented block at the end).
--  H4  data: auto-generated default nicknames 香客1234 -> 访客1234 (only ^香客[0-9]+$; nothing else is touched).
--  QA  tg_cleanup_tests() also catches __test accounts whose profile row is gone (nickname in auth user metadata)
--      and the two tables without a user FK (shrine_attempts, showcases.editor).
--
-- PREVIEW (run first, read-only):
--   select count(*) as default_nicks_to_rename from public.profiles where nickname ~ '^香客[0-9]+$';
--   select id, nickname, '访客' || substring(nickname from 3) as new_nickname from public.profiles where nickname ~ '^香客[0-9]+$' order by 2;
begin;

-- ======================= H1: save revisions =======================
alter table public.saves add column if not exists rev bigint not null default 0;
alter table public.saves add column if not exists legacy_writes int not null default 0;
alter table public.saves add column if not exists last_legacy_at timestamptz;

-- direct table writes (v13 clients) bypass save_put: accept them, but bump rev and count them
create or replace function public.tg_saves_rev() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('tg.save_rpc', true), '') = '1' then return new; end if;   -- save_put manages rev itself
  if tg_op = 'INSERT' then
    new.rev := 1; new.legacy_writes := 1; new.last_legacy_at := now();
  else
    new.rev := old.rev + 1; new.legacy_writes := old.legacy_writes + 1; new.last_legacy_at := now();
  end if;
  return new;
end $$;
drop trigger if exists saves_rev on public.saves;
create trigger saves_rev before insert or update on public.saves for each row execute function public.tg_saves_rev();

-- current cloud save: {state|null, rev, updated_at}
create or replace function public.save_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then jsonb_build_object('ok', false, 'reason', 'not_signed_in')
    else coalesce((select jsonb_build_object('ok', true, 'state', case when s.state = '{}'::jsonb then null else s.state end,
                                             'rev', s.rev, 'updated_at', s.updated_at)
                   from saves s where s.user_id = auth.uid()),
                  jsonb_build_object('ok', true, 'state', null, 'rev', 0, 'updated_at', null)) end
$$;

-- cheap check (tab became visible again: did another device save meanwhile?)
create or replace function public.save_rev() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select rev from saves where user_id = auth.uid()), 0)
$$;

-- write my save if nobody else wrote since p_base_rev. p_base_rev null = unconditional (reset / brand-new account).
-- ok:    {ok:true, rev}
-- stale: {ok:false, reason:'conflict', rev, state, updated_at}     (state = what the other device saved)
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

revoke all on function public.tg_saves_rev() from public, anon, authenticated;
revoke all on function public.save_get(), public.save_rev(), public.save_put(jsonb, bigint) from public, anon;
grant execute on function public.save_get(), public.save_rev(), public.save_put(jsonb, bigint) to authenticated;

-- ======================= H4: default nicknames =======================
update public.profiles set nickname = '访客' || substring(nickname from 3) where nickname ~ '^香客[0-9]+$';

-- ======================= test cleanup =======================
create or replace function public.tg_cleanup_tests() returns int
language plpgsql security definer set search_path = public as $$
declare n int; ids uuid[];
begin
  select coalesce(array_agg(u.id), '{}') into ids from auth.users u
  where exists (select 1 from profiles p where p.id = u.id and p.nickname like '\_\_test%')
     or (not exists (select 1 from profiles p where p.id = u.id) and coalesce(u.raw_user_meta_data ->> 'nickname', '') like '\_\_test%');
  delete from suggestions where player_id = any (ids);
  delete from shrine_attempts where owner = any (ids) or guest = any (ids);          -- no FK on this table
  update showcases set editor = null where editor = any (ids);                       -- a test family member edited a real yard
  with d as (delete from auth.users where id = any (ids) returning 1) select count(*) into n from d;   -- the rest cascades
  return n;
end $$;
revoke all on function public.tg_cleanup_tests() from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';

-- Later (NOT now — only after v14+ has been live long enough that no v13 tab is still open): force every save through save_put
--   drop policy if exists "saves own insert" on public.saves;  drop policy if exists "saves own update" on public.saves;
