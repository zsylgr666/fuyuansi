// Candidate verification only. Two browser contexts, real save_put, then attempted replay.
// This is not a release freeze and it does not prove a global pause.
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire('/workspace/qa/tools-node/package.json');
const { chromium } = require('playwright-core');
const SITE = fs.readFileSync('/workspace/qa/r9h-candidate/site.html');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail).slice(0, 900) : ''); };

let cloud = { rev: 0, state: null };
const srv = http.createServer((q, r) => {
  const url = q.url.split('?')[0];
  if (url === '/' || url === '/index.html') { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(SITE); return; }
  if (url === '/rpc') {
    let body = '';
    q.on('data', c => { body += c; });
    q.on('end', () => {
      let msg = {}; try { msg = JSON.parse(body || '{}'); } catch (e) { msg = {}; }
      const fn = msg.fn, args = msg.args || {};
      let data;
      if (fn === 'save_rev') data = cloud.rev;
      else if (fn === 'save_get') data = { ok: true, state: cloud.state, rev: cloud.rev };
      else if (fn === 'save_put') {
        const base = args.p_base_rev;
        if (base == null || cloud.state == null || Number(base) === cloud.rev) { cloud = { rev: cloud.rev + 1, state: args.p_state }; data = { ok: true, rev: cloud.rev }; }
        else data = { ok: false, reason: 'conflict', state: cloud.state, rev: cloud.rev };
      } else data = { ok: false, reason: 'offline' };
      r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(data));
    });
    return;
  }
  r.statusCode = 404; r.end();
});
await new Promise(res => srv.listen(0, '127.0.0.1', res));
const origin = `http://127.0.0.1:${srv.address().port}`;
const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function device() {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    const user = { id: 'merge-user', is_anonymous: true, user_metadata: { nickname: '测' } };
    const session = { user, access_token: 'test', refresh_token: 'test' };
    function chain() {
      const c = { select() { return c; }, eq() { return c; }, order() { return c; }, limit() { return c; }, delete() { return c; },
        maybeSingle: async () => ({ data: { nickname: '测' }, error: null }),
        single: async () => ({ data: { nickname: '测' }, error: null }),
        upsert: async () => ({ data: null, error: null }),
        insert: async () => ({ data: null, error: null }),
        update: async () => ({ data: null, error: null }) };
      return c;
    }
    const client = {
      auth: {
        async getSession() { return { data: { session } }; },
        async setSession() { return { data: { session } }; },
        async getUser() { return { data: { user } }; },
        async signInAnonymously() { return { data: { user, session } }; },
        async signOut() { return { error: null }; },
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
      },
      from() { return chain(); },
      rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'missing' } }),
      channel() { const ch = { on() { return ch; }, subscribe() { return ch; }, send() {}, track() {}, unsubscribe() {}, presenceState() { return {}; } }; return ch; },
      removeChannel() {}
    };
    let lib = { createClient() { return client; } };
    Object.defineProperty(window, 'supabase', { configurable: true, get() { return lib; }, set(v) { if (v && typeof v.createClient === 'function') v.createClient = () => client; lib = v; } });
    window.TG_SAVE_RPC = (fn, args) => fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn, args }) }).then(r => r.json());
    window.TG_BACKEND_CONFIG = { publicRoomSuffix: '~test', cloudSave: true, debounceMs: 15000 };
    window.__earnN = 0; window.__HOLD = false; window.__FORCE = null;
    window.TG_R6_RPC = (fn, args) => {
      if (fn === 'econ_status') return { day: 'd', earn_left: 40, sell_uncapped: true, sell_epoch: 2, sell_cap: 100, sell_left: 100, sellback_left: 400 };
      if (fn === 'econ_earn') {
        window.__earnN = (window.__earnN || 0) + 1;
        const body = window.__FORCE || { ok: true, granted: args && args.p_coins, sell_uncapped: true, sell_epoch: 2, req: args && args.p_req };
        if (window.__HOLD) return new Promise(res => { window.__release = () => res(body); window.__flushSale = () => window.TG_STORAGE.flush(); });
        return body;
      }
      if (fn === 'avatar_me') return { owned: [], catalog: [], avatar: {}, mounts: { owned: [] } };
      if (fn === 'lotus_status') return { day: 'd', koi_left: 1 };
      return { ok: false, reason: 'offline' };
    };
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(180000);
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 180)));
  await p.goto(origin + '/');
  await p.waitForFunction(() => window.TG_R9?.sell?.version === 'r9h-q' && window.TG_AUTH?.userId === 'merge-user' && window.W3?.player, null, { timeout: 180000 });
  await p.evaluate(() => { try { S.unlocked = true; closeModal(); document.querySelector('.tgb-mask')?.remove(); } catch (e) {} });
  return { ctx, p, errs };
}
async function cloudGet() {
  const r = await fetch(origin + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn: 'save_get', args: {} }) });
  return r.json();
}
function journal(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('templeGarden.r9.cropQuarantine.merge-user');
    return raw ? JSON.parse(raw) : null;
  });
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
    return { rev: TG_STORAGE.rev, coins: S.coins, cabbage: S.inventory.cabbage, q: TG_R9.sell.quarantineActive(), epoch: TG_R9.sell.policy().epoch, uid: TG_AUTH.userId };
  });
}

