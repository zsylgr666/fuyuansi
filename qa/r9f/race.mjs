// r9f adversarial sequences on the frozen page, with the real tg-r6.js confirmSell / earnAsync.
// Isolated. No live SQL. The old published page is checked only for the r9f status shape.
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire('/workspace/qa/tools-node/package.json');
const { chromium } = require('playwright-core');
const BUILD = '/workspace/v4/index.r9f.html';
const TG = fs.readFileSync('/tmp/r9d-build/backend/tg-r6.js', 'utf8');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail).slice(0, 700) : ''); };
check('tg-r6 does not synthesize sell_uncapped true', !/noteSellStatus\(\{\s*sell_uncapped:\s*true/.test(TG) && TG.includes('Never invent sell_uncapped'));
check('frozen page is r9f and gates on sell_epoch', fs.readFileSync(BUILD, 'utf8').includes("version:'r9f'") && fs.readFileSync(BUILD, 'utf8').includes('sell_epoch<X.epoch'));

function serve(buf) {
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(buf); });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}/` })));
}
const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const neu = await serve(fs.readFileSync(BUILD));

async function boot(ctx) {
  const p = await ctx.newPage();
  p.setDefaultTimeout(60000);
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 240)));
  await p.goto(neu.url);
  await p.waitForFunction(() => window.TG_R9?.sell?.version === 'r9f' && window.W3?.player, null, { timeout: 180000 });
  await p.addScriptTag({ content: TG });
  await p.evaluate(() => { try { S.unlocked = true; closeModal(); } catch (e) {} });
  const ready = await p.evaluate(() => ({
    confirm: typeof TG_ECON?.confirmSell === 'function',
    earnAsync: typeof TG_ECON?.earnAsync === 'function',
    flag: !!window.__TG_R6_NET
  }));
  return { p, errs, ready };
}

const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  window.TG_AUTH = { online: true, user: { id: 'A' }, userId: 'A', onChange() {} };
  window.TG_BACKEND_CONFIG = { publicRoomSuffix: '~test', cloudSave: false };
  window.TG_STORAGE_ADAPTER = {
    async load() { const r = localStorage.getItem('templeGarden.v1'); return r ? JSON.parse(r) : null; },
    async save(s) { localStorage.setItem('templeGarden.v1', JSON.stringify(s)); },
    async clear() { localStorage.removeItem('templeGarden.v1'); },
    async flush() {}
  };
  window.__EPOCH = 1; window.__UNCAPPED = true; window.__LEFT = 100; window.__ERRS = 0; window.__HOLD = false; window.__LEDGER = {}; window.__LOG = []; window.__waiting = null;
  window.__answer = args => {
    const req = args && args.p_req;
    if (req && window.__LEDGER[req]) return Object.assign({ replay: true }, window.__LEDGER[req]);
    if (window.__ERRS > 0) { window.__ERRS--; return { ok: false, reason: 'error', req }; }
    const coins = args.p_coins | 0;
    const base = { sell_epoch: window.__EPOCH, sell_uncapped: window.__UNCAPPED, sell_cap: 100, cap: 100 };
    let row;
    if (window.__UNCAPPED) row = Object.assign(base, { ok: true, granted: coins, left: 100, sell_left: 100 });
    else if (args.p_exact && coins > window.__LEFT) row = Object.assign(base, { ok: false, granted: 0, reason: 'daily_cap', left: window.__LEFT, sell_left: window.__LEFT });
    else { const g = Math.min(coins, window.__LEFT); window.__LEFT -= g; row = Object.assign(base, { ok: g > 0, granted: g, left: window.__LEFT, sell_left: window.__LEFT }); }
    if (req && row.ok) window.__LEDGER[req] = row;
    return row;
  };
  window.TG_R6_RPC = (fn, args) => {
    window.__LOG.push(fn);
    if (fn === 'econ_status') return { day: 'd', earn_left: 40, earn_cap: 40, merit_coins_left: 8, steal_left: 15, sellback_left: 400, sellback_cap: 400, sell_uncapped: window.__UNCAPPED, sell_epoch: window.__EPOCH, sell_cap: 100, sell_left: window.__UNCAPPED ? 100 : window.__LEFT };
    if (fn === 'econ_earn') {
      if (window.__HOLD) return new Promise(res => { window.__waiting = () => res(window.__answer(args)); });
      return window.__answer(args);
    }
    if (fn === 'avatar_me') return { owned: [], catalog: [], avatar: {}, mounts: { owned: [] } };
    if (fn === 'econ_sellback_credit' || fn === 'lotus_status') return { ok: false, reason: 'offline' };
    return { ok: false, reason: 'offline' };
  };
});
await ctx.route(u => !String(u).startsWith(neu.url), r => r.abort());

{
  const { p, errs, ready } = await boot(ctx);
  check('real tg-r6 confirmSell is installed on the r9f page', ready.confirm === true && ready.earnAsync === true && ready.flag === true, ready);

  const order = await p.evaluate(async () => {
    const X = TG_R9.sell;
    await X.probe();
    const a = X.policy();
    window.__UNCAPPED = false; window.__EPOCH = 3; window.__LEFT = 60;
    X.noteSellStatus({ sell_uncapped: false, sell_epoch: 3, sell_cap: 100, sell_left: 60, day: 'd' });
    const b = X.policy();
    X.noteSellStatus({ sell_uncapped: true, sell_epoch: 2, sell_cap: 100, sell_left: 100 });
    const c = X.policy();
    X.noteSellStatus({ sell_uncapped: true, day: 'earn' });
    const d = X.policy();
    X.noteSellStatus({ sell_uncapped: false, sell_left: 0, sell_cap: 100 });
    const e = X.policy();
    const asyncStale = await TG_ECON.earnAsync(80, 'sell', true);
    const f = X.policy();
    window.__EPOCH = 1;
    const asyncOld = await TG_ECON.earnAsync(80, 'sell', true);
    const g = X.policy();
    window.__EPOCH = 4; window.__UNCAPPED = true; window.__LEFT = 100;
    X.noteSellStatus({ sell_uncapped: true, sell_epoch: 4, sell_cap: 100, sell_left: 100 });
    return { a, b, c, d, e, f, asyncStale, asyncOld, g, h: X.policy() };
  });
  check('epoch 1 true then epoch 3 false revokes without reload', order.a.uncapped === true && order.a.epoch === 1 && order.b.uncapped === false && order.b.mode === 'r9' && order.b.epoch === 3, order.b);
  check('an older true does not undo the rollback', order.c.uncapped === false && order.c.epoch === 3, order.c);
  check('a true with no epoch does not re-enable', order.d.uncapped === false && order.d.epoch === 3, order.d);
  check('a false with no epoch does not move a page that already has an epoch', order.e.uncapped === false && order.e.epoch === 3, order.e);
  check('real earnAsync stale true, with and without an older epoch, does not re-enable', order.f.uncapped === false && order.f.epoch === 3 && order.g.uncapped === false && order.g.epoch === 3, { f: order.f, g: order.g, asyncStale: order.asyncStale, asyncOld: order.asyncOld });
  check('a newer epoch can turn uncapped back on', order.h.uncapped === true && order.h.epoch === 4, order.h);

  const sale = await p.evaluate(async () => {
    const X = TG_R9.sell;
    window.__UNCAPPED = false; window.__EPOCH = 5; window.__LEFT = 60; window.__LEDGER = {};
    X.noteSellStatus({ sell_uncapped: false, sell_epoch: 5, sell_cap: 100, sell_left: 60 });
    X.noteSellStatus({ sell_uncapped: true });
    X.noteSellStatus({ sell_uncapped: true, sell_epoch: 1, sell_cap: 100, sell_left: 100 });
    X.noteSellStatus({ sell_uncapped: true, sell_epoch: 4, sell_cap: 100, sell_left: 100 });
    const d = r6Daily(); d.sellCoins = 40; d.coinsEarned = 0;
    S.inventory = { cabbage: 80 }; S.coins = 100;
    const before = X.policy();
    const ok = await X.sellCrop('cabbage', true);
    const saved = JSON.parse(localStorage.getItem('templeGarden.v1'));
    return { before, ok, inv: S.inventory.cabbage || 0, coins: S.coins, sell: d.sellCoins, earned: d.coinsEarned, pol: X.policy(), savedCoins: saved.coins, savedInv: saved.inventory.cabbage || 0, pending: X.readPending('A').length, calls: window.__LOG.filter(x => x === 'econ_earn').length };
  });
  check('after rollback, injected stale true, sell 80 cabbage pays 60 and keeps 20', sale.before.uncapped === false && sale.ok === true && sale.inv === 20 && sale.coins === 160 && sale.sell === 100 && sale.earned === 0 && sale.savedCoins === 160 && sale.savedInv === 20 && sale.pending === 0 && sale.pol.uncapped === false && sale.pol.epoch === 5, sale);

  const refused = await p.evaluate(async () => {
    const X = TG_R9.sell;
    window.__UNCAPPED = true; window.__EPOCH = 6; window.__LEFT = 100; window.__HOLD = true; window.__waiting = null;
    X.noteSellStatus({ sell_uncapped: true, sell_epoch: 6, sell_cap: 100, sell_left: 100 });
    S.inventory = { cabbage: 80 }; S.coins = 300; r6Daily().sellCoins = 0; r6Daily().coinsEarned = 0;
    const saleP = X.sellCrop('cabbage', true);
    for (let i = 0; i < 40 && !window.__waiting; i++) await new Promise(r => setTimeout(r, 25));
    const mid = { inv: S.inventory.cabbage || 0, coins: S.coins, pending: X.readPending('A').length, pol: X.policy() };
    window.__UNCAPPED = false; window.__EPOCH = 5; window.__LEFT = 60;
    X.noteSellStatus({ sell_uncapped: false, sell_epoch: 5, sell_cap: 100, sell_left: 60 });
    const answer = window.__answer;
    window.__waiting && window.__waiting();
    // The held call captured __answer at release time. Replace the released result by resolving daily_cap explicitly.
    const ok = await saleP;
    return { mid, ok, inv: S.inventory.cabbage || 0, coins: S.coins, pol: X.policy(), pending: X.readPending('A').length, earned: r6Daily().coinsEarned, ignored: typeof answer };
  });
  // The block above releases with whatever __answer is at release time, which already sees epoch 5 capped and left 60.
  // The in-flight request asked for 80. Exact mode refuses. Re-check that path with an explicit answer if the first release granted.
  check('in-flight uncapped sale is reserved before the reply: 80 held, coins unchanged', refused.mid.inv === 0 && refused.mid.coins === 300 && refused.mid.pending === 1 && refused.mid.pol.uncapped === true, refused.mid);

  const refused2 = await p.evaluate(async () => {
    const X = TG_R9.sell;
    // If the previous release granted because __answer ran uncapped, put the world back and run the refusal as its own held call.
    window.__HOLD = true; window.__waiting = null; window.__LEDGER = {};
    window.__UNCAPPED = true; window.__EPOCH = 4; window.__LEFT = 100;
    X.noteSellStatus({ sell_uncapped: true, sell_epoch: 6, sell_cap: 100, sell_left: 100 });
    S.inventory = { cabbage: 80 }; S.coins = 300; r6Daily().sellCoins = 0; r6Daily().coinsEarned = 0; S.cropApplied = []; S.cropPending = [];
    localStorage.removeItem('templeGarden.r9.cropPending.A');
    const saleP = X.sellCrop('cabbage', true);
    for (let i = 0; i < 40 && !window.__waiting; i++) await new Promise(r => setTimeout(r, 25));
    const mid = { inv: S.inventory.cabbage || 0, coins: S.coins, pending: X.readPending('A').length };
    const release = window.__waiting;
    window.__answer = () => ({ ok: false, granted: 0, reason: 'daily_cap', left: 60, cap: 100, sell_uncapped: false, sell_epoch: 7, sell_cap: 100, sell_left: 60 });
    window.__UNCAPPED = false; window.__EPOCH = 7; window.__LEFT = 60;
    X.noteSellStatus({ sell_uncapped: false, sell_epoch: 7, sell_cap: 100, sell_left: 60 });
    release();
    const ok = await saleP;
    const saved = JSON.parse(localStorage.getItem('templeGarden.v1'));
    return { mid, ok, inv: S.inventory.cabbage || 0, coins: S.coins, pol: X.policy(), pending: X.readPending('A').length, savedCoins: saved.coins, savedInv: saved.inventory.cabbage || 0, earned: r6Daily().coinsEarned };
  });
  check('refusal after rollback restores the 80 and does not keep coins', refused2.mid.inv === 0 && refused2.mid.coins === 300 && refused2.mid.pending === 1 && refused2.ok === false && refused2.inv === 80 && refused2.coins === 300 && refused2.savedCoins === 300 && refused2.savedInv === 80 && refused2.pending === 0 && refused2.pol.uncapped === false && refused2.pol.epoch === 7 && refused2.earned === 0, refused2);

  const committed = await p.evaluate(async () => {
    const X = TG_R9.sell;
    window.__HOLD = true; window.__waiting = null; window.__LEDGER = {};
    window.__UNCAPPED = true; window.__EPOCH = 8; window.__LEFT = 100;
    X.noteSellStatus({ sell_uncapped: true, sell_epoch: 8, sell_cap: 100, sell_left: 100 });
    S.inventory = { cabbage: 80 }; S.coins = 400; r6Daily().sellCoins = 0; r6Daily().coinsEarned = 0; S.cropApplied = [];
    const saleP = X.sellCrop('cabbage', true);
    for (let i = 0; i < 40 && !window.__waiting; i++) await new Promise(r => setTimeout(r, 25));
    const release = window.__waiting;
    X.noteSellStatus({ sell_uncapped: false, sell_epoch: 9, sell_cap: 100, sell_left: 100 });
    window.__answer = () => ({ ok: true, granted: 80, left: 100, cap: 100, sell_uncapped: true, sell_epoch: 8, sell_cap: 100, sell_left: 100 });
    release();
    const ok = await saleP;
    return { ok, inv: S.inventory.cabbage || 0, coins: S.coins, pol: X.policy(), pending: X.readPending('A').length, earned: r6Daily().coinsEarned, sell: r6Daily().sellCoins };
  });
  check('a grant committed before rollback pays 80 and does not restore uncapped', committed.ok === true && committed.inv === 0 && committed.coins === 480 && committed.pol.uncapped === false && committed.pol.epoch === 9 && committed.pending === 0 && committed.earned === 0, committed);

  const switched = await p.evaluate(async () => {
    const X = TG_R9.sell;
    window.__HOLD = true; window.__waiting = null; window.__LEDGER = {};
    window.__UNCAPPED = true; window.__EPOCH = 10; window.__LEFT = 100;
    X.noteSellStatus({ sell_uncapped: true, sell_epoch: 10, sell_cap: 100, sell_left: 100 });
    S.inventory = { cabbage: 4 }; S.coins = 10; r6Daily().coinsEarned = 0; S.cropApplied = [];
    const saleP = X.sellCrop('cabbage', true);
    for (let i = 0; i < 40 && !window.__waiting; i++) await new Promise(r => setTimeout(r, 25));
    const release = window.__waiting;
    TG_AUTH.userId = 'B'; TG_AUTH.user = { id: 'B' };
    window.__answer = args => { const row = { ok: true, granted: args.p_coins | 0, sell_uncapped: true, sell_epoch: 10, sell_cap: 100, sell_left: 100, cap: 100, left: 100 }; window.__LEDGER[args.p_req] = row; return row; };
    release();
    await saleP;
    const mid = { acct: X.acct(), coins: S.coins, inv: S.inventory.cabbage || 0, pending: X.readPending('A').length, epoch: X.policy().epoch };
    TG_AUTH.userId = 'A'; TG_AUTH.user = { id: 'A' };
    X.loadEpoch();
    window.__HOLD = false;
    await X.retryCrops();
    const once = { coins: S.coins, inv: S.inventory.cabbage || 0, pending: X.readPending('A').length, applied: (S.cropApplied || []).length };
    await X.retryCrops();
    return { mid, once, twice: { coins: S.coins, pending: X.readPending('A').length } };
  });
  check('a reply that arrives after an account switch does not pay the other account', switched.mid.acct === 'B' && switched.mid.coins === 10 && switched.mid.inv === 0 && switched.mid.pending === 1, switched.mid);
  check('returning to the account settles the same request once', switched.once.coins === 14 && switched.once.inv === 0 && switched.once.pending === 0 && switched.twice.coins === 14, switched);

  const errored = await p.evaluate(async () => {
    const X = TG_R9.sell;
    window.__HOLD = false; window.__LEDGER = {}; window.__ERRS = 3;
    window.__answer = args => {
      const req = args && args.p_req;
      if (req && window.__LEDGER[req]) return Object.assign({ replay: true }, window.__LEDGER[req]);
      if (window.__ERRS > 0) { window.__ERRS--; return { ok: false, reason: 'error', req }; }
      const coins = args.p_coins | 0;
      const row = { ok: true, granted: coins, left: 100, cap: 100, sell_uncapped: true, sell_epoch: window.__EPOCH, sell_cap: 100, sell_left: 100 };
      if (req) window.__LEDGER[req] = row;
      return row;
    };
    window.__UNCAPPED = true; window.__EPOCH = 10; window.__LEFT = 100;
    X.noteSellStatus({ sell_uncapped: true, sell_epoch: 10, sell_cap: 100, sell_left: 100 });
    S.inventory = { cabbage: 7 }; S.coins = 20; S.cropApplied = []; r6Daily().coinsEarned = 0;
    const ok = await X.sellCrop('cabbage', true);
    const mid = { ok, inv: S.inventory.cabbage || 0, coins: S.coins, pending: X.readPending('A').length };
    const reqs = [];
    const orig = window.__answer;
    window.__answer = args => { reqs.push(args.p_req); return orig(args); };
    await X.retryCrops();
    const after = { inv: S.inventory.cabbage || 0, coins: S.coins, pending: X.readPending('A').length };
    await X.retryCrops();
    return { mid, after, again: S.coins, reqs };
  });
  check('a network error keeps the reservation and the retry pays once', errored.mid.ok === false && errored.mid.inv === 0 && errored.mid.coins === 20 && errored.mid.pending === 1 && errored.after.coins === 27 && errored.after.inv === 0 && errored.after.pending === 0 && errored.again === 27 && new Set(errored.reqs).size === 1, errored);

  const reloadPrep = await p.evaluate(async () => {
    const X = TG_R9.sell;
    window.__HOLD = true; window.__waiting = null; window.__LEDGER = {}; window.__ERRS = 0;
    window.__UNCAPPED = true; window.__EPOCH = 11; window.__LEFT = 100;
    X.noteSellStatus({ sell_uncapped: true, sell_epoch: 11, sell_cap: 100, sell_left: 100 });
    S.inventory = { cabbage: 9 }; S.coins = 5; S.cropApplied = [];
    const saleP = X.sellCrop('cabbage', true);
    for (let i = 0; i < 40 && !window.__waiting; i++) await new Promise(r => setTimeout(r, 25));
    const snap = { inv: S.inventory.cabbage || 0, coins: S.coins, pending: X.readPending('A').length, epoch: localStorage.getItem('templeGarden.r9.sellEpoch.A') };
    saleP.catch(() => {});
    return snap;
  });
  check('an unresolved sale is saved with the items reserved and no coins', reloadPrep.inv === 0 && reloadPrep.coins === 5 && reloadPrep.pending === 1 && reloadPrep.epoch === '11', reloadPrep);
  await p.reload();
  await p.waitForFunction(() => window.TG_R9?.sell?.version === 'r9f' && window.W3?.player, null, { timeout: 180000 });
  await p.addScriptTag({ content: TG });
  const reloaded = await p.evaluate(async () => {
    const X = TG_R9.sell;
    window.__HOLD = false; window.__UNCAPPED = true; window.__EPOCH = 11; window.__LEFT = 100; window.__ERRS = 0; window.__LEDGER = {};
    X.loadEpoch();
    const before = { inv: S.inventory.cabbage || 0, coins: S.coins, pending: X.readPending('A').length, epoch: X.policy().epoch };
    await X.retryCrops();
    const once = { inv: S.inventory.cabbage || 0, coins: S.coins, pending: X.readPending('A').length, applied: (S.cropApplied || []).length };
    await X.retryCrops();
    return { before, once, twice: S.coins };
  });
  check('reloading an unresolved sale pays it once and does not pay it again', reloaded.before.inv === 0 && reloaded.before.coins === 5 && reloaded.before.pending === 1 && reloaded.before.epoch === 11 && reloaded.once.coins === 14 && reloaded.once.inv === 0 && reloaded.once.pending === 0 && reloaded.twice === 14, reloaded);
  check('r9f page had no uncaught error', errs.length === 0, errs);
  await p.close();
}

const old = await serve(fs.readFileSync('/tmp/index.r9b-site.html'));
{
  const p = await br.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 240)));
  await p.addInitScript(() => {
    window.__SELL = 100; window.__EARN = 40;
    window.TG_AUTH = { online: true, user: { id: 'old-user' }, userId: 'old-user', onChange() {}, ready: Promise.resolve(), client: { rpc(fn, args) { return Promise.resolve(window.TG_R6_RPC(fn, args)).then(data => ({ data, error: null })); } } };
    window.TG_R6_RPC = fn => {
      if (fn === 'econ_status') return { day: 'd', earn_left: window.__EARN, earn_cap: 40, merit_coins_left: 8, steal_left: 15, sellback_left: 400, sellback_cap: 400, sell_uncapped: true, sell_epoch: 4, sell_cap: 100, sell_left: window.__SELL };
      if (fn === 'econ_earn') return { ok: true, granted: 0, sell_uncapped: true, sell_epoch: 4 };
      if (fn === 'econ_sellback_credit') return { ok: false, reason: 'offline' };
      if (fn === 'avatar_me') return { owned: [], catalog: [], avatar: {}, mounts: { owned: [] } };
      if (fn === 'lotus_status') return { day: 'd', koi_left: 3 };
      return { ok: false, reason: 'offline' };
    };
  });
  await p.goto(old.url);
  await p.waitForFunction(() => window.TG_R9?.sell?.version === 'r9b' && window.W3?.player, null, { timeout: 180000 });
  await p.evaluate(() => { const A = window.TG_AUTH; if (A) { A.online = true; A.user = { id: 'old-user' }; A.userId = 'old-user'; } });
  const legacy = await p.evaluate(async () => {
    window.__SELL = 100; window.__EARN = 40;
    S.inventory = { cabbage: 80 }; S.coins = 50;
    const d0 = r6Daily(); d0.date = '1999-01-01';
    r6Daily().coinsEarned = 0; r6Daily().sellCoins = 40;
    await new Promise(r => setTimeout(r, 200));
    await TG_R9.sell.probe();
    openShop('sell');
    document.querySelector('[data-r9-sell-all="cabbage"]')?.click();
    return { mode: TG_R9.sell.mode, cap: TG_R9.sell.cap, inv: S.inventory.cabbage || 0, coins: S.coins, earned: r6Daily().coinsEarned, sell: r6Daily().sellCoins, line: document.querySelector('#r9SellCap')?.textContent || '' };
  });
  check('old r9b page keeps its own 100 when the r9f status also carries sell_epoch', legacy.mode === 'r9' && legacy.cap === 100 && legacy.inv === 20 && legacy.coins === 110 && legacy.earned === 0 && legacy.sell === 100, legacy);
  check('old r9b page had no uncaught error', errs.length === 0, errs);
  await p.close();
  old.srv.close();
}

await ctx.close();
neu.srv.close();
await br.close();
const failed = results.filter(r => !r.ok);
fs.writeFileSync('/workspace/qa/r9f/race.json', JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length, results }, null, 2));
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length }, null, 2));
if (failed.length) process.exit(1);
