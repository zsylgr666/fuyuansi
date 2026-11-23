import {
  CROPS, CROP, STAGE_AT, levelNeed, PLOT_COUNT, UNLOCK_ORDER, UNLOCK_REQ, ITEMS,
  NEIGHBORS, WHEEL, WHEEL_COOLDOWN, WHEEL_GEM_COST, QUEST_POOL,
} from './data.js';
import { rng, hashStr } from './geo.js';

const KEY = 'harvest-isle-save-v1';
const MIN_PROBLEM_GAP = 14000;

export const TUT = ['harvest', 'clear', 'plant', 'care', 'sell', 'visit', 'steal'];

function growing(def, now, frac, extra = {}) {
  return { unlocked: true, state: 'growing', crop: def.id, t0: now - frac * def.grow * 1000, boost: 0, season: 1, weeds: 0, bugs: 0, dry: false, stolen: 0, next: now + 20000, ...extra };
}

function newState(now) {
  const plots = Array.from({ length: PLOT_COUNT }, () => ({ unlocked: false, state: 'empty' }));
  UNLOCK_ORDER.slice(0, 6).forEach((idx) => (plots[idx].unlocked = true));
  const [a, b, c, d] = UNLOCK_ORDER;
  plots[a] = growing(CROP.carrot, now, 1.2);
  plots[b] = growing(CROP.carrot, now, 1.05);
  plots[c] = growing(CROP.wheat, now, 0.5, { weeds: 1 });
  plots[d] = growing(CROP.wheat, now, 0.42, { bugs: 1, dry: true });
  return {
    v: 1, name: '阳光农场', avatar: '🧑‍🌾', coins: 200, gems: 5, xp: 0, level: 1, plots,
    seeds: { carrot: 4, wheat: 2 }, barn: {}, items: { fert: 2, superFert: 0 },
    stats: { plants: 0, harvests: 0, steals: 0, helps: 0, earned: 0 },
    wheel: { last: 0 }, nb: {}, quests: [], tut: 0,
    settings: { sound: true, music: true, quality: 'auto' },
    log: [], lastSeen: now, nextThief: now + 75000,
  };
}

export class Game {
  constructor() {
    const now = Date.now();
    this.handlers = {};
    this.farmCache = {};
    this.visiting = null;
    let s = null;
    try {
      s = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (e) {
      s = null;
    }
    this.fresh = !s || s.v !== 1;
    this.s = this.fresh ? newState(now) : s;
    if (!this.s.quests.length) {
      const used = [];
      for (let i = 0; i < 3; i++) {
        const q = this.newQuest(0, used);
        used.push(q.k);
        this.s.quests.push(q);
      }
    }
    this.rainUntil = 0;
    this.nextRain = now + 150000 + Math.random() * 60000;
    this.welcome = this.fresh ? null : this.offline(now);
  }

  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
  }
  emit(type, data) {
    (this.handlers[type] || []).forEach((fn) => fn(data));
    if (type !== 'change') (this.handlers.change || []).forEach((fn) => fn(type));
  }
  save() {
    this.s.lastSeen = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch (e) {
      /* 隐私模式下存不了就算了 */
    }
  }
  reset() {
    localStorage.removeItem(KEY);
    location.reload();
  }
  logEvent(text) {
    this.s.log.unshift({ t: Date.now(), text });
    this.s.log.length = Math.min(this.s.log.length, 30);
  }