const only = process.env.ONLY || '';
const reqA = { id: 'cabbage', n: 5, gain: 5, price: 1, req: 'crop-dev-a-0001', acct: 'merge-user', epoch: 2, name: '白菜' };
const reqB = { id: 'cabbage', n: 4, gain: 4, price: 1, req: 'crop-dev-b-0001', acct: 'merge-user', epoch: 2, name: '白菜' };
if (only !== 'inflight') {
const A = await device();
const seeded = await A.p.evaluate(async () => {
  S.coins = 100; S.merit = 9; S.inventory = { cabbage: 12 }; delete S.cropPending; delete S.cropApplied;
  save(); await TG_STORAGE.flush();
  await TG_R9.sell.probe();
  return { rev: TG_STORAGE.rev, status: TG_STORAGE.status, epoch: TG_R9.sell.policy().epoch };
});
check('device A establishes the shared base', seeded.status === 'synced' && seeded.rev >= 1 && seeded.epoch === 2, seeded);
const B = await device();
const bBoot = await B.p.evaluate(() => ({ q: TG_R9.sell.quarantineActive(), coins: S.coins, cabbage: S.inventory && S.inventory.cabbage, rev: TG_STORAGE.rev, status: TG_STORAGE.status }));
check('device B boots against the existing cloud without a pause', bBoot.q === false && bBoot.cabbage === 12 && bBoot.coins === 100, bBoot);
const bBase = await adopt(B.p);
check('device B adopts that base without pausing', bBase.q === false && bBase.coins === 100 && bBase.cabbage === 12 && bBase.epoch === 2, bBase);

await A.p.evaluate(async (rec) => {
  S.inventory = { cabbage: 7 }; S.coins = 100; S.merit = 9; S.cropPending = { [rec.req]: rec }; delete S.cropApplied;
  save(); await TG_STORAGE.flush();
}, reqA);
const cloudA = await cloudGet();
await B.p.evaluate(async (rec) => {
  S.inventory = { cabbage: 8 }; S.coins = 103; S.merit = 9; S.cropPending = { [rec.req]: rec }; delete S.cropApplied;
  save(); await TG_STORAGE.flush();
}, reqB);
const after = await cloudGet();
const jb = await journal(B.p);
check('conflict keeps both original snapshots', !!(jb && jb.paused && jb.acct === 'merge-user' && jb.local.coins === 103 && jb.local.inventory.cabbage === 8 && jb.local.cropPending[reqB.req].n === 4 && jb.remote.coins === 100 && jb.remote.inventory.cabbage === 7 && jb.remote.cropPending[reqA.req].n === 5 && jb.base && jb.base.inventory.cabbage === 12 && jb.base.coins === 100), jb);
check('the cloud blob is not rewritten into a union', after.rev === cloudA.rev && after.state.inventory.cabbage === 7 && !!after.state.cropPending[reqA.req] && !after.state.cropPending[reqB.req] && after.state.coins === 100, { rev: after.rev, cloudA: cloudA.rev, inv: after.state && after.state.inventory, coins: after.state && after.state.coins, pending: after.state && Object.keys(after.state.cropPending || {}) });

const replay = await B.p.evaluate(async () => {
  const before = { coins: S.coins, cabbage: S.inventory.cabbage, pending: Object.keys(S.cropPending || {}) };
  const earn0 = window.__earnN || 0;
  await TG_R9.sell.retryCrops();
  await TG_R9.sell.resumeCrops();
  const sold = await TG_R9.sell.sellCrop('cabbage', true);
  const earned = window.r6EarnCoins(9, 'sell', true);
  localStorage.setItem('templeGarden.r9.cropPending.merge-user', JSON.stringify([{ id: 'cabbage', n: 9, gain: 9, price: 1, req: 'crop-local-recover', acct: 'merge-user' }]));
  await TG_R9.sell.retryCrops();
  TG_AUTH.online = false;
  await TG_R9.sell.retryCrops();
  const offlineSold = await TG_R9.sell.sellCrop('cabbage', true);
  TG_AUTH.online = true;
  return { before, after: { coins: S.coins, cabbage: S.inventory.cabbage, pending: Object.keys(S.cropPending || {}) }, sold, earned, offlineSold, earnN: (window.__earnN || 0) - earn0, q: TG_R9.sell.quarantineActive() };
});
check('replay, direct earn, offline, and a local receipt do not pay or move stock', replay.q === true && replay.sold === false && replay.earned === false && replay.offlineSold === false && replay.earnN === 0 && replay.after.coins === 103 && replay.after.cabbage === 8 && replay.after.pending.length === 1 && replay.after.pending[0] === reqB.req, replay);

const aStill = await A.p.evaluate(async () => {
  const q = TG_R9.sell.quarantineActive();
  S.coins = 100; S.inventory = { cabbage: 7 }; S.cropPending = { 'crop-dev-a-0001': S.cropPending['crop-dev-a-0001'] };
  save(); const up = await TG_STORAGE.flush();
  return { q, up, rev: TG_STORAGE.rev };
});
const cloudAfterA = await cloudGet();
check('the other device is not paused and a later save still lands', aStill.q === false && cloudAfterA.rev > after.rev, { aStill, rev: cloudAfterA.rev });

await B.p.reload();
await B.p.waitForFunction(() => window.TG_R9?.sell?.version === 'r9h-q' && window.TG_AUTH?.userId === 'merge-user' && window.W3?.player, null, { timeout: 180000 });
const reloaded = await B.p.evaluate(async () => {
  try { closeModal(); document.querySelector('.tgb-mask')?.remove(); } catch (e) {}
  const raw = JSON.parse(localStorage.getItem('templeGarden.r9.cropQuarantine.merge-user') || 'null');
  const coins = S.coins, cabbage = S.inventory.cabbage;
  await TG_R9.sell.probe();
  await TG_R9.sell.retryCrops();
  const remoteRec = raw && raw.remote && raw.remote.cropPending && raw.remote.cropPending['crop-dev-a-0001'];
  return { q: TG_R9.sell.quarantineActive(), coins, after: S.coins, cabbage, afterCabbage: S.inventory.cabbage, localCoins: raw && raw.local.coins, remoteN: remoteRec && remoteRec.n };
});
const cloudAfterReload = await cloudGet();
check('reload keeps the journal, the local quantities, and does not upload', reloaded.q === true && reloaded.localCoins === 103 && reloaded.remoteN === 5 && reloaded.coins === 103 && reloaded.after === 103 && reloaded.cabbage === 8 && reloaded.afterCabbage === 8 && cloudAfterReload.rev === cloudAfterA.rev, { reloaded, rev: cloudAfterReload.rev });

const tab = await B.ctx.newPage();
tab.setDefaultTimeout(180000);
await tab.goto(origin + '/', { timeout: 180000 });
await tab.waitForFunction(() => window.TG_R9?.sell?.version === 'r9h-q' && window.TG_AUTH?.userId === 'merge-user' && window.W3?.player, null, { timeout: 180000 });
const tabState = await tab.evaluate(async () => {
  try { closeModal(); document.querySelector('.tgb-mask')?.remove(); } catch (e) {}
  const before = { coins: S.coins, cabbage: S.inventory.cabbage };
  await TG_R9.sell.probe();
  const sold = await TG_R9.sell.sellCrop('cabbage', true);
  return { q: TG_R9.sell.quarantineActive(), before, sold, after: { coins: S.coins, cabbage: S.inventory.cabbage } };
});
check('a second tab of the same account stays paused', tabState.q === true && tabState.sold === false && tabState.before.coins === 103 && tabState.after.coins === 103 && tabState.after.cabbage === 8, tabState);
await tab.close();

const switched = await B.p.evaluate(async () => {
  const journalBefore = localStorage.getItem('templeGarden.r9.cropQuarantine.merge-user');
  TG_AUTH.user = { id: 'other-user', is_anonymous: true };
  TG_R9.sell.syncAccount();
  await TG_R9.sell.probe();
  S.coins = 10; S.inventory = { cabbage: 3 }; delete S.cropPending;
  const qOther = TG_R9.sell.quarantineActive();
  const sold = await TG_R9.sell.sellCrop('cabbage', false);
  const mid = { q: qOther, sold, coins: S.coins, cabbage: S.inventory.cabbage || 0 };
  TG_AUTH.user = { id: 'merge-user', is_anonymous: true };
  TG_R9.sell.syncAccount();
  const backCoins = S.coins, backCabbage = S.inventory.cabbage || 0;
  const blocked = await TG_R9.sell.sellCrop('cabbage', false);
  return { mid, back: { q: TG_R9.sell.quarantineActive(), blocked, coins: S.coins, cabbage: S.inventory.cabbage || 0, same: S.coins === backCoins && (S.inventory.cabbage || 0) === backCabbage }, journalSame: localStorage.getItem('templeGarden.r9.cropQuarantine.merge-user') === journalBefore };
});
check('the other account can sell and the paused account still cannot', switched.mid.q === false && switched.mid.sold === true && switched.mid.coins === 11 && switched.mid.cabbage === 2 && switched.back.q === true && switched.back.blocked === false && switched.back.same === true && switched.journalSame === true, switched);

await fetch(origin + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn: 'save_put', args: { p_state: { coins: 1, inventory: { cabbage: 12 } }, p_base_rev: cloudAfterReload.rev } }) });
const wiped = await cloudGet();
const journalStill = await journal(B.p);
check('a raw save_put replaces the cloud blob and leaves this device journal', wiped.state.coins === 1 && wiped.state.cropPending == null && journalStill.local.cropPending[reqB.req].n === 4 && journalStill.remote.inventory.cabbage === 7, { cloud: wiped.state, localN: journalStill.local.cropPending[reqB.req].n });
await A.ctx.close(); await B.ctx.close();

