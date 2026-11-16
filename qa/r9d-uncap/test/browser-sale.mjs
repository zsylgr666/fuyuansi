// Reconstructed sale regression + uncapped crop hotfix.
// The original selltest (84 cases) was not in the archive or the git history.
// These cases re-check the behaviours described in qa/r9c/PROGRESS.md and the new ceiling rules.
// They are NOT the original 84 and must not be reported as that run.
import puppeteer from '/tmp/r9d-deps/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const root = process.env.SALE_TMP || '/tmp/r9d-sale-run';
fs.mkdirSync(root, { recursive: true });
const frozen = path.join(repo, 'v4/index.r9d.html');
const testHtml = path.join(root, 'sale-test.html');
const tg = fs.readFileSync(path.join(repo, 'backend/tg-r6.js'), 'utf8');
let html = fs.readFileSync(frozen, 'utf8');
if (!html.includes('</body>')) throw new Error('frozen html has no body');
html = html.replace('</body>', `<script>\n${tg}\n</script>\n</body>`);
fs.writeFileSync(testHtml, html);
fs.copyFileSync(frozen, path.join(root, 'index.html'));
fs.copyFileSync(path.join(repo, 'icon.svg'), path.join(root, 'icon.svg'));
fs.copyFileSync(path.join(repo, 'manifest.webmanifest'), path.join(root, 'manifest.webmanifest'));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const file = url.pathname === '/sale' ? testHtml : path.join(root, decodeURIComponent(url.pathname.replace(/^\//, '') || 'index.html'));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('missing'); return; }
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/plain';
    res.writeHead(200, { 'content-type': type });
    res.end(buf);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail == null ? '' : String(detail) });
  console.log(cond ? 'PASS' : 'FAIL', name, detail == null ? '' : detail);
}

