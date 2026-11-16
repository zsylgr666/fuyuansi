// Two browser contexts against the real save_put / econ_earn / save_quarantine functions.
// auth.uid() is the test scaffold (app.uid). The SQL does not accept an account argument.
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire('/tmp/pg-node/package.json');
const { Client } = require('pg');
const pw = createRequire('/workspace/qa/tools-node/package.json');
const { chromium } = pw('playwright-core');
import { loadDb, ensureUser, pgCfg } from './pg-setup.mjs';

const DB = 'fuyuansi_q3b';
const A = '00000000-0000-0000-0000-0000000000a1';
const B = '00000000-0000-0000-0000-0000000000b2';
const SITE = fs.readFileSync('/workspace/qa/r9h-q3/site.html');
const R9B = fs.readFileSync('/tmp/index.r9b-site.html');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail).slice(0, 700) : ''); };
await loadDb(DB);
await ensureUser(DB, A);
await ensureUser(DB, B);

async function sql(uid, text, params) {
  const c = new Client({ ...pgCfg, database: DB });
  await c.connect();
  try {
    await c.query('begin');
    if (uid) await c.query(`select set_config('app.uid', $1, true)`, [uid]);
    const r = await c.query(text, params);
    await c.query('commit');
    return r.rows;
  } finally { await c.end(); }
}
const srv = http.createServer((q, r) => {
  const url = q.url.split('?')[0];
  if (url === '/' || url === '/index.html') { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(SITE); return; }
  if (url === '/r9b') { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(R9B); return; }
  if (url === '/rpc') {
    let body = '';
    q.on('data', c => { body += c; });
    q.on('end', async () => {
      let msg = {}; try { msg = JSON.parse(body || '{}'); } catch (e) { msg = {}; }
      const fn = msg.fn;
      const args = msg.args || {};
      const uid = msg.uid;
      console.log('RPC', fn, uid);
      const allowed = /^[0-9a-f-]{36}$/.test(String(uid || ''));
      let data = { ok: false, reason: 'bad_uid' };
      try {
        if (!allowed) data = { ok: false, reason: 'bad_uid' };
        else if (fn === 'save_get') data = (await sql(uid, 'select public.save_get() as data'))[0].data;
        else if (fn === 'save_rev') data = (await sql(uid, 'select public.save_rev() as data'))[0].data;
        else if (fn === 'save_put') data = (await sql(uid, 'select public.save_put($1::jsonb, $2::bigint) as data', [JSON.stringify(args.p_state), args.p_base_rev == null ? null : Number(args.p_base_rev)]))[0].data;
        else if (fn === 'save_quarantine') data = (await sql(uid, 'select public.save_quarantine($1::bigint,$2::jsonb,$3::jsonb,$4::jsonb,$5::text,$6::text) as data', [args.p_base_rev == null ? null : Number(args.p_base_rev), JSON.stringify(args.p_local), JSON.stringify(args.p_remote), args.p_base == null ? null : JSON.stringify(args.p_base), args.p_device || null, args.p_source || null]))[0].data;
        else if (fn === 'econ_earn') data = (await sql(uid, 'select public.econ_earn($1::bigint,$2::text,$3::boolean,$4::text) as data', [args.p_coins, args.p_source || 'sell', args.p_exact !== false, args.p_req || null]))[0].data;
        else if (fn === 'econ_status') data = (await sql(uid, 'select public.econ_status() as data'))[0].data;
        else if (fn === 'crop_hold_review') data = (await sql(uid, 'select public.crop_hold_review() as data'))[0].data;
        else if (fn === 'avatar_me') data = { owned: [], catalog: [], avatar: {}, mounts: { owned: [] } };
        else if (fn === 'lotus_status') data = { day: 'd', koi_left: 1 };
        else data = { ok: false, reason: 'offline' };
      } catch (e) { data = { ok: false, reason: 'error', message: String(e.message || e).slice(0, 180) }; }
      r.setHeader('content-type', 'application/json');
      r.end(JSON.stringify(data));
    });
    return;
  }
  r.statusCode = 404; r.end();
});
await new Promise(res => srv.listen(0, '127.0.0.1', res));
const origin = `http://127.0.0.1:${srv.address().port}`;
const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

