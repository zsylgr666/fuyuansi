// r9e compatibility. New page: true -> stale -> explicit false, no reload.
// Old published r9b page (git a328f7c index.html): null sell_left falls to shared 40;
// sell_cap/sell_left 100 keeps the old crop pool and does not touch coinsEarned.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
const require = createRequire('/workspace/qa/tools-node/package.json');
const { chromium } = require('playwright-core');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail).slice(0, 500) : ''); };

function serve(file) {
  const buf = fs.readFileSync(file);
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(buf); });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}/` })));
}
const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });

const neu = await serve('/workspace/v4/index.r9e.html');
{
  const p = await br.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.addInitScript(() => {
    window.__MODE = 'uncapped';
    window.TG_ECON = {
      earn(n, src, exact) {
        n = n | 0; src = src || 'sell';
        if (src === 'sell' && (window.__MODE === 'uncapped' || window.TG_R9?.sell?.policy?.().uncapped)) return n;
        if (src === 'sell') { const left = window.__SELL ?? 100; if (exact && n > left) return 0; const g = Math.min(n, left); window.__SELL = left - g; return g; }
        const left = window.__EARN ?? 40; if ((window.__EARN ?? 40) + 0, exact && n > left) return 0; const g = Math.min(n, left); window.__EARN = left - g; return g;
      },
      async status() {
        const base = { day: 'd', earn_left: window.__EARN ?? 40, merit_coins_left: 8, steal_left: 15, sellback_left: 400, sellback_cap: 400 };
        if (window.__MODE === 'uncapped') return Object.assign(base, { sell_uncapped: true, sell_cap: 100, sell_left: 100 });
        if (window.__MODE === 'stale') return Object.assign(base, { sell_cap: 100, sell_left: 0 });
        if (window.__MODE === 'rollback') return Object.assign(base, { sell_uncapped: false, sell_cap: 100, sell_left: window.__SELL ?? 100 });
        return base;
      },
      left(src) { if (src === 'sell' && window.TG_R9?.sell?.policy?.().uncapped) return null; if (src === 'sellback') return 400; if (src === 'sell') return window.__SELL ?? null; return window.__EARN ?? null; },
      async sellbackCredit() { return { ok: false, reason: 'offline' }; },
      async sellback() { return { ok: false, reason: 'offline' }; },
      async sellbackSeed() { return { ok: false, reason: 'offline' }; }
    };
  });
  await p.goto(neu.url);
  await p.waitForFunction(() => window.TG_R9?.sell?.version === 'r9e' && window.W3?.player, null, { timeout: 180000 });
  const flow = await p.evaluate(async () => {
    const X = TG_R9.sell;
    S.inventory = { cabbage: 400 }; S.coins = 100; r6Daily().sellCoins = 0; r6Daily().coinsEarned = 0;
    await X.probe();
    const afterTrue = { pol: X.policy(), cap: X.sellCap() };
    const sold = await X.sellCrop('cabbage', true);
    const afterSale = { sold, inv: S.inventory.cabbage || 0, coins: S.coins, earned: r6Daily().coinsEarned, pol: X.policy() };
    window.__MODE = 'stale'; window.__SELL = 0;
    await X.probe();
    const afterStale = { pol: X.policy(), cap: X.sellCap() };
    S.inventory.cabbage = 30;
    const soldStale = await X.sellCrop('cabbage', true);
    const mid = { soldStale, inv: S.inventory.cabbage || 0, coins: S.coins, pol: X.policy() };
    await new Promise(r => setTimeout(r, 200));
    window.__MODE = 'rollback'; window.__SELL = 100; r6Daily().sellCoins = 0;
    await X.probe();
    const beforeCap = X.sellCap();
    S.inventory.cabbage = 150;
    const soldBack = await X.sellCrop('cabbage', true);
    return { afterTrue, afterSale, afterStale, mid, afterRollback: { beforeCap, pol: X.policy(), cap: X.sellCap(), soldBack, inv: S.inventory.cabbage || 0, coins: S.coins, earned: r6Daily().coinsEarned, sellCoins: r6Daily().sellCoins } };
  });
  check('N1 uncapped true ignores the advertised 100 and sells the whole stack', flow.afterTrue.pol.uncapped === true && flow.afterSale.sold === true && flow.afterSale.inv === 0 && flow.afterSale.coins === 500 && flow.afterSale.earned === 0, flow.afterSale);
  check('N2 a stale numeric status does not restore the cap', flow.afterStale.pol.uncapped === true && flow.mid.soldStale === true && flow.mid.inv === 0, flow.mid);
  check('N3 explicit sell_uncapped false revokes unlimited with no reload', flow.afterRollback.pol.uncapped === false && flow.afterRollback.pol.mode === 'r9' && flow.afterRollback.soldBack === true && flow.afterRollback.inv === 50 && flow.afterRollback.earned === 0, flow.afterRollback);
  check('N4 new page had no uncaught error', errs.length === 0, errs);
  await p.close();
}
neu.srv.close();

const old = await serve('/tmp/index.r9b-site.html');
{
  const p = await br.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 240)));
  await p.addInitScript(() => {
    window.__SHAPE = 'null-left';
    window.__SELL = 100; window.__EARN = 40; window.__SB = 400; window.__CREDIT = { 'wood-table': 2 }; window.__LEDGER = {}; window.__DROP = 0;
    const listeners = [];
    window.TG_AUTH = { online: true, user: { id: 'old-user' }, userId: 'old-user', nickname: '旧', onChange(fn) { listeners.push(fn); }, ready: Promise.resolve(), client: { rpc(fn, args) { return Promise.resolve(window.TG_R6_RPC(fn, args)).then(data => ({ data, error: null })); } } };
    window.TG_R6_RPC = (fn, args) => {
      args = args || {};
      if (fn === 'econ_status') {
        const base = { day: 'd', earn_left: window.__EARN, earn_cap: 40, merit_coins_left: 8, steal_left: 15, steal_cap: 15, market_left: 500, market_cap: 500, crops: {}, sellback_cap: 400, sellback_left: window.__SB };
        if (window.__SHAPE === 'null-left') return Object.assign(base, { sell_uncapped: true, sell_cap: null, sell_left: null });
        return Object.assign(base, { sell_uncapped: true, sell_cap: 100, sell_left: window.__SELL });
      }
      if (fn === 'econ_earn') {
        const src = args.p_source || 'sell', coins = args.p_coins | 0;
        if (src === 'sell' && window.__SHAPE === 'compat') {
          if (args.p_exact && coins > window.__SELL) return { ok: false, granted: 0, reason: 'daily_cap', left: window.__SELL, cap: 100 };
          const g = Math.min(coins, window.__SELL); window.__SELL -= g; return { ok: true, granted: g, left: window.__SELL, cap: 100, sell_uncapped: true };
        }
        const left = src === 'steal' ? 15 : window.__EARN;
        if (args.p_exact && coins > left) return { ok: false, granted: 0, reason: 'daily_cap', left, cap: 40 };
        const g = Math.min(coins, left); if (src !== 'steal') window.__EARN -= g; return { ok: g > 0, granted: g, left: window.__EARN, cap: 40 };
      }
      if (fn === 'econ_sellback_credit') return { credit: window.__CREDIT, prices: { 'wood-table': 30 }, seeded: true, left: window.__SB };
      if (fn === 'econ_sellback') {
        window.__SB_CALLS = (window.__SB_CALLS || 0) + 1;
        const req = args.p_req;
        const total = 30 * (args.p_qty || 1);
        if (window.__HOLD_ERROR) {
          if (!window.__LEDGER[req]) { window.__CREDIT['wood-table']--; window.__SB -= total; window.__LEDGER[req] = { ok: true, granted: total, unit: 30, credit_left: window.__CREDIT['wood-table'], left: window.__SB, req }; }
          return { ok: false, reason: 'error', req };
        }
        if (window.__LEDGER[req]) return Object.assign({ replay: true }, window.__LEDGER[req]);
        if ((window.__CREDIT['wood-table'] || 0) < 1) return { ok: false, reason: 'no_credit', credit: 0, req };
        window.__CREDIT['wood-table']--; window.__SB -= total;
        const row = { ok: true, granted: total, unit: 30, credit_left: window.__CREDIT['wood-table'], left: window.__SB, req };
        window.__LEDGER[req] = row; return row;
      }
      if (fn === 'avatar_me') return { owned: [], catalog: [], avatar: {}, mounts: { owned: [] } };
      if (fn === 'lotus_status') return { day: 'd', koi_left: 3 };
      return { ok: false, reason: 'offline' };
    };
  });
  await p.goto(old.url);
  await p.waitForFunction(() => window.TG_R9?.sell?.version === 'r9b' && window.TG_ECON?.status && window.W3?.player, null, { timeout: 180000 });
  await p.evaluate(() => { const A = window.TG_AUTH; if (A) { A.online = true; A.user = { id: 'old-user' }; A.userId = 'old-user'; } });
  const bad = await p.evaluate(async () => {
    window.__SHAPE = 'null-left'; window.__EARN = 40; window.__SELL = 100;
    S.inventory = { melon: 10 }; S.coins = 50; const d = r6Daily(); d.coinsEarned = 0; d.sellCoins = 0;
    await TG_R9.sell.probe();
    const cap0 = document.querySelector('#r9SellCap')?.textContent || TG_R9.sell.sellCap();
    await TG_R9.sell.probe();
    openShop('sell');
    document.querySelector('[data-r9-sell-all="melon"]')?.click();
    return { mode: TG_R9.sell.mode, cap: TG_R9.sell.cap, line: document.querySelector('#r9SellCap')?.textContent, melon: S.inventory.melon, earned: r6Daily().coinsEarned, sell: r6Daily().sellCoins, coins: S.coins };
  });
  check('O1 old page + null sell_left falls onto the shared 40 and records coinsEarned', bad.mode !== 'r9' && bad.melon === 5 && bad.earned === 40 && bad.sell === 40, bad);
  const good = await p.evaluate(async () => {
    await new Promise(r => setTimeout(r, 200));
    window.__SHAPE = 'compat'; window.__EARN = 40; window.__SELL = 100;
    S.inventory = { melon: 20, cabbage: 10 }; S.coins = 50; const d = r6Daily(); d.date = '1999-01-01'; r6Daily();
    r6Daily().coinsEarned = 0; r6Daily().sellCoins = 0;
    await TG_R9.sell.probe();
    openShop('sell');
    document.querySelector('[data-r9-sell-all="melon"]')?.click();
    const mid = { mode: TG_R9.sell.mode, cap: TG_R9.sell.cap, melon: S.inventory.melon, earned: r6Daily().coinsEarned, sell: r6Daily().sellCoins, coins: S.coins, line: document.querySelector('#r9SellCap')?.textContent };
    document.querySelector('[data-r9-sell-all="cabbage"]')?.click();
    return { mid, melon: S.inventory.melon, cabbage: S.inventory.cabbage, earned: r6Daily().coinsEarned, sell: r6Daily().sellCoins, coins: S.coins };
  });
  check('O2 old page + numeric sell_left 100 sells past 40 and does not touch the task pool', good.mid.mode === 'r9' && good.mid.cap === 100 && good.mid.melon === 8 && good.mid.sell === 96 && good.mid.earned === 0 && good.mid.coins === 146, good);
  check('O3 old page still stops at its own 100', good.melon === 8 && good.cabbage === 6 && good.sell === 100 && good.earned === 0 && good.coins === 150, good);
  const lost = await p.evaluate(async () => {
    S.coins = 100; S.backpack['wood-table'] = 1; S.sellable = { 'wood-table': 1 }; S.sellSeeded = true; r6Daily().sellbackCoins = 0;
    window.__HOLD_ERROR = true; window.__LEDGER = {}; window.__CREDIT = { 'wood-table': 1 }; window.__SB = 400;
    TG_R9.sell.fb = 'server'; window.__SB_CALLS = 0;
    const before = { coins: S.coins, bp: S.backpack['wood-table'], fb: TG_R9.sell.fb };
    await TG_R9.sell.sellBack('wood-table');
    const mid = { coins: S.coins, bp: S.backpack['wood-table'], pend: (TG_R9.sell.pending() || []).length, fb: TG_R9.sell.fb, last: TG_R9.sell.last, calls: window.__SB_CALLS, why: TG_R9.sell.reasonOf('wood-table'), now: TG_R9.sell.sellableNow('wood-table') };
    window.__HOLD_ERROR = false;
    await TG_R9.sell.retryPending();
    return { before, mid, after: { coins: S.coins, bp: S.backpack['wood-table'], pend: (TG_R9.sell.pending() || []).length } };
  });
  check('O4 old page lost sell-back reply keeps the item, retry pays once', lost.mid.coins === lost.before.coins && lost.mid.bp === 1 && lost.mid.pend === 1 && lost.after.coins === lost.before.coins + 30 && lost.after.bp === 0 && lost.after.pend === 0, lost);
  check('O5 old page had no uncaught error', errs.length === 0, errs);
  await p.close();
}
old.srv.close();
await br.close();
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length }, null, 2));
fs.writeFileSync('/workspace/qa/r9e/compat-results.json', JSON.stringify({ results }, null, 1));
if (failed.length) process.exit(1);
