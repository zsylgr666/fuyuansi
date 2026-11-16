// Isolated Postgres. Real save_put, save_quarantine, and econ_earn bodies.
// auth.uid() reads the session setting app.uid. That is test scaffolding, disclosed in the report.
// The functions do not take a caller-chosen account id.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/tmp/pg-node/package.json');
const { Client } = require('pg');
const root = '/workspace';
const cfg = { host: '/tmp/pg/sock', user: 'ubuntu' };
const A = '00000000-0000-0000-0000-0000000000a1';
const B = '00000000-0000-0000-0000-0000000000b2';
const C = '00000000-0000-0000-0000-0000000000c3';
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail).slice(0, 500) : ''); };

function slice(text, start, end) {
  const i = text.indexOf(start);
  if (i < 0) throw new Error('missing ' + start);
  const j = end ? text.indexOf(end, i) : text.length;
  return text.slice(i, j < 0 ? text.length : j);
}
async function admin(db, sql, params) {
  const c = new Client({ ...cfg, database: db });
  await c.connect();
  try { return await c.query(sql, params); }
  finally { await c.end(); }
}
async function load(db) {
  const boot = new Client({ ...cfg, database: 'postgres' });
  await boot.connect();
  await boot.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid <> pg_backend_pid()`, [db]);
  await boot.query(`drop database if exists ${db}`);
  await boot.query(`create database ${db}`);
  await boot.end();
  const files = {
    schema: fs.readFileSync(root + '/backend/upstream/schema.sql', 'utf8'),
    r6: fs.readFileSync(root + '/backend/upstream/r6.sql', 'utf8'),
    r7: fs.readFileSync(root + '/backend/upstream/r7.2.sql', 'utf8'),
    r9: fs.readFileSync(root + '/backend/upstream/r9.sql', 'utf8'),
    r9f: fs.readFileSync(root + '/backend/r9f-uncap.sql', 'utf8'),
    hold: fs.readFileSync(root + '/backend/r9h-q2-hold.sql', 'utf8')
  };
  const c = new Client({ ...cfg, database: db });
  await c.connect();
  await c.query(`create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    end $$;
    grant authenticated to ubuntu;`);
  await c.query(files.schema);
  await c.query(slice(files.r6, 'create or replace function public.tg_day', 'create or replace function public.tg_limit'));
  await c.query(slice(files.r6, 'create table if not exists public.crop_rules', 'create or replace function public.tg_max_grow_ms'));
  await c.query(slice(files.r9, 'create or replace function public.tg_req_ok', 'create or replace function public.econ_shop_buy'));
  await c.query(slice(files.r7, 'alter table public.saves add column if not exists rev', '-- ======================= H4'));
  const epochBefore = (await c.query(files.r9f.replace(/notify pgrst, 'reload schema';\s*$/, ''))).rows;
  const epoch = (await c.query('select epoch, uncapped from sell_policy where id=1')).rows[0];
  await c.query(files.hold.replace(/notify pgrst, 'reload schema';\s*$/, ''));
  const epochAfter = (await c.query('select epoch, uncapped from sell_policy where id=1')).rows[0];
  await c.query(`insert into auth.users(id) values ('${A}'),('${B}'),('${C}')`);
  await c.query(`grant usage on schema public to authenticated;
    grant usage on schema public to authenticated;`);
  await c.end();
  return { epoch, epochAfter };
}
async function tx(db, uid, fn) {
  const c = new Client({ ...cfg, database: db });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.uid', $1, true)`, [uid]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    try { await c.query('rollback'); } catch (x) {}
    throw e;
  } finally { await c.end(); }
}
const one = (db, uid, sql, params) => tx(db, uid, async c => (await c.query(sql, params)).rows[0].data);
const snap = (coins, inv, pending, applied) => ({ coins, inventory: inv, cropPending: pending || null, cropApplied: applied || null });

const db = 'fuyuansi_q3';
const loaded = await load(db);
check('hold migration does not move the sell_policy epoch', String(loaded.epoch.epoch) === String(loaded.epochAfter.epoch) && loaded.epochAfter.uncapped === true, { before: loaded.epoch, after: loaded.epochAfter });