function authScript(uid) {
  return `(() => {
    const user = { id: ${JSON.stringify(uid)}, is_anonymous: true, user_metadata: { nickname: '测' } };
    const session = { user, access_token: 'test', refresh_token: 'test' };
    function chain() { const c = { select(){return c;}, eq(){return c;}, order(){return c;}, limit(){return c;}, delete(){return c;}, maybeSingle: async () => ({ data: { nickname: '测' }, error: null }), single: async () => ({ data: { nickname: '测' }, error: null }), upsert: async () => ({ data: null, error: null }), insert: async () => ({ data: null, error: null }), update: async () => ({ data: null, error: null }) }; return c; }
    const client = { auth: { async getSession(){return { data: { session } };}, async setSession(){return { data: { session } };}, async getUser(){return { data: { user } };}, async signInAnonymously(){return { data: { user, session } };}, async signOut(){return { error: null };}, onAuthStateChange(){return { data: { subscription: { unsubscribe(){} } } };} }, from(){return chain();}, rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'missing' } }), channel(){ const ch={ on(){return ch;}, subscribe(){return ch;}, send(){}, track(){}, unsubscribe(){}, presenceState(){return {};} }; return ch; }, removeChannel(){} };
    let lib = { createClient(){ return client; } };
    Object.defineProperty(window, 'supabase', { configurable: true, get(){ return lib; }, set(v){ if (v && typeof v.createClient === 'function') v.createClient = () => client; lib = v; } });
    const post = (fn, args) => fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn, args, uid: (window.TG_AUTH && TG_AUTH.userId) || ${JSON.stringify(uid)} }) }).then(r => r.json());
    window.TG_SAVE_RPC = post;
    window.TG_R6_RPC = post;
    window.TG_BACKEND_CONFIG = { publicRoomSuffix: '~test', cloudSave: true, debounceMs: 15000 };
  })();`;
}
async function device(uid) {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(authScript(uid));
  const p = await ctx.newPage();
  p.setDefaultTimeout(180000);
  const errs = [];
  p.on('pageerror', e => { const m = String(e).slice(0, 240); errs.push(m); console.log('PAGE', m); });
  p.on('console', m => { if (m.type() === 'error') console.log('CON', m.text().slice(0, 240)); });
  await p.goto(origin + '/', { timeout: 180000 });
  try {
    await p.waitForFunction(id => window.TG_R9?.sell?.version === 'r9h-q3' && window.TG_AUTH?.userId === id && window.W3?.player, uid, { timeout: 180000 });
  } catch (e) {
    const snap = await p.evaluate(() => ({ v: window.TG_R9 && TG_R9.sell && TG_R9.sell.version, id: window.TG_AUTH && TG_AUTH.userId, player: !!(window.W3 && W3.player) })).catch(err => String(err));
    console.log('BOOT', JSON.stringify(snap), errs);
    throw e;
  }
  await p.evaluate(() => { try { S.unlocked = true; closeModal(); document.querySelector('.tgb-mask')?.remove(); } catch (e) {} });
  return { ctx, p, errs };
}
async function adopt(page) {
  return page.evaluate(async () => {
    TG_STORAGE._resetSync();
    const raw = localStorage.getItem('templeGarden.v1');
    if (raw) { const st = JSON.parse(raw); st._savedAt = 1; localStorage.setItem('templeGarden.v1', JSON.stringify(st)); }
    const st = await TG_STORAGE.load();
    if (st) {
      S.coins = st.coins; S.merit = st.merit || 0; S.inventory = Object.assign({}, st.inventory || {});
      if (st.cropPending) S.cropPending = st.cropPending; else delete S.cropPending;
      if (st.cropApplied) S.cropApplied = st.cropApplied; else delete S.cropApplied;
    }
    await TG_R9.sell.probe();
    return { rev: TG_STORAGE.rev, coins: S.coins, cabbage: S.inventory.cabbage, q: TG_R9.sell.quarantineActive(), epoch: TG_R9.sell.policy().epoch };
  });
}

