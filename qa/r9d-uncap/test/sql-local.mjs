// Local SQL validation only. Never connects to Supabase or a live player database.
import { PGlite } from '/tmp/r9d-deps/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '../../../backend');
const forward = fs.readFileSync(path.join(backend, 'r9d-uncap.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(backend, 'r9d-uncap-rollback.sql'), 'utf8');
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  if (!cond) console.error('FAIL', name, detail || '');
  else console.log('PASS', name);
}

check('forward draft does not replace sellback, market, or family functions',
  !/create or replace function public\.econ_sellback\b/.test(forward)
  && !/create or replace function public\.market_buy\b/.test(forward)
  && !/create or replace function public\.space_take_decor\b/.test(forward)
  && !/create or replace function public\.space_save\b/.test(forward));
check('forward draft has no numeric sell_coins ceiling',
  /when 'sell_coins'\s+then null::bigint/.test(forward) && !/when 'sell_coins'\s+then \d+/.test(forward));
check('rollback draft restores sell_coins 100 and has no sell_uncapped flag',
  /when 'sell_coins'\s+then 100/.test(rollback) && !/sell_uncapped/.test(rollback));
check('furniture 400 and earn 40 remain in both drafts',
  /when 'sellback_coins' then 400/.test(forward) && /when 'earn_coins'\s+then 40/.test(forward)
  && /when 'sellback_coins' then 400/.test(rollback) && /when 'earn_coins'\s+then 40/.test(rollback));

const db = new PGlite();
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-0000000000aa'::uuid $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;
  create table if not exists crop_rules (id text primary key, grow_ms int);
  create table if not exists tg_daily (
    uid uuid not null, kind text not null, day date not null, used bigint not null default 0,
    primary key (uid, kind, day));
  create or replace function tg_day() returns date language sql stable as $$
    select (timezone('Asia/Shanghai', now()))::date $$;
  create or replace function tg_daily_used(p_uid uuid, p_kind text) returns bigint language sql stable as $$
    select coalesce((select used from tg_daily d where d.uid = p_uid and d.kind = p_kind and d.day = tg_day()), 0) $$;
  create or replace function tg_take_daily(p_uid uuid, p_kind text, p_lim bigint, p_n bigint) returns bigint language plpgsql as $$
  declare have bigint; g bigint;
  begin
    if p_lim is null or p_n is null or p_n <= 0 then return 0; end if;
    have := tg_daily_used(p_uid, p_kind);
    g := least(p_n, greatest(p_lim - have, 0));
    if g <= 0 then return 0; end if;
    insert into tg_daily(uid, kind, day, used) values (p_uid, p_kind, tg_day(), g)
      on conflict (uid, kind, day) do update set used = tg_daily.used + excluded.used;
    return g;
  end $$;
`);

async function one(sql, params) {
  const r = await db.query(sql, params);
  return r.rows[0];
}
async function apply(file) {
  const sql = fs.readFileSync(file, 'utf8').replace(/notify pgrst, 'reload schema';\s*$/,'');
  await db.exec(sql);
}

await apply(path.join(backend, 'r9d-uncap-rollback.sql'));
let row = await one(`select public.econ_earn(100, 'sell', true) as r`);
check('legacy r9 sell of 100 is granted', row.r.ok === true && row.r.granted === 100, JSON.stringify(row.r));
row = await one(`select public.econ_earn(1, 'sell', true) as r`);
check('legacy r9 exact sell past 100 is refused', row.r.ok === false && row.r.reason === 'daily_cap' && row.r.granted === 0, JSON.stringify(row.r));
row = await one(`select public.econ_status() as r`);
check('legacy status advertises sell_cap 100', row.r.sell_cap === 100 && row.r.sell_left === 0 && row.r.sell_uncapped == null, JSON.stringify(row.r));

await apply(path.join(backend, 'r9d-uncap.sql'));
row = await one(`select public.tg_limit('sell_coins') as sell, public.tg_limit('earn_coins') as earn, public.tg_limit('sellback_coins') as sb, public.tg_limit('merit_coins') as merit`);
check('limits: sell ceiling is SQL NULL, earn 40, sellback 400, merit 8',
  row.sell === null && row.earn === 40 && row.sb === 400 && row.merit === 8, JSON.stringify(row));

const big = [101, 5000, 250000, 9007199254740991];
for (const n of big) {
  row = await one(`select public.econ_earn($1::bigint, 'sell', true) as r`, [n]);
  check(`uncapped sell ${n} granted in full`, row.r.ok === true && String(row.r.granted) === String(n) && row.r.sell_uncapped === true && row.r.cap === null && row.r.left === null, JSON.stringify(row.r));
}
row = await one(`select public.econ_earn(9007199254740992, 'sell', true) as r`);
check('sell above the JS safe integer is rejected (not a daily cap)', row.r.ok === false && row.r.reason === 'bad_amount', JSON.stringify(row.r));
for (const bad of [0, -5]) {
  row = await one(`select public.econ_earn($1::bigint, 'sell', true) as r`, [bad]);
  check(`sell ${bad} rejected`, row.r.ok === false && row.r.reason === 'bad_amount', JSON.stringify(row.r));
}
row = await one(`select coalesce(sum(used),0)::bigint as used from tg_daily where kind = 'sell_coins'`);
check('uncapped sells do not add to the sell_coins counter left by the old 100 cap', String(row.used) === '100', JSON.stringify(row));

row = await one(`select public.econ_earn(40, 'task', true) as r`);
check('task 40 still granted', row.r.ok === true && row.r.granted === 40 && row.r.cap === 40, JSON.stringify(row.r));
row = await one(`select public.econ_earn(1, 'task', true) as r`);
check('task past 40 still refused', row.r.ok === false && row.r.reason === 'daily_cap', JSON.stringify(row.r));
row = await one(`select public.econ_status() as r`);
check('status agrees: uncapped null cap/left, earn left 0, sellback cap 400',
  row.r.sell_uncapped === true && row.r.sell_cap === null && row.r.sell_left === null
  && row.r.earn_cap === 40 && row.r.earn_left === 0 && row.r.sellback_cap === 400 && row.r.sellback_left === 400, JSON.stringify(row.r));

// fresh user so merit/earn pool is full
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-0000000000bb'::uuid $$`);
let meritOk = 0;
for (let i = 0; i < 8; i++) {
  row = await one(`select public.econ_earn(1, 'merit', true) as r`);
  if (row.r.ok === true && row.r.granted === 1) meritOk++;
}
check('merit still grants 8', meritOk === 8, String(meritOk));
row = await one(`select public.econ_earn(1, 'merit', true) as r`);
check('merit 9th is refused', row.r.ok === false && row.r.reason === 'daily_cap', JSON.stringify(row.r));
row = await one(`select public.econ_earn(1, 'task', true) as r`);
check('merit coins also consume the shared earn 40 (8 used, 1 task still ok)', row.r.ok === true && row.r.granted === 1, JSON.stringify(row.r));

await apply(path.join(backend, 'r9d-uncap-rollback.sql'));
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-0000000000cc'::uuid $$`);
row = await one(`select public.econ_earn(100, 'sell', true) as r`);
check('after exact rollback, sell 100 works again', row.r.ok === true && row.r.granted === 100, JSON.stringify(row.r));
row = await one(`select public.econ_earn(1, 'sell', true) as r`);
check('after exact rollback, the 101st sell coin is refused', row.r.ok === false && row.r.reason === 'daily_cap', JSON.stringify(row.r));
row = await one(`select public.tg_limit('sellback_coins') as sb, public.tg_limit('earn_coins') as earn`);
check('rollback leaves sellback 400 and earn 40', row.sb === 400 && row.earn === 40, JSON.stringify(row));

const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length }, null, 2));
if (failed.length) process.exit(1);