  /* ---------- 查询 ---------- */
  get plots() {
    return this.visiting ? this.visiting.plots : this.s.plots;
  }
  progress(p, now) {
    return (now - p.t0 + (p.boost || 0)) / (CROP[p.crop].grow * 1000);
  }
  stage(p, now) {
    const f = this.progress(p, now);
    for (let k = 4; k >= 0; k--) if (f >= STAGE_AT[k]) return k;
    return 0;
  }
  remaining(p, now) {
    return Math.max(0, (1 - this.progress(p, now)) * CROP[p.crop].grow * 1000);
  }
  isMature(p, now) {
    return p.unlocked && p.state === 'growing' && this.stage(p, now) === 4;
  }
  nextUnlock() {
    const own = this.s.plots;
    const k = UNLOCK_ORDER.findIndex((idx) => !own[idx].unlocked);
    return k < 0 ? null : { idx: UNLOCK_ORDER[k], req: UNLOCK_REQ[k] };
  }
  viewModels(now) {
    const next = this.visiting ? null : this.nextUnlock();
    return this.plots.map((p, i) => ({
      locked: !p.unlocked,
      nextUnlock: !!next && next.idx === i,
      state: p.state,
      crop: p.crop,
      stage: p.state === 'growing' ? this.stage(p, now) : 0,
      dry: !!p.dry,
      weeds: p.weeds || 0,
      bugs: p.bugs || 0,
    }));
  }
  maturedCount(now) {
    return this.s.plots.filter((p) => this.isMature(p, now)).length;
  }
  need() {
    return levelNeed(this.s.level);
  }

  /* ---------- 资源 ---------- */
  addCoins(n) {
    this.s.coins += n;
    if (n > 0) this.s.stats.earned += n;
  }
  addXP(n) {
    const s = this.s;
    s.xp += n;
    while (s.xp >= levelNeed(s.level)) {
      s.xp -= levelNeed(s.level);
      s.level++;
      const coins = 40 * s.level, gems = s.level % 5 === 0 ? 5 : 2;
      s.coins += coins;
      s.gems += gems;
      const unlocked = CROPS.filter((c) => c.lv === s.level);
      const plot = UNLOCK_REQ.some((r) => r && r.lv === s.level);
      this.emit('levelup', { level: s.level, coins, gems, unlocked, plot });
    }
  }
  give(reward) {
    if (reward.coins) this.addCoins(reward.coins);
    if (reward.gems) this.s.gems += reward.gems;
    if (reward.fert) this.s.items.fert += reward.fert;
    if (reward.xp) this.addXP(reward.xp);
  }
  tut(step) {
    if (TUT[this.s.tut] === step) {
      this.s.tut++;
      this.emit('tut', this.s.tut);
    }
  }