const devA = await device(A);
const seeded = await devA.p.evaluate(async () => {
  S.coins = 100; S.merit = 9; S.inventory = { cabbage: 12 }; delete S.cropPending; delete S.cropApplied;
  save(); await TG_STORAGE.flush();
  await TG_R9.sell.probe();
  const pre = await TG_R6_RPC('econ_earn', { p_coins: 5, p_source: 'sell', p_exact: true, p_req: 'crop-prehold-0001' });
  return { rev: TG_STORAGE.rev, status: TG_STORAGE.status, epoch: TG_R9.sell.policy().epoch, pre };
});
check('device A saves through real save_put and a pre-hold grant is stored', seeded.status === 'synced' && seeded.rev >= 1 && seeded.epoch === 1 && seeded.pre.ok === true && seeded.pre.granted === 5, seeded);
const devB = await device(A);
const bBoot = await devB.p.evaluate(() => ({ q: TG_R9.sell.quarantineActive(), coins: S.coins, cabbage: S.inventory && S.inventory.cabbage }));
check('device B boots onto the cloud save without a pause', bBoot.q === false && bBoot.coins === 100 && bBoot.cabbage === 12, bBoot);
const bBase = await adopt(devB.p);
check('device B adopts the current revision', bBase.q === false && bBase.coins === 100 && bBase.cabbage === 12, bBase);

const reqA = { id: 'cabbage', n: 5, gain: 5, price: 1, req: 'crop-dev-a-0001', acct: A, epoch: 1, name: '白菜' };
const reqB = { id: 'cabbage', n: 4, gain: 4, price: 1, req: 'crop-dev-b-0001', acct: A, epoch: 1, name: '白菜' };
const applied = { 'crop-prehold-0001': 1 };
await devA.p.evaluate(async (rec) => {
  S.inventory = { cabbage: 7 }; S.coins = 90; S.merit = 9; S.cropPending = { [rec.req]: rec }; S.cropApplied = { 'crop-prehold-0001': 1 };
  save(); await TG_STORAGE.flush();
}, reqA);
await devB.p.evaluate(async (rec) => {
  S.inventory = { cabbage: 8 }; S.coins = 80; S.merit = 9; S.cropPending = { [rec.req]: rec, 'crop-prehold-0001': { id: 'cabbage', n: 5, gain: 5, price: 1, req: 'crop-prehold-0001', acct: rec.acct, epoch: 1, name: '白菜' } }; S.cropApplied = { 'crop-dev-a-0001': 1 };
  save(); await TG_STORAGE.flush();
}, reqB);
const cloud = (await sql(A, 'select rev, state, crop_hold, hold_local, hold_remote, hold_base, hold_device, hold_source from saves where user_id=$1', [A]))[0];
check('both directions of the conflict are stored and the committed state is not merged', cloud.crop_hold === true && cloud.hold_source === 'save_conflict' && cloud.hold_local.coins === 80 && cloud.hold_local.inventory.cabbage === 8 && cloud.hold_local.cropPending['crop-dev-b-0001'].n === 4 && cloud.hold_local.cropPending['crop-prehold-0001'].n === 5 && cloud.hold_local.cropApplied['crop-dev-a-0001'] === 1 && cloud.hold_remote.coins === 90 && cloud.hold_remote.inventory.cabbage === 7 && cloud.hold_remote.cropPending['crop-dev-a-0001'].n === 5 && cloud.hold_remote.cropApplied['crop-prehold-0001'] === 1 && cloud.hold_base.inventory.cabbage === 12 && cloud.state.inventory.cabbage === 7 && cloud.state.coins === 90, cloud);
const replay = await devB.p.evaluate(async () => {
  const before = { coins: S.coins, cabbage: S.inventory.cabbage };
  await TG_R9.sell.probe();
  await TG_R9.sell.retryCrops();
  await TG_R9.sell.resumeCrops();
  const sold = await TG_R9.sell.sellCrop('cabbage', true);
  const earned = window.r6EarnCoins(9, 'sell', true);
  TG_AUTH.online = false;
  const offline = await TG_R9.sell.sellCrop('cabbage', true);
  TG_AUTH.online = true;
  return { before, after: { coins: S.coins, cabbage: S.inventory.cabbage }, sold, earned, offline, q: TG_R9.sell.quarantineActive() };
});
const grants = (await sql(null, `select req, result->>'granted' as granted from econ_earn_reqs where owner=$1 order by req`, [A]));
check('the paused device does not pay or restore, and the old grant is unchanged', replay.q === true && replay.sold === false && replay.earned === false && replay.offline === false && replay.after.coins === 80 && replay.after.cabbage === 8 && grants.length === 1 && grants[0].req === 'crop-prehold-0001' && grants[0].granted === '5', { replay, grants });
const aRetry = await devA.p.evaluate(async () => {
  const before = S.coins;
  save(); const up = await TG_STORAGE.flush();
  await TG_R9.sell.retryCrops();
  return { up, q: TG_R9.sell.quarantineActive(), coins: S.coins, same: S.coins === before };
});
const revAfterA = (await sql(A, 'select rev, state from saves where user_id=$1', [A]))[0];
check('the other device discovers the hold and cannot write', aRetry.q === true && aRetry.same === true && String(revAfterA.rev) === String(cloud.rev) && revAfterA.state.coins === 90, { aRetry, rev: revAfterA.rev });