function install(mode) {
  window.__ECON_MODE = mode;
  window.__LEDGER = {};
  window.__CALLS = [];
  window.__SB_CALLS = [];
  window.__SB = 400;
  window.__EARN = 40;
  window.__MERIT = 8;
  window.__SELL = 100;
  window.__CREDIT = { 'wood-table': 5 };
  window.__DROP = null;
  const listeners = [];
  window.__AUTH_LISTENERS = listeners;
  const auth = {
    online: true,
    user: { id: 'acct-a' },
    userId: 'acct-a',
    nickname: '甲',
    onChange(fn) { listeners.push(fn); },
    ready: Promise.resolve(),
    client: { rpc(fn, args) { return Promise.resolve(window.TG_R6_RPC(fn, args)).then(data => ({ data: data, error: null })); } }
  };
  window.TG_AUTH = auth;
  window.TG_R6_RPC = (fn, args) => window.__rpc(fn, args || {});
  window.__rpc = function (fn, args) {
    window.__CALLS.push(fn);
    const day = '2026-11-16';
    if (fn === 'econ_status') {
      const base = { day, earn_cap: 40, earn_left: window.__EARN, merit_coins_left: window.__MERIT, steal_cap: 15, steal_left: 15, market_cap: 500, market_left: 500, sellback_cap: 400, sellback_left: window.__SB, crops: {} };
      const modeNow = window.__ECON_MODE;
      if (modeNow === 'uncapped') return Object.assign(base, { sell_uncapped: true, sell_cap: null, sell_left: null });
      if (modeNow === 'legacy100' || modeNow === 'stale100') return Object.assign(base, { sell_cap: 100, sell_left: window.__SELL });
      if (modeNow === 'explicit-cap') return Object.assign(base, { sell_uncapped: false, sell_cap: 100, sell_left: window.__SELL });
      if (modeNow === 'old') return base;
      if (modeNow === 'offline') return { reason: 'offline' };
      return base;
    }
    if (fn === 'econ_earn') {
      const src = args.p_source || 'sell';
      const coins = args.p_coins | 0;
      if (src === 'sell' && (window.__ECON_MODE === 'uncapped' || window.TG_R9?.sell?.policy?.().uncapped)) {
        return { ok: true, granted: coins, left: null, cap: null, sell_uncapped: true };
      }
      if (src === 'sell' && (window.__ECON_MODE === 'legacy100' || window.__ECON_MODE === 'explicit-cap' || window.__ECON_MODE === 'stale100')) {
        if (args.p_exact && coins > window.__SELL) return { ok: false, granted: 0, reason: 'daily_cap', left: window.__SELL, cap: 100 };
        const g = Math.min(coins, window.__SELL);
        window.__SELL -= g;
        return { ok: g > 0, granted: g, left: window.__SELL, cap: 100 };
      }
      if (src === 'sell') {
        if (args.p_exact && coins > window.__EARN) return { ok: false, granted: 0, reason: 'daily_cap', left: window.__EARN, cap: 40 };
        const g = Math.min(coins, window.__EARN); window.__EARN -= g;
        return { ok: g > 0, granted: g, left: window.__EARN, cap: 40 };
      }
      if (src === 'task' || src === 'merit') {
        let g = Math.min(coins, window.__EARN);
        if (src === 'merit') g = Math.min(g, window.__MERIT);
        if (args.p_exact && g < coins) return { ok: false, granted: 0, reason: 'daily_cap', left: window.__EARN, cap: 40 };
        window.__EARN -= g; if (src === 'merit') window.__MERIT -= g;
        return { ok: g > 0, granted: g, left: window.__EARN, cap: 40 };
      }
      return { ok: false, reason: 'bad_source' };
    }
    if (fn === 'econ_sellback_credit') {
      return { credit: window.__CREDIT, prices: { 'wood-table': 30, bench: 15, cabinet: 50, daybed: 80, 'altar-table': 45, 'rocking-chair': 42, vase: 12, lantern: 20, bonsai: 27, screen: 40, cushion: 10 }, seeded: true, left: window.__SB };
    }
    if (fn === 'econ_sellback') {
      window.__SB_CALLS.push({ item: args.p_item, qty: args.p_qty, unit: args.p_unit, req: args.p_req });
      const req = args.p_req;
      if (window.__DROP === 'lose') {
        if (!window.__LEDGER[req]) {
          const u = 30, total = u * (args.p_qty || 1);
          window.__CREDIT[args.p_item] = (window.__CREDIT[args.p_item] || 0) - (args.p_qty || 1);
          window.__SB -= total;
          window.__LEDGER[req] = { ok: true, granted: total, unit: u, credit_left: window.__CREDIT[args.p_item], left: window.__SB };
        }
        return { ok: false, reason: 'error', req };
      }
      if (window.__DROP === 'error') return { ok: false, reason: 'error', req };
      if (window.__LEDGER[req]) return Object.assign({ replay: true }, window.__LEDGER[req]);
      const u = 30;
      if (args.p_unit != null && args.p_unit !== u && args.p_item === 'wood-table') return { ok: false, reason: 'price_changed', unit: u };
      const total = u * (args.p_qty || 1);
      const have = window.__CREDIT[args.p_item] || 0;
      if (have < (args.p_qty || 1)) return { ok: false, reason: 'no_credit', credit: have };
      if (window.__SB < total) return { ok: false, reason: 'daily_cap', left: window.__SB };
      window.__CREDIT[args.p_item] = have - (args.p_qty || 1);
      window.__SB -= total;
      const row = { ok: true, granted: total, unit: u, credit_left: window.__CREDIT[args.p_item], left: window.__SB };
      window.__LEDGER[req] = row;
      return row;
    }
    if (fn === 'lotus_status') return { day, koi_left: 3 };
    if (fn === 'avatar_me' || fn === 'avatar_mine') return { owned: [], catalog: [], avatar: {}, title: null, mounts: { owned: [] } };
    if (fn === 'merit_catalog' || fn === 'avatar_catalog') return { items: [], aliases: {}, owned: [], catalog: [] };
    return { ok: false, reason: 'offline' };
  };
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
});

async function newPage(mode) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(String(err && err.stack || err)));
  await page.evaluateOnNewDocument(install, mode);
  await page.goto(base + '/sale', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.TG_R9?.sell?.debugPatch && window.TG_ECON?.earn && window.r6Daily, { timeout: 60000 });
  page.__errors = errors;
  return page;
}