  /* ---------- 自家农场 ---------- */
  plant(i, id, now) {
    const p = this.s.plots[i], def = CROP[id];
    if (!p.unlocked) return { ok: false, msg: '这块地还没开垦' };
    if (p.state !== 'empty') return { ok: false, msg: p.state === 'withered' ? '先用铲子把枯萎的植株铲掉' : '这里已经种上啦' };
    if (!(this.s.seeds[id] > 0)) return { ok: false, msg: `没有${def.name}种子了，去商店买点吧`, shop: true };
    this.s.seeds[id]--;
    Object.assign(p, growing(def, now, 0, { next: now + Math.max(MIN_PROBLEM_GAP, def.grow * 1000 * (0.25 + Math.random() * 0.3)) }));
    this.s.stats.plants++;
    this.addXP(1);
    this.questProgress('plant', 1);
    this.tut('plant');
    this.emit('plant', i);
    return { ok: true, xp: 1 };
  }
  harvest(i, now) {
    const p = this.s.plots[i];
    if (!this.isMature(p, now)) return { ok: false, msg: '还没成熟呢' };
    const def = CROP[p.crop];
    const problems = (p.weeds || 0) + (p.bugs || 0) + (p.dry ? 1 : 0);
    let n = Math.max(1, Math.round(def.yield * (1 - 0.12 * problems)) - (p.stolen || 0));
    const bumper = Math.random() < 0.12;
    if (bumper) n = Math.ceil(n * 1.6);
    this.s.barn[def.id] = (this.s.barn[def.id] || 0) + n;
    this.addXP(def.xp);
    this.s.stats.harvests++;
    if (p.season < def.seasons) {
      Object.assign(p, { season: p.season + 1, t0: now - 0.5 * def.grow * 1000, boost: 0, weeds: 0, bugs: 0, dry: false, stolen: 0, next: now + Math.max(MIN_PROBLEM_GAP, def.grow * 300) });
    } else {
      Object.assign(p, { state: 'withered', weeds: 0, bugs: 0, dry: false, stolen: 0 });
    }
    this.questProgress('harvest', 1);
    this.tut('harvest');
    return { ok: true, n, crop: def, xp: def.xp, bumper };
  }
  clear(i) {
    const p = this.s.plots[i];
    if (p.state !== 'withered') return { ok: false, msg: p.state === 'growing' ? '作物还在长，别铲啦' : '这里没有需要铲除的东西' };
    Object.assign(p, { state: 'empty', crop: null });
    this.addXP(2);
    this.tut('clear');
    return { ok: true, xp: 2 };
  }
  care(i, kind) {
    const p = this.s.plots[i];
    if (p.state !== 'growing') return { ok: false, msg: '这里没有作物' };
    if (kind === 'water' && !p.dry) return { ok: false, msg: '土还湿着呢，不用浇水' };
    if (kind === 'weed' && !p.weeds) return { ok: false, msg: '这里没有杂草' };
    if (kind === 'bug' && !p.bugs) return { ok: false, msg: '这里没有虫子' };
    if (kind === 'water') p.dry = false;
    if (kind === 'weed') p.weeds--;
    if (kind === 'bug') p.bugs--;
    this.addXP(2);
    this.questProgress('care', 1);
    this.tut('care');
    return { ok: true, xp: 2, kind };
  }
  firstProblem(p) {
    if (p.state !== 'growing') return null;
    if (p.bugs) return 'bug';
    if (p.weeds) return 'weed';
    if (p.dry) return 'water';
    return null;
  }
  fertilize(i, type, now) {
    const p = this.s.plots[i];
    if (p.state !== 'growing') return { ok: false, msg: '只能给正在生长的作物施肥' };
    const st = this.stage(p, now);
    if (st >= 4) return { ok: false, msg: '已经成熟啦，快收获吧' };
    if (!(this.s.items[type] > 0)) return { ok: false, msg: `没有${ITEMS[type].name}了`, shop: true };
    this.s.items[type]--;
    const def = CROP[p.crop];
    const target = type === 'superFert' ? 1 : STAGE_AT[st + 1];
    p.boost = (p.boost || 0) + (target - this.progress(p, now)) * def.grow * 1000 + 50;
    return { ok: true, stage: this.stage(p, now) };
  }
  unlock(i) {
    const next = this.nextUnlock();
    if (!next || next.idx !== i) return { ok: false, msg: '要先开垦前面的土地哦' };
    const { lv, coins } = next.req;
    if (this.s.level < lv) return { ok: false, msg: `需要等级 Lv.${lv}` };
    if (this.s.coins < coins) return { ok: false, msg: `金币不够，需要 ${coins}`, shop: false };
    this.s.coins -= coins;
    this.s.plots[i].unlocked = true;
    this.addXP(10);
    return { ok: true };
  }

  /* ---------- 商店 / 仓库 ---------- */
  buySeed(id, n) {
    const def = CROP[id];
    if (this.s.level < def.lv) return { ok: false, msg: `Lv.${def.lv} 才能买` };
    const cost = def.seed * n;
    if (this.s.coins < cost) return { ok: false, msg: '金币不够啦' };
    this.s.coins -= cost;
    this.s.seeds[id] = (this.s.seeds[id] || 0) + n;
    return { ok: true, cost };
  }
  buyItem(id, n) {
    const it = ITEMS[id];
    const cost = it.price * n;
    const wallet = it.currency === 'gems' ? 'gems' : 'coins';
    if (this.s[wallet] < cost) return { ok: false, msg: wallet === 'gems' ? '钻石不够啦' : '金币不够啦' };
    this.s[wallet] -= cost;
    this.s.items[id] = (this.s.items[id] || 0) + n;
    return { ok: true };
  }
  sell(id, n) {
    const have = this.s.barn[id] || 0;
    n = Math.min(n, have);
    if (n <= 0) return { ok: false, msg: '没有可以卖的' };
    const coins = n * CROP[id].price;
    this.s.barn[id] = have - n;
    this.addCoins(coins);
    this.questProgress('sell', coins);
    this.tut('sell');
    return { ok: true, coins };
  }
  sellAll() {
    let total = 0;
    for (const id in this.s.barn) {
      const r = this.sell(id, this.s.barn[id]);
      if (r.ok) total += r.coins;
    }
    return total ? { ok: true, coins: total } : { ok: false, msg: '仓库里没有果实' };
  }
  barnValue() {
    return Object.entries(this.s.barn).reduce((a, [id, n]) => a + n * CROP[id].price, 0);
  }