// Same request id: one device already applied it, the other still has it pending.
cloud = { rev: 0, state: null };
const C = await device();
const same = 'crop-same-0001';
await C.p.evaluate(async () => { S.coins = 100; S.inventory = { cabbage: 12 }; delete S.cropPending; delete S.cropApplied; save(); await TG_STORAGE.flush(); });
const D = await device();
const dBase = await adopt(D.p);
await C.p.evaluate(async (req) => {
  S.coins = 108; S.inventory = { cabbage: 4 }; delete S.cropPending; S.cropApplied = { [req]: 1 };
  save(); await TG_STORAGE.flush();
}, same);
await D.p.evaluate(async (req) => {
  S.coins = 100; S.inventory = { cabbage: 4 }; S.cropPending = { [req]: { id: 'cabbage', n: 8, gain: 8, price: 1, req, acct: 'merge-user', epoch: 2, name: '白菜' } }; delete S.cropApplied;
  save(); await TG_STORAGE.flush();
}, same);
const js = await journal(D.p);
const sameReplay = await D.p.evaluate(async () => {
  const before = { coins: S.coins, cabbage: S.inventory.cabbage };
  const earn0 = window.__earnN || 0;
  await TG_R9.sell.probe();
  await TG_R9.sell.retryCrops();
  return { before, after: { coins: S.coins, cabbage: S.inventory.cabbage }, earnN: (window.__earnN || 0) - earn0, q: TG_R9.sell.quarantineActive() };
});
check('same request pending against applied keeps both snapshots and does not pay again', dBase.q === false && js && js.local.coins === 100 && js.local.cropPending[same].n === 8 && js.local.inventory.cabbage === 4 && js.remote.coins === 108 && js.remote.cropApplied[same] === 1 && js.remote.inventory.cabbage === 4 && sameReplay.q === true && sameReplay.after.coins === 100 && sameReplay.after.cabbage === 4 && sameReplay.earnN === 0, { js, sameReplay });
await C.ctx.close(); await D.ctx.close();
}

