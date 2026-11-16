-- 福缘里 · 心田小院 r7 (after r6.1.sql): 意见箱 (suggestion box). One transaction; safe to re-run.
-- Players: suggest_submit / suggest_list / suggest_followup / suggest_unread_count / suggest_mark_seen (authenticated only).
-- Nightly review: suggest_admin_pending / suggest_admin_reply, guarded by an admin secret (bcrypt hash below; the secret itself
-- lives only in backend/.suggest_admin_key on the box). Callable with the publishable key (anon) because the nightly job has
-- no user session; every call checks the secret first.
begin;

-- ---------- limits (r6.1 values + suggestion box) ----------
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
    else 0 end
$$;

-- ---------- tables ----------
create table if not exists public.suggestions (
  id bigserial primary key,
  player_id uuid not null references auth.users on delete cascade,
  nickname text,                                   -- snapshot at submit time
  category text not null check (category in ('decor', 'gameplay', 'ui', 'bug', 'other')),
  body text not null check (char_length(body) between 10 and 500),
  status text not null default 'pending' check (status in ('pending', 'need_info', 'accepted_live', 'rejected', 'escalated')),
  reply text check (reply is null or char_length(reply) <= 1000),
  reply_at timestamptz,
  follow_up text check (follow_up is null or char_length(follow_up) <= 500),
  seen_at timestamptz,                             -- player last looked at this reply (red dot)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_batch text);
create index if not exists suggestions_player_idx on public.suggestions (player_id, created_at desc);
create index if not exists suggestions_status_idx on public.suggestions (status, updated_at);
alter table public.suggestions enable row level security;
drop policy if exists suggestions_select_own on public.suggestions;
create policy suggestions_select_own on public.suggestions for select to authenticated using (player_id = auth.uid());
revoke all on public.suggestions from anon, public;
revoke insert, update, delete on public.suggestions from authenticated;
grant select on public.suggestions to authenticated;               -- own rows only (policy); writes go through the RPCs

create table if not exists public.tg_admin_keys (
  name text primary key, hash text not null, created_at timestamptz not null default now());
alter table public.tg_admin_keys enable row level security;           -- no policies: nobody reads it except definer functions
revoke all on public.tg_admin_keys from anon, authenticated, public;
insert into public.tg_admin_keys(name, hash) values ('suggest', '$2a$10$sKoODoBIpsRLon2c5A5FLOqyY/h2.mGcEMVG40.5EK9ZTLCnp8Vim')
on conflict (name) do update set hash = excluded.hash;

-- ---------- helpers ----------
create or replace function public.tg_admin_ok(p_name text, p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare h text;
begin
  if p_key is null or char_length(p_key) < 32 or char_length(p_key) > 200 then return false; end if;
  select hash into h from tg_admin_keys where name = p_name;
  return h is not null and extensions.crypt(p_key, h) = h;
end $$;
-- contact-info check for suggestions (looser than tg_text_reason's 7-digit rule: IDs, versions, dates are fine)
create or replace function public.tg_contact_reason(p text) returns text
language plpgsql immutable as $$
declare t text; d text;
begin
  t := lower(translate(coalesce(p, ''), '０１２３４５６７８９ＱＶＸＷ', '0123456789qvxw'));
  d := regexp_replace(t, '[\s\-\.·_()（）]', '', 'g');
  if d ~ '(^|[^0-9])1[3-9][0-9]{9}([^0-9]|$)' then return 'number'; end if;                     -- mainland mobile (separators ignored)
  if t ~ '(qq|q号|扣扣|企鹅|vx|v信|wx|微信|weixin|wechat|威信|薇信|电话|手机|tel|phone|联系方式)[\s:：=是号为]{0,3}[0-9a-z][0-9a-z_-]{4,}' then return 'number'; end if;
  return null;
end $$;
create or replace function public.tg_suggest_json(s public.suggestions) returns jsonb language sql stable as $$
  select jsonb_build_object('id', s.id, 'category', s.category, 'body', s.body, 'status', s.status, 'reply', s.reply,
    'reply_at', s.reply_at, 'follow_up', s.follow_up, 'created_at', s.created_at, 'updated_at', s.updated_at,
    'unread', s.reply_at is not null and (s.seen_at is null or s.seen_at < s.reply_at))
$$;

-- ---------- player RPCs ----------
create or replace function public.suggest_submit(p_category text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t text; why text; nid bigint;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_category is null or p_category not in ('decor', 'gameplay', 'ui', 'bug', 'other') then return jsonb_build_object('ok', false, 'reason', 'bad_category'); end if;
  t := btrim(regexp_replace(regexp_replace(coalesce(p_body, ''), '[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]', ' ', 'g'), '\s+', ' ', 'g'));
  if char_length(t) < 10 then return jsonb_build_object('ok', false, 'reason', 'too_short', 'min', 10); end if;
  if char_length(t) > 500 then return jsonb_build_object('ok', false, 'reason', 'too_long', 'max', 500); end if;
  why := coalesce(tg_contact_reason(t), tg_text_reason(regexp_replace(t, '[0-9０-９]', '', 'g'), 500));   -- contact info / link / blocked word (plain digit runs allowed)
  if why is not null then return jsonb_build_object('ok', false, 'reason', why); end if;
  perform pg_advisory_xact_lock(hashtext('tg_suggest'), hashtext(uid::text));
  if tg_take_daily(uid, 'suggest', tg_limit('suggest')) = 0 then return jsonb_build_object('ok', false, 'reason', 'daily', 'limit', tg_limit('suggest')); end if;
  insert into suggestions(player_id, nickname, category, body)
    values (uid, (select left(nickname, 24) from profiles where id = uid), p_category, t) returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid, 'left', tg_limit('suggest') - tg_daily_used(uid, 'suggest'));
end $$;

create or replace function public.suggest_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  return coalesce((select jsonb_agg(tg_suggest_json(s) order by s.created_at desc)
                   from (select * from suggestions where player_id = uid order by created_at desc limit 50) s), '[]'::jsonb);
end $$;

create or replace function public.suggest_followup(p_id bigint, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s suggestions%rowtype; t text; why text;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into s from suggestions where id = p_id and player_id = uid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if s.status <> 'need_info' then return jsonb_build_object('ok', false, 'reason', 'not_need_info', 'status', s.status); end if;
  t := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  if char_length(t) < 5 then return jsonb_build_object('ok', false, 'reason', 'too_short', 'min', 5); end if;
  if char_length(t) > 500 then return jsonb_build_object('ok', false, 'reason', 'too_long', 'max', 500); end if;
  why := coalesce(tg_contact_reason(t), tg_text_reason(regexp_replace(t, '[0-9０-９]', '', 'g'), 500));
  if why is not null then return jsonb_build_object('ok', false, 'reason', why); end if;
  if tg_take_daily(uid, 'suggest_fu', tg_limit('suggest_fu')) = 0 then return jsonb_build_object('ok', false, 'reason', 'daily'); end if;
  update suggestions set follow_up = t, status = 'pending', seen_at = now(), updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'pending');
end $$;

create or replace function public.suggest_unread_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from suggestions
  where player_id = auth.uid() and reply_at is not null and (seen_at is null or seen_at < reply_at)
$$;

create or replace function public.suggest_mark_seen(p_id bigint default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update suggestions set seen_at = now()
  where player_id = auth.uid() and reply_at is not null and (seen_at is null or seen_at < reply_at) and (p_id is null or id = p_id);
  get diagnostics n = row_count; return n;
end $$;

-- ---------- nightly review (admin secret) ----------
-- pending rows (new + answered follow-ups), oldest first. Test accounts' rows are flagged so the reviewer can skip them.
create or replace function public.suggest_admin_pending(p_key text, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not tg_admin_ok('suggest', p_key) then return jsonb_build_object('ok', false, 'reason', 'denied'); end if;
  return jsonb_build_object('ok', true, 'at', now(), 'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'player_id', s.player_id, 'nickname', s.nickname, 'category', s.category, 'body', s.body,
      'follow_up', s.follow_up, 'prev_reply', s.reply, 'prev_batch', s.reviewed_batch, 'created_at', s.created_at, 'updated_at', s.updated_at,
      'is_test', tg_is_test(s.player_id),
      'player_open', (select count(*) from suggestions o where o.player_id = s.player_id and o.status in ('pending', 'need_info'))) order by s.updated_at)
    from (select * from suggestions where status = 'pending' order by updated_at limit greatest(1, least(coalesce(p_limit, 200), 500))) s), '[]'::jsonb));
