import * as THREE from 'three';
import { World } from './world.js';
import { Plots, plotPos } from './plots.js';
import { Game } from './game.js';
import { UI, autoQuality, fmtDur } from './ui.js';
import { audio } from './audio.js';
import { CROP, STAGE_NAMES, TOOLS } from './data.js';
import { produceGroup } from './crops3d.js';
import { icon } from './icons.js';

const $ = (s) => document.querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const POS = Array.from({ length: 16 }, (_, i) => plotPos(i));

const splash = $('#splash');
const startBtn = $('#startBtn');
const fatal = $('#fatal');

let game;
let world;
let plots;
let ui;
let started = false;
let painting = false;
let toastOk = true;
const actedAt = new Array(16).fill(0);

function boot() {
  try {
    game = new Game();
    world = new World($('#scene'));
    if (!world.renderer.getContext()) throw new Error('no webgl');
    const q = game.s.settings.quality;
    world.setQuality(q === 'auto' ? autoQuality() : q);
    plots = new Plots(world);
    ui = new UI(game, world);
    ui.setThumbs(makeThumbs());
    ui.onPlant = (i, id) => doPlant(i, id);
    ui.onUnlock = (i) => doUnlock(i);
    ui.onHarvestAll = () => harvestAll();
    game.on('levelup', (info) => {
      audio.play('levelup');
      ui.confetti(170);
      ui.queueLevel(info);
      saveSoon();
    });
    game.on('thief', onThief);
    game.on('rain', onRain);
    game.on('tut', () => ui.syncHint());
    startBtn.disabled = false;
    startBtn.textContent = game.fresh ? '开始种田' : '继续游戏';
    bindInput();
    requestAnimationFrame(frame);
  } catch (err) {
    console.error(err);
    splash.hidden = true;
    fatal.hidden = false;
  }
}

function makeThumbs() {
  const out = {};
  const size = 160;
  const rt = new THREE.WebGLRenderTarget(size, size);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
  cam.position.set(1.35, 1.05, 1.7);
  cam.lookAt(0, 0.12, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 1.35));
  const sun = new THREE.DirectionalLight(0xfff4dd, 2.4);
  sun.position.set(2.5, 4, 2);
  scene.add(sun);
  const renderer = world.renderer;
  const prev = renderer.getRenderTarget();
  const clear = new THREE.Color();
  renderer.getClearColor(clear);
  const alpha = renderer.getClearAlpha();
  const buf = new Uint8Array(size * size * 4);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  try {
    renderer.setClearColor(0x000000, 0);
    for (const def of Object.values(CROP)) {
      const g = produceGroup(def.id);
      scene.add(g);
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
      scene.remove(g);
      g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (let y = 0; y < size; y++) {
        const row = (size - 1 - y) * size;
        for (let x = 0; x < size; x++) {
          const s = (row + x) * 4;
          const d = (y * size + x) * 4;
          img.data[d] = buf[s];
          img.data[d + 1] = buf[s + 1];
          img.data[d + 2] = buf[s + 2];
          img.data[d + 3] = buf[s + 3];
        }
      }
      ctx.putImageData(img, 0, 0);
      out[def.id] = canvas.toDataURL('image/png');
    }
  } catch (err) {
    console.warn('thumbs', err);
  } finally {
    renderer.setRenderTarget(prev);
    renderer.setClearColor(clear, alpha);
    rt.dispose();
  }
  return out;
}

startBtn.addEventListener('click', () => {
  if (started || !world) return;
  started = true;
  audio.sfxOn = game.s.settings.sound;
  audio.musicOn = game.s.settings.music;
  audio.init();
  world.startIntro();
  world.setSign(game.s.name, '欢迎光临');
  ui.show();
  game.save();
  splash.classList.add('out');
  splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  if (game.welcome) setTimeout(() => { if (started) ui.open('back', false); }, 2400);
});

