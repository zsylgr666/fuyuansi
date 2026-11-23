import {
  CROPS, CROP, ITEMS, NEIGHBORS, WHEEL, WHEEL_COOLDOWN, WHEEL_GEM_COST,
  QUEST_POOL, TOOLS, VISIT_TOOLS, STAGE_NAMES,
} from './data.js';
import { icon, ICONS, cursorFor } from './icons.js';
import { plotPos } from './plots.js';
import { audio } from './audio.js';

const TAU = Math.PI * 2;
const $ = (s) => document.querySelector(s);

export function autoQuality() {
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  const small = Math.min(innerWidth, innerHeight) < 640;
  return cores <= 4 || mem <= 4 || small ? 'low' : 'high';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n) => {
  n = Math.floor(n);
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n < 10000) return sign + n.toLocaleString('zh-CN');
  if (n < 100000000) return sign + (n / 10000).toFixed(n < 100000 ? 1 : 0).replace(/\.0$/, '') + '万';
  return sign + (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
};
export const fmtDur = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return s + '秒';
  const m = Math.floor(s / 60);
  if (m < 60) return m + '分' + (s % 60 ? (s % 60) + '秒' : '');
  const h = Math.floor(m / 60);
  return h + '小时' + (m % 60 ? (m % 60) + '分' : '');
};
const ago = (t, now) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return s + '秒前';
  const m = Math.round(s / 60);
  if (m < 60) return m + '分钟前';
  const h = Math.round(m / 60);
  if (h < 48) return h + '小时前';
  return Math.round(h / 24) + '天前';
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const QICON = { plant: 'sprout', harvest: 'basket', steal: 'hand', help: 'friends', care: 'can', sell: 'coin' };
const HINTS = [
  ['basket', '金光闪闪就是熟了。点一下，或按住拖过一整排，把菜<b>收进仓库</b>'],
  ['shovel', '收完会枯萎。选底部的<b>铲子</b>，把残株铲掉才能再种'],
  ['sprout', '空地用<b>播种</b>。点工具选种子，按住拖动可以连着种'],
  ['can', '作物会<b>干旱、长草、生虫</b>。点地上的气泡，或换成对应的工具'],
  ['barn', '果实都在<b>仓库</b>里。卖掉就有金币，就能买更好的种子'],
  ['friends', '去<b>好友</b>的岛上看看。成熟的菜可以偷，缺水的也能帮忙'],
  ['hand', '紫色气泡就是能偷的。下手轻一点，<b>看门狗</b>会咬人'],
];

function rewardChips(r) {
  const bits = [];
  if (r.coins) bits.push(`<span class="chip">${icon('coin')}${r.coins}</span>`);
  if (r.gems) bits.push(`<span class="chip">${icon('gem')}${r.gems}</span>`);
  if (r.fert) bits.push(`<span class="chip">${icon('fert')}化肥×${r.fert}</span>`);
  if (r.xp) bits.push(`<span class="chip">${icon('star')}${r.xp}</span>`);
  return `<div class="chips">${bits.join('')}</div>`;
}

export class UI {
  constructor(game, world) {
    this.game = game;
    this.world = world;
    this.tool = 'hand';
    this.seedId = CROPS.find((c) => game.s.seeds[c.id] > 0)?.id || 'carrot';
    this.fertId = 'fert';
    this.thumbs = {};
    this.modal = null;
    this.shopTab = 'seed';
    this.qty = {};
    this.popState = null;
    this.hintDismissed = -1;
    this.levelQueue = [];
    this.spin = null;
    this.spinning = false;
    this.prizeOn = false;
    this.rot = 0;
    this.lastSlice = null;
    this.locked = false;
    this.coinShown = game.s.coins;
    this.gemShown = game.s.gems;
    this.coinTarget = game.s.coins;
    this.gemTarget = game.s.gems;
    this.nbAt = 0;
    this.nbRipe = 0;
    this.bits = [];
    this.resetArm = false;
    this.canvas = world.renderer.domElement;

    this.hud = $('#hud');
    this.coinsEl = $('#coins');
    this.gemsEl = $('#gems');
    this.xpFill = $('#xpFill');
    this.xpText = $('#xpText');
    this.lvEl = $('#lv');
    this.farmName = $('#farmName');
    this.avatarEl = $('#avatar');
    this.clockIcon = $('#clockIcon');
    this.clockText = $('#clockText');
    this.coinBtn = $('#coinBtn');
    this.gemBtn = $('#gemBtn');
    this.visitBar = $('#visitBar');
    this.vbAvatar = $('#vbAvatar');
    this.vbName = $('#vbName');
    this.vbSub = $('#vbSub');
    this.bar = $('#toolbar');
    this.harvestBtn = $('#harvestAll');
    this.harvestText = $('#harvestAllText');
    this.hint = $('#hint');
    this.hintIco = $('#hintIco');
    this.hintText = $('#hintText');
    this.toasts = $('#toasts');
    this.tip = $('#tip');
    this.popEl = $('#pop');
    this.modalEl = $('#modal');
    this.sheet = this.modalEl.querySelector('.sheet');
    this.mask = this.modalEl.querySelector('.mask');
    this.curtainEl = $('#curtain');
    this.cv = $('#confetti');
    this.ctx = this.cv.getContext('2d');
    this.labels = $('#labels');
    this.flyLayer = $('#fly');
    this.profile = $('#profile');

    this.bubs = Array.from({ length: 16 }, () => {
      const el = document.createElement('div');
      el.className = 'bub';
      el.innerHTML = '<div class="in"></div>';
      el.hidden = true;
      this.labels.append(el);
      return el;
    });

    this.injectIcons();
    this.buildToolbar();
    this.bind();
    this.resizeConfetti();
    this.farmName.textContent = game.s.name;
    this.avatarEl.textContent = game.s.avatar;
    this.applyCursor();
  }

  injectIcons() {
    document.querySelectorAll('[data-icon]').forEach((el) => {
      el.innerHTML = ICONS[el.dataset.icon] || '';
    });
  }
  setThumbs(map) {
    this.thumbs = map || {};
    this.updateToolbar();
  }
  thumb(id) {
    if (this.thumbs[id]) return this.thumbs[id];
    const c = CROP[id]?.color || '#ccc';
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="${c}"/></svg>`)}`;
  }
  show() {
    this.hud.classList.remove('off');
    this.syncHint();
  }
  screen(i, y = 1.3) {
    const p = plotPos(i);
    p.y = y;
    return this.world.project(p);
  }

  /* ================= 每帧 ================= */
  update(dt, now) {
    this.tweenMoney(dt);
    this.updateClock();
    this.updateToolbar();
    this.updateBubbles(now);
    this.updateVisit();
    this.updateHarvestAll(now);
    this.updateDots(now);
    this.updateWheel(dt, now);
    this.updateConfetti(dt);
    const need = this.game.need();
    this.xpFill.style.width = `${clamp(this.game.s.xp / need, 0, 1) * 100}%`;
    this.xpText.textContent = `${this.game.s.xp}/${need}`;
    this.lvEl.textContent = this.game.s.level;
  }