// Grant already committed while the local coin save has not happened, then the debit upload conflicts.
cloud = { rev: 0, state: null };
const E = await device();
await E.p.evaluate(async () => { S.coins = 50; S.inventory = { cabbage: 20 }; delete S.cropPending; delete S.cropApplied; save(); await TG_STORAGE.flush(); });
const F = await device();
const fBase = await adopt(F.p);
const eCaught = await E.p.evaluate(async () => {
  TG_STORAGE._resetSync();
  const raw = localStorage.getItem('templeGarden.v1');
  if (raw) { const st = JSON.parse(raw); st._savedAt = 1; localStorage.setItem('templeGarden.v1', JSON.stringify(st)); }
  const st = await TG_STORAGE.load();
  if (st) { S.coins = st.coins; S.inventory = Object.assign({}, st.inventory || {}); if (st.cropPending) S.cropPending = st.cropPending; else delete S.cropPending; }
  return { rev: TG_STORAGE.rev, coins: S.coins, cabbage: S.inventory.cabbage, q: TG_R9.sell.quarantineActive() };
});
const sale = F.p.evaluate(async () => {
  window.__HOLD = true;
  const ok = await TG_R9.sell.sellCrop('cabbage', false);
  const proofs = JSON.parse(localStorage.getItem('templeGarden.r9.grantProofs.merge-user') || '[]');
  return { ok, coins: S.coins, cabbage: S.inventory.cabbage || 0, pending: S.cropPending, proofs, q: TG_R9.sell.quarantineActive() };
});
await F.p.waitForFunction(() => typeof window.__flushSale === 'function', null, { timeout: 20000 });
const eMove = await E.p.evaluate(async () => {
  S.coins = 60; S.inventory = { cabbage: 20 }; delete S.cropPending;
  save(); const up = await TG_STORAGE.flush();
  return { up, rev: TG_STORAGE.rev, q: TG_R9.sell.quarantineActive(), coins: S.coins };
});
const flushed = await Promise.race([
  F.p.evaluate(async () => { const up = await window.__flushSale(); return { up, q: TG_R9.sell.quarantineActive() }; }),
  new Promise(res => setTimeout(() => res({ timeout: true }), 20000))
]);
let inflightJournal = null, inflight = { skipped: true };
if (!flushed.timeout) {
  inflightJournal = await journal(F.p);
  await F.p.evaluate(() => { if (window.__release) window.__release(); });
  inflight = await sale;
}
check('an in-flight grant is kept as proof and does not pay or restore after the conflict', eCaught.q === false && eMove.q === false && eMove.coins === 60 && eMove.rev > eCaught.rev && fBase.q === false && inflight.q === true && inflight.ok === false && inflight.coins === 50 && inflight.cabbage === 19 && inflight.proofs.length === 1 && inflight.proofs[0].granted === 1 && inflightJournal && inflightJournal.local.inventory.cabbage === 19 && inflightJournal.local.coins === 50 && inflightJournal.remote.coins === 60 && inflightJournal.remote.inventory.cabbage === 20, { eCaught, eMove, flushed, fBase, inflight, journal: inflightJournal });
await E.ctx.close(); await F.ctx.close();

await br.close(); srv.close();
const failed = results.filter(r => !r.ok);
fs.writeFileSync(only ? '/tmp/conflict-only.json' : '/workspace/qa/r9h-candidate/conflict.json', JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length, results }, null, 2));
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length }));
if (failed.length) process.exit(1);