let last = performance.now();
let saveT = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000 || 0);
  last = t;
  const now = Date.now();
  if (started) game.tick(now);
  try {
    plots.sync(game.viewModels(now));
    plots.update(dt, t / 1000);
    world.update(dt, t / 1000);
  } catch (err) {
    console.error(err);
    if (world.quality !== 'low') world.setQuality('low');
  }
  if (started) {
    if (hover && !gesture) {
      hover.i = pickPlot(hover.x, hover.y);
      plots.setHover(hover.i, hoverKind(hover.i));
      ui.showTip(hover.i, hover.x, hover.y);
    }
    ui.update(dt, now);
    audio.setAmbience(dt, world.night, world.rain);
    if (now - saveT > 8000) { saveT = now; game.save(); }
  }
  requestAnimationFrame(frame);
}

function saveSoon() {
  clearTimeout(saveSoon.t);
  saveSoon.t = setTimeout(() => game.save(), 350);
}

function playing() {
  return started && !ui.locked;
}

function fail(msg, shop) {
  audio.play('error');
  if (toastOk && msg) {
    ui.toast(msg, 'bad');
    toastOk = false;
    if (shop) ui.pulseShop();
  }
}
function done() {
  plots.sync(game.viewModels(Date.now()));
  saveSoon();
  ui.syncHint();
}

function doHarvest(i) {
  const r = game.harvest(i, Date.now());
  if (!r.ok) return fail(r.msg);
  const pos = POS[i];
  world.fx.play('harvest', pos, { colors: [r.crop.color, '#fff6d0'] });
  plots.views[i].bounce();
  audio.play('harvest');
  ui.floatAt(i, `<img src="${ui.thumb(r.crop.id)}" alt="">+${r.n}`, r.bumper ? 'gold big' : 'gold', 1.5);
  ui.floatAt(i, `${icon('star')}+${r.xp}`, 'green', 0.85);
  ui.flyFrom(i, `<img src="${ui.thumb(r.crop.id)}" alt="">`, '#side [data-open="barn"]', 1.4);
  if (r.bumper) ui.toast(`${r.crop.name}大丰收！×${r.n}`, 'gold', 'basket');
  else if (game.s.plots[i].state === 'growing') ui.toast(`${r.crop.name}还能再收一茬`, 'good', 'sprout');
  done();
}
function doPlant(i, id) {
  const r = game.plant(i, id, Date.now());
  if (!r.ok) return fail(r.msg, r.shop);
  world.fx.play('plant', POS[i]);
  plots.views[i].bounce();
  audio.play('plant');
  ui.floatAt(i, `${icon('star')}+1`, 'green', 0.9);
  done();
}
function doClear(i) {
  const r = game.clear(i);
  if (!r.ok) return fail(r.msg);
  world.fx.play('shovel', POS[i]);
  plots.views[i].bounce();
  audio.play('shovel');
  ui.floatAt(i, `${icon('star')}+2`, 'green');
  done();
}
function doCare(i, kind) {
  const r = game.care(i, kind);
  if (!r.ok) return fail(r.msg);
  world.fx.play(kind, POS[i]);
  plots.views[i].bounce();
  audio.play(kind);
  ui.floatAt(i, `${icon('star')}+2`, 'green');
  done();
}
function doFert(i, type) {
  const r = game.fertilize(i, type, Date.now());
  if (!r.ok) return fail(r.msg, r.shop);
  world.fx.play('fert', POS[i]);
  plots.views[i].bounce();
  audio.play('fert');
  ui.floatAt(i, type === 'superFert' ? '瞬间成熟' : '长了一截', 'gold', 1.4);
  done();
}
function doUnlock(i) {
  const r = game.unlock(i);
  if (!r.ok) return fail(r.msg);
  world.fx.play('unlock', POS[i]);
  plots.views[i].bounce();
  audio.play('unlock');
  ui.floatAt(i, '开垦完成', 'gold', 1.1);
  ui.confetti(50);
  done();
}
function doSteal(i) {
  const r = game.steal(i, Date.now());
  if (!r.ok) return fail(r.msg);
  const nb = game.visiting.nb;
  if (r.bitten) {
    world.dogRun(POS[i], () => {});
    world.fx.play('bite', POS[i]);
    audio.play('bite');
    ui.toast(`被${nb.dogName}咬了一口，赔了 ${r.loss} 金币`, 'bad', 'dog');
    ui.floatAt(i, `${icon('coin')}-${r.loss}`, 'red', 1.3);
  } else {
    world.fx.play('steal', POS[i], { colors: [r.crop.color, '#fff'] });
    plots.views[i].bounce();
    audio.play('steal');
    ui.floatAt(i, `<img src="${ui.thumb(r.crop.id)}" alt="">+${r.n}`, 'purple', 1.45);
    ui.flyFrom(i, `<img src="${ui.thumb(r.crop.id)}" alt="">`, '#side [data-open="barn"]');
    ui.toast(`从${nb.name}家摸走 ${r.n} 个${r.crop.name}`, 'purple', 'hand');
  }
  done();
}
function doHelp(i, kind) {
  const r = game.help(i, kind, Date.now());
  if (!r.ok) return fail(r.msg);
  world.fx.play(r.kind, POS[i]);
  plots.views[i].bounce();
  audio.play(r.kind);
  ui.floatAt(i, `${icon('coin')}+${r.coins}`, 'gold', 1.35);
  ui.floatAt(i, `${icon('star')}+${r.xp}`, 'green', 0.8);
  done();
}