async function boot(page, mode) {
  return page.evaluate(async (mode) => {
    window.__ECON_MODE = mode;
    TG_R9.sell.debugPatch({ coins: 100, merit: 500, inventory: {}, sellApplied: [], backpack: { cushion: 1, vase: 1, 'wood-table': 1 }, sellable: { 'wood-table': 1 }, sellSeeded: true, daily: { coinsEarned: 0, sellCoins: 0, sellbackCoins: 0, meritCoins: 0 } });
    window.__SELL = 100; window.__EARN = 40; window.__MERIT = 8; window.__SB = 400;
    window.__LEDGER = {}; window.__SB_CALLS = []; window.__DROP = null;
    window.__CREDIT = { 'wood-table': 5 };
    const X = TG_R9.sell;
    X.confirmedUncapped = false; X.mode = '?'; X.cap = null; X.uncapped = false; X.serverLeft = null;
    await X.probe();
    return { mode: X.mode, cap: X.cap, uncapped: X.policy().uncapped, fb: X.fb, err: X.err || null };
  }, mode);
}

const page = await newPage('legacy100');
let bootInfo = await boot(page, 'legacy100');
check('legacy r9 probe keeps a numeric crop cap and does not invent uncapped', bootInfo.mode === 'r9' && bootInfo.cap === 100 && bootInfo.uncapped === false, JSON.stringify(bootInfo));

let sale = await page.evaluate(async () => {
  TG_R9.sell.debugPatch({ inventory: { cabbage: 150 } });
  const before = TG_R9.sell.debugState().coins;
  const ok = await TG_R9.sell.sellCrop('cabbage', true);
  const st = TG_R9.sell.debugState();
  return { ok, coins: st.coins - before, left: st.inventory.cabbage || 0, earned: st.daily.coinsEarned, sell: st.daily.sellCoins, cap: TG_R9.sell.sellCap() };
});
check('legacy sell-all is partial at the 100 coin cap (150 cabbage price 1)', sale.ok === true && sale.coins === 100 && sale.left === 50 && sale.earned === 0, JSON.stringify(sale));

sale = await page.evaluate(async () => {
  const before = TG_R9.sell.debugState().coins;
  const ok = await TG_R9.sell.sellCrop('cabbage', false);
  const st = TG_R9.sell.debugState();
  return { ok, coins: st.coins - before, left: st.inventory.cabbage || 0 };
});
check('legacy refuses another crop coin after the cap', sale.ok === false && sale.coins === 0 && sale.left === 50, JSON.stringify(sale));

bootInfo = await boot(page, 'uncapped');
check('uncapped probe clears the numeric cap', bootInfo.uncapped === true && bootInfo.cap == null && bootInfo.mode === 'uncapped', JSON.stringify(bootInfo));

sale = await page.evaluate(async () => {
  TG_R9.sell.debugPatch({ inventory: { cabbage: 150, melon: 40 } });
  const before = TG_R9.sell.debugState().coins; const earned = TG_R9.sell.debugState().daily.coinsEarned;
  const a = await TG_R9.sell.sellCrop('cabbage', true);
  const b = await TG_R9.sell.sellCrop('melon', true);
  const st = TG_R9.sell.debugState();
  const cap = document.createElement('div');
  openShop('sell');
  const text = document.querySelector('#r9SellCap')?.textContent || '';
  const furn = document.querySelector('#r9SbCap')?.textContent || '';
  return { a, b, coins: st.coins - before, cabbage: st.inventory.cabbage || 0, melon: st.inventory.melon || 0, earned: st.daily.coinsEarned, earnedBefore: earned, text, furn, pol: TG_R9.sell.policy() };
});
check('two large crop sales in one day pay in full (150 + 40*8 = 470) with no cap line',
  sale.a === true && sale.b === true && sale.coins === 470 && sale.cabbage === 0 && sale.melon === 0 && sale.earned === 0
  && sale.text.includes('没有每日') && !/\d+\s*\/\s*\d+/.test(sale.text) && /400/.test(sale.furn), JSON.stringify(sale));

