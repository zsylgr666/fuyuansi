// Entry-frame draw peaks for frozen v4/index.r9d.html.
// Adapted from qa/r9c/smoke-r9c.mjs section 3/3b only: no pack, no freeze, the frozen file is served read-only.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const BUILD = process.env.BUILD || '/workspace/v4/index.r9d.html';
const OUT = '/workspace/qa/r9c/out/smoke-r9d-entry.json';
const shaOf = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const before = { sha256: shaOf(BUILD), size: fs.statSync(BUILD).size };
const require = createRequire('/workspace/qa/tools-node/package.json');
const { chromium } = require('playwright-core');
const buf = fs.readFileSync(BUILD);
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(buf); }).listen(0, '127.0.0.1');
await new Promise(r => srv.on('listening', r));
const URL = `http://127.0.0.1:${srv.address().port}/`;
const SCENES = ['plaza', 'gate', 'hall', 'yard', 'zen', 'study', 'market', 'tea', 'lotus'];
const VPS = { portrait: { width: 390, height: 844 }, landscape: { width: 844, height: 390 } };
const br = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ignore = /AudioContext|autoplay|supabase\.co|ERR_FAILED|Failed to load resource|net::|GPU stall|WebGL: |ERR_BLOCKED/i;
const report = { build: BUILD, before, smoke: {} };
let errTotal = 0;
try {
  for (const [vn, vp] of Object.entries(VPS)) {
    const ctx = await br.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await ctx.route(u => !String(u).startsWith(URL), r => r.abort());
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('templeGarden.nickname')) localStorage.setItem('templeGarden.nickname', 'smoke'); } catch (e) {} window.TG_BACKEND_CONFIG = Object.assign({ publicRoomSuffix: '~test' }, window.TG_BACKEND_CONFIG || {}); });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !ignore.test(m.text())) errs.push('console: ' + m.text()); });
    p.on('dialog', d => d.dismiss());
    await p.goto(URL);
    await p.waitForFunction(() => window.W3?.player && W3.active, null, { timeout: 180000 });
    await p.evaluate(() => { try { S.unlocked = true; closeModal(); } catch (e) {} });
    const r = {};
    for (const n of SCENES) {
      const e0 = errs.length;
      const entry600 = await p.evaluate(async n => {
        await go(n, true);
        await new Promise(r => setTimeout(r, 600));
        const w = W3, R = w.renderer, out = [];
        const y0 = w.yaw;
        for (const dy of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) {
          w.yaw = y0 + dy;
          try { worldCamera(1); } catch (e) {}
          R.info.reset();
          R.render(w.scene, w.camera);
          out.push(R.info.render.calls);
        }
        w.yaw = y0;
        try { worldCamera(1); } catch (e) {}
        return out;
      }, n);
      await p.waitForTimeout(1900);
      const stable = await p.evaluate(() => {
        const w = W3, R = w.renderer;
        R.info.autoReset = false; R.info.reset(); R.render(w.scene, w.camera);
        const c = R.info.render.calls; R.info.autoReset = true;
        return { active: w.active, calls: c };
      });
      r[n] = { ...stable, errors: errs.slice(e0), entry600, entry600Max: Math.max(...entry600) };
      console.log(vn, n, 'stable', r[n].calls, 'entry600', JSON.stringify(entry600), 'errors', r[n].errors.length);
    }
    r.errorsTotal = errs.length;
    errTotal += errs.length;
    report.smoke[vn] = r;
    await ctx.close();
  }
} finally {
  await br.close();
  srv.close();
}
const stableCalls = Object.values(report.smoke).flatMap(r => SCENES.map(n => r[n]?.calls || 0));
const entryMaxes = Object.values(report.smoke).flatMap(r => SCENES.map(n => r[n]?.entry600Max || 0));
report.smoke.maxStable = Math.max(...stableCalls);
report.smoke.maxEntry600 = Math.max(...entryMaxes);
report.smoke.errors = errTotal;
report.after = { sha256: shaOf(BUILD), size: fs.statSync(BUILD).size };
report.frozenUntouched = report.before.sha256 === report.after.sha256 && report.before.size === report.after.size;
fs.mkdirSync('/workspace/qa/r9c/out', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log('errors', errTotal, 'max stable', report.smoke.maxStable, 'max entry600', report.smoke.maxEntry600, 'frozen untouched', report.frozenUntouched);
if (errTotal || !report.frozenUntouched || report.smoke.maxEntry600 > 150 || report.smoke.maxStable > 150) process.exit(1);