await devB.p.reload({ timeout: 180000 });
await devB.p.waitForFunction(id => window.TG_R9?.sell?.version === 'r9h-q3' && window.TG_AUTH?.userId === id, A, { timeout: 180000 });
const reloaded = await devB.p.evaluate(async () => {
  try { closeModal(); document.querySelector('.tgb-mask')?.remove(); } catch (e) {}
  const q = TG_R9.sell.quarantineActive();
  const coins = S.coins, cabbage = S.inventory.cabbage;
  await TG_R9.sell.retryCrops();
  return { q, coins, after: S.coins, cabbage, afterCabbage: S.inventory.cabbage };
});
check('reload keeps the pause and does not pay', reloaded.q === true && reloaded.after === reloaded.coins && reloaded.afterCabbage === reloaded.cabbage, reloaded);
await devA.ctx.close();
await devB.ctx.close();

const devC = await device(A);
const third = await devC.p.evaluate(async () => {
  try { closeModal(); document.querySelector('.tgb-mask')?.remove(); } catch (e) {}
  const q = TG_R9.sell.quarantineActive();
  const review = await TG_R6_RPC('crop_hold_review', {});
  const before = { coins: S.coins, cabbage: S.inventory && S.inventory.cabbage };
  await TG_R9.sell.probe();
  const sold = await TG_R9.sell.sellCrop('cabbage', true);
  save(); const up = await TG_STORAGE.flush();
  return { q, sold, up, before, after: { coins: S.coins, cabbage: S.inventory && S.inventory.cabbage }, localCoins: review.hold_local && review.hold_local.coins, remoteCoins: review.hold_remote && review.hold_remote.coins };
});
const afterThird = (await sql(A, 'select rev, hold_local, hold_device from saves where user_id=$1', [A]))[0];
check('a fresh device discovers the server hold and cannot overwrite it', third.q === true && third.sold === false && third.after.coins === 90 && third.after.cabbage === 7 && third.localCoins === 80 && third.remoteCoins === 90 && String(afterThird.rev) === String(cloud.rev) && afterThird.hold_device === cloud.hold_device && afterThird.hold_local.coins === 80, { third, device: afterThird.hold_device });

const reset = await devC.p.evaluate(async () => { await TG_STORAGE.clear(); return { q: TG_R9.sell.quarantineActive() }; });
const afterReset = (await sql(A, 'select rev, crop_hold, state, hold_local from saves where user_id=$1', [A]))[0];
check('reset does not clear the hold or the snapshots', reset.q === true && afterReset.crop_hold === true && afterReset.rev === cloud.rev && afterReset.hold_local.coins === 80 && afterReset.state.coins === 90, { reset, afterReset });

const rawPut = (await sql(A, `select public.save_put('{"coins":1,"inventory":{"cabbage":12}}'::jsonb, null::bigint) as data`))[0].data;
const rawEarn = (await sql(A, `select public.econ_earn(7, 'sell', true, 'crop-raw-after-01') as data`))[0].data;
const rawReplay = (await sql(A, `select public.econ_earn(5, 'sell', true, 'crop-prehold-0001') as data`))[0].data;
const still = (await sql(null, `select count(*)::int as n from econ_earn_reqs where owner=$1 and req='crop-raw-after-01'`, [A]))[0];
check('raw save_put and a new earn are refused; the old grant replays', rawPut.reason === 'quarantine' && rawEarn.reason === 'quarantine' && rawReplay.replay === true && rawReplay.granted === 5 && still.n === 0, { rawPut, rawEarn, rawReplay });