const put1 = await one(db, A, 'select public.save_put($1::jsonb, $2::bigint) as data', [JSON.stringify(snap(100, { cabbage: 12 })), null]);
check('first save_put lands at rev 1', put1.ok === true && put1.rev === 1 && put1.crop_hold === false, put1);
const grant = await one(db, A, `select public.econ_earn(5, 'sell', true, 'crop-prehold-0001') as data`);
check('a grant committed before the hold is stored', grant.ok === true && grant.granted === 5 && grant.crop_hold === false, grant);
const put2 = await one(db, A, 'select public.save_put($1::jsonb, $2::bigint) as data', [JSON.stringify(snap(100, { cabbage: 7 }, { 'crop-prehold-0001': { req: 'crop-prehold-0001', n: 5 } })), 1]);
check('a current revision write still lands', put2.ok === true && put2.rev === 2, put2);
const stale = await one(db, A, 'select public.save_put($1::jsonb, $2::bigint) as data', [JSON.stringify(snap(103, { cabbage: 8 })), 1]);
check('a stale save_put conflicts and does not replace state', stale.ok === false && stale.reason === 'conflict' && stale.rev === 2 && stale.state.inventory.cabbage === 7, stale);
const badCas = await one(db, A, 'select public.save_quarantine($1::bigint,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6) as data', [1, JSON.stringify(snap(1, { cabbage: 1 })), JSON.stringify(snap(2, { cabbage: 2 })), null, 'device-a-0001', 'save_conflict']);
check('quarantine at a stale revision does not set the hold', badCas.ok === false && badCas.reason === 'conflict' && badCas.crop_hold === false, badCas);
const local = snap(103, { cabbage: 8 }, { 'crop-dev-b-0001': { req: 'crop-dev-b-0001', n: 4, acct: B } });
const remote = snap(100, { cabbage: 7 }, { 'crop-prehold-0001': { req: 'crop-prehold-0001', n: 5 } });
const base = snap(100, { cabbage: 12 });
const held = await one(db, A, 'select public.save_quarantine($1::bigint,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6) as data', [2, JSON.stringify(local), JSON.stringify(remote), JSON.stringify(base), 'device-b-0001', 'save_conflict']);
check('quarantine at the current revision stores both snapshots, the base, and the device', held.ok === true && held.crop_hold === true && held.already === false && held.hold_rev === 2 && held.hold_device === 'device-b-0001' && held.hold_source === 'save_conflict' && held.hold_local.coins === 103 && held.hold_local.inventory.cabbage === 8 && held.hold_remote.coins === 100 && held.hold_remote.inventory.cabbage === 7 && held.hold_base.inventory.cabbage === 12 && held.state.inventory.cabbage === 7, held);
const row = (await admin(db, 'select user_id::text, rev, crop_hold, state, hold_local, hold_remote from saves')).rows[0];
check('the row owner is auth.uid and the committed state was not replaced', row.user_id === A && row.rev === '2' && row.crop_hold === true && row.state.inventory.cabbage === 7 && row.hold_local.coins === 103, row);
const again = await one(db, A, 'select public.save_quarantine($1::bigint,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6) as data', [2, JSON.stringify(snap(1, { cabbage: 1 })), JSON.stringify(snap(9, { cabbage: 9 })), null, 'device-c-0001', 'save_conflict']);
check('a second quarantine keeps the original pair', again.already === true && again.hold_local.coins === 103 && again.hold_remote.inventory.cabbage === 7 && again.hold_device === 'device-b-0001' && again.hold_base.inventory.cabbage === 12, again);
const blockedPut = await one(db, A, 'select public.save_put($1::jsonb, $2::bigint) as data', [JSON.stringify(snap(1, { cabbage: 1 })), 2]);
const blockedReset = await one(db, A, 'select public.save_put($1::jsonb, null::bigint) as data', [JSON.stringify({ coins: 0, inventory: {} })]);
check('save_put and unconditional reset are refused and the state stays', blockedPut.reason === 'quarantine' && blockedReset.reason === 'quarantine' && blockedPut.state.inventory.cabbage === 7 && blockedReset.hold_local.coins === 103, { blockedPut, blockedReset });
const replay = await one(db, A, `select public.econ_earn(5, 'sell', true, 'crop-prehold-0001') as data`);
const fresh = await one(db, A, `select public.econ_earn(8, 'sell', true, 'crop-after-hold-01') as data`);
const oldShape = await one(db, A, `select public.econ_earn(4, 'sell', true) as data`);
const rows = await admin(db, `select count(*)::int as n from econ_earn_reqs where owner='${A}'`);
check('an old request replays and a new crop grant is not stored', replay.replay === true && replay.granted === 5 && replay.crop_hold === true && fresh.reason === 'quarantine' && fresh.ok === false && oldShape.reason === 'quarantine' && rows.rows[0].n === 1, { replay, fresh, oldShape, n: rows.rows[0].n });
const task = await one(db, A, `select public.econ_earn(5, 'task', true, 'task-during-hold') as data`);
const taskRows = await admin(db, `select count(*)::int as n from econ_earn_reqs where owner='${A}' and req='task-during-hold'`);
check('a new task earn is also refused while the crop hold is set', task.ok === false && task.reason === 'quarantine' && task.granted === 0 && taskRows.rows[0].n === 0, task);