  tweenMoney(dt) {
    const k = 1 - Math.exp(-dt * 9);
    const s = this.game.s;
    if (s.coins !== this.coinTarget) {
      this.coinTarget = s.coins;
      this.coinBtn.classList.add('pulse');
      clearTimeout(this.coinPulse);
      this.coinPulse = setTimeout(() => this.coinBtn.classList.remove('pulse'), 360);
    }
    if (s.gems !== this.gemTarget) {
      this.gemTarget = s.gems;
      this.gemBtn.classList.add('pulse');
      clearTimeout(this.gemPulse);
      this.gemPulse = setTimeout(() => this.gemBtn.classList.remove('pulse'), 360);
    }
    this.coinShown += (s.coins - this.coinShown) * k;
    this.gemShown += (s.gems - this.gemShown) * k;
    if (Math.abs(this.coinShown - s.coins) < 0.5) this.coinShown = s.coins;
    if (Math.abs(this.gemShown - s.gems) < 0.5) this.gemShown = s.gems;
    this.coinsEl.textContent = fmt(Math.round(this.coinShown));
    this.gemsEl.textContent = fmt(Math.round(this.gemShown));
  }
  updateClock() {
    const t = this.world.dayT;
    const mins = Math.floor(t * 24 * 60) % (24 * 60);
    const text = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    if (this.clockText.textContent !== text) this.clockText.textContent = text;
    const ico = this.world.rain > 0.45 ? 'rain' : this.world.night > 0.55 ? 'moon' : 'sun';
    if (this.clockIcon.dataset.k !== ico) {
      this.clockIcon.dataset.k = ico;
      this.clockIcon.innerHTML = ICONS[ico];
    }
  }
  updateVisit() {
    const v = this.game.visiting;
    this.visitBar.hidden = !v;
    if (!v) return;
    if (this.visitBar.dataset.id !== v.nb.id) {
      this.visitBar.dataset.id = v.nb.id;
      this.vbAvatar.textContent = v.nb.avatar;
      this.vbAvatar.style.background = '#fff';
      this.vbName.textContent = `${v.nb.name}的农场`;
      this.vbSub.textContent = `Lv.${v.nb.lv} · ${v.nb.dog ? v.nb.dogName + '看门' : '没有看门狗'}`;
    }
  }
  updateHarvestAll(now) {
    const n = this.game.visiting ? 0 : this.game.maturedCount(now);
    this.harvestBtn.hidden = n <= 0;
    if (n > 0) this.harvestText.textContent = `一键收获 ×${n}`;
  }
  updateDots(now) {
    const q = this.game.questsReady();
    const dq = $('#dotQuest');
    dq.classList.toggle('on', q > 0);
    dq.textContent = q || '';
    const ready = this.game.wheelReady(now);
    const dw = $('#dotWheel');
    dw.classList.toggle('on', ready);
    dw.textContent = ready ? '!' : '';
    if (now - this.nbAt > 2500) {
      this.nbAt = now;
      this.nbRipe = NEIGHBORS.reduce((a, nb) => a + (this.game.neighborStatus(nb, now).ripe > 0 ? 1 : 0), 0);
    }
    const df = $('#dotFriends');
    df.classList.toggle('on', this.nbRipe > 0);
    df.textContent = this.nbRipe || '';
  }

  /* ================= 工具栏 ================= */
  buildToolbar() {
    this.bar.innerHTML = TOOLS.map((t) => `
      <button class="tool" type="button" data-tool="${t.id}" title="${t.name}（${t.key}）">
        <span class="ico">${ICONS[t.icon]}</span><em>${t.name}</em><i class="count" hidden>0</i>
      </button>`).join('');
  }
  updateToolbar() {
    const s = this.game.s;
    const visiting = !!this.game.visiting;
    const allow = new Set(visiting ? VISIT_TOOLS : TOOLS.map((t) => t.id));
    if (!allow.has(this.tool)) this.tool = 'hand';
    for (const btn of this.bar.children) {
      const id = btn.dataset.tool;
      btn.hidden = !allow.has(id);
      btn.classList.toggle('active', id === this.tool);
      let sig = id;
      let visual = '';
      let label = TOOLS.find((t) => t.id === id).name;
      let count = null;
      if (id === 'hand') {
        label = visiting ? '偷菜' : '收获';
        sig += visiting ? ':v' : ':h';
        visual = `<span class="ico">${ICONS[visiting ? 'hand' : 'basket']}</span>`;
      } else if (id === 'seed') {
        label = CROP[this.seedId].name;
        count = s.seeds[this.seedId] || 0;
        sig += `:${this.seedId}:${count}`;
        visual = `<img class="seedthumb" src="${this.thumb(this.seedId)}" alt="">`;
      } else if (id === 'fert') {
        label = this.fertId === 'superFert' ? '神肥' : '施肥';
        count = s.items[this.fertId] || 0;
        sig += `:${this.fertId}:${count}`;
        visual = `<span class="ico">${ICONS[this.fertId === 'superFert' ? 'superFert' : 'fert']}</span>`;
      }
      if (sig !== id && btn.dataset.sig !== sig) {
        btn.dataset.sig = sig;
        const old = btn.querySelector('.ico, .seedthumb');
        if (old) old.outerHTML = visual;
        btn.querySelector('em').textContent = label;
      } else if (id === 'hand' && btn.dataset.sig !== sig) {
        btn.dataset.sig = sig;
        btn.querySelector('.ico').outerHTML = visual;
        btn.querySelector('em').textContent = label;
      }
      const badge = btn.querySelector('.count');
      if (count == null) badge.hidden = true;
      else {
        badge.hidden = false;
        badge.textContent = count;
        badge.classList.toggle('zero', count <= 0);
      }
    }
  }
  pickTool(id) {
    if (this.game.visiting && !VISIT_TOOLS.includes(id)) return;
    audio.play('click');
    if (this.tool === id && id === 'seed') return this.popSeed(null);
    if (this.tool === id && id === 'fert') return this.popFert();
    this.setTool(id);
  }
  setTool(id) {
    if (this.game.visiting && !VISIT_TOOLS.includes(id)) id = 'hand';
    this.tool = id;
    this.applyCursor();
    this.updateToolbar();
  }
  applyCursor() {
    const map = {
      hand: this.game.visiting ? 'hand' : 'basket',
      seed: 'sprout', water: 'can', weed: 'sickle', bug: 'spray', shovel: 'shovel',
      fert: this.fertId === 'superFert' ? 'superFert' : 'fert',
    };
    this.canvas.style.cursor = cursorFor(map[this.tool] || 'basket');
  }