  /* ---------- 转盘 ---------- */
  wheelReady(now) {
    return now - this.s.wheel.last >= WHEEL_COOLDOWN;
  }
  spin(now) {
    if (!this.wheelReady(now)) {
      if (this.s.gems < WHEEL_GEM_COST) return { ok: false, msg: `钻石不够，需要 ${WHEEL_GEM_COST} 颗` };
      this.s.gems -= WHEEL_GEM_COST;
    } else {
      this.s.wheel.last = now;
    }
    const total = WHEEL.reduce((a, w) => a + w.weight, 0);
    let x = Math.random() * total, idx = 0;
    for (; idx < WHEEL.length - 1; idx++) {
      x -= WHEEL[idx].weight;
      if (x < 0) break;
    }
    return { ok: true, idx };
  }
  claimWheel(idx) {
    const w = WHEEL[idx];
    if (w.type === 'coins') this.addCoins(w.n);
    if (w.type === 'gems') this.s.gems += w.n;
    if (w.type === 'fert') this.s.items.fert += w.n;
    if (w.type === 'xp') this.addXP(w.n);
    if (w.type === 'seeds') {
      const pool = CROPS.filter((c) => c.lv <= Math.max(2, this.s.level));
      const def = pool[Math.floor(Math.random() * pool.length)];
      this.s.seeds[def.id] = (this.s.seeds[def.id] || 0) + w.n;
      return { ...w, text: `${def.name}种子 ×${w.n}`, crop: def };
    }
    return { ...w, text: `${w.sub} ×${w.n}` };
  }

  /* ---------- 任务 ---------- */
  newQuest(tier, exclude = []) {
    const pool = QUEST_POOL.filter((q) => !exclude.includes(q.k));
    const q = pool[Math.floor(Math.random() * pool.length)];
    return { k: q.k, target: q.base + q.step * tier, prog: 0, tier };
  }
  questProgress(k, n) {
    let changed = false;
    for (const q of this.s.quests) {
      if (q.k === k && q.prog < q.target) {
        q.prog = Math.min(q.target, q.prog + n);
        changed = true;
      }
    }
    if (changed) this.emit('quest');
  }
  claimQuest(i) {
    const q = this.s.quests[i];
    if (!q || q.prog < q.target) return { ok: false };
    const def = QUEST_POOL.find((d) => d.k === q.k);
    const reward = def.reward;
    this.give(reward);
    this.s.quests[i] = this.newQuest(q.tier + 1, this.s.quests.map((x) => x.k));
    return { ok: true, reward };
  }
  questsReady() {
    return this.s.quests.filter((q) => q.prog >= q.target).length;
  }