function act(i, mode) {
  if (!playing() || i < 0) return;
  const now = Date.now();
  if (now - actedAt[i] < 240) return;
  actedAt[i] = now;
  const p = game.plots[i];
  const tool = ui.tool;
  if (!game.visiting && !p.unlocked) {
    if (mode === 'primary' || tool === 'hand') ui.popUnlock(i);
    else fail('这块地还没开垦');
    return;
  }
  if (mode === 'primary' || tool === 'hand') return primary(i, mode !== 'paint');
  if (tool === 'seed') {
    if (p.state !== 'empty') return fail(p.state === 'withered' ? '先用铲子把枯萎的植株铲掉' : '这里已经种上啦');
    return doPlant(i, ui.seedId);
  }
  if (tool === 'shovel') return game.visiting ? fail('别人的地不能铲') : doClear(i);
  if (tool === 'fert') return game.visiting ? fail('肥料留着自己用吧') : doFert(i, ui.fertId);
  if (tool === 'water' || tool === 'weed' || tool === 'bug') {
    return game.visiting ? doHelp(i, tool) : doCare(i, tool);
  }
}
function primary(i, allowPop) {
  const now = Date.now();
  const p = game.plots[i];
  if (game.visiting) {
    if (game.canSteal(i, now)) return doSteal(i);
    const k = game.firstProblem(p);
    if (k) return doHelp(i, k);
    return fail('这块地现在没什么可做的');
  }
  if (p.state === 'withered') return doClear(i);
  if (p.state === 'empty') {
    if (allowPop) ui.popSeed(i);
    return;
  }
  if (game.isMature(p, now)) return doHarvest(i);
  const k = game.firstProblem(p);
  if (k) return doCare(i, k);
  if (allowPop) {
    const def = CROP[p.crop];
    ui.toast(`${def.name} · ${STAGE_NAMES[game.stage(p, now)]} · 还要 ${fmtDur(game.remaining(p, now))}`, '', 'sprout');
  }
}

let harvesting = false;
async function harvestAll() {
  if (harvesting || game.visiting || !playing()) return;
  const ids = game.s.plots.map((p, i) => (game.isMature(p, Date.now()) ? i : -1)).filter((i) => i >= 0);
  if (!ids.length) return;
  harvesting = true;
  toastOk = true;
  for (const i of ids) {
    doHarvest(i);
    await wait(75);
  }
  harvesting = false;
}

function onThief(ev) {
  const pos = POS[ev.plot];
  if (ev.caught) {
    world.dogRun(pos, () => {
      audio.play('bark');
      world.fx.play('bite', pos);
      ui.toast(`旺财赶跑了${ev.nb.name}，你捡到 ${ev.reward} 金币`, 'good', 'dog');
      ui.floatAt(ev.plot, `${icon('coin')}+${ev.reward}`, 'gold', 1.2);
    });
  } else {
    ui.toast(`${ev.nb.name}偷走了 ${ev.n} 个${ev.crop.name}`, 'bad', 'hand');
    ui.floatAt(ev.plot, `-${ev.n}`, 'red', 1.3);
    world.dogRun(pos, () => audio.play('bark'));
  }
  saveSoon();
}
function onRain(ev) {
  world.setRain(ev.on);
  if (!started) return;
  if (ev.on) {
    audio.play('water');
    ui.toast(ev.watered ? `下雨了，${ev.watered} 块旱地被浇透` : '下雨了', 'good', 'rain');
  } else ui.toast('雨停了，天又亮堂起来', '', 'sun');
}