  /* ================= 教程 ================= */
  syncHint() {
    const i = this.game.s.tut;
    const hide = i >= HINTS.length || this.hintDismissed === i || this.modal === 'back' || (this.game.visiting && i < 5);
    this.hint.hidden = hide;
    if (hide) return;
    if (this.hint.dataset.i === String(i)) return;
    this.hint.dataset.i = String(i);
    this.hintIco.innerHTML = ICONS[HINTS[i][0]];
    this.hintText.innerHTML = HINTS[i][1];
    const tool = [null, 'shovel', 'seed', 'water', null, null, null][i];
    const side = [null, null, null, null, 'barn', 'friends', null][i];
    const el = tool
      ? this.bar.querySelector(`[data-tool="${tool}"]`)
      : side
        ? document.querySelector(`#side [data-open="${side}"]`)
        : null;
    if (el) {
      el.classList.add('pulse');
      setTimeout(() => el.classList.remove('pulse'), 800);
    }
  }

  /* ================= 气泡 ================= */
  bubbleSpec(i, now) {
    const p = this.game.plots[i];
    const visiting = !!this.game.visiting;
    if (!p.unlocked) {
      if (visiting) return null;
      const next = this.game.nextUnlock();
      if (!next || next.idx !== i) return null;
      const can = this.game.s.level >= next.req.lv && this.game.s.coins >= next.req.coins;
      return { cls: `bub lock ${can ? 'can' : 'no'}`, html: `${icon('lock')}<b>${fmt(next.req.coins)}</b>`, y: 0.85, sig: `L${can}${next.req.coins}` };
    }
    if (p.state === 'empty') return null;
    const tall = p.crop === 'sunflower' || p.crop === 'corn' || p.crop === 'starfruit';
    const y = tall ? 2.35 : 1.55;
    if (visiting && this.game.canSteal(i, now)) {
      return { cls: 'bub steal', html: `<img src="${this.thumb(p.crop)}" alt="">${icon('hand', 'mini')}`, y, sig: `S${p.crop}` };
    }
    if (!visiting && p.state === 'withered') return { cls: 'bub wither', html: icon('shovel'), y: 1.15, sig: 'W' };
    if (!visiting && this.game.isMature(p, now)) {
      return { cls: 'bub ready', html: `<img src="${this.thumb(p.crop)}" alt="">`, y, sig: `R${p.crop}` };
    }
    if (p.state !== 'growing') return null;
    const bits = [];
    if (p.bugs) bits.push(icon('bug'));
    if (p.weeds) bits.push(icon('weed'));
    if (p.dry) bits.push(icon('drop'));
    if (!bits.length) return null;
    return { cls: 'bub need', html: bits.join(''), y: y - 0.15, sig: `N${p.bugs}|${p.weeds}|${p.dry ? 1 : 0}` };
  }
  updateBubbles(now) {
    for (let i = 0; i < 16; i++) {
      const el = this.bubs[i];
      const spec = this.modal ? null : this.bubbleSpec(i, now);
      if (!spec) { el.hidden = true; continue; }
      const scr = this.screen(i, spec.y);
      if (!scr.vis || scr.x < -60 || scr.y < -60 || scr.x > innerWidth + 60 || scr.y > innerHeight + 60) {
        el.hidden = true;
        continue;
      }
      el.hidden = false;
      el.dataset.i = String(i);
      if (el.dataset.sig !== spec.sig) {
        el.dataset.sig = spec.sig;
        el.className = spec.cls;
        el.querySelector('.in').innerHTML = spec.html;
      }
      el.style.transform = `translate(${scr.x}px, ${scr.y}px) translate(-50%, -100%)`;
    }
  }