  /* ---------- 好友 ---------- */
  memo(nb, now) {
    const win = Math.floor(now / 240000);
    const m = (this.s.nb[nb.id] ||= { win: -1, stolen: [], helped: 0 });
    if (m.win !== win) Object.assign(m, { win, stolen: [], helped: 0 });
    return m;
  }
  farmFor(nb, now) {
    const win = Math.floor(now / 240000);
    this.memo(nb, now);
    const cache = this.farmCache[nb.id];
    if (cache && cache.win === win) return cache.plots;
    const r = rng(hashStr(nb.id) ^ (win * 7919));
    const unlockedN = Math.min(PLOT_COUNT, 6 + Math.floor(nb.lv * 0.55));
    const avail = CROPS.filter((c) => c.lv <= nb.lv);
    const plots = Array.from({ length: PLOT_COUNT }, () => ({ unlocked: false, state: 'empty' }));
    UNLOCK_ORDER.forEach((idx, k) => {
      if (k >= unlockedN) return;
      const p = plots[idx];
      p.unlocked = true;
      const roll = r();
      if (roll < 0.08) return;
      const def = avail[Math.floor(r() * avail.length)];
      if (roll < 0.15) return Object.assign(p, { state: 'withered', crop: def.id });
      const frac = 0.3 + r() * 1.3;
      Object.assign(p, growing(def, now, frac, {
        weeds: r() < 0.25 ? 1 + Math.floor(r() * 2) : 0,
        bugs: r() < 0.22 ? 1 + Math.floor(r() * 2) : 0,
        dry: r() < 0.2,
        stolen: frac >= 1 ? Math.floor(r() * def.yield * 0.3) : 0,
      }));
    });
    this.farmCache[nb.id] = { win, plots };
    return plots;
  }
  stealable(p, i, m, now) {
    if (!this.isMature(p, now) || m.stolen.includes(i)) return false;
    const def = CROP[p.crop];
    return def.yield - (p.stolen || 0) > Math.ceil(def.yield * 0.5);
  }
  canSteal(i, now) {
    const v = this.visiting;
    return !!v && this.stealable(v.plots[i], i, this.memo(v.nb, now), now);
  }
  neighborStatus(nb, now) {
    const plots = this.farmFor(nb, now);
    const m = this.memo(nb, now);
    let ripe = 0, help = 0;
    plots.forEach((p, i) => {
      if (this.stealable(p, i, m, now)) ripe++;
      if (p.state === 'growing') help += (p.weeds || 0) + (p.bugs || 0) + (p.dry ? 1 : 0);
    });
    return { ripe, help };
  }
  visit(nb, now) {
    this.visiting = { nb, plots: this.farmFor(nb, now) };
    this.tut('visit');
  }
  goHome() {
    this.visiting = null;
  }
  steal(i, now) {
    const v = this.visiting, p = v.plots[i];
    if (!p.unlocked || p.state !== 'growing') return { ok: false, msg: '这里没什么可偷的' };
    if (this.stage(p, now) < 4) return { ok: false, msg: '还没成熟，偷了也没用' };
    const def = CROP[p.crop], m = this.memo(v.nb, now);
    if (m.stolen.includes(i)) return { ok: false, msg: '这块地偷过啦，给人家留点吧' };
    const keep = Math.ceil(def.yield * 0.5);
    const left = def.yield - p.stolen;
    if (left <= keep) return { ok: false, msg: '已经被别人偷得差不多了…' };
    m.stolen.push(i);
    if (v.nb.dog && Math.random() < 0.18) {
      const loss = Math.min(this.s.coins, 8 + Math.floor(Math.random() * 12));
      this.s.coins -= loss;
      this.logEvent(`偷${v.nb.name}家的${def.name}时被${v.nb.dogName}咬了，赔了 ${loss} 金币`);
      return { ok: true, bitten: true, loss, crop: def };
    }
    const n = Math.max(1, Math.min(left - keep, 1 + (def.yield >= 5 ? Math.floor(Math.random() * 2) : 0)));
    p.stolen += n;
    this.s.barn[def.id] = (this.s.barn[def.id] || 0) + n;
    this.s.stats.steals++;
    this.addXP(1);
    this.questProgress('steal', 1);
    this.tut('steal');
    return { ok: true, n, crop: def, xp: 1 };
  }
  help(i, kind, now) {
    const v = this.visiting, p = v.plots[i];
    if (p.state !== 'growing') return { ok: false, msg: '这块地不需要帮忙' };
    kind = kind === 'auto' ? this.firstProblem(p) : kind;
    if (!kind) return { ok: false, msg: '这块地好好的，不用帮忙' };
    if ((kind === 'water' && !p.dry) || (kind === 'weed' && !p.weeds) || (kind === 'bug' && !p.bugs)) return { ok: false, msg: kind === 'water' ? '不缺水' : kind === 'weed' ? '没有杂草' : '没有虫子' };
    const m = this.memo(v.nb, now);
    if (m.helped >= 12) return { ok: false, msg: `今天帮${v.nb.name}帮得够多啦` };
    m.helped++;
    if (kind === 'water') p.dry = false;
    if (kind === 'weed') p.weeds--;
    if (kind === 'bug') p.bugs--;
    this.addXP(3);
    this.addCoins(2);
    this.s.stats.helps++;
    this.questProgress('help', 1);
    return { ok: true, xp: 3, coins: 2, kind };
  }

