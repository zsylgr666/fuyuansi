// r9h: big safe-integer settlement, earn replies cannot change mode, overflow stop, reload pays once.
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire('/workspace/qa/tools-node/package.json');
const { chromium } = require('playwright-core');
const BUILD = '/workspace/v4/index.r9h.html';
const TG = fs.readFileSync('/workspace/backend/tg-r6.js', 'utf8');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail).slice(0, 500) : ''); };
const html = fs.readFileSync(BUILD, 'utf8');
check('r9h page has no 32-bit crop grant coercion', html.includes("version:'r9h'") && html.includes('function asCount') && !html.includes('r.granted|0') && html.includes('if(!fromStatus)return policy()'));

function serve(buf) {
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(buf); });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}/` })));
}
const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const neu = await serve(fs.readFileSync(BUILD));
async function boot() {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    window.TG_AUTH = { online: true, user: { id: 'A' }, userId: 'A', onChange() {} };
    window.TG_BACKEND_CONFIG = { publicRoomSuffix: '~test', cloudSave: false };
    window.TG_STORAGE_ADAPTER = {
      async load() { const r = localStorage.getItem('templeGarden.v1'); return r ? JSON.parse(r) : null; },
      async save(s) { localStorage.setItem('templeGarden.v1', JSON.stringify(s)); },
      async clear() { localStorage.removeItem('templeGarden.v1'); }, async flush() {}
    };
    window.__DELAY_STATUS = false; window.__HOLD_EARN = false;
    window.__EPOCH = 1; window.__UNCAPPED = true; window.__LEFT = 100; window.__LOG = [];
    window.__answer = args => {
      const coins = typeof args.p_coins === 'number' ? args.p_coins : Number(args.p_coins);
      const base = { sell_epoch: window.__EPOCH, sell_uncapped: !!window.__UNCAPPED, sell_cap: 100, cap: 100 };
      if (window.__FORCE) return window.__FORCE(args);
      if (window.__UNCAPPED) return Object.assign(base, { ok: true, granted: coins, left: 100, sell_left: 100 });
      if (args.p_exact && coins > window.__LEFT) return Object.assign(base, { ok: false, granted: 0, reason: 'daily_cap', left: window.__LEFT, sell_left: window.__LEFT });
      const g = Math.min(coins, window.__LEFT); window.__LEFT -= g;
      return Object.assign(base, { ok: g > 0, granted: g, left: window.__LEFT, sell_left: window.__LEFT });
    };
    window.__waiters = [];
    window.__releaseFor = (who, value) => { const rest = []; for (const w of window.__waiters) { if (w.who === who) w.res(value); else rest.push(w); } window.__waiters = rest; };
    window.TG_R6_RPC = (fn, args) => {
      window.__LOG.push(fn);
      if (fn === 'econ_status') {
        const who = window.TG_AUTH && window.TG_AUTH.userId;
        if (window.__DELAY_STATUS) return new Promise(res => window.__waiters.push({ who, res }));
        return { day: 'd', earn_left: 40, sell_uncapped: !!window.__UNCAPPED, sell_epoch: window.__EPOCH, sell_cap: 100, sell_left: window.__UNCAPPED ? 100 : window.__LEFT, sellback_left: 400 };
      }
      if (fn === 'econ_earn') {
        if (window.__HOLD_EARN) return new Promise(res => { window.__earnRelease = () => res(window.__answer(args)); });
        return window.__answer(args);
      }
      if (fn === 'avatar_me') return { owned: [], catalog: [], avatar: {}, mounts: { owned: [] } };
      return { ok: false, reason: 'offline' };
    };
  });
  await ctx.route(u => !String(u).startsWith(neu.url), r => r.abort());
  const p = await ctx.newPage();
  p.setDefaultTimeout(60000);
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.goto(neu.url);
  await p.waitForFunction(() => window.TG_R9?.sell?.version === 'r9h' && window.W3?.player, null, { timeout: 180000 });
  await p.addScriptTag({ content: TG });
  await p.evaluate(() => { try { S.unlocked = true; closeModal(); } catch (e) {} });
  return { ctx, p, errs };
}

{
  const { ctx, p, errs } = await boot();
  const prov = await p.evaluate(async () => {
    const X = TG_R9.sell;
    window.__DELAY_STATUS = true;
    S.coins = 20; S.inventory = { cabbage: 5 }; save();
    const early = X.noteSellStatus({ sell_uncapped: true, sell_epoch: 9 });
    const probeP = X.probe();
    window.__releaseFor('A', { day: 'd', sell_uncapped: false, sell_epoch: 7, sell_cap: 100, sell_left: 100, earn_left: 40 });
    await probeP;
    const capped = X.policy();
    window.__UNCAPPED = true; window.__EPOCH = 7;
    await TG_ECON.earnAsync(10, 'sell', true);
    X.noteSellStatus({ sell_uncapped: true, sell_epoch: 7, sell_cap: 100, sell_left: 100 });
    const equal = X.policy();
    window.__EPOCH = 9;
    await TG_ECON.earnAsync(10, 'sell', true);
    X.noteSellStatus({ sell_uncapped: true, sell_epoch: 9 });
    const newer = X.policy();
    X.noteSellStatus({ sell_uncapped: true });
    const bare = X.policy();
    TG_AUTH.userId = 'B'; TG_AUTH.user = { id: 'B' }; X.syncAccount();
    const switched = { acct: X.acct(), pol: X.policy() };
    const sold = await X.sellCrop('cabbage', true);
    return { early, capped, equal, newer, bare, switched, sold, coins: S.coins, inv: S.inventory.cabbage };
  });
  check('an earn before classification does not authorize unlimited', prov.early.classified === false && prov.early.uncapped === false, prov.early);
  check('status false epoch 7 caps the page', prov.capped.uncapped === false && prov.capped.epoch === 7 && prov.capped.mode === 'r9' && prov.capped.class === 'epoch', prov.capped);
  check('earn true at the same epoch does not reopen unlimited', prov.equal.uncapped === false && prov.equal.epoch === 7 && prov.equal.mode === 'r9', prov.equal);
  check('earn true at a newer epoch does not reopen unlimited', prov.newer.uncapped === false && prov.newer.epoch === 7, prov.newer);
  check('earn true with no epoch does not reopen unlimited', prov.bare.uncapped === false && prov.bare.epoch === 7, prov.bare);
  check('account switch before the next status drops the mode and does not sell', prov.switched.acct === 'B' && prov.switched.pol.pending === true && prov.switched.pol.uncapped === false && prov.sold === false && prov.coins === 20 && prov.inv === 5, prov.switched);
  check('provenance page had no uncaught error', errs.length === 0, errs);
  await ctx.close();
}

{
  const { ctx, p, errs } = await boot();
  const big = await p.evaluate(async () => {
    const X = TG_R9.sell;
    window.__UNCAPPED = true; window.__EPOCH = 3; window.__LEFT = 100; window.__DELAY_STATUS = false;
    await X.probe();
    const amounts = [2147483647, 2147483648, 3000000000, Number.MAX_SAFE_INTEGER];
    const out = [];
    for (const n of amounts) {
      S.inventory = { cabbage: n }; S.coins = 0; r6Daily().sellCoins = 0; S.cropApplied = {}; delete S.cropPending;
      const ok = await X.sellCrop('cabbage', true);
      const saved = JSON.parse(localStorage.getItem('templeGarden.v1'));
      out.push({ n, ok, coins: S.coins, inv: S.inventory.cabbage || 0, saved: saved.coins, savedInv: (saved.inventory || {}).cabbage || 0, pending: X.readPending('A').length });
    }
    const qty = 268435456;
    S.inventory = { melon: qty }; S.coins = 0;
    const melon = await X.sellCrop('melon', true);
    const melonCoins = S.coins, melonInv = S.inventory.melon || 0;
    const melonSaved = JSON.parse(localStorage.getItem('templeGarden.v1'));
    const tooBig = 1125899906842624;
    S.inventory = { melon: tooBig }; S.coins = 11;
    const refused = await X.sellCrop('melon', true);
    return { out, melon: { ok: melon, coins: melonCoins, inv: melonInv, saved: melonSaved.coins }, refused, afterRefuse: { coins: S.coins, inv: S.inventory.melon, pending: X.readPending('A').length } };
  });
  for (const row of big.out) {
    check('settlement pays ' + row.n + ' and keeps it in the save', row.ok === true && row.coins === row.n && row.inv === 0 && row.saved === row.n && row.savedInv === 0 && row.pending === 0, row);
  }
  check('268435456 melons settle as 2147483648, not a wrapped 32-bit grant', big.melon.ok === true && big.melon.coins === 2147483648 && big.melon.inv === 0 && big.melon.saved === 2147483648, big.melon);
  check('a product past the safe integer is refused with inventory and coins untouched', big.refused === false && big.afterRefuse.coins === 11 && big.afterRefuse.inv === 1125899906842624 && big.afterRefuse.pending === 0, big.afterRefuse);
  check('big-amount page had no uncaught error', errs.length === 0, errs);
  await ctx.close();
}

{
  const { ctx, p, errs } = await boot();
  const over = await p.evaluate(async () => {
    const X = TG_R9.sell;
    window.__UNCAPPED = true; window.__EPOCH = 4; window.__DELAY_STATUS = false;
    S.inventory = { cabbage: 4 }; S.coins = Number.MAX_SAFE_INTEGER - 5;
    await X.probe();
    window.__HOLD_EARN = true;
    const saleP = X.sellCrop('cabbage', false);
    for (let i = 0; i < 40 && !window.__earnRelease; i++) await new Promise(r => setTimeout(r, 25));
    S.coins = Number.MAX_SAFE_INTEGER;
    window.__HOLD_EARN = false;
    window.__FORCE = () => ({ ok: true, granted: 1, sell_uncapped: true, sell_epoch: 4, sell_cap: 100, sell_left: 100 });
    window.__earnRelease();
    await saleP;
    await X.retryCrops();
    await X.retryCrops();
    openShop('sell');
    const held = { coins: S.coins, inv: S.inventory.cabbage || 0, text: document.querySelector('#r9CropHold')?.textContent || '', btn: !!document.querySelector('#r9CropResume') };
    await X.retryCrops();
    const still = S.coins;
    S.coins = 10;
    await X.resumeCrops();
    return { held, still, after: { coins: S.coins, inv: S.inventory.cabbage || 0, pending: X.readPending('A').length } };
  });
  check('overflow stops after three tries and shows the reason', over.held.coins === Number.MAX_SAFE_INTEGER && over.held.inv === 3 && /自动重试已停/.test(over.held.text) && over.held.btn && over.still === Number.MAX_SAFE_INTEGER, over.held);
  check('manual recovery after spending pays the reserved crop once', over.after.coins === 11 && over.after.inv === 3 && over.after.pending === 0, over.after);
  check('overflow page had no uncaught error', errs.length === 0, errs);
  await ctx.close();
}

{
  const { ctx, p, errs } = await boot();
  await p.evaluate(async () => {
    const X = TG_R9.sell;
    window.__UNCAPPED = true; window.__EPOCH = 5; window.__DELAY_STATUS = false; window.__HOLD_EARN = true;
    S.inventory = { cabbage: 9 }; S.coins = 5; S.cropApplied = {};
    await X.probe();
    const saleP = X.sellCrop('cabbage', true);
    for (let i = 0; i < 40 && !window.__earnRelease; i++) await new Promise(r => setTimeout(r, 25));
    saleP.catch(() => {});
  });
  await p.reload();
  await p.waitForFunction(() => window.TG_R9?.sell?.version === 'r9h' && window.W3?.player, null, { timeout: 180000 });
  await p.addScriptTag({ content: TG });
  const re = await p.evaluate(async () => {
    const X = TG_R9.sell;
    window.__HOLD_EARN = false; window.__UNCAPPED = true; window.__EPOCH = 5; window.__DELAY_STATUS = false;
    X.loadEpoch();
    await X.probe();
    const before = { coins: S.coins, inv: S.inventory.cabbage || 0, pending: X.readPending('A').length };
    await X.retryCrops();
    const once = { coins: S.coins, inv: S.inventory.cabbage || 0, pending: X.readPending('A').length };
    await X.retryCrops();
    return { before, once, twice: S.coins };
  });
  check('reload while a reservation is open pays it once', re.before.coins === 5 && re.before.inv === 0 && re.before.pending === 1 && re.once.coins === 14 && re.once.inv === 0 && re.once.pending === 0 && re.twice === 14, re);
  check('reload page had no uncaught error', errs.length === 0, errs);
  await ctx.close();
}

await br.close(); neu.srv.close();
const failed = results.filter(r => !r.ok);
fs.mkdirSync('/workspace/qa/r9h', { recursive: true });
fs.writeFileSync('/workspace/qa/r9h/audit.json', JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length, results }, null, 2));
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length }));
if (failed.length) process.exit(1);