const switched = await devC.p.evaluate(async (other) => {
  TG_AUTH.user = { id: other, is_anonymous: true };
  TG_R9.sell.syncAccount();
  S.coins = 10; S.inventory = { cabbage: 3 }; delete S.cropPending; delete S.cropApplied;
  await TG_R9.sell.probe();
  const sold = await TG_R9.sell.sellCrop('cabbage', false);
  const mid = { q: TG_R9.sell.quarantineActive(), sold, coins: S.coins, cabbage: S.inventory.cabbage || 0 };
  TG_AUTH.user = { id: '00000000-0000-0000-0000-0000000000a1', is_anonymous: true };
  TG_R9.sell.syncAccount();
  await TG_R9.sell.probe();
  const backCoins = S.coins;
  const blocked = await TG_R9.sell.sellCrop('cabbage', false);
  return { mid, back: { q: TG_R9.sell.quarantineActive(), blocked, same: S.coins === backCoins } };
}, B);
const devOther = await device(B);
const otherSale = await devOther.p.evaluate(async () => {
  try { closeModal(); document.querySelector('.tgb-mask')?.remove(); } catch (e) {}
  S.coins = 10; S.inventory = { cabbage: 3 }; delete S.cropPending; delete S.cropApplied;
  save(); const up = await TG_STORAGE.flush();
  await TG_R9.sell.probe();
  const sold = await TG_R9.sell.sellCrop('cabbage', false);
  save(); await TG_STORAGE.flush();
  return { q: TG_R9.sell.quarantineActive(), up, sold, coins: S.coins, cabbage: S.inventory.cabbage || 0 };
});
const bRow = (await sql(B, 'select crop_hold, state from saves where user_id=$1', [B]))[0];
const aRow = (await sql(A, 'select crop_hold, hold_local from saves where user_id=$1', [A]))[0];
check('another account is not held, and switching back on the paused page stays paused', switched.mid.q === false && switched.mid.sold === true && switched.mid.coins === 11 && switched.back.q === true && switched.back.blocked === false && otherSale.q === false && otherSale.sold === true && bRow && bRow.crop_hold === false && aRow.crop_hold === true && aRow.hold_local.coins === 80, { switched, otherSale, b: bRow && bRow.state, aHold: aRow.hold_local.coins });
await devOther.ctx.close();

const deleted = await devC.p.evaluate(async () => {
  const id = TG_AUTH.userId;
  localStorage.removeItem('templeGarden.r9.cropQuarantine.' + id);
  TG_R9.sell.loadQuarantine();
  S.coins = 1; S.inventory = { cabbage: 2 };
  const sold = await TG_R9.sell.sellCrop('cabbage', false);
  return { q: TG_R9.sell.quarantineActive(), sold, coins: S.coins, cabbage: S.inventory.cabbage ?? 0, key: localStorage.getItem('templeGarden.r9.cropQuarantine.' + id) != null };
});
const refused = (await sql(A, `select public.econ_earn(1, 'sell', true, 'crop-after-keydel') as data`))[0].data;
const saved = (await sql(A, `select public.save_put('{"coins":1}'::jsonb, null::bigint) as data`))[0].data;
const keyRows = (await sql(null, `select count(*)::int as n from econ_earn_reqs where owner=$1 and req='crop-after-keydel'`, [A]))[0];
check('deleting the local pause key does not resume selling while the server hold remains', deleted.sold === false && deleted.coins === 1 && deleted.cabbage === 2 && deleted.q === true && refused.reason === 'quarantine' && saved.reason === 'quarantine' && keyRows.n === 0, { deleted, refused, saved });
await devC.ctx.close();

await br.close(); srv.close();
const failed = results.filter(r => !r.ok);
fs.writeFileSync('/workspace/qa/r9h-q3/browser-hold.json', JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length, results }, null, 2));
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length }));
if (failed.length) process.exit(1);
