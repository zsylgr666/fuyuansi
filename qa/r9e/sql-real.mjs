// Local only. Real tg_take_daily / tg_daily_used / tg_day / crop_rules come from backend/upstream/r6.sql.
// Real econ_earn (r9), econ_status (r9), shop tables, tg_req_ok, econ_shop_buy, econ_sellback, econ_sellback_credit
// come from backend/upstream/r9.sql, then the r9e drafts replace earn/status/limit.
// Mocked scaffolding, disclosed: auth.users, auth.uid(), roles anon/authenticated. No remote SQL.
import { PGlite } from '/tmp/r9d-deps/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const up = path.join(root, 'backend/upstream');
const r6 = fs.readFileSync(path.join(up, 'r6.sql'), 'utf8');
const r9 = fs.readFileSync(path.join(up, 'r9.sql'), 'utf8');
const forward = fs.readFileSync(path.join(root, 'backend/r9e-uncap.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'backend/r9e-uncap-rollback.sql'), 'utf8');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); console.log(ok ? 'PASS' : 'FAIL', name, detail || ''); };

function sliceBetween(text, start, end) {
  const i = text.indexOf(start); if (i < 0) throw new Error('missing ' + start);
  const j = end ? text.indexOf(end, i) : text.length; if (j < 0) throw new Error('missing ' + end);
  return text.slice(i, j);
}
check('upstream tg_take_daily is the daily_counts implementation', /insert into daily_counts/.test(r6) && /for update/.test(sliceBetween(r6, 'create or replace function public.tg_take_daily', 'create or replace function public.tg_daily_used')));
check('upstream econ_sellback charges sellback_coins through tg_take_daily', /tg_take_daily\(uid, 'sellback_coins'/.test(r9));

const db = new PGlite();
const A = '00000000-0000-0000-0000-0000000000aa';
const B = '00000000-0000-0000-0000-0000000000bb';
const C = '00000000-0000-0000-0000-0000000000cc';
await db.exec(`
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, created_at timestamptz not null default now());
  insert into auth.users(id) values ('${A}'), ('${B}'), ('${C}') on conflict do nothing;
  create or replace function auth.uid() returns uuid language sql stable as $$ select '${A}'::uuid $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
`);
const helpers = [
  sliceBetween(r6, 'create or replace function public.tg_day', 'create table if not exists public.daily_counts'),
  sliceBetween(r6, 'create table if not exists public.daily_counts', '-- tunable limits'),
  sliceBetween(r6, 'create table if not exists public.crop_rules', 'create or replace function public.tg_max_grow_ms')
].join('\n');
await db.exec(helpers);
const r9part = sliceBetween(r9, 'create or replace function public.tg_limit', '-- ---------- 5. fix: market_buy');
await db.exec(r9part);

async function uid(id) { await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '${id}'::uuid $$`); }
async function one(sql, params) { return (await db.query(sql, params)).rows[0]; }
async function apply(sql) { await db.exec(sql.replace(/notify pgrst, 'reload schema';\s*$/, '')); }

let row = await one(`select pg_get_functiondef('public.tg_take_daily(uuid,text,bigint,bigint)'::regprocedure) as def`);
check('loaded tg_take_daily is the upstream body', /daily_counts/.test(row.def) && /for update/.test(row.def), row.def.slice(0, 180));
row = await one(`select pg_get_functiondef('public.econ_sellback(text,int,int,text)'::regprocedure) as def`);
check('loaded econ_sellback is the upstream body', /sellback_ledger/.test(row.def) && /sellback_coins/.test(row.def));

await apply(forward);
row = await one(`select public.tg_limit('sell_coins') as sell, public.tg_limit('earn_coins') as earn, public.tg_limit('sellback_coins') as sb, public.tg_limit('merit_coins') as merit`);
check('limits: sell ceiling NULL, earn 40, sellback 400, merit 8', row.sell === null && row.earn === 40 && row.sb === 400 && row.merit === 8, JSON.stringify(row));
row = await one(`select public.econ_status() as r`);
check('status advertises legacy 100 and sell_uncapped true', row.r.sell_uncapped === true && row.r.sell_cap === 100 && row.r.sell_left === 100 && row.r.sellback_cap === 400 && row.r.earn_cap === 40, JSON.stringify(row.r));
for (const n of [50, 101, 5000, 9007199254740991]) {
  row = await one(`select public.econ_earn($1::bigint, 'sell', true) as r`, [n]);
  check(`uncapped sell ${n} granted and not clamped to the advertised 100`, row.r.ok === true && String(row.r.granted) === String(n) && row.r.sell_uncapped === true && row.r.cap === 100 && row.r.left === 100, JSON.stringify(row.r));
}
row = await one(`select coalesce(sum(n),0)::bigint as n from daily_counts where kind='sell_coins'`);
check('uncapped sells do not write sell_coins through tg_take_daily', String(row.n) === '0', JSON.stringify(row));
row = await one(`select public.econ_earn(40, 'task', true) as r`);
check('task 40 granted by real tg_take_daily', row.r.ok === true && row.r.granted === 40, JSON.stringify(row.r));
row = await one(`select n::bigint as n from daily_counts where owner='${A}' and kind='earn_coins'`);
check('earn_coins counter is 40', String(row.n) === '40', JSON.stringify(row));
row = await one(`select public.econ_earn(1, 'task', true) as r`);
check('task past 40 refused', row.r.ok === false && row.r.reason === 'daily_cap', JSON.stringify(row.r));
row = await one(`select public.econ_earn(80, 'sell', true) as r`);
check('a full task pool does not block a crop sale', row.r.ok === true && row.r.granted === 80, JSON.stringify(row.r));
await uid(C);
let merit = 0;
for (let i = 0; i < 8; i++) { row = await one(`select public.econ_earn(1, 'merit', true) as r`); if (row.r.ok && row.r.granted === 1) merit++; }
check('merit grants 8', merit === 8, String(merit));
row = await one(`select public.econ_earn(1, 'merit', true) as r`);
check('merit 9th refused', row.r.ok === false && row.r.reason === 'daily_cap', JSON.stringify(row.r));
row = await one(`select n::bigint as n from daily_counts where owner='${C}' and kind='earn_coins'`);
check('merit consumed the shared earn pool', String(row.n) === '8', JSON.stringify(row));

await uid(A);
const buy = await one(`select public.econ_shop_buy('wood-table', 14, 'buy-wood-01') as r`);
check('real shop_buy credits 14 wood tables', buy.r.ok === true && buy.r.credit === 14, JSON.stringify(buy.r));
let sold = 0, blocked = null;
for (let i = 1; i <= 14; i++) {
  row = await one(`select public.econ_sellback('wood-table', 1, 30, $1) as r`, ['sell-wood-' + String(i).padStart(2, '0')]);
  if (row.r.ok) sold++; else blocked = row.r;
}
check('real econ_sellback stops at 400 (13 grants, 14th daily_cap)', sold === 13 && blocked && blocked.reason === 'daily_cap' && blocked.left === 10, JSON.stringify({ sold, blocked }));
row = await one(`select n::bigint as n from daily_counts where owner='${A}' and kind='sellback_coins'`);
check('sellback counter is 390', String(row.n) === '390', JSON.stringify(row));
const replay = await one(`select public.econ_sellback('wood-table', 1, 30, 'sell-wood-01') as r`);
row = await one(`select qty from shop_credit where owner='${A}' and item='wood-table'`);
const ledger = await one(`select count(*)::int as n from sellback_ledger where owner='${A}' and kind='sell' and req='sell-wood-01'`);
check('same request id replays and does not take a second credit', replay.r.ok === true && replay.r.replay === true && replay.r.granted === 30 && row.qty === 1 && ledger.n === 1, JSON.stringify({ replay: replay.r, qty: row.qty, ledger }));
await uid(B);
const other = await one(`select public.econ_sellback('wood-table', 1, 30, 'sell-wood-01') as r`);
check('another account does not replay the first account request', other.r.ok === false && other.r.replay !== true, JSON.stringify(other.r));

await apply(rollback);
await uid(C);
row = await one(`select public.econ_status() as r`);
check('rollback status is explicit sell_uncapped false and cap 100', row.r.sell_uncapped === false && row.r.sell_cap === 100 && row.r.sell_left === 100 && row.r.sellback_cap === 400, JSON.stringify(row.r));
row = await one(`select public.econ_earn(100, 'sell', true) as r`);
check('after rollback, sell 100 is granted', row.r.ok === true && row.r.granted === 100, JSON.stringify(row.r));
row = await one(`select public.econ_earn(1, 'sell', true) as r`);
check('after rollback, the next sell coin is refused', row.r.ok === false && row.r.reason === 'daily_cap', JSON.stringify(row.r));
row = await one(`select public.tg_limit('sellback_coins') as sb, public.tg_limit('earn_coins') as earn`);
check('rollback leaves sellback 400 and earn 40', row.sb === 400 && row.earn === 40, JSON.stringify(row));

const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length }, null, 2));
if (failed.length) process.exit(1);
