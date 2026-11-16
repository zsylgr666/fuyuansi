// Two independent browser contexts. The cloud RPC is only the transport.
// Conflict resolution and merge3 run inside the real site page.
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire('/workspace/qa/tools-node/package.json');
const { chromium } = require('playwright-core');
const SITE = fs.readFileSync('/workspace/index.html');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail).slice(0, 700) : ''); };
check('site page unions crop receipts in merge3', SITE.includes('function unionPending') && SITE.includes("version:'r9h'"));

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
      if (fn === 'save_get' || fn === 'save_rev') data = fn === 'save_rev' ? cloud.rev : { ok: true, state: cloud.state, rev: cloud.rev };
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
    window.TG_SAVE_RPC = (fn, args) => fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn, args }) }).then(r => r.json());
    window.TG_BACKEND_CONFIG = Object.assign({ publicRoomSuffix: '~test', cloudSave: true }, window.TG_BACKEND_CONFIG || {});
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(90000);
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 180)));
  await p.goto(origin + '/');
  await p.waitForFunction(() => window.TG_R9?.sell?.version === 'r9h' && window.TG_STORAGE?._merge3 && window.W3?.player, null, { timeout: 180000 });
  await p.evaluate(() => {
    try { S.unlocked = true; closeModal(); } catch (e) {}
    TG_AUTH.user = { id: 'merge-user', is_anonymous: true };
    TG_AUTH.online = true;
    TG_AUTH.ready = Promise.resolve(TG_AUTH.user);
    try { document.querySelector('.tgb-mask')?.remove(); } catch (e) {}
  });
  return { ctx, p, errs };
}
async function cloudGet() {
  const r = await fetch(origin + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn: 'save_get', args: {} }) });
  return r.json();
}

const A = await device();
const B = await device();
const seeded = await A.p.evaluate(async () => {
  S.coins = 100; S.inventory = { cabbage: 80 }; S.cropPending = {}; delete S.cropApplied; r6Daily().sellCoins = 0;
  save(); await TG_STORAGE.flush();
  return { rev: TG_STORAGE.rev, status: TG_STORAGE.status };
});
check('device A establishes the shared base save', seeded.status === 'synced' && seeded.rev >= 1, seeded);
const bLoad = await B.p.evaluate(async () => {
  const st = await TG_STORAGE.load();
  if (st && st.inventory) { S.coins = st.coins; S.inventory = st.inventory; S.cropPending = st.cropPending; S.cropApplied = st.cropApplied; }
  return { rev: TG_STORAGE.rev, coins: S.coins, cabbage: S.inventory.cabbage, base: TG_STORAGE._merge3 ? true : false };
});
check('device B loads the cloud save through the real storage load', typeof bLoad.rev === 'number' && bLoad.rev >= 1 && bLoad.base === true, bLoad);

const receipt = { id: 'cabbage', n: 80, gain: 80, price: 1, req: 'crop-merge-0001', acct: 'merge-user', epoch: 2, name: '白菜', at: 1 };
await A.p.evaluate(async (receipt) => {
  S.inventory = { cabbage: 0 }; S.coins = 100; S.cropPending = { [receipt.req]: receipt }; delete S.cropApplied;
  save(); await TG_STORAGE.flush();
}, receipt);
const afterA = await cloudGet();
check('device A uploaded the deducted inventory and the receipt', afterA.state && afterA.state.inventory && afterA.state.inventory.cabbage === 0 && afterA.state.cropPending[receipt.req].req === receipt.req, { rev: afterA.rev, keys: afterA.state && Object.keys(afterA.state.cropPending || {}) });

const mergedBA = await B.p.evaluate(async () => {
  S.coins = 140; S.cropPending = []; S.inventory = { cabbage: 80 };
  save(); await TG_STORAGE.flush();
  return { status: TG_STORAGE.status, rev: TG_STORAGE.rev };
});
const cloudBA = await cloudGet();
const pendingBA = cloudBA.state && cloudBA.state.cropPending && cloudBA.state.cropPending[receipt.req];
check('B conflicting with an empty receipt list keeps A receipt and the deduction', mergedBA.status === 'synced' && pendingBA && pendingBA.n === 80 && cloudBA.state.inventory.cabbage === 0 && cloudBA.state.coins === 140, { mergedBA, inv: cloudBA.state && cloudBA.state.inventory, coins: cloudBA.state && cloudBA.state.coins, pending: pendingBA });