sale = await page.evaluate(async () => {
  window.__ECON_MODE = 'stale100';
  window.__SELL = 0;
  await TG_R9.sell.probe();
  TG_R9.sell.debugPatch({ inventory: { cabbage: 80 } });
  const before = TG_R9.sell.debugState().coins;
  const ok = await TG_R9.sell.sellCrop('cabbage', true);
  const st = TG_R9.sell.debugState();
  return { ok, coins: st.coins - before, left: st.inventory.cabbage || 0, pol: TG_R9.sell.policy(), cap: TG_R9.sell.sellCap() };
});
check('after uncapped is confirmed, a stale sell_left/sell_cap 100 does not come back',
  sale.ok === true && sale.coins === 80 && sale.left === 0 && sale.pol.uncapped === true && sale.cap.uncapped === true, JSON.stringify(sale));

sale = await page.evaluate(async () => {
  const coinsBefore = TG_R9.sell.debugState().coins;
  let merit = 0;
  for (let i = 0; i < 8; i++) if (r5MeritCoins()) merit++;
  const ninth = r5MeritCoins();
  let tasks = 0;
  for (let i = 0; i < 5; i++) if (r6EarnCoins(8, 'task', true)) tasks++;
  const over = r6EarnCoins(1, 'task', true);
  const st = TG_R9.sell.debugState();
  return { merit, ninth, tasks, over, earned: st.daily.coinsEarned, coins: st.coins - coinsBefore, sellback: st.daily.sellbackCoins };
});
check('merit stops at 8 and task/merit pool stops at 40 after uncapped crop sales',
  sale.merit === 8 && sale.ninth === false && sale.earned === 40 && sale.over === false && sale.coins === 40, JSON.stringify(sale));

sale = await page.evaluate(async () => {
  const X = TG_R9.sell, bad = {};
  X.debugPatch({ coins: 100, inventory: { cabbage: 0 } });
  bad.zero = await X.sellCrop('cabbage', true);
  X.debugPatch({ inventory: { cabbage: -3 } });
  bad.neg = await X.sellQty('cabbage', 1);
  const negLeft = X.debugState().inventory.cabbage;
  X.debugPatch({ inventory: { cabbage: 2.5 } });
  bad.frac = await X.sellQty('cabbage', 1);
  const fracLeft = X.debugState().inventory.cabbage;
  X.debugPatch({ inventory: { cabbage: 2 } });
  bad.excess = await X.sellQty('cabbage', 5);
  const exLeft = X.debugState().inventory.cabbage;
  X.debugPatch({ coins: Number.MAX_SAFE_INTEGER, inventory: { cabbage: 2 } });
  bad.unsafe = await X.sellQty('cabbage', 2);
  const st = X.debugState();
  X.debugPatch({ coins: 100 });
  return { bad, negLeft, fracLeft, exLeft, unsafeLeft: st.inventory.cabbage, coins: st.coins };
});
check('zero, negative, fractional, excess and unsafe coin totals are rejected',
  sale.bad.zero === false && sale.bad.neg === false && sale.negLeft === -3
  && sale.bad.frac === false && sale.fracLeft === 2.5
  && sale.bad.excess === false && sale.exLeft === 2
  && sale.bad.unsafe === false && sale.unsafeLeft === 2 && sale.coins === Number.MAX_SAFE_INTEGER, JSON.stringify(sale));

sale = await page.evaluate(async () => {
  TG_R9.sell.debugPatch({ coins: 100, inventory: { cabbage: 10 } });
  const orig = TG_ECON.earn;
  TG_ECON.earn = function (n, source, exact) {
    if (source === 'sell') TG_R9.sell.debugPatch({ inventory: { cabbage: 4 } });
    return orig.call(this, n, source, exact);
  };
  const before = TG_R9.sell.debugState().coins;
  const ok = await TG_R9.sell.sellCrop('cabbage', true);
  TG_ECON.earn = orig;
  const st = TG_R9.sell.debugState();
  return { ok, coins: st.coins, inv: st.inventory.cabbage, before };
});
check('sell-all aborts when inventory shrinks during the sale and does not keep the coins',
  sale.ok === false && sale.coins === 100 && sale.inv === 4, JSON.stringify(sale));