function hoverKind(i) {
  if (i < 0) return null;
  const p = game.plots[i];
  const now = Date.now();
  const tool = ui.tool;
  if (!p.unlocked) {
    if (game.visiting) return 'bad';
    const n = game.nextUnlock();
    if (!n || n.idx !== i) return 'bad';
    return game.s.level >= n.req.lv && game.s.coins >= n.req.coins ? 'ok' : 'bad';
  }
  if (game.visiting) {
    if (tool === 'hand') return game.canSteal(i, now) ? 'ok' : game.firstProblem(p) ? 'info' : 'bad';
    if (tool === 'water') return p.dry ? 'ok' : 'bad';
    if (tool === 'weed') return p.weeds ? 'ok' : 'bad';
    if (tool === 'bug') return p.bugs ? 'ok' : 'bad';
    return 'info';
  }
  if (tool === 'seed') return p.state === 'empty' ? 'ok' : 'bad';
  if (tool === 'shovel') return p.state === 'withered' ? 'ok' : 'bad';
  if (tool === 'fert') return p.state === 'growing' && game.stage(p, now) < 4 ? 'ok' : 'bad';
  if (tool === 'water') return p.dry ? 'ok' : 'bad';
  if (tool === 'weed') return p.weeds ? 'ok' : 'bad';
  if (tool === 'bug') return p.bugs ? 'ok' : 'bad';
  if (p.state === 'empty' || p.state === 'withered' || game.isMature(p, now) || game.firstProblem(p)) return 'ok';
  return 'info';
}
function shouldPaint(i) {
  const p = game.plots[i];
  if (!p || !p.unlocked) return false;
  const tool = ui.tool;
  const now = Date.now();
  if (tool === 'seed') return p.state === 'empty';
  if (tool === 'shovel') return !game.visiting && p.state === 'withered';
  if (tool === 'fert') return !game.visiting && p.state === 'growing' && game.stage(p, now) < 4;
  if (tool === 'water') return !!p.dry;
  if (tool === 'weed') return !!p.weeds;
  if (tool === 'bug') return !!p.bugs;
  if (p.state === 'empty') return false;
  if (game.visiting) return game.canSteal(i, now) || !!game.firstProblem(p);
  return p.state === 'withered' || game.isMature(p, now) || !!game.firstProblem(p);
}

const pointers = new Map();
let gesture = null;
let pinchPrev = null;
let hover = null;