// Opposite direction. Reset cloud to a base both devices share, then B holds the receipt and A is the stale writer.
cloud = { rev: 0, state: null };
await A.p.evaluate(async () => { TG_STORAGE._resetSync(); S.coins = 100; S.inventory = { cabbage: 80 }; delete S.cropPending; delete S.cropApplied; save(); await TG_STORAGE.flush(); });
const base2 = await cloudGet();
await B.p.evaluate(async () => { TG_STORAGE._resetSync(); await TG_STORAGE.load(); });
await B.p.evaluate(async (receipt) => {
  S.inventory = { cabbage: 0 }; S.coins = 100; S.cropPending = { [receipt.req]: receipt };
  save(); await TG_STORAGE.flush();
}, receipt);
await A.p.evaluate(async () => {
  S.coins = 155; S.inventory = { cabbage: 80 }; S.cropPending = [];
  save(); await TG_STORAGE.flush();
});
const cloudAB = await cloudGet();
const pendingAB = cloudAB.state && cloudAB.state.cropPending && cloudAB.state.cropPending[receipt.req];
check('the opposite direction also keeps the receipt and the deducted stack', pendingAB && pendingAB.req === receipt.req && cloudAB.state.inventory.cabbage === 0 && cloudAB.state.coins === 155, { inv: cloudAB.state && cloudAB.state.inventory, coins: cloudAB.state && cloudAB.state.coins, pending: !!pendingAB });

// Stale device whose base is missing still does not drop the local receipt when the server has none.
const stale = await A.p.evaluate((receipt) => {
  const merge = TG_STORAGE._merge3;
  const local = { coins: 100, inventory: { cabbage: 0 }, cropPending: { [receipt.req]: receipt } };
  const server = { coins: 90, inventory: { cabbage: 80 }, cropPending: [] };
  const out = merge(null, local, server);
  return { pending: out.cropPending && out.cropPending[receipt.req] && out.cropPending[receipt.req].n, inv: out.inventory && out.inventory.cabbage, coins: out.coins };
}, receipt);
check('a missing base does not throw away the local receipt', stale.pending === 80 && stale.inv === 0, stale);

// Committed on A, still pending on B: the merged save remembers the credit and does not keep a second payable receipt.
const committed = await A.p.evaluate((receipt) => {
  const merge = TG_STORAGE._merge3;
  const base = { coins: 100, inventory: { cabbage: 80 } };
  const local = { coins: 180, inventory: { cabbage: 0 }, cropApplied: { [receipt.req]: 1 } };
  const server = { coins: 100, inventory: { cabbage: 0 }, cropPending: { [receipt.req]: receipt } };
  const out = merge(base, local, server);
  return { applied: !!(out.cropApplied && out.cropApplied[receipt.req]), pending: out.cropPending && out.cropPending[receipt.req], coins: out.coins };
}, receipt);
check('a credited request stays credited and is not payable a second time', committed.applied === true && !committed.pending && committed.coins === 180, committed);

// Reload the merged cloud save and confirm one retry does not pay twice when the receipt was already applied.
await B.p.evaluate(async () => { TG_STORAGE._resetSync(); });
cloud = { rev: 1, state: { coins: 180, inventory: { cabbage: 0 }, cropApplied: { 'crop-merge-0001': 1 }, _savedAt: Date.now() } };
const once = await B.p.reload().then(async () => {
  await B.p.waitForFunction(() => window.TG_R9?.sell?.version === 'r9h' && window.W3?.player, null, { timeout: 180000 });
  return B.p.evaluate(async () => {
    TG_AUTH.user = { id: 'merge-user', is_anonymous: true }; TG_AUTH.online = true; TG_AUTH.ready = Promise.resolve(TG_AUTH.user);
    const st = await TG_STORAGE.load();
    if (st) { S.coins = st.coins; S.inventory = st.inventory || {}; S.cropApplied = st.cropApplied; S.cropPending = st.cropPending; }
    const X = TG_R9.sell;
    const before = S.coins;
    await X.retryCrops();
    await X.retryCrops();
    return { before, after: S.coins, pending: X.readPending('merge-user').length, applied: !!(S.cropApplied && S.cropApplied['crop-merge-0001']) };
  });
});
check('reloading a merged save that already credited the request pays nothing more', once.before === 180 && once.after === 180 && once.pending === 0 && once.applied === true, once);

const errs = A.errs.concat(B.errs).filter(e => !/supabase|net::|Failed to fetch/i.test(e));
check('merge pages had no unexpected page error', errs.length === 0, errs);
await A.ctx.close(); await B.ctx.close(); await br.close(); srv.close();
const failed = results.filter(r => !r.ok);
fs.mkdirSync('/workspace/qa/r9h', { recursive: true });
fs.writeFileSync('/workspace/qa/r9h/merge-devices.json', JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length, cloudRev: cloud.rev, results }, null, 2));
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length }));
if (failed.length) process.exit(1);