sale = await page.evaluate(async () => {
  TG_R9.sell.debugPatch({ backpack: { cushion: 1, vase: 1, 'wood-table': 20 }, sellable: { 'wood-table': 20 }, sellSeeded: true, daily: { sellbackCoins: 0 } });
  window.__CREDIT = { 'wood-table': 20 }; window.__SB = 400; window.__LEDGER = {}; window.__DROP = null; window.__SB_CALLS = [];
  TG_R9.sell.fb = 'server'; TG_R9.sell.credit = { 'wood-table': 20 }; TG_R9.sell.sbLeft = 400; TG_R9.sell.prices = { 'wood-table': 30 };
  let sold = 0, blocked = false, coins = 0;
  for (let i = 0; i < 16; i++) {
    const before = TG_R9.sell.debugState().coins;
    await TG_R9.sell.sellBack('wood-table');
    const now = TG_R9.sell.debugState().coins;
    if (now > before) { sold++; coins += now - before; }
    else { blocked = true; break; }
  }
  return { sold, blocked, coins, sb: TG_R9.sell.debugState().daily.sellbackCoins, left: window.__SB, backpack: TG_R9.sell.debugState().backpack['wood-table'] };
});
check('furniture buy-back still stops at 400 (13 * 30 = 390, 14th blocked)',
  sale.sold === 13 && sale.blocked === true && sale.coins === 390 && sale.sb === 390, JSON.stringify(sale));

sale = await page.evaluate(async () => {
  const X = TG_R9.sell;
  localStorage.removeItem('templeGarden.r9.sellbackPending.acct-a');
  localStorage.removeItem('templeGarden.r9.sellbackPending');
  X.debugPatch({ coins: 100, backpack: { cushion: 1, vase: 1, 'wood-table': 1 }, sellable: { 'wood-table': 1 }, sellSeeded: true, daily: { sellbackCoins: 0 } });
  window.__CREDIT = { 'wood-table': 2 }; window.__SB = 400; window.__LEDGER = {}; window.__DROP = 'lose'; window.__SB_CALLS = [];
  X.fb = 'server'; X.credit = { 'wood-table': 2 }; X.prices = { 'wood-table': 30 }; X.sbLeft = 400; X.busy = false;
  const before = X.debugState().coins;
  await X.sellBack('wood-table');
  const mid = { coins: X.debugState().coins - before, pending: X.pending().length, calls: window.__SB_CALLS.length };
  window.__DROP = null;
  await X.retryPending();
  const after = { coins: X.debugState().coins - before, pending: X.pending().length, calls: window.__SB_CALLS.map(c => c.req) };
  await X.retryPending();
  const req = after.calls[0];
  localStorage.setItem('templeGarden.r9.sellbackPending.acct-a', JSON.stringify([{ id: 'wood-table', qty: 1, unit: 30, req, at: Date.now(), acct: 'acct-a' }]));
  await X.retryPending();
  return { mid, after, coins: X.debugState().coins - before, pending: X.pending().length, sameReq: after.calls.every(r => r === req), calls: window.__SB_CALLS.length };
});
check('lost sell-back response retries the same request id and does not pay twice',
  sale.mid.coins === 0 && sale.mid.pending === 1 && sale.mid.calls >= 2 && sale.after.coins === 30 && sale.coins === 30 && sale.pending === 0 && sale.sameReq, JSON.stringify(sale));

sale = await page.evaluate(async () => {
  const keyA = 'templeGarden.r9.sellbackPending.acct-a';
  const legacy = 'templeGarden.r9.sellbackPending';
  localStorage.removeItem(keyA);
  localStorage.setItem(legacy, JSON.stringify([{ id: 'wood-table', qty: 1, unit: 30, req: 'sell-legacy01', at: Date.now() }]));
  TG_R9.sell.debugPatch({ backpack: { cushion: 1, vase: 1, 'wood-table': 1 }, sellable: { 'wood-table': 1 } });
  const list = TG_R9.sell.pending();
  const moved = localStorage.getItem(legacy) == null && !!localStorage.getItem(keyA);
  window.__SB_CALLS = [];
  TG_AUTH.userId = 'acct-b'; TG_AUTH.user.id = 'acct-b';
  const other = TG_R9.sell.pending();
  await TG_R9.sell.retryPending();
  const takeBefore = TG_R9.sell.debugState().backpack['wood-table'];
  const tookOther = window.TG_INV_TAKE('decor', 'wood-table', 1);
  TG_R9.sell.debugPatch({ backpack: { cushion: 1, vase: 1, 'wood-table': 1 } });
  TG_AUTH.userId = 'acct-a'; TG_AUTH.user.id = 'acct-a';
  const mine = TG_R9.sell.pending().map(p => p.req);
  const tookOwn = window.TG_INV_TAKE('decor', 'wood-table', 1);
  return { list: list.map(p => p.req), moved, other: other.length, tookOther, tookOwn, takeBefore, mine, replayed: window.__SB_CALLS.length, hooked: window.__AUTH_LISTENERS.length > 0 };
});
check('pending records stay on their account; the other account is not locked and legacy key migrates once',
  sale.moved && sale.list.includes('sell-legacy01') && sale.other === 0 && sale.mine.includes('sell-legacy01') && sale.tookOther === true && sale.tookOwn === false && sale.replayed === 0 && sale.hooked, JSON.stringify(sale));