const malformed = await one(db, B, 'select public.save_put($1::jsonb, null::bigint) as data', [JSON.stringify(snap(10, { cabbage: 3 }))]);
const badSnap = await one(db, B, 'select public.save_quarantine($1::bigint,$2::jsonb,$3::jsonb,null,$4,$5) as data', [malformed.rev, JSON.stringify([1, 2]), JSON.stringify(snap(1, {})), 'device-b-0001', 'save_conflict']);
const badDev = await one(db, B, 'select public.save_quarantine($1::bigint,$2::jsonb,$3::jsonb,null,$4,$5) as data', [malformed.rev, JSON.stringify(snap(1, {})), JSON.stringify(snap(2, {})), 'x', 'save_conflict']);
const badSource = await one(db, B, 'select public.save_quarantine($1::bigint,$2::jsonb,$3::jsonb,null,$4,$5) as data', [malformed.rev, JSON.stringify(snap(1, {})), JSON.stringify(snap(2, {})), 'device-b-0001', 'please-clear']);
const noBase = await one(db, B, 'select public.save_quarantine($1::bigint,$2::jsonb,$3::jsonb,null,$4,$5) as data', [malformed.rev, JSON.stringify(snap(10, { cabbage: 3 })), JSON.stringify(snap(10, { cabbage: 3 })), 'device-b-0001', 'save_conflict']);
check('malformed snapshots, device, and source are refused; a null base is stored', badSnap.reason === 'bad_snapshot' && badDev.reason === 'bad_device' && badSource.reason === 'bad_source' && noBase.crop_hold === true && noBase.hold_base === null, { badSnap, badDev, badSource, noBase });

let forged = null;
try {
  forged = await tx(db, A, async c => {
    await c.query(`set local role authenticated`);
    await c.query(`select set_config('app.uid', $1, true)`, [A]);
    const upd = await c.query(`update saves set state='{"coins":1}'::jsonb where user_id=$1`, [B]);
    return { updated: upd.rowCount };
  });
} catch (e) { forged = String(e.message); }
const bStill = (await admin(db, `select state, crop_hold from saves where user_id='${B}'`)).rows[0];
check('user A cannot write user B through table privileges', /permission denied/i.test(forged) && bStill.crop_hold === true && bStill.state.inventory.cabbage === 3, { forged, bStill });
let direct = null;
try {
  direct = await tx(db, A, async c => {
    await c.query(`set local role authenticated`);
    await c.query(`select set_config('app.uid', $1, true)`, [A]);
    await c.query(`update saves set state='{"coins":1}'::jsonb where user_id=$1`, [A]);
    return 'updated';
  });
} catch (e) { direct = String(e.message); }
const aStill = (await admin(db, `select state->>'coins' as coins, crop_hold, hold_local->>'coins' as local_coins from saves where user_id='${A}'`)).rows[0];
check('a direct update without table privilege cannot replace a held save', /permission denied/i.test(direct) && aStill.crop_hold === true && aStill.coins === '100' && aStill.local_coins === '103', { direct, aStill });
await admin(db, 'grant select, update on public.saves to authenticated');
let guc = null;
try {
  guc = await tx(db, A, async c => {
    await c.query(`set local role authenticated`);
    await c.query(`select set_config('app.uid', $1, true)`, [A]);
    await c.query(`select set_config('tg.crop_hold_mgr', '1', true)`);
    await c.query(`update saves set state = jsonb_set(state, '{coins}', '123') where user_id = $1`, [A]);
    return 'updated';
  });
} catch (e) { guc = String(e.message); }
await admin(db, 'revoke update on public.saves from authenticated');
const afterGuc = (await admin(db, `select state->>'coins' as coins, crop_hold, hold_local->>'coins' as local_coins, hold_remote->'inventory'->>'cabbage' as remote_cabbage from saves where user_id='${A}'`)).rows[0];
check('set_config of the old manager GUC cannot rewrite a held row', /crop_hold/.test(guc) && afterGuc.crop_hold === true && afterGuc.coins === '100' && afterGuc.local_coins === '103' && afterGuc.remote_cabbage === '7', { guc, afterGuc });
let cleared = null;
try {
  cleared = await tx(db, A, async c => {
    await c.query(`set local role authenticated`);
    await c.query(`select set_config('app.uid', $1, true)`, [A]);
    return (await c.query('select public.crop_hold_clear() as data')).rows[0].data;
  });
} catch (e) { cleared = String(e.message); }
check('authenticated cannot call the operator clear', /permission denied/i.test(cleared), cleared);
const review = await one(db, A, 'select public.crop_hold_review() as data');
check('the signed-in review read returns this account evidence only', review.ok === true && review.crop_hold === true && review.hold_local.coins === 103 && review.hold_remote.inventory.cabbage === 7, review);

