// r9g: a signed-in shop must not pay or change crop inventory before status classifies the account.
// Fresh page, real tg-r6.js. No live SQL. r9f files are not the subject of this run.
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire('/workspace/qa/tools-node/package.json');
const { chromium } = require('playwright-core');
const BUILD = '/workspace/v4/index.r9g.html';
const TG = fs.readFileSync('/workspace/backend/tg-r6.js', 'utf8');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail).slice(0, 800) : ''); };
const html = fs.readFileSync(BUILD, 'utf8');
check('frozen r9g page waits for status and keeps r9f bytes off this file', html.includes("version:'r9g'") && html.includes('正在核对今日的出售规则') && !html.includes("version:'r9f'"));

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
      async clear() { localStorage.removeItem('templeGarden.v1'); },
      async flush() {}
    };
    window.__DELAY_STATUS = true;
    window.__HOLD_EARN = false;
    window.__EPOCH = 1; window.__UNCAPPED = true; window.__LEFT = 100; window.__ERRS = 0;
    window.__LEDGER = {}; window.__LOG = []; window.__waiters = [];
    window.__answer = args => {
      const req = args && args.p_req;
      if (req && window.__LEDGER[req]) return Object.assign({ replay: true }, window.__LEDGER[req]);
      if (window.__ERRS > 0) { window.__ERRS--; return { ok: false, reason: 'error', req }; }
      const coins = args.p_coins | 0;
      const base = { sell_epoch: window.__EPOCH, sell_uncapped: !!window.__UNCAPPED, sell_cap: 100, cap: 100 };
      let row;
      if (window.__FORCE_EARN) row = window.__FORCE_EARN(args);
      else if (window.__UNCAPPED) row = Object.assign(base, { ok: true, granted: coins, left: 100, sell_left: 100 });
      else if (args.p_exact && coins > window.__LEFT) row = Object.assign(base, { ok: false, granted: 0, reason: 'daily_cap', left: window.__LEFT, sell_left: window.__LEFT });
      else { const g = Math.min(coins, window.__LEFT); window.__LEFT -= g; row = Object.assign(base, { ok: g > 0, granted: g, left: window.__LEFT, sell_left: window.__LEFT }); }
      if (req && row && row.ok) window.__LEDGER[req] = row;
      return row;
    };
    window.__releaseFor = (who, value) => {
      const rest = [];
      for (const w of window.__waiters) { if (w.who === who) w.res(value); else rest.push(w); }
      window.__waiters = rest;
    };
    window.TG_R6_RPC = (fn, args) => {
      window.__LOG.push(fn);
      if (fn === 'econ_status') {
        const who = window.TG_AUTH && window.TG_AUTH.userId;
        if (window.__DELAY_STATUS) return new Promise(res => { window.__waiters.push({ who, res }); });
        return { day: 'd', earn_left: 40, earn_cap: 40, merit_coins_left: 8, steal_left: 15, sellback_left: 400, sellback_cap: 400, sell_uncapped: !!window.__UNCAPPED, sell_epoch: window.__EPOCH, sell_cap: 100, sell_left: window.__UNCAPPED ? 100 : window.__LEFT };
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
  p.on('pageerror', e => errs.push(String(e).slice(0, 240)));
  await p.goto(neu.url);
  await p.waitForFunction(() => window.TG_R9?.sell?.version === 'r9g' && window.W3?.player, null, { timeout: 180000 });
  await p.addScriptTag({ content: TG });
  await p.evaluate(() => { try { S.unlocked = true; closeModal(); } catch (e) {} });
  return { ctx, p, errs };
}

{
  const { ctx, p, errs } = await boot();
  const early = await p.evaluate(async () => {
    const X = TG_R9.sell;
    S.inventory = { cabbage: 80 }; S.coins = 100; r6Daily().sellCoins = 0; r6Daily().coinsEarned = 0; save();
    const probeP = X.probe();
    openShop('sell');
    const line = document.querySelector('#r9SellCap')?.textContent || '';
    const beforeEarns = window.__LOG.filter(x => x === 'econ_earn').length;
    const sold = await X.sellCrop('cabbage', true);
    const sellEarns = window.__LOG.filter(x => x === 'econ_earn').length - beforeEarns;
    X.noteSellStatus({ sell_uncapped: true, day: 'earn' });
    X.noteSellStatus({ sell_uncapped: true, sell_epoch: 1, sell_cap: 100, sell_left: 100 });
    const earn = await TG_ECON.earnAsync(80, 'sell', true);
    const saved = JSON.parse(localStorage.getItem('templeGarden.v1') || '{}');
    const mid = { sold, line, pol: X.policy(), inv: S.inventory.cabbage, coins: S.coins, savedCoins: saved.coins, savedInv: (saved.inventory || {}).cabbage, earn, sellEarns };
    window.__UNCAPPED = false; window.__EPOCH = 2; window.__LEFT = 60;
    window.__releaseFor('A', { day: 'd', earn_left: 40, sell_uncapped: false, sell_epoch: 2, sell_cap: 100, sell_left: 60, sellback_left: 400 });
    await probeP;
    const after = { pol: X.policy(), inv: S.inventory.cabbage, coins: S.coins };
    const paid = await X.sellCrop('cabbage', true);
    const saved2 = JSON.parse(localStorage.getItem('templeGarden.v1') || '{}');
    return { mid, after, paid, end: { inv: S.inventory.cabbage || 0, coins: S.coins, earned: r6Daily().coinsEarned, sell: r6Daily().sellCoins, pol: X.policy(), savedCoins: saved2.coins, savedInv: (saved2.inventory || {}).cabbage || 0, pending: X.readPending('A').length } };
  });
  check('fresh page with status held does not sell or save coins', early.mid.sold === false && early.mid.pol.pending === true && early.mid.pol.uncapped === false && early.mid.inv === 80 && early.mid.coins === 100 && early.mid.savedCoins === 100 && early.mid.savedInv === 80 && early.mid.sellEarns === 0 && /正在核对/.test(early.mid.line), early.mid);
  check('an earn reply before the first status does not turn unlimited on', early.mid.pol.uncapped === false && early.mid.pol.classified === false, early.mid.pol);
  check('rollback status, arriving first, caps the page and the following 80 pays 60', early.after.pol.uncapped === false && early.after.pol.epoch === 2 && early.after.pol.class === 'epoch' && early.paid === true && early.end.inv === 20 && early.end.coins === 160 && early.end.earned === 0 && early.end.sell === 60 && early.end.savedCoins === 160 && early.end.savedInv === 20 && early.end.pending === 0, { after: early.after, end: early.end });
  check('delayed-status page had no uncaught error', errs.length === 0, errs);
  await ctx.close();
}

{
  const { ctx, p, errs } = await boot();
  const refused = await p.evaluate(async () => {
    const X = TG_R9.sell;
    window.__DELAY_STATUS = false; window.__UNCAPPED = true; window.__EPOCH = 4; window.__LEFT = 100;
    S.inventory = { cabbage: 30 }; S.coins = 50; r6Daily().coinsEarned = 0;
    await X.probe();
    window.__HOLD_EARN = true;
    const saleP = X.sellCrop('cabbage', true);
    for (let i = 0; i < 40 && !window.__earnRelease; i++) await new Promise(r => setTimeout(r, 25));
    const mid = { inv: S.inventory.cabbage || 0, coins: S.coins, pending: X.readPending('A').length, pol: X.policy() };
    window.__answer = () => ({ ok: false, granted: 0, reason: 'daily_cap', left: 0, cap: 100, sell_uncapped: true, sell_epoch: 4, sell_cap: 100, sell_left: 100 });
    window.__earnRelease();
    const ok = await saleP;
    const saved = JSON.parse(localStorage.getItem('templeGarden.v1') || '{}');
    return { mid, ok, inv: S.inventory.cabbage || 0, coins: S.coins, savedCoins: saved.coins, savedInv: (saved.inventory || {}).cabbage || 0, pol: X.policy() };
  });
  check('a refused first settlement restores the crop and does not keep coins', refused.mid.inv === 0 && refused.mid.coins === 50 && refused.mid.pending === 1 && refused.mid.pol.uncapped === true && refused.ok === false && refused.inv === 30 && refused.coins === 50 && refused.savedCoins === 50 && refused.savedInv === 30, refused);
  check('refusal page had no uncaught error', errs.length === 0, errs);
  await ctx.close();
}

{
  const { ctx, p, errs } = await boot();
  const err = await p.evaluate(async () => {
    const X = TG_R9.sell;
    S.inventory = { cabbage: 12 }; S.coins = 7;
    const probeP = X.probe();
    window.__releaseFor('A', { reason: 'error' });
    await probeP;
    const sold = await X.sellCrop('cabbage', true);
    const afterErr = { pol: X.policy(), sold, inv: S.inventory.cabbage, coins: S.coins };
    window.__DELAY_STATUS = false; window.__UNCAPPED = true; window.__EPOCH = 6; window.__LEFT = 100;
    await X.probe();
    window.__HOLD_EARN = false;
    const ok = await X.sellCrop('cabbage', true);
    return { afterErr, ok, inv: S.inventory.cabbage || 0, coins: S.coins, pol: X.policy() };
  });
  check('a first status error stays pending and does not sell', err.afterErr.pol.pending === true && err.afterErr.pol.mode !== 'offline' && err.afterErr.pol.mode !== 'local' && err.afterErr.sold === false && err.afterErr.inv === 12 && err.afterErr.coins === 7, err.afterErr);
  check('status retry then an unlimited first sale pays the whole stack', err.ok === true && err.pol.uncapped === true && err.pol.epoch === 6 && err.inv === 0 && err.coins === 19, err);
  check('status-error page had no uncaught error', errs.length === 0, errs);
  await ctx.close();
}

{
  const { ctx, p, errs } = await boot();
  const sw = await p.evaluate(async () => {
    const X = TG_R9.sell;
    S.inventory = { cabbage: 9 }; S.coins = 3;
    const probeA = X.probe();
    TG_AUTH.userId = 'B'; TG_AUTH.user = { id: 'B' };
    X.syncAccount();
    window.__releaseFor('A', { day: 'd', sell_uncapped: true, sell_epoch: 1, sell_cap: 100, sell_left: 100, earn_left: 40 });
    await probeA;
    const soldB = await X.sellCrop('cabbage', true);
    const mid = { pol: X.policy(), acct: X.acct(), soldB, inv: S.inventory.cabbage, coins: S.coins };
    const probeB = X.probe();
    window.__releaseFor('B', { day: 'd', sell_uncapped: true, sell_epoch: 8, sell_cap: 100, sell_left: 100, earn_left: 40 });
    await probeB;
    window.__HOLD_EARN = false; window.__UNCAPPED = true; window.__EPOCH = 8;
    const ok = await X.sellCrop('cabbage', true);
    return { mid, ok, inv: S.inventory.cabbage || 0, coins: S.coins, pol: X.policy() };
  });
  check('switching account before the first status drops the previous policy', sw.mid.acct === 'B' && sw.mid.pol.pending === true && sw.mid.pol.uncapped === false && sw.mid.soldB === false && sw.mid.coins === 3 && sw.mid.inv === 9, sw.mid);
  check('the new account sells only after its own status, and the first sale pays', sw.ok === true && sw.pol.uncapped === true && sw.pol.epoch === 8 && sw.inv === 0 && sw.coins === 12, sw);
  check('account-switch page had no uncaught error', errs.length === 0, errs);
  await ctx.close();
}

{
  const { ctx, p, errs } = await boot();
  const over = await p.evaluate(async () => {
    const X = TG_R9.sell;
    window.__DELAY_STATUS = false; window.__UNCAPPED = true; window.__EPOCH = 9; window.__LEFT = 100;
    S.inventory = { cabbage: 4 }; S.coins = Number.MAX_SAFE_INTEGER - 5; r6Daily().coinsEarned = 0;
    await X.probe();
    window.__HOLD_EARN = true;
    const saleP = X.sellCrop('cabbage', false);
    for (let i = 0; i < 40 && !window.__earnRelease; i++) await new Promise(r => setTimeout(r, 25));
    S.coins = Number.MAX_SAFE_INTEGER;
    const release = window.__earnRelease;
    window.__HOLD_EARN = false;
    window.__answer = () => ({ ok: true, granted: 1, sell_uncapped: true, sell_epoch: 9, sell_cap: 100, sell_left: 100, cap: 100, left: 100 });
    release();
    await saleP;
    await X.retryCrops();
    await X.retryCrops();
    openShop('sell');
    const held = { coins: S.coins, inv: S.inventory.cabbage || 0, pending: X.readPending('A').length, text: document.querySelector('#r9CropHold')?.textContent || '', btn: !!document.querySelector('#r9CropResume') };
    await X.retryCrops();
    const still = S.coins;
    S.coins = 10;
    await X.resumeCrops();
    return { held, still, after: { coins: S.coins, inv: S.inventory.cabbage || 0, pending: X.readPending('A').length } };
  });
  check('a grant that does not fit stops retrying and shows why, without adding coins', over.held.coins === Number.MAX_SAFE_INTEGER && over.held.inv === 3 && over.held.pending === 1 && /自动重试已停/.test(over.held.text) && over.held.btn === true && over.still === Number.MAX_SAFE_INTEGER, over.held);
  check('after coins are spent, one confirmation pays the reserved crop', over.after.coins === 11 && over.after.inv === 3 && over.after.pending === 0, over.after);
  check('overflow page had no uncaught error', errs.length === 0, errs);
  await ctx.close();
}

await br.close();
neu.srv.close();
const failed = results.filter(r => !r.ok);
fs.mkdirSync('/workspace/qa/r9g', { recursive: true });
fs.writeFileSync('/workspace/qa/r9g/first-status.json', JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length, results }, null, 2));
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length }, null, 2));
if (failed.length) process.exit(1);
