-- r7.3 — 福缘里 · 心田小院: public wish plaques (祈愿牌) on the 祈愿古树 in the spawn plaza. Apply AFTER r7.2.sql. Idempotent.
-- No currency on the server and NO economy change: hanging a plaque only writes text, rate-limited per player
-- (tg_limit('wish') per Asia/Shanghai day = the altar's 5 slots, and at least tg_limit('wish_gap_s') seconds apart).
-- The client calls wish_hang() only after its existing local 挂祈愿牌/摆放心意 flow succeeded.
-- Text: 1..40 chars after whitespace cleanup, same contact-info / link / blocked-word filter as suggestions.
-- Read: wish_recent() only (no table grants). "__test" plaques are hidden from real players (like the tea wall).
-- Moderation: the nightly review can hide one with wish_admin_hide(key, id) (same admin key as the suggestion box).
-- Cleanup: wish_plaques.player_id -> auth.users ON DELETE CASCADE, so tg_cleanup_tests() removes __test plaques.
begin;

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

create table if not exists public.wish_plaques (
  id bigserial primary key,
  player_id uuid not null references auth.users on delete cascade,
  nickname text,                                         -- snapshot at hang time
  text text not null check (char_length(text) between 1 and 40),
  hidden boolean not null default false,                 -- set by moderation; never shown again
  created_at timestamptz not null default now());
create index if not exists wish_plaques_recent_idx on public.wish_plaques (created_at desc) where not hidden;
create index if not exists wish_plaques_player_idx on public.wish_plaques (player_id, created_at desc);
alter table public.wish_plaques enable row level security;   -- no policies: RPC access only
revoke all on public.wish_plaques from anon, authenticated;

create or replace function public.wish_hang(p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t text; why text; last_at timestamptz; nid bigint; nick text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  t := btrim(regexp_replace(regexp_replace(coalesce(p_text, ''), '[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]', ' ', 'g'), '\s+', ' ', 'g'));
  if char_length(t) < 1 then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  if char_length(t) > 40 then return jsonb_build_object('ok', false, 'reason', 'too_long', 'max', 40); end if;
  why := coalesce(tg_contact_reason(t), tg_text_reason(regexp_replace(t, '[0-9０-９]', '', 'g'), 40));
  if why is not null then return jsonb_build_object('ok', false, 'reason', why); end if;
  perform pg_advisory_xact_lock(hashtext('tg_wish'), hashtext(uid::text));
  select max(created_at) into last_at from wish_plaques where player_id = uid;
  if last_at is not null and last_at > now() - make_interval(secs => tg_limit('wish_gap_s')) then
    return jsonb_build_object('ok', false, 'reason', 'slow', 'wait_s', ceil(extract(epoch from last_at + make_interval(secs => tg_limit('wish_gap_s')) - now())));
  end if;
  if tg_take_daily(uid, 'wish', tg_limit('wish')) = 0 then return jsonb_build_object('ok', false, 'reason', 'daily', 'limit', tg_limit('wish')); end if;
  nick := (select left(nickname, 24) from profiles where id = uid);
  insert into wish_plaques(player_id, nickname, text) values (uid, nick, t) returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid, 'left', tg_limit('wish') - tg_daily_used(uid, 'wish'),
    'plaque', jsonb_build_object('id', nid, 'nickname', coalesce(nick, '访客'), 'text', t, 'created_at', now(), 'mine', true));
end $$;

-- latest plaques, newest first: [{id, nickname, text, created_at, mine}]
create or replace function public.wish_recent(p_limit int default 60) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'nickname', coalesce(w.nickname, '访客'), 'text', w.text,
                                               'created_at', w.created_at, 'mine', w.player_id = auth.uid()) order by w.created_at desc, w.id desc), '[]'::jsonb)
  from (select * from wish_plaques w
        where not w.hidden and (not tg_is_test(w.player_id) or tg_is_test(auth.uid()))
        order by w.created_at desc, w.id desc
        limit greatest(1, least(coalesce(p_limit, 60), 100))) w
$$;

-- nightly moderation: hide one plaque (admin key of the suggestion box)
create or replace function public.wish_admin_hide(p_key text, p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not tg_admin_ok('suggest', p_key) then return jsonb_build_object('ok', false, 'reason', 'denied'); end if;
  update wish_plaques set hidden = true where id = p_id;
  return jsonb_build_object('ok', found, 'id', p_id);
end $$;

revoke all on function public.wish_hang(text), public.wish_recent(int), public.wish_admin_hide(text, bigint) from public, anon, authenticated;
grant execute on function public.wish_hang(text), public.wish_recent(int) to authenticated;
grant execute on function public.wish_admin_hide(text, bigint) to anon, authenticated;
commit;
notify pgrst, 'reload schema';