  /* ================= 反馈 ================= */
  toast(text, kind = '', ico = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = (ico ? icon(ico) : '') + `<span>${esc(text)}</span>`;
    this.toasts.append(el);
    while (this.toasts.children.length > 4) this.toasts.children[0].remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 420);
    }, 2600);
  }
  float(html, x, y, cls = '') {
    const el = document.createElement('div');
    el.className = `float ${cls}`;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.innerHTML = html;
    this.flyLayer.append(el);
    setTimeout(() => el.remove(), 1400);
  }
  floatAt(i, html, cls, y = 1.25) {
    const s = this.screen(i, y);
    if (s.vis) this.float(html, s.x, s.y - 10, cls);
  }
  fly(html, x, y, target) {
    const dest = typeof target === 'string' ? document.querySelector(target) : target;
    if (!dest) return;
    const el = document.createElement('div');
    el.className = 'flyer';
    el.innerHTML = html;
    this.flyLayer.append(el);
    const r = dest.getBoundingClientRect();
    const x2 = r.left + r.width / 2;
    const y2 = r.top + r.height / 2;
    const anim = el.animate([
      { transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 1 },
      { transform: `translate(${x + (x2 - x) * 0.45}px, ${Math.min(y, y2) - 80}px) scale(1.35)`, opacity: 1, offset: 0.42 },
      { transform: `translate(${x2}px, ${y2}px) scale(.3)`, opacity: 0.85 },
    ], { duration: 680, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
    anim.onfinish = () => {
      el.remove();
      dest.classList.add('pulse');
      setTimeout(() => dest.classList.remove('pulse'), 360);
    };
  }
  flyFrom(i, html, target, y = 1.2) {
    const s = this.screen(i, y);
    if (s.vis) this.fly(html, s.x, s.y, target);
  }
  pulseShop() {
    const b = document.querySelector('#side [data-open="shop"]');
    if (!b) return;
    b.classList.add('pulse');
    setTimeout(() => b.classList.remove('pulse'), 700);
  }

  confetti(n = 140) {
    const colors = ['#ff5a4e', '#ffc83d', '#5cc93b', '#4fb3ff', '#b06ce0', '#fff', '#ff8a3d'];
    const cx = innerWidth / 2;
    const cy = innerHeight * 0.32;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = 3 + Math.random() * 9;
      this.bits.push({
        x: cx + (Math.random() - 0.5) * 80,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 4,
        w: 6 + Math.random() * 7,
        h: 8 + Math.random() * 8,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.4,
        color: colors[i % colors.length],
        life: 1,
      });
    }
  }
  resizeConfetti() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.cv.width = innerWidth * dpr;
    this.cv.height = innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  updateConfetti(dt) {
    if (!this.bits.length) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const p = this.bits[i];
      p.vy += 16 * dt;
      p.x += p.vx * 60 * dt;
      p.y += p.vy * 60 * dt;
      p.rot += p.vr;
      p.life -= dt * 0.38;
      if (p.life <= 0 || p.y > innerHeight + 30) { this.bits.splice(i, 1); continue; }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (!this.bits.length) ctx.clearRect(0, 0, innerWidth, innerHeight);
  }

  async curtain(fn) {
    this.locked = true;
    this.closePop();
    this.curtainEl.classList.add('on', 'in');
    audio.play('whoosh');
    await wait(560);
    fn();
    await wait(90);
    this.curtainEl.classList.remove('in');
    await wait(560);
    this.curtainEl.classList.remove('on');
    this.locked = false;
  }

  /* ================= 弹出层 ================= */
  openPop(html, x, y, state) {
    this.popState = state;
    this.popEl.style.visibility = 'hidden';
    this.popEl.hidden = false;
    this.popEl.innerHTML = html;
    const w = this.popEl.offsetWidth;
    const h = this.popEl.offsetHeight;
    let left = x - w / 2;
    let top = y - h - 16;
    let below = false;
    if (top < 8) { top = y + 18; below = true; }
    left = clamp(left, 8, innerWidth - w - 8);
    top = clamp(top, 8, innerHeight - h - 8);
    const ax = clamp(x - left, 18, w - 18);
    this.popEl.style.left = left + 'px';
    this.popEl.style.top = top + 'px';
    this.popEl.style.setProperty('--ax', ax + 'px');
    this.popEl.classList.toggle('below', below);
    this.popEl.style.visibility = '';
  }
  closePop() {
    this.popEl.hidden = true;
    this.popState = null;
  }
  popSeed(plot) {
    const owned = CROPS.filter((c) => (this.game.s.seeds[c.id] || 0) > 0);
    let html = `<button class="pop-x" type="button" data-x>×</button><div class="pop-title">${icon('sprout')} 选种子</div>`;
    if (!owned.length) {
      html += `<div class="pop-empty">种子用完啦</div><div class="pop-actions"><button class="btn gold" type="button" data-shop>去商店</button></div>`;
    } else {
      html += `<div class="seedlist">${owned.map((c) => `
        <button class="seedbtn" type="button" data-seed="${c.id}">
          <i>${this.game.s.seeds[c.id]}</i>
          <img src="${this.thumb(c.id)}" alt="">
          <b>${c.name}</b>
          <small>${fmtDur(c.grow * 1000)}</small>
        </button>`).join('')}</div>
        <div class="pop-actions"><button class="btn sm gray" type="button" data-shop>去商店进货</button></div>`;
    }
    const anchor = plot == null ? this.toolAnchor('seed') : this.screen(plot, 0.55);
    if (anchor.vis === false) { this.toast('这块地不在画面里', 'bad'); return; }
    this.openPop(html, anchor.x, anchor.y, { type: 'seed', plot });
  }
  popFert() {
    const s = this.game.s;
    const html = `<button class="pop-x" type="button" data-x>×</button><div class="pop-title">${icon('fert')} 选肥料</div>
      <div class="pop-actions">
        <button class="btn sm ${this.fertId === 'fert' ? 'gold' : 'gray'}" type="button" data-fert="fert">${icon('fert')} 化肥 ×${s.items.fert || 0}</button>
        <button class="btn sm ${this.fertId === 'superFert' ? 'purple' : 'gray'}" type="button" data-fert="superFert">${icon('superFert')} 神肥 ×${s.items.superFert || 0}</button>
      </div>`;
    const a = this.toolAnchor('fert');
    this.openPop(html, a.x, a.y, { type: 'fert' });
  }
  popUnlock(i) {
    const next = this.game.nextUnlock();
    if (!next || next.idx !== i) { this.toast('要按顺序一块一块开垦', 'bad'); return; }
    const { lv, coins } = next.req;
    const lvOk = this.game.s.level >= lv;
    const coinOk = this.game.s.coins >= coins;
    const html = `<button class="pop-x" type="button" data-x>×</button>
      <div class="pop-title">${icon('lock')} 开垦这块地</div>
      <div class="req">
        <span class="${lvOk ? '' : 'no'}">${icon('star')} Lv.${lv}</span>
        <span class="${coinOk ? '' : 'no'}">${icon('coin')} ${fmt(coins)}</span>
      </div>
      <div class="pop-actions"><button class="btn gold" type="button" data-unlock="${i}" ${lvOk && coinOk ? '' : 'disabled'}>开垦</button></div>`;
    const s = this.screen(i, 0.6);
    this.openPop(html, s.x, s.y, { type: 'unlock' });
  }
  toolAnchor(id) {
    const b = this.bar.querySelector(`[data-tool="${id}"]`);
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top, vis: true };
  }
  showTip(i, x, y) {
    const p = i < 0 ? null : this.game.plots[i];
    if (!p || !p.unlocked || p.state === 'empty' || this.modal || !this.popEl.hidden) {
      this.tip.hidden = true;
      return;
    }
    const now = Date.now();
    const def = CROP[p.crop];
    let body;
    if (p.state === 'withered') {
      body = `<div class="tip-head"><img src="${this.thumb(def.id)}" alt=""><div><b>${def.name}</b><small>已经枯萎</small></div></div><div class="tip-row"><span>用铲子清理后可以重种</span></div>`;
    } else {
      const st = this.game.stage(p, now);
      const prog = clamp(this.game.progress(p, now), 0, 1);
      const probs = `${p.bugs ? icon('bug') : ''}${p.weeds ? icon('weed') : ''}${p.dry ? icon('drop') : ''}`;
      const left = st >= 4 ? '可以收获' : `还要 ${fmtDur(this.game.remaining(p, now))}`;
      const season = def.seasons > 1 ? ` · 第${p.season}/${def.seasons}茬` : '';
      body = `<div class="tip-head"><img src="${this.thumb(def.id)}" alt=""><div><b>${def.name}</b><small>${STAGE_NAMES[st]}${season}</small></div></div>
        <div class="bar ${st >= 4 ? 'gold' : ''}"><i style="width:${prog * 100}%"></i></div>
        <div class="tip-row"><span>${left}</span><b>约 ${Math.max(1, def.yield - (p.stolen || 0))} 个</b></div>
        ${probs ? `<div class="probs">${probs}</div>` : ''}`;
    }
    const sig = `${i}|${p.state}|${p.crop}|${p.bugs}|${p.weeds}|${p.dry ? 1 : 0}|${p.state === 'growing' ? Math.floor(this.game.progress(p, now) * 40) : 0}`;
    if (this.tip.dataset.sig !== sig) {
      this.tip.dataset.sig = sig;
      this.tip.innerHTML = body;
    }
    this.tip.hidden = false;
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    let left = x + 16;
    let top = y - h - 12;
    if (left + w > innerWidth - 8) left = x - w - 16;
    if (top < 8) top = y + 18;
    this.tip.style.left = clamp(left, 8, innerWidth - w - 8) + 'px';
    this.tip.style.top = clamp(top, 8, innerHeight - h - 8) + 'px';
  }
  hideTip() { this.tip.hidden = true; }

  /* ================= 弹窗 ================= */
  open(name, sound = true) {
    if (this.locked && name !== 'levelup') return;
    if (this.spinning) return;
    this.closePop();
    if (this.modal === 'levelup' && name !== 'levelup') this.levelQueue.shift();
    const was = this.modal;
    this.modal = name;
    this.modalEl.hidden = false;
    this.render();
    if (sound && !was) audio.play('open');
    this.syncHint();
  }
  close() {
    if (!this.modal || this.spinning) return;
    const was = this.modal;
    if (was === 'levelup') {
      this.levelQueue.shift();
      if (this.levelQueue.length) { this.render(); return; }
    }
    this.modal = null;
    this.prizeOn = false;
    this.modalEl.hidden = true;
    this.sheet.innerHTML = '';
    audio.play('close');
    this.flushLevel();
    if (was === 'back' || was === 'levelup') this.syncHint();
  }
  render() {
    const view = {
      shop: () => this.viewShop(),
      barn: () => this.viewBarn(),
      quests: () => this.viewQuests(),
      friends: () => this.viewFriends(),
      wheel: () => this.viewWheel(),
      settings: () => this.viewSettings(),
      levelup: () => this.viewLevel(),
      back: () => this.viewBack(),
    }[this.modal];
    this.sheet.innerHTML = view ? view() : '';
    if (this.modal === 'wheel') {
      this.drawWheel();
      this.updateWheelButton(Date.now());
    }
  }
  onSheetClick(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled || !this.sheet.contains(b)) return;
    if (b.dataset.step) {
      audio.play('tick');
      const box = b.closest('.stepper');
      const id = box.dataset.id;
      this.qty[id] = clamp((this.qty[id] || 1) + Number(b.dataset.step), 1, 99);
      box.querySelector('span').textContent = this.qty[id];
      const price = Number(box.dataset.price);
      const buy = box.parentElement.querySelector('[data-cost]');
      if (buy) buy.lastChild.textContent = fmt(price * this.qty[id]);
      return;
    }
    if (b.dataset.tab) {
      audio.play('click');
      this.shopTab = b.dataset.tab;
      this.render();
      return;
    }
    if (b.dataset.buySeed) return this.buySeed(b.dataset.buySeed);
    if (b.dataset.buyItem) return this.buyItem(b.dataset.buyItem);
    if (b.dataset.sell) return this.sell(b.dataset.sell, b.dataset.n);
    if (b.dataset.sellAll != null) return this.sellAll();
    if (b.dataset.claim != null) return this.claimQuest(+b.dataset.claim);
    if (b.dataset.visit) return this.visit(b.dataset.visit);
    if (b.dataset.toggle) return this.toggleSetting(b.dataset.toggle);
    if (b.dataset.quality) return this.setQualitySetting(b.dataset.quality);
    if (b.dataset.act === 'reset') return this.armReset(b);
    if (b.dataset.act === 'spin') return this.spinWheel();
    if (b.dataset.act === 'prize-ok') return this.dismissPrize();
    if (b.dataset.act === 'close') return this.close();
    audio.play('click');
  }

  viewShop() {
    const tab = this.shopTab;
    const tabs = `<div class="tabs">
      <button type="button" data-tab="seed" class="${tab === 'seed' ? 'on' : ''}">种子</button>
      <button type="button" data-tab="item" class="${tab === 'item' ? 'on' : ''}">道具</button>
    </div>`;
    const body = tab === 'seed' ? this.seedCards() : this.itemCards();
    return `${this.ribbon('商店', 'red')}${this.closer()}<div class="mbody">${tabs}${body}</div>`;
  }
  seedCards() {
    return `<div class="grid">${CROPS.map((c) => {
      const locked = this.game.s.level < c.lv;
      const q = this.qty[c.id] || 1;
      const own = this.game.s.seeds[c.id] || 0;
      const profit = c.yield * c.price - c.seed;
      return `<div class="card ${locked ? 'locked' : ''}">
        <div class="thumb"><img src="${this.thumb(c.id)}" alt=""><span class="tag">Lv.${c.lv}</span><span class="tag r">${fmtDur(c.grow * 1000)}</span></div>
        <div class="name">${c.name}<span class="cnt">×${own}</span></div>
        <div class="meta"><span>产 ${c.yield}</span><span>卖 ${c.price}</span><span class="hl">净赚 ${profit}</span>${c.seasons > 1 ? `<span>${c.seasons}茬</span>` : ''}</div>
        <div class="buyrow">
          <div class="stepper" data-id="${c.id}" data-price="${c.seed}"><button type="button" data-step="-1" ${locked ? 'disabled' : ''}>−</button><span>${q}</span><button type="button" data-step="1" ${locked ? 'disabled' : ''}>+</button></div>
          <button class="btn sm gold" type="button" data-buy-seed="${c.id}" data-cost ${locked ? 'disabled' : ''}>${icon('coin')}${fmt(c.seed * q)}</button>
        </div>
      </div>`;
    }).join('')}</div>`;
  }
  itemCards() {
    return `<div class="grid">${Object.values(ITEMS).map((it) => {
      const q = this.qty[it.id] || 1;
      const own = this.game.s.items[it.id] || 0;
      const icoName = it.currency === 'gems' ? 'gem' : 'coin';
      return `<div class="card">
        <div class="thumb"><span class="ico">${ICONS[it.id] || ICONS.fert}</span><span class="tag r">持有 ${own}</span></div>
        <div class="name">${it.name}</div>
        <div class="meta"><span>${it.desc}</span></div>
        <div class="buyrow">
          <div class="stepper" data-id="${it.id}" data-price="${it.price}"><button type="button" data-step="-1">−</button><span>${q}</span><button type="button" data-step="1">+</button></div>
          <button class="btn sm ${it.currency === 'gems' ? 'blue' : 'gold'}" type="button" data-buy-item="${it.id}" data-cost>${icon(icoName)}${fmt(it.price * q)}</button>
        </div>
      </div>`;
    }).join('')}</div>`;
  }
  buySeed(id) {
    const n = this.qty[id] || 1;
    const r = this.game.buySeed(id, n);
    if (!r.ok) { audio.play('error'); this.toast(r.msg, 'bad'); return; }
    audio.play('coin');
    this.game.save();
    this.toast(`买了 ${CROP[id].name}种子 ×${n}`, 'good', 'sprout');
    this.seedId = id;
    const top = this.sheet.querySelector('.mbody').scrollTop;
    this.render();
    this.sheet.querySelector('.mbody').scrollTop = top;
  }
  buyItem(id) {
    const n = this.qty[id] || 1;
    const r = this.game.buyItem(id, n);
    if (!r.ok) { audio.play('error'); this.toast(r.msg, 'bad'); return; }
    audio.play('coin');
    this.game.save();
    this.toast(`买了 ${ITEMS[id].name} ×${n}`, 'good', id === 'superFert' ? 'superFert' : 'fert');
    const top = this.sheet.querySelector('.mbody').scrollTop;
    this.render();
    this.sheet.querySelector('.mbody').scrollTop = top;
  }

  viewBarn() {
    const entries = Object.entries(this.game.s.barn).filter(([, n]) => n > 0);
    const rows = entries.length ? entries.map(([id, n]) => {
      const def = CROP[id];
      return `<div class="row">
        <img class="th" src="${this.thumb(id)}" alt="">
        <div class="info"><b>${def.name} <span class="cnt">×${n}</span></b><small>单价 ${def.price} · 共 ${fmt(n * def.price)} 金币</small></div>
        <div class="acts"><button class="btn xs" type="button" data-sell="${id}" data-n="1">卖 1</button><button class="btn xs gold" type="button" data-sell="${id}" data-n="all">全卖</button></div>
      </div>`;
    }).join('') : `<div class="empty">${icon('barn')}仓库空空的，先去收一茬吧</div>`;
    const total = this.game.barnValue();
    return `${this.ribbon('仓库', 'green')}${this.closer()}
      <div class="mbody"><div class="list">${rows}</div></div>
      <div class="mfoot"><div class="grow">总价值 ${icon('coin')} <b>${fmt(total)}</b></div>
      <button class="btn gold" type="button" data-sell-all ${total ? '' : 'disabled'}>全部卖掉</button></div>`;
  }
  sell(id, n) {
    const count = n === 'all' ? (this.game.s.barn[id] || 0) : 1;
    const r = this.game.sell(id, count);
    if (!r.ok) { audio.play('error'); this.toast(r.msg, 'bad'); return; }
    audio.play('coin');
    this.game.save();
    this.toast(`卖掉 ${CROP[id].name}，+${fmt(r.coins)} 金币`, 'gold', 'coin');
    this.syncHint();
    this.render();
  }
  sellAll() {
    const r = this.game.sellAll();
    if (!r.ok) { audio.play('error'); this.toast(r.msg, 'bad'); return; }
    audio.play('coin');
    this.game.save();
    this.toast(`全部卖掉，+${fmt(r.coins)} 金币`, 'gold', 'coin');
    this.syncHint();
    this.render();
  }

  viewQuests() {
    const cards = this.game.s.quests.map((q, i) => {
      const def = QUEST_POOL.find((d) => d.k === q.k);
      const done = q.prog >= q.target;
      const pct = clamp(q.prog / q.target, 0, 1) * 100;
      return `<div class="qcard ${done ? 'done' : ''}">
        <div class="qi">${icon(QICON[q.k] || 'quest')}</div>
        <div class="info">
          <b>${def.name}</b>
          <small>${def.desc(q.target)}</small>
          <div class="bar ${done ? 'gold' : ''}"><i style="width:${pct}%"></i><span>${Math.min(q.prog, q.target)}/${q.target}</span></div>
          ${rewardChips(def.reward)}
        </div>
        <button class="btn sm gold" type="button" data-claim="${i}" ${done ? '' : 'disabled'}>${done ? '领取' : '进行中'}</button>
      </div>`;
    }).join('');
    return `${this.ribbon('今日任务', 'blue')}${this.closer()}<div class="mbody"><div class="list">${cards}</div></div>`;
  }
  claimQuest(i) {
    const r = this.game.claimQuest(i);
    if (!r.ok) return;
    audio.play('reward');
    this.confetti(70);
    this.game.save();
    this.toast('任务奖励到手', 'gold', 'star');
    if (this.modal === 'levelup') return;
    this.render();
  }

  viewFriends() {
    const now = Date.now();
    const visiting = this.game.visiting?.nb.id;
    const rows = NEIGHBORS.map((nb) => {
      const st = this.game.neighborStatus(nb, now);
      const here = visiting === nb.id;
      return `<div class="row">
        <div class="fav" style="background:${nb.color}">${nb.avatar}</div>
        <div class="info">
          <b>${esc(nb.name)} <span class="cnt">Lv.${nb.lv}</span></b>
          <small>${nb.dog ? `${esc(nb.dogName)} 看门` : '没有看门狗'}</small>
          <div class="chips">
            ${st.ripe ? `<span class="chip purple">${icon('hand')}可偷 ${st.ripe}</span>` : ''}
            ${st.help ? `<span class="chip green">${icon('can')}可帮 ${st.help}</span>` : ''}
            ${!st.ripe && !st.help ? '<span class="chip">先去逛逛</span>' : ''}
          </div>
        </div>
        <button class="btn sm ${here ? 'gray' : 'purple'}" type="button" data-visit="${nb.id}" ${here ? 'disabled' : ''}>${here ? '在这' : '串门'}</button>
      </div>`;
    }).join('');
    const logs = this.game.s.log.slice(0, 8);
    const log = `<div class="log"><h4>${icon('dog')} 农场日记</h4><ul>${
      logs.length ? logs.map((e) => `<li><time>${ago(e.t, now)}</time><span>${esc(e.text)}</span></li>`).join('') : '<li>还没什么动静</li>'
    }</ul></div>`;
    return `${this.ribbon('好友', 'purple')}${this.closer()}<div class="mbody"><div class="list">${rows}</div>${log}</div>`;
  }
  async visit(id) {
    if (this.locked) return;
    const nb = NEIGHBORS.find((n) => n.id === id);
    if (!nb) return;
    this.modal = null;
    this.modalEl.hidden = true;
    this.sheet.innerHTML = '';
    await this.curtain(() => {
      this.game.visit(nb, Date.now());
      this.world.setSign(`${nb.name}的岛`, nb.dog ? `看门狗 · ${nb.dogName}` : '没有看门狗');
      this.world.setDog(nb.dog ? 'visit' : null);
      this.world.roofMat.color.set(nb.color);
      this.tool = 'hand';
    });
    this.game.save();
    this.applyCursor();
    this.syncHint();
    this.toast(`来到${nb.name}的农场`, 'purple', 'friends');
  }
  async goHome() {
    if (this.locked || !this.game.visiting) return;
    await this.curtain(() => {
      this.game.goHome();
      this.world.setSign(this.game.s.name, '欢迎光临');
      this.world.setDog('home');
      this.world.roofMat.color.set('#e2574c');
      this.tool = 'hand';
    });
    this.applyCursor();
    this.syncHint();
    this.toast('回到自己的岛', 'good', 'home');
  }

  viewWheel() {
    const ptr = `<svg viewBox="0 0 44 54"><path d="M22 52 6 16a16 16 0 0 1 32 0Z" fill="#fff" stroke="#8a4b00" stroke-width="3"/><circle cx="22" cy="16" r="6" fill="#ff5a4e" stroke="#8a4b00" stroke-width="2"/></svg>`;
    return `${this.ribbon('幸运转盘', 'purple')}${this.closer()}
      <div class="mbody">
        <div class="wheel-wrap">
          <canvas width="680" height="680"></canvas>
          <div class="wheel-ptr">${ptr}</div>
          <button class="wheel-go" type="button" data-act="spin"><span class="g1">免费</span><small class="g2">开始</small></button>
          <div class="prize" hidden></div>
        </div>
        <div class="wheel-info"></div>
      </div>`;
  }
  drawWheel() {
    const c = this.sheet.querySelector('canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const n = WHEEL.length;
    const arc = TAU / n;
    const w = c.width;
    const r = w / 2 - 18;
    ctx.clearRect(0, 0, w, w);
    ctx.save();
    ctx.translate(w / 2, w / 2);
    ctx.rotate(this.rot);
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 - arc / 2 + i * arc;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, a0, a0 + arc);
      ctx.closePath();
      ctx.fillStyle = WHEEL[i].color;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r + 2, 0, TAU);
    ctx.lineWidth = 18;
    ctx.strokeStyle = '#8a4b10';
    ctx.stroke();
    const blink = Math.floor(performance.now() / 180) % 2;
    for (let i = 0; i < n * 3; i++) {
      const a = (i / (n * 3)) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * (r + 2), Math.sin(a) * (r + 2), 7, 0, TAU);
      ctx.fillStyle = (i + blink) % 2 ? '#fff' : '#ffe066';
      ctx.fill();
    }
    ctx.rotate(-this.rot);
    for (let i = 0; i < n; i++) {
      const mid = this.rot - Math.PI / 2 + i * arc;
      ctx.save();
      ctx.translate(Math.cos(mid) * r * 0.66, Math.sin(mid) * r * 0.66);
      ctx.fillStyle = '#4a2a12';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 46px "PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
      ctx.fillText(WHEEL[i].label, 0, -13);
      ctx.font = '800 22px "PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
      ctx.fillStyle = 'rgba(74,42,18,.78)';
      ctx.fillText(WHEEL[i].sub, 0, 16);
      ctx.restore();
    }
    ctx.restore();
  }
  updateWheelButton(now) {
    const b = this.sheet.querySelector('.wheel-go');
    const info = this.sheet.querySelector('.wheel-info');
    if (!b || !info) return;
    const ready = this.game.wheelReady(now);
    const gemsOk = this.game.s.gems >= WHEEL_GEM_COST;
    b.disabled = this.spinning || (!ready && !gemsOk);
    b.querySelector('.g1').textContent = this.spinning ? '…' : ready ? '免费' : String(WHEEL_GEM_COST);
    b.querySelector('.g2').textContent = this.spinning ? '' : ready ? '开始' : '钻石再转';
    if (this.spinning) { info.textContent = '好运转动中…'; return; }
    info.innerHTML = ready
      ? '这一转<b>免费</b>，之后每 8 分钟一次'
      : `免费还要 <b>${fmtDur(WHEEL_COOLDOWN - (now - this.game.s.wheel.last))}</b>，或花 ${WHEEL_GEM_COST} 颗钻石`;
  }
  spinWheel() {
    if (this.spinning) return;
    const now = Date.now();
    const res = this.game.spin(now);
    if (!res.ok) { audio.play('error'); this.toast(res.msg, 'bad', 'gem'); return; }
    this.game.save();
    audio.play('whoosh');
    const n = WHEEL.length;
    const arc = TAU / n;
    const cur = ((this.rot % TAU) + TAU) % TAU;
    const want = ((-res.idx * arc) % TAU + TAU) % TAU;
    let delta = want - cur;
    if (delta > 0) delta -= TAU;
    delta -= (6 + Math.floor(Math.random() * 2)) * TAU;
    this.spinning = true;
    this.spin = { from: this.rot, to: this.rot + delta, t0: performance.now(), dur: 4200, idx: res.idx };
    this.lastSlice = null;
    this.updateWheelButton(now);
  }
  updateWheel(dt, now) {
    if (this.modal === 'wheel' && !this.spinning) this.updateWheelButton(now);
    if (!this.spin) return;
    const t = clamp((performance.now() - this.spin.t0) / this.spin.dur, 0, 1);
    const e = 1 - (1 - t) ** 3;
    this.rot = this.spin.from + (this.spin.to - this.spin.from) * e;
    const arc = TAU / WHEEL.length;
    let slice = Math.round(-this.rot / arc);
    slice = ((slice % WHEEL.length) + WHEEL.length) % WHEEL.length;
    if (slice !== this.lastSlice) {
      this.lastSlice = slice;
      if (t < 0.98) audio.play('tick');
    }
    if (this.modal === 'wheel') this.drawWheel();
    if (t >= 1) this.finishSpin();
  }
  finishSpin() {
    const idx = this.spin.idx;
    const landed = this.spin.to;
    this.spin = null;
    this.spinning = false;
    this.rot = ((landed % TAU) + TAU) % TAU;
    this.prizeOn = true;
    const prize = this.game.claimWheel(idx);
    this.game.save();
    audio.play('reward');
    if (prize.type === 'gems' || (prize.type === 'coins' && prize.n >= 666)) this.confetti(120);
    const el = this.sheet.querySelector('.prize');
    const visual = prize.crop ? `<img src="${this.thumb(prize.crop.id)}" alt="">` : icon(prize.type === 'coins' ? 'coin' : prize.type === 'gems' ? 'gem' : prize.type === 'fert' ? 'fert' : 'star');
    if (el) {
      el.innerHTML = `<div class="prize-card"><div class="big">${visual}</div><h3>${esc(prize.text)}</h3><p>恭喜抽中</p><button class="btn gold" type="button" data-act="prize-ok">收下</button></div>`;
      el.hidden = false;
    } else this.toast(`抽中 ${prize.text}`, 'gold');
    if (this.modal === 'wheel') {
      this.drawWheel();
      this.updateWheelButton(Date.now());
    }
  }
  dismissPrize() {
    const el = this.sheet.querySelector('.prize');
    if (el) el.hidden = true;
    this.prizeOn = false;
    audio.play('coin');
    this.flushLevel();
  }

  queueLevel(info) {
    this.levelQueue.push(info);
    this.flushLevel();
  }
  flushLevel() {
    if (this.prizeOn || this.spinning || this.modal === 'levelup') return;
    if (!this.levelQueue.length) return;
    this.open('levelup', false);
  }
  viewLevel() {
    const info = this.levelQueue[0];
    if (!info) return '';
    const crops = info.unlocked.map((c) => `<div><img src="${this.thumb(c.id)}" alt="">${c.name}</div>`).join('');
    return `${this.ribbon('升级啦', 'gold')}${this.closer()}
      <div class="mbody lvup">
        <div class="rays"></div>
        <div class="badge">${info.level}</div>
        <h2>升到 Lv.${info.level}</h2>
        <p style="margin:0;font-weight:800;color:#8a6a4a">岛又热闹了一点</p>
        ${rewardChips({ coins: info.coins, gems: info.gems })}
        ${crops ? `<div class="unl">${crops}</div><p style="margin:4px 0 0;font-weight:800">新作物解锁</p>` : ''}
        ${info.plot ? '<p style="font-weight:900;color:#2a7d16">有一块新地可以开垦了</p>' : ''}
        <div class="pop-actions" style="justify-content:center"><button class="btn big gold" type="button" data-act="close">太棒了</button></div>
      </div>`;
  }
  viewBack() {
    const w = this.game.welcome;
    if (!w) return '';
    const lines = [`你离开了 ${fmtDur(w.away)}`];
    if (w.matured) lines.push(`${w.matured} 块作物已经成熟，正发着光`);
    if (w.thefts) lines.push(`离家时有 ${w.thefts} 次偷菜`);
    if (!w.matured && !w.thefts) lines.push('菜地安安静静，一切都好');
    return `${this.ribbon('欢迎回来', 'gold')}${this.closer()}
      <div class="mbody" style="text-align:center">
        <div style="font-size:64px;line-height:1.2">🌾</div>
        ${lines.map((t) => `<p style="margin:6px 0;font-weight:800">${esc(t)}</p>`).join('')}
        <div class="pop-actions" style="justify-content:center"><button class="btn gold" type="button" data-act="close">去看看</button></div>
      </div>`;
  }

  viewSettings() {
    const s = this.game.s.settings;
    const q = this.game.s.settings.quality;
    const seg = (val, label) => `<button type="button" data-quality="${val}" class="${q === val ? 'on' : ''}">${label}</button>`;
    return `${this.ribbon('设置', 'gray')}${this.closer()}
      <div class="mbody">
        <div class="set-row"><div>农场名字<small>会出现在门口的木牌上</small></div><input id="nameInput" class="name-input" maxlength="10" value="${esc(this.game.s.name)}"></div>
        <div class="set-row"><div>音效<small>浇水、收菜、狗叫</small></div><button type="button" class="toggle ${s.sound ? 'on' : ''}" data-toggle="sound" aria-label="音效"></button></div>
        <div class="set-row"><div>音乐<small>一段自己长出来的小岛曲子</small></div><button type="button" class="toggle ${s.music ? 'on' : ''}" data-toggle="music" aria-label="音乐"></button></div>
        <div class="set-row"><div>画质<small>当前是${this.world.quality === 'high' ? '精致' : '流畅'}</small></div><div class="seg">${seg('auto', '自动')}${seg('high', '精致')}${seg('low', '流畅')}</div></div>
        <div class="set-row"><div>重新开始<small>清空这块岛上的一切</small></div><button class="btn sm red" type="button" data-act="reset">${this.resetArm ? '再点一次确认' : '清空存档'}</button></div>
        <div class="help">
          <div><kbd>1</kbd>–<kbd>7</kbd> 切换工具，点地或按住拖动连续操作</div>
          <div>拖空白处平移，右键拖动旋转，滚轮缩放，<kbd>R</kbd> 回到默认视角</div>
          <div>手机上单指操作，双指同时缩放和旋转。作物按真实时间生长，关掉页面也会长</div>
        </div>
      </div>`;
  }
  toggleSetting(key) {
    const s = this.game.s.settings;
    s[key] = !s[key];
    if (key === 'sound') audio.setSfx(s.sound);
    if (key === 'music') audio.setMusic(s.music);
    audio.play('click');
    this.game.save();
    this.render();
  }
  setQualitySetting(q) {
    this.game.s.settings.quality = q;
    this.world.setQuality(q === 'auto' ? autoQuality() : q);
    audio.play('click');
    this.game.save();
    this.render();
  }
  armReset(b) {
    if (!this.resetArm) {
      this.resetArm = true;
      b.textContent = '再点一次确认';
      clearTimeout(this.resetT);
      this.resetT = setTimeout(() => { this.resetArm = false; if (this.modal === 'settings') this.render(); }, 2400);
      return;
    }
    this.game.reset();
  }
  ribbon(text, color) {
    return `<div class="ribbon ${color}">${text}</div>`;
  }
  closer() {
    return `<button class="mclose" type="button" data-act="close" aria-label="关闭">${icon('close')}</button>`;
  }

  bind() {
    this.bar.addEventListener('click', (e) => {
      const b = e.target.closest('.tool');
      if (b) this.pickTool(b.dataset.tool);
    });
    $('#side').addEventListener('click', (e) => {
      const b = e.target.closest('[data-open]');
      if (b) this.open(b.dataset.open);
    });
    $('#homeBtn').addEventListener('click', () => this.goHome());
    $('#harvestAll').addEventListener('click', () => this.onHarvestAll?.());
    $('#hintClose').addEventListener('click', () => {
      this.hintDismissed = this.game.s.tut;
      this.syncHint();
    });
    this.coinBtn.addEventListener('click', () => { this.shopTab = 'seed'; this.open('shop'); });
    this.gemBtn.addEventListener('click', () => { this.shopTab = 'item'; this.open('shop'); });
    this.profile.addEventListener('click', () => this.open('settings'));
    this.mask.addEventListener('click', () => this.close());
    this.sheet.addEventListener('click', (e) => this.onSheetClick(e));
    this.sheet.addEventListener('change', (e) => {
      if (e.target.id !== 'nameInput') return;
      const v = e.target.value.trim().slice(0, 10) || '阳光农场';
      this.game.s.name = v;
      this.farmName.textContent = v;
      if (!this.game.visiting) this.world.setSign(v, '欢迎光临');
      this.game.save();
    });
    this.popEl.addEventListener('click', (e) => this.onPopClick(e));
    document.addEventListener('pointerdown', (e) => {
      if (this.popEl.hidden) return;
      if (e.target.closest('#pop, .tool')) return;
      this.closePop();
    });
    addEventListener('resize', () => this.resizeConfetti());
  }
  onPopClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    audio.play('click');
    if (b.dataset.x != null) return this.closePop();
    if (b.dataset.shop != null) { this.closePop(); this.shopTab = 'seed'; this.open('shop'); return; }
    if (b.dataset.seed) {
      this.seedId = b.dataset.seed;
      const plot = this.popState?.plot;
      this.closePop();
      this.setTool('seed');
      if (plot != null) this.onPlant?.(plot, this.seedId);
      return;
    }
    if (b.dataset.fert) {
      this.fertId = b.dataset.fert;
      this.closePop();
      this.setTool('fert');
      return;
    }
    if (b.dataset.unlock != null) {
      const i = +b.dataset.unlock;
      this.closePop();
      this.onUnlock?.(i);
    }
  }
}
