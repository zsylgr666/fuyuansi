// Local only. Real tg_take_daily / tg_daily_used / tg_day / crop_rules from backend/upstream/r6.sql.
// Real shop / sellback / tg_req_ok from backend/upstream/r9.sql, then the r9f drafts.
// Mocked scaffolding, disclosed: auth.users, auth.uid(), roles anon/authenticated. No remote SQL.
import { PGlite } from '/tmp/r9d-deps/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const up = path.join(root, 'backend/upstream');
const r6 = fs.readFileSync(path.join(up, 'r6.sql'), 'utf8');
const r9 = fs.readFileSync(path.join(up, 'r9.sql'), 'utf8');
const forward = fs.readFileSync(path.join(root, 'backend/r9f-uncap.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'backend/r9f-uncap-rollback.sql'), 'utf8');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); console.log(ok ? 'PASS' : 'FAIL', name, detail || ''); };
function sliceBetween(text, start, end) {
  const i = text.indexOf(start); if (i < 0) throw new Error('missing ' + start);
  const j = end ? text.indexOf(end, i) : text.length; if (j < 0) throw new Error('missing ' + end);
  return text.slice(i, j);
}
const earnFwd = sliceBetween(forward, '-- r9f-econ-earn', 'revoke all on function public.tg_limit');
const earnBack = sliceBetween(rollback, '-- r9f-econ-earn', 'revoke all on function public.tg_limit');
check('forward and rollback install the same econ_earn and econ_status', earnFwd === earnBack);
check('neither draft sets a numeric sell_coins limit', !/when 'sell_coins'\s+then\s+\d/.test(forward) && !/when 'sell_coins'\s+then\s+\d/.test(rollback));
check('capped mode passes the literal 100 to tg_take_daily', /tg_take_daily\(uid, 'sell_coins', 100, want\)/.test(forward));

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
await db.exec(sliceBetween(r9, 'create or replace function public.tg_limit', '-- ---------- 5. fix: market_buy'));
async function uid(id) { await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '${id}'::uuid $$`); }
async function one(sql, params) { return (await db.query(sql, params)).rows[0]; }
async function apply(sql) { await db.exec(sql.replace(/notify pgrst, 'reload schema';\s*$/, '')); }
async function policy() { return one(`select epoch::bigint as epoch, uncapped from sell_policy where id=1`); }
async function sellUsed(owner) {
  const row = await one(`select coalesce(sum(n),0)::bigint as n from daily_counts where owner=$1 and kind='sell_coins'`, [owner]);
  return String(row.n);
}

let row = await one(`select pg_get_functiondef('public.tg_take_daily(uuid,text,bigint,bigint)'::regprocedure) as def`);
check('loaded tg_take_daily is the upstream body', /daily_counts/.test(row.def) && /for update/.test(row.def));
row = await one(`select pg_get_functiondef('public.econ_sellback(text,int,int,text)'::regprocedure) as def`);
check('loaded econ_sellback is the upstream body', /sellback_ledger/.test(row.def) && /sellback_coins/.test(row.def));

await apply(forward);
row = await policy();
check('forward epoch 1 uncapped', String(row.epoch) === '1' && row.uncapped === true, JSON.stringify(row));
row = await one(`select public.tg_limit('sell_coins') as sell, public.tg_limit('earn_coins') as earn, public.tg_limit('sellback_coins') as sb, public.tg_limit('merit_coins') as merit`);
check('limits: sell NULL, earn 40, sellback 400, merit 8', row.sell === null && row.earn === 40 && row.sb === 400 && row.merit === 8, JSON.stringify(row));
row = await one(`select public.econ_status() as r`);
check('status advertises legacy 100, uncapped, epoch 1', row.r.sell_uncapped === true && row.r.sell_epoch === 1 && row.r.sell_cap === 100 && row.r.sell_left === 100 && row.r.sellback_cap === 400 && row.r.earn_cap === 40, JSON.stringify(row.r));

const pre = await one(`select public.econ_earn(5000, 'sell', true, 'crop-pre-rollback-0001') as r`);
check('uncapped sale stores its grant and epoch 1', pre.r.ok === true && pre.r.granted === 5000 && pre.r.sell_uncapped === true && pre.r.sell_epoch === 1 && pre.r.cap === 100, JSON.stringify(pre.r));
check('uncapped sale writes no sell_coins row', await sellUsed(A) === '0');
row = await one(`select public.econ_earn(9007199254740991::bigint, 'sell', true) as r`);
check('uncapped per-call bound still grants the JS safe integer', row.r.ok === true && String(row.r.granted) === '9007199254740991');
row = await one(`select public.econ_earn(9007199254740992::bigint, 'sell', true) as r`);
check('one past the JS safe integer is bad_amount', row.r.ok === false && row.r.reason === 'bad_amount', JSON.stringify(row.r));
check('those calls still wrote no sell_coins row', await sellUsed(A) === '0');

row = await one(`select public.econ_earn(40, 'task', true) as r`);
check('task 40 granted by real tg_take_daily', row.r.ok === true && row.r.granted === 40 && row.r.sell_epoch === 1, JSON.stringify(row.r));
row = await one(`select public.econ_earn(1, 'task', true) as r`);
check('task past 40 refused', row.r.ok === false && row.r.reason === 'daily_cap', JSON.stringify(row.r));
row = await one(`select public.econ_earn(80, 'sell', true, 'crop-beside-task-0001') as r`);
check('a full task pool does not block an uncapped crop sale', row.r.ok === true && row.r.granted === 80 && row.r.sell_uncapped === true, JSON.stringify(row.r));

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
const replaySb = await one(`select public.econ_sellback('wood-table', 1, 30, 'sell-wood-01') as r`);
row = await one(`select qty from shop_credit where owner='${A}' and item='wood-table'`);
const ledger = await one(`select count(*)::int as n from sellback_ledger where owner='${A}' and kind='sell' and req='sell-wood-01'`);
check('same sellback request replays once', replaySb.r.ok === true && replaySb.r.replay === true && replaySb.r.granted === 30 && row.qty === 1 && ledger.n === 1, JSON.stringify({ replay: replaySb.r, qty: row.qty, ledger }));
await uid(B);
const other = await one(`select public.econ_sellback('wood-table', 1, 30, 'sell-wood-01') as r`);
check('another account does not replay the first account sellback', other.r.ok === false && other.r.replay !== true, JSON.stringify(other.r));
const otherEarn = await one(`select public.econ_earn(10, 'sell', true, 'crop-pre-rollback-0001') as r`);
check('another account does not replay the first account crop request', otherEarn.r.ok === true && otherEarn.r.replay !== true && otherEarn.r.granted === 10 && otherEarn.r.sell_epoch === 1, JSON.stringify(otherEarn.r));

await apply(rollback);
await uid(A);
row = await policy();
check('rollback bumps the epoch and clears uncapped', String(row.epoch) === '2' && row.uncapped === false, JSON.stringify(row));
row = await one(`select public.econ_status() as r`);
check('rollback status is explicit false, epoch 2, left 100', row.r.sell_uncapped === false && row.r.sell_epoch === 2 && row.r.sell_cap === 100 && row.r.sell_left === 100 && row.r.sellback_cap === 400, JSON.stringify(row.r));
const replayOld = await one(`select public.econ_earn(1, 'sell', true, 'crop-pre-rollback-0001') as r`);
check('replay of the pre-rollback grant returns epoch 1 and does not re-uncap', replayOld.r.ok === true && replayOld.r.replay === true && replayOld.r.granted === 5000 && replayOld.r.sell_uncapped === true && replayOld.r.sell_epoch === 1, JSON.stringify(replayOld.r));
row = await policy();
check('that replay left the policy capped at epoch 2', String(row.epoch) === '2' && row.uncapped === false, JSON.stringify(row));
check('that replay did not write sell_coins', await sellUsed(A) === '0');
row = await one(`select public.econ_earn(40, 'sell', true, 'crop-after-roll-40') as r`);
check('after rollback a 40 sell is granted under epoch 2', row.r.ok === true && row.r.granted === 40 && row.r.sell_uncapped === false && row.r.sell_epoch === 2 && row.r.sell_left === 60, JSON.stringify(row.r));
check('capped sell uses the real counter', await sellUsed(A) === '40');
const over = await one(`select public.econ_earn(80, 'sell', true, 'crop-after-roll-80') as r`);
check('exact 80 against 60 left is refused and stored nothing', over.r.ok === false && over.r.reason === 'daily_cap' && over.r.granted === 0 && over.r.sell_left === 60 && over.r.sell_epoch === 2 && over.r.sell_uncapped === false, JSON.stringify(over.r));
check('the refusal did not move the counter', await sellUsed(A) === '40');
const again = await one(`select public.econ_earn(80, 'sell', true, 'crop-after-roll-80') as r`);
check('retrying the refused request id re-evaluates and still refuses', again.r.ok === false && again.r.reason === 'daily_cap' && again.r.replay !== true, JSON.stringify(again.r));
const fit = await one(`select public.econ_earn(60, 'sell', true, 'crop-after-roll-60') as r`);
check('exact 60 of the remaining 60 is granted', fit.r.ok === true && fit.r.granted === 60 && fit.r.sell_left === 0, JSON.stringify(fit.r));
const fitReplay = await one(`select public.econ_earn(60, 'sell', true, 'crop-after-roll-60') as r`);
check('replaying the 60 does not take it twice', fitReplay.r.replay === true && fitReplay.r.granted === 60 && await sellUsed(A) === '100', JSON.stringify(fitReplay.r));
row = await one(`select public.econ_earn(1, 'sell', true, 'crop-after-full-01') as r`);
check('the next coin is refused', row.r.ok === false && row.r.reason === 'daily_cap' && row.r.sell_left === 0, JSON.stringify(row.r));
row = await one(`select public.econ_earn(1, 'sell', true, 'nope') as r`);
check('a short request id is bad_req', row.r.ok === false && row.r.reason === 'bad_req', JSON.stringify(row.r));
row = await one(`select public.tg_limit('sellback_coins') as sb, public.tg_limit('earn_coins') as earn, public.tg_limit('sell_coins') as sell`);
check('rollback leaves sell NULL, sellback 400, earn 40', row.sell === null && row.sb === 400 && row.earn === 40, JSON.stringify(row));

await apply(forward);
row = await policy();
check('forward again bumps the epoch and restores uncapped', String(row.epoch) === '3' && row.uncapped === true, JSON.stringify(row));
row = await one(`select public.econ_status() as r`);
check('re-forward status is uncapped epoch 3 and advertises 100', row.r.sell_uncapped === true && row.r.sell_epoch === 3 && row.r.sell_left === 100 && row.r.sell_cap === 100, JSON.stringify(row.r));
row = await one(`select public.econ_earn(250, 'sell', true, 'crop-reuncap-250') as r`);
check('active uncapped mode grants past the old 100', row.r.ok === true && row.r.granted === 250 && row.r.sell_uncapped === true && row.r.sell_epoch === 3, JSON.stringify(row.r));
check('re-uncap did not add to the capped counter', await sellUsed(A) === '100');
const oldCap = await one(`select public.econ_earn(1, 'sell', true, 'crop-after-roll-40') as r`);
check('replay of the capped 40 still reports epoch 2 and false', oldCap.r.replay === true && oldCap.r.granted === 40 && oldCap.r.sell_epoch === 2 && oldCap.r.sell_uncapped === false, JSON.stringify(oldCap.r));
row = await policy();
check('that old replay did not turn the row back to capped', String(row.epoch) === '3' && row.uncapped === true, JSON.stringify(row));

await apply(rollback);
row = await policy();
check('second rollback is epoch 4 and capped', String(row.epoch) === '4' && row.uncapped === false, JSON.stringify(row));
row = await one(`select count(*)::int as n from pg_proc where proname='econ_earn'`);
check('only one econ_earn function remains', row.n === 1, JSON.stringify(row));

const failed = results.filter(r => !r.ok);
const out = { passed: results.length - failed.length, failed: failed.length, total: results.length, results };
fs.mkdirSync(path.join(root, 'qa/r9f'), { recursive: true });
fs.writeFileSync(path.join(root, 'qa/r9f/sql-epoch.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ passed: out.passed, failed: out.failed, total: out.total }, null, 2));
if (failed.length) process.exit(1);