end $$;

create or replace function public.suggest_admin_reply(p_key text, p_id bigint, p_status text, p_reply text, p_batch text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s suggestions%rowtype;
begin
  if not tg_admin_ok('suggest', p_key) then return jsonb_build_object('ok', false, 'reason', 'denied'); end if;
  if p_status is null or p_status not in ('pending', 'need_info', 'accepted_live', 'rejected', 'escalated') then return jsonb_build_object('ok', false, 'reason', 'bad_status'); end if;
  if p_status <> 'pending' and coalesce(btrim(p_reply), '') = '' then return jsonb_build_object('ok', false, 'reason', 'reply_required'); end if;
  if char_length(coalesce(p_reply, '')) > 1000 then return jsonb_build_object('ok', false, 'reason', 'too_long'); end if;
  if p_batch is null or p_batch !~ '^[A-Za-z0-9_.:-]{1,40}$' then return jsonb_build_object('ok', false, 'reason', 'bad_batch'); end if;
  select * into s from suggestions where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  update suggestions set status = p_status, reply = nullif(btrim(p_reply), ''), reply_at = case when coalesce(btrim(p_reply), '') = '' then reply_at else now() end,
         reviewed_batch = p_batch, updated_at = now()
  where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_status);
end $$;

-- ---------- test cleanup also removes suggestions (they also go via ON DELETE CASCADE) ----------
create or replace function public.tg_cleanup_tests() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from suggestions where player_id in (select id from profiles where nickname like '\_\_test%');
  with d as (delete from auth.users where id in (select id from profiles where nickname like '\_\_test%') returning 1)
  select count(*) into n from d;
  return n;
end $$;

-- ---------- grants ----------
revoke all on function public.tg_limit(text), public.tg_admin_ok(text, text), public.tg_contact_reason(text), public.tg_suggest_json(public.suggestions), public.tg_cleanup_tests() from public, anon, authenticated;
revoke all on function public.suggest_submit(text, text), public.suggest_list(), public.suggest_followup(bigint, text),
  public.suggest_unread_count(), public.suggest_mark_seen(bigint), public.suggest_admin_pending(text, int),
  public.suggest_admin_reply(text, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.suggest_submit(text, text), public.suggest_list(), public.suggest_followup(bigint, text),
  public.suggest_unread_count(), public.suggest_mark_seen(bigint) to authenticated;
grant execute on function public.suggest_admin_pending(text, int), public.suggest_admin_reply(text, bigint, text, text, text) to anon, authenticated;
commit;
notify pgrst, 'reload schema';