sale = await page.evaluate(() => {
  TG_AUTH.userId = 'acct-a'; TG_AUTH.user.id = 'acct-a';
  localStorage.setItem('templeGarden.r9.sellbackPending.acct-a', JSON.stringify([{ id: 'wood-table', qty: 1, unit: 30, req: 'sell-offline1', at: Date.now(), acct: 'acct-a' }]));
  TG_AUTH.online = false;
  TG_R9.sell.fb = 'server';
  openShop('sell');
  const offline = document.querySelector('#r9SbPend')?.textContent || '';
  TG_AUTH.online = true;
  openShop('sell');
  const online = document.querySelector('#r9SbPend')?.textContent || '';
  return { offline, online, pending: TG_R9.sell.pending().length };
});
check('offline and online pending copy stays account-specific',
  sale.offline.includes('没有联网') && sale.online.includes('确认') && !sale.online.includes('没有联网'), JSON.stringify(sale));

// two tabs, one shared profile
const context = await browser.createBrowserContext();
await context.evaluateOnNewDocument ? null : null;
const pageA = await context.newPage();
const pageB = await context.newPage();
for (const p of [pageA, pageB]) await p.evaluateOnNewDocument(install, 'uncapped');
await Promise.all([pageA.goto(base + '/sale', { waitUntil: 'load', timeout: 120000 }), pageB.goto(base + '/sale', { waitUntil: 'load', timeout: 120000 })]);
await pageA.waitForFunction(() => window.TG_R9?.sell?.debugPatch, { timeout: 60000 });
await pageB.waitForFunction(() => window.TG_R9?.sell?.debugPatch, { timeout: 60000 });
const req = 'sell-twotab01';
await pageA.evaluate((req) => {
  localStorage.setItem('templeGarden.r9.sellbackPending.acct-a', JSON.stringify([{ id: 'wood-table', qty: 1, unit: 30, req, at: Date.now(), acct: 'acct-a' }]));
}, req);
const prep = (req) => page => page.evaluate(async (req) => {
  TG_R9.sell.debugPatch({ coins: 100, backpack: { cushion: 1, vase: 1, 'wood-table': 1 }, sellable: { 'wood-table': 1 }, sellSeeded: true, sellApplied: [] });
  window.__CREDIT = { 'wood-table': 1 }; window.__SB = 400; window.__LEDGER = {}; window.__DROP = null;
  TG_R9.sell.fb = 'server'; TG_R9.sell.credit = { 'wood-table': 1 }; TG_R9.sell.prices = { 'wood-table': 30 };
  TG_AUTH.userId = 'acct-a';
  return TG_R9.sell.pending().some(p => p.req === req);
}, req);
check('both tabs see the same pending request', (await prep(req)(pageA)) && (await prep(req)(pageB)));
await Promise.all([pageA.evaluate(() => TG_R9.sell.retryPending()), pageB.evaluate(() => TG_R9.sell.retryPending())]);
const coinsA = await pageA.evaluate(() => TG_R9.sell.debugState().coins);
const coinsB = await pageB.evaluate(() => TG_R9.sell.debugState().coins);
check('two tabs crediting one request id pay exactly once', (coinsA === 130 && coinsB === 100) || (coinsA === 100 && coinsB === 130), JSON.stringify({ coinsA, coinsB }));