function pickPlot(x, y) {
  const hit = world.pick(x, y, plots.hitBoxes);
  return hit ? hit.object.userData.plot : -1;
}
function overUi(el) {
  return !!el.closest('#modal, #pop, #splash, #toolbar, #side, #hint, #topbar, #visitBar, #harvestAll, button, input, a');
}
function pinchOf() {
  const [a, b] = [...pointers.values()];
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    ang: Math.atan2(a.y - b.y, a.x - b.x),
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function bindInput() {
  const canvas = world.renderer.domElement;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('pointerdown', (e) => {
    if (!world) return;
    const bub = e.target.closest('.bub');
    if (bub && e.button === 0) {
      gesture = { type: 'bub', i: +bub.dataset.i, x: e.clientX, y: e.clientY };
      return;
    }
    if (overUi(e.target)) return;
    if (!e.target.closest('#scene, #vignette, #app, #labels')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      gesture = { type: 'pinch' };
      pinchPrev = pinchOf();
      ui.hideTip();
      return;
    }
    gesture = { type: 'pending', x: e.clientX, y: e.clientY, plot: pickPlot(e.clientX, e.clientY), button: e.button };
    toastOk = true;
  });
  addEventListener('pointermove', (e) => {
    if (!world) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture || gesture.type === 'bub') {
      if (started && e.pointerType === 'mouse') {
        hover = { i: pickPlot(e.clientX, e.clientY), x: e.clientX, y: e.clientY };
      }
      return;
    }
    if (gesture.type === 'pinch' && pointers.size >= 2) {
      const now = pinchOf();
      if (pinchPrev && playing()) {
        world.zoom(pinchPrev.dist / now.dist);
        world.rotate(pinchPrev.ang - now.ang, 0);
        world.pan(now.x - pinchPrev.x, now.y - pinchPrev.y);
      }
      pinchPrev = now;
      return;
    }
    if (gesture.type === 'pending') {
      const dx = e.clientX - gesture.x;
      const dy = e.clientY - gesture.y;
      if (dx * dx + dy * dy < 36) return;
      ui.hideTip();
      plots.setHover(-1, null);
      if (!playing()) { gesture = { type: 'pan', x: e.clientX, y: e.clientY }; return; }
      if (gesture.button === 2 || e.shiftKey || e.altKey) gesture = { type: 'rotate', x: e.clientX, y: e.clientY };
      else if (gesture.button === 1 || gesture.plot < 0 || !shouldPaint(gesture.plot)) gesture = { type: 'pan', x: e.clientX, y: e.clientY };
      else {
        const plot = gesture.plot;
        gesture = { type: 'paint', done: new Set([plot]) };
        painting = true;
        act(plot, 'paint');
      }
    }
    if (gesture.type === 'pan') {
      world.pan(e.clientX - gesture.x, e.clientY - gesture.y);
      gesture.x = e.clientX;
      gesture.y = e.clientY;
      canvas.style.cursor = 'grabbing';
    } else if (gesture.type === 'rotate') {
      world.rotate(-(e.clientX - gesture.x) * 0.008, (e.clientY - gesture.y) * 0.004);
      gesture.x = e.clientX;
      gesture.y = e.clientY;
    } else if (gesture.type === 'paint') {
      const i = pickPlot(e.clientX, e.clientY);
      if (i >= 0 && !gesture.done.has(i)) {
        gesture.done.add(i);
        act(i, 'paint');
      }
    }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.type === 'pinch' && pointers.size >= 2) return;
    if (gesture.type === 'pending' && gesture.button === 0 && playing()) {
      ui.closePop();
      act(gesture.plot, 'tool');
    } else if (gesture.type === 'bub') {
      const dx = e.clientX - gesture.x;
      const dy = e.clientY - gesture.y;
      if (dx * dx + dy * dy < 64 && playing()) {
        ui.closePop();
        act(gesture.i, 'primary');
      }
    }
    gesture = null;
    painting = false;
    pinchPrev = null;
    if (started) ui.applyCursor();
  };
  addEventListener('pointerleave', () => {
    hover = null;
    if (plots) plots.setHover(-1, null);
    if (ui) ui.hideTip();
  });
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  addEventListener('wheel', (e) => {
    if (e.target.closest('#modal, #pop, .seedlist')) return;
    e.preventDefault();
    if (!world || !started) return;
    world.zoom(Math.exp(e.deltaY * 0.0011));
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (!started) return;
    if (e.target.matches('input, textarea')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.repeat) return;
    if (e.key === 'Escape') {
      if (!ui.popEl.hidden) ui.closePop();
      else ui.close();
      return;
    }
    if (e.key === 'r' || e.key === 'R') { world.resetView(); return; }
    if (e.key === 'h' || e.key === 'H') { harvestAll(); return; }
    if (e.key === 'b' || e.key === 'B') { ui.open('barn'); return; }
    if (e.key === 'f' || e.key === 'F') { ui.open('friends'); return; }
    if (e.key === 'g' || e.key === 'G') { ui.shopTab = 'seed'; ui.open('shop'); return; }
    const n = '1234567'.indexOf(e.key);
    if (n >= 0) {
      audio.play('click');
      ui.setTool(TOOLS[n].id);
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && game) game.save(); });
  addEventListener('pagehide', () => game && game.save());
}

boot();