  /* ---------- 时间推进 ---------- */
  tick(now) {
    const s = this.s;
    s.plots.forEach((p, i) => {
      if (p.state !== 'growing' || !p.unlocked) return;
      const st = this.stage(p, now);
      if (st < 1 || st > 3 || now < p.next) return;
      const def = CROP[p.crop];
      p.next = now + Math.max(MIN_PROBLEM_GAP, def.grow * 1000 * (0.25 + Math.random() * 0.35));
      const kinds = [];
      if (!p.dry && !(this.rainUntil > now)) kinds.push('water', 'water');
      if ((p.weeds || 0) < 3) kinds.push('weed', 'weed');
      if ((p.bugs || 0) < 3) kinds.push('bug');
      if (!kinds.length || Math.random() < 0.3) return;
      const k = kinds[Math.floor(Math.random() * kinds.length)];
      if (k === 'water') p.dry = true;
      if (k === 'weed') p.weeds = (p.weeds || 0) + 1;
      if (k === 'bug') p.bugs = (p.bugs || 0) + 1;
      this.emit('problem', { plot: i, kind: k });
    });
    if (now >= s.nextThief) {
      s.nextThief = now + 70000 + Math.random() * 80000;
      this.thief(now);
    }
    if (!this.rainUntil && now >= this.nextRain) {
      this.rainUntil = now + 32000 + Math.random() * 18000;
      let n = 0;
      s.plots.forEach((p) => {
        if (p.dry) { p.dry = false; n++; }
      });
      this.emit('rain', { on: true, watered: n });
    } else if (this.rainUntil && now >= this.rainUntil) {
      this.rainUntil = 0;
      this.nextRain = now + 200000 + Math.random() * 160000;
      this.emit('rain', { on: false });
    }
  }
  thief(now, silent = false) {
    const cands = this.s.plots.map((p, i) => i).filter((i) => {
      const p = this.s.plots[i];
      return this.isMature(p, now) && p.stolen < CROP[p.crop].yield * 0.4;
    });
    if (!cands.length || (!silent && Math.random() < 0.35)) return null;
    const i = cands[Math.floor(Math.random() * cands.length)];
    const p = this.s.plots[i], def = CROP[p.crop];
    const nb = NEIGHBORS[Math.floor(Math.random() * NEIGHBORS.length)];
    const caught = Math.random() < 0.4;
    let ev;
    if (caught) {
      const reward = 5 + Math.floor(Math.random() * 10);
      this.addCoins(reward);
      this.logEvent(`旺财赶跑了来偷${def.name}的${nb.name}，捡到 ${reward} 金币`);
      ev = { nb, plot: i, caught, reward, crop: def };
    } else {
      const n = 1 + (def.yield >= 5 ? Math.floor(Math.random() * 2) : 0);
      p.stolen = (p.stolen || 0) + n;
      this.logEvent(`${nb.name} 偷走了你 ${n} 个${def.name}`);
      ev = { nb, plot: i, caught, n, crop: def };
    }
    if (!silent) this.emit('thief', ev);
    return ev;
  }
  offline(now) {
    const away = now - (this.s.lastSeen || now);
    if (away < 60000) return null;
    this.s.plots.forEach((p) => {
      if (p.state === 'growing' && p.next && p.next < now && this.stage(p, now) < 4 && Math.random() < 0.6) {
        const k = ['dry', 'weeds', 'bugs'][Math.floor(Math.random() * 3)];
        if (k === 'dry') p.dry = true; else p[k] = Math.min(3, (p[k] || 0) + 1);
      }
    });
    let thefts = 0;
    const tries = Math.min(3, Math.floor(away / 150000));
    for (let k = 0; k < tries; k++) if (this.thief(now, true)) thefts++;
    return { away, matured: this.maturedCount(now), thefts };
  }
}