await context.close();

// fresh load of a rolled-back server must honour 100 again
const rolled = await newPage('legacy100');
const rolledBoot = await boot(rolled, 'legacy100');
sale = await rolled.evaluate(async () => {
  TG_R9.sell.debugPatch({ inventory: { cabbage: 130 } });
  const ok = await TG_R9.sell.sellCrop('cabbage', true);
  const st = TG_R9.sell.debugState();
  return { ok, left: st.inventory.cabbage || 0, coins: st.coins };
});
check('a new page load against the rolled-back server applies 100 again',
  rolledBoot.uncapped === false && rolledBoot.cap === 100 && sale.ok === true && sale.left === 30, JSON.stringify({ rolledBoot, sale }));

// explicit sell_uncapped:false is the in-session recap, distinct from a stale numeric payload
sale = await page.evaluate(async () => {
  window.__ECON_MODE = 'explicit-cap';
  window.__SELL = 100;
  TG_R9.sell.debugPatch({ coins: 100, inventory: {}, daily: { sellCoins: 0, coinsEarned: 0 } });
  TG_R9.sell.confirmedUncapped = true;
  await TG_R9.sell.probe();
  TG_R9.sell.debugPatch({ inventory: { cabbage: 130 } });
  const ok = await TG_R9.sell.sellCrop('cabbage', true);
  const st = TG_R9.sell.debugState();
  return { ok, left: st.inventory.cabbage || 0, pol: TG_R9.sell.policy() };
});
check('explicit sell_uncapped false restores the numeric cap in the same session',
  sale.pol.uncapped === false && sale.pol.mode === 'r9' && sale.ok === true && sale.left === 30, JSON.stringify(sale));

const errors = page.__errors.concat(rolled.__errors || []);
check('sale pages produced no uncaught exception', errors.length === 0, errors.join('\n').slice(0, 500));

// smoke: frozen self-contained game, two viewports, 9 scenes
const scenes = ['gate', 'plaza', 'market', 'yard', 'lotus', 'hall', 'zen', 'study', 'tea'];
const smoke = [];
for (const [w, h] of [[390, 844], [844, 390]]) {
  const sp = await browser.newPage();
  const serr = [];
  sp.on('pageerror', e => serr.push(String(e)));
  await sp.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await sp.goto(base + '/index.html', { waitUntil: 'load', timeout: 120000 });
  await sp.waitForFunction(() => window.W3?.renderer && window.go, { timeout: 60000 }).catch(() => {});
  const ready = await sp.evaluate(() => ({ has: !!window.W3?.renderer, fail: !!document.querySelector('#webglFail.show'), err: window.W3 ? null : 'no world' }));
  if (!ready.has) {
    smoke.push({ viewport: `${w}x${h}`, blocked: true, ready, errors: serr });
    await sp.close();
    continue;
  }
  const frames = [];
  for (const id of scenes) {
    const row = await sp.evaluate(async (id) => {
      const errs = [];
      try { await go(id, true); } catch (e) { errs.push(String(e)); }
      await new Promise(r => setTimeout(r, 400));
      let calls = null;
      await new Promise(r => requestAnimationFrame(() => { calls = W3?.renderer?.info?.render?.calls ?? null; r(); }));
      return { id, calls, current: document.querySelector('.scene.active')?.id || null, errs, title: document.querySelector('#sceneTitle')?.textContent || '' };
    }, id);
    frames.push(row);
  }
  smoke.push({ viewport: `${w}x${h}`, blocked: false, frames, errors: serr });
  await sp.close();
}
const smokeOk = smoke.every(s => !s.blocked && s.errors.length === 0 && s.frames.every(f => f.current === f.id && typeof f.calls === 'number' && f.calls > 0 && f.calls <= 150 && f.errs.length === 0));
check('smoke 9 scenes at 390x844 and 844x390, settled draw calls between 1 and 150', smokeOk, JSON.stringify(smoke));

await browser.close();
server.close();
const failed = results.filter(r => !r.ok);
fs.writeFileSync(path.join(root, 'test-results.json'), JSON.stringify({ results, smoke, failed: failed.length }, null, 2));
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length }, null, 2));
if (failed.length) process.exit(1);