// Lock linearization. C has no save yet.
await one(db, C, 'select public.save_put($1::jsonb, null::bigint) as data', [JSON.stringify(snap(50, { cabbage: 20 }))]);
const pre = await one(db, C, `select public.econ_earn(1, 'sell', true, 'crop-linear-pre-01') as data`);
const c1 = new Client({ ...cfg, database: db });
const c2 = new Client({ ...cfg, database: db });
await c1.connect(); await c2.connect();
await c1.query('begin');
await c1.query(`select set_config('app.uid', $1, true)`, [C]);
await c1.query(`select pg_advisory_xact_lock(hashtext('tg_save:' || $1::text))`, [C]);
const waiter = (async () => {
  await c2.query('begin');
  await c2.query(`select set_config('app.uid', $1, true)`, [C]);
  return c2.query(`select public.econ_earn(9, 'sell', true, 'crop-linear-new-01') as data`);
})();
await new Promise(r => setTimeout(r, 300));
const waiting = (await admin(db, `select count(*)::int as n from pg_stat_activity where state='active' and query like '%crop-linear-new-01%' and pid <> pg_backend_pid()`)).rows[0].n;
const q1 = await c1.query(`select public.save_quarantine(1, $1::jsonb, $2::jsonb, $3::jsonb, 'device-c-0001', 'save_conflict') as data`, [JSON.stringify(snap(40, { cabbage: 19 }, { 'crop-linear-new-01': { n: 1 } })), JSON.stringify(snap(60, { cabbage: 20 })), JSON.stringify(snap(50, { cabbage: 20 }))]);
await c1.query('commit');
const earned = await waiter;
await c2.query('commit');
await c1.end(); await c2.end();
const newRows = (await admin(db, `select count(*)::int as n from econ_earn_reqs where owner='${C}' and req='crop-linear-new-01'`)).rows[0].n;
const oldReplay = await one(db, C, `select public.econ_earn(1, 'sell', true, 'crop-linear-pre-01') as data`);
check('an earn that waits on the save lock observes the hold and inserts nothing', waiting >= 1 && q1.rows[0].data.crop_hold === true && earned.rows[0].data.reason === 'quarantine' && newRows === 0 && pre.granted === 1 && oldReplay.replay === true && oldReplay.granted === 1, { waiting, earned: earned.rows[0].data, newRows, oldReplay });

const c3 = new Client({ ...cfg, database: db });
const c4 = new Client({ ...cfg, database: db });
await c3.connect(); await c4.connect();
await c3.query('begin');
await c3.query(`select set_config('app.uid', $1, true)`, [C]);
await c3.query(`select pg_advisory_xact_lock(hashtext('tg_save:' || $1::text))`, [C]);
const putWait = (async () => {
  await c4.query('begin');
  await c4.query(`select set_config('app.uid', $1, true)`, [C]);
  return c4.query(`select public.save_put('{"coins":1}'::jsonb, null::bigint) as data`);
})();
await new Promise(r => setTimeout(r, 200));
await c3.query('commit');
const putRes = await putWait;
await c4.query('commit');
await c3.end(); await c4.end();
const afterPut = (await admin(db, `select rev, state, crop_hold, hold_local from saves where user_id='${C}'`)).rows[0];
check('a reset that waits on the lock is refused and the evidence stays', putRes.rows[0].data.reason === 'quarantine' && afterPut.crop_hold === true && afterPut.hold_local.coins === 40 && afterPut.state.inventory.cabbage === 20, { put: putRes.rows[0].data, afterPut });

// Rollback draft on a copy of the schema, not this database. Epoch stays. Evidence columns stay. Enforcement lifts.
const rb = 'fuyuansi_q3_rollback';
const loadedRb = await load(rb);
await one(rb, A, 'select public.save_put($1::jsonb, null::bigint) as data', [JSON.stringify(snap(4, { cabbage: 4 }))]);
await one(rb, A, `select public.save_quarantine(1, $1::jsonb, $2::jsonb, null, 'device-a-0001', 'save_conflict') as data`, [JSON.stringify(snap(4, { cabbage: 4 })), JSON.stringify(snap(5, { cabbage: 5 }))]);
const beforeRb = (await admin(rb, 'select epoch from sell_policy where id=1')).rows[0];
const rbSql = fs.readFileSync(root + '/backend/r9h-q2-hold-rollback.sql', 'utf8').replace(/notify pgrst, 'reload schema';\s*$/, '');
await admin(rb, rbSql);
const afterRb = (await admin(rb, `select epoch from sell_policy where id=1`)).rows[0];
const evidence = (await admin(rb, `select crop_hold, hold_local, hold_remote from saves where user_id='${A}'`)).rows[0];
const lifted = await one(rb, A, `select public.econ_earn(3, 'sell', true, 'crop-after-rollback') as data`);
const putAfter = await one(rb, A, `select public.save_put($1::jsonb, 1::bigint) as data`, [JSON.stringify(snap(6, { cabbage: 6 }))]);
check('companion rollback clears the hold flag and the snapshots and does not move the epoch', String(beforeRb.epoch) === String(afterRb.epoch) && String(beforeRb.epoch) === String(loadedRb.epoch.epoch) && evidence.crop_hold === false && evidence.hold_local == null && evidence.hold_remote == null && lifted.ok === true && lifted.granted === 3 && putAfter.ok === true && putAfter.crop_hold !== true, { beforeRb, afterRb, evidence, lifted, putAfter });
const holdAgain = fs.readFileSync(root + '/backend/r9h-q2-hold.sql', 'utf8').replace(/notify pgrst, 'reload schema';\s*$/, '');
await admin(rb, holdAgain);
const revived = (await admin(rb, `select crop_hold, hold_local, hold_remote from saves where user_id='${A}'`)).rows[0];
const putRevived = await one(rb, A, `select public.save_put($1::jsonb, $2::bigint) as data`, [JSON.stringify(snap(8, { cabbage: 8 })), putAfter.rev]);
check('re-applying the hold draft does not revive the old snapshots as a freeze', revived.crop_hold === false && revived.hold_local == null && revived.hold_remote == null && putRevived.ok === true && putRevived.reason !== 'quarantine', { revived, putRevived });

const mix = 'fuyuansi_q3_mix';
await load(mix);
await one(mix, A, 'select public.save_put($1::jsonb, null::bigint) as data', [JSON.stringify(snap(11, { cabbage: 11 }))]);
await one(mix, A, `select public.save_quarantine(1, $1::jsonb, $2::jsonb, null, 'device-a-0001', 'save_conflict') as data`, [JSON.stringify(snap(11, { cabbage: 11 })), JSON.stringify(snap(12, { cabbage: 12 }))]);
const epochMixBefore = (await admin(mix, 'select epoch, uncapped from sell_policy where id=1')).rows[0];
const r9fRb = fs.readFileSync(root + '/backend/r9f-uncap-rollback.sql', 'utf8').replace(/notify pgrst, 'reload schema';\s*$/, '');
await admin(mix, r9fRb);
const mixEarn = await one(mix, A, `select public.econ_earn(11, 'sell', true, 'crop-mix-r9f-only') as data`);
const mixPut = await one(mix, A, `select public.save_put($1::jsonb, 1::bigint) as data`, [JSON.stringify(snap(1, { cabbage: 1 }))]);
const epochMixAfter = (await admin(mix, 'select epoch, uncapped from sell_policy where id=1')).rows[0];
check('standalone r9f rollback is the wrong file: earn pays while save_put stays quarantined', mixEarn.ok === true && mixEarn.granted === 11 && mixPut.reason === 'quarantine' && String(epochMixAfter.epoch) !== String(epochMixBefore.epoch) && epochMixAfter.uncapped === false, { mixEarn, mixPut, epochMixBefore, epochMixAfter });
await admin(mix, rbSql);
const mixCleared = (await admin(mix, `select crop_hold, hold_local from saves where user_id='${A}'`)).rows[0];
const mixPut2 = await one(mix, A, `select public.save_put($1::jsonb, 1::bigint) as data`, [JSON.stringify(snap(2, { cabbage: 2 }))]);
check('the companion rollback is what clears that leftover hold', mixCleared.crop_hold === false && mixCleared.hold_local == null && mixPut2.ok === true, { mixCleared, mixPut2 });

await admin(db, `select pg_terminate_backend(pid) from pg_stat_activity where datname in ('${db}','${rb}','fuyuansi_q3_mix') and pid <> pg_backend_pid()`).catch(() => {});
const failed = results.filter(r => !r.ok);
fs.mkdirSync('/workspace/qa/r9h-q3', { recursive: true });
fs.writeFileSync('/workspace/qa/r9h-q3/sql-hold.json', JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length, results }, null, 2));
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length }));
if (failed.length) process.exit(1);
