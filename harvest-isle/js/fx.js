import * as THREE from 'three';
import { Builder, M, mul, P, MAT } from './geo.js';

const V3 = THREE.Vector3;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new V3();
const _v = new V3();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const seg = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

class Pool {
  constructor(scene, geo, mat, n) {
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.n = n;
    this.next = 0;
    this.items = [];
    for (let i = 0; i < n; i++) {
      this.items.push({ alive: false, p: new V3(), v: new V3(), rot: new V3(), spin: new V3(), life: 0, max: 1, size: 0.1, g: 9, drag: 0, bounce: true, floor: 0.3, twinkle: false });
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setColorAt(i, _c.set(1, 1, 1));
    }
    scene.add(this.mesh);
  }
  spawn(color, mult = 1) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const it = this.items[i];
    it.alive = true;
    it.life = 0;
    _c.set(color).multiplyScalar(mult);
    this.mesh.setColorAt(i, _c);
    this.mesh.instanceColor.needsUpdate = true;
    return it;
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      const it = this.items[i];
      if (!it.alive) continue;
      any = true;
      it.life += dt;
      if (it.life >= it.max) {
        it.alive = false;
        this.mesh.setMatrixAt(i, ZERO);
        continue;
      }
      it.v.y -= it.g * dt;
      if (it.drag) it.v.multiplyScalar(Math.max(0, 1 - it.drag * dt));
      it.p.addScaledVector(it.v, dt);
      if (it.bounce && it.p.y < it.floor) {
        it.p.y = it.floor;
        it.v.y *= -0.35;
        it.v.x *= 0.55;
        it.v.z *= 0.55;
      }
      const f = it.life / it.max;
      let s = it.size;
      if (it.twinkle) s *= Math.sin(Math.PI * f) * (0.75 + 0.25 * Math.sin(it.life * 30));
      else if (f > 0.7) s *= (1 - f) / 0.3;
      _e.set(it.rot.x + it.spin.x * it.life, it.rot.y + it.spin.y * it.life, it.rot.z + it.spin.z * it.life);
      _q.setFromEuler(_e);
      _m.compose(it.p, _q, _s.set(s, s, s));
      this.mesh.setMatrixAt(i, _m);
    }
    if (any || this.dirty) this.mesh.instanceMatrix.needsUpdate = true;
    this.dirty = any;
  }
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.bits = new Pool(scene, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.6 }), 700);
    this.bits.mesh.castShadow = true;
    this.glows = new Pool(scene, new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), 400);
    this.rings = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.visible = false;
      m.userData.t = 1;
      scene.add(m);
      this.rings.push(m);
    }
    this.anims = [];
    this.models = {};
  }

  burst(pos, o = {}) {
    const { n = 12, colors = ['#ffffff'], speed = 2.5, up = 3, size = 0.08, life = 0.9, g = 9, glow = false, spread = 0.4, bounce = true, drag = 0, mult = 2.6, floor = 0.3, dir = null } = o;
    const pool = glow ? this.glows : this.bits;
    for (let k = 0; k < n; k++) {
      const it = pool.spawn(colors[Math.floor(Math.random() * colors.length)], glow ? mult : 1);
      it.p.set(pos.x + (Math.random() - 0.5) * spread, pos.y + Math.random() * 0.15, pos.z + (Math.random() - 0.5) * spread);
      const a = Math.random() * Math.PI * 2, sp = speed * (0.35 + Math.random() * 0.65);
      it.v.set(Math.cos(a) * sp, up * (0.55 + Math.random() * 0.6), Math.sin(a) * sp);
      if (dir) it.v.add(dir);
      it.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      it.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
      it.size = size * (0.6 + Math.random() * 0.7);
      it.max = life * (0.7 + Math.random() * 0.6);
      it.g = g;
      it.drag = drag;
      it.bounce = bounce;
      it.floor = floor;
      it.twinkle = glow;
    }
  }

  ring(pos, color = '#ffe066', scale = 2.2, dur = 0.7) {
    const m = this.rings.find((r) => r.userData.t >= 1) || this.rings[0];
    m.position.set(pos.x, 0.35, pos.z);
    m.material.color.set(color).multiplyScalar(2);
    m.userData = { t: 0, scale, dur };
    m.visible = true;
  }

  sparkleColumn(pos, colors = ['#fff3a0', '#ffd23f', '#ffffff']) {
    this.burst(pos, { n: 22, colors, glow: true, speed: 0.9, up: 2.6, g: -0.6, size: 0.07, life: 1.3, spread: 1.8, bounce: false, drag: 1.2 });
  }

  /* ---------- 工具模型 ---------- */
  model(kind) {
    if (this.models[kind]) return this.models[kind];
    const b = new Builder(3);
    switch (kind) {
      case 'can':
        b.add(P.cylC(10), M(0, 0, 0, 0, 0, 0, 0.24, 0.34, 0.24), '#38b6ee', 0.03);
        b.add(P.cylC(10), M(0, 0.18, 0, 0, 0, 0, 0.18, 0.04, 0.18), '#2a8fc2', 0.03);
        b.add(P.cylC(6), M(0.3, 0.08, 0, 0, 0, -0.95, 0.04, 0.42, 0.04), '#2a8fc2', 0.03);
        b.add(P.cone(8), M(0.47, 0.22, 0, 0, 0, -0.95 - Math.PI, 0.08, 0.1, 0.08), '#ffcf3f', 0.03);
        b.add(P.torus(), M(-0.24, 0.02, 0, 0, 0, Math.PI / 2, 0.17, 0.17, 0.17), '#2a8fc2', 0.03);
        b.add(P.box(), M(-0.05, -0.05, 0.245, 0, 0, 0, 0.14, 0.1, 0.01), '#ffffff', 0.02);
        break;
      case 'spray':
        b.add(P.cylC(8), M(0, 0, 0, 0, 0, 0, 0.11, 0.36, 0.11), '#b06ce0', 0.03);
        b.add(P.boxC(), M(0.03, 0.24, 0, 0, 0, 0, 0.16, 0.12, 0.1), '#ffd23f', 0.03);
        b.add(P.cylC(6), M(0.15, 0.25, 0, 0, 0, Math.PI / 2, 0.025, 0.12, 0.025), '#333333', 0.03);
        b.add(P.boxC(), M(-0.02, 0.15, 0, 0, 0, 0.4, 0.04, 0.12, 0.05), '#ffd23f', 0.03);
        b.add(P.box(), M(0, -0.04, 0.11, 0, 0, 0, 0.12, 0.1, 0.01), '#9ad66b', 0.02);
        break;
      case 'sickle':
        b.add(P.boxC(), M(0, -0.2, 0, 0, 0, 0, 0.06, 0.4, 0.06), '#8a5a2b', 0.05);
        for (let i = 0; i < 5; i++) {
          const a = 0.2 + i * 0.42;
          b.add(P.boxC(), M(Math.cos(a) * 0.22 - 0.0, Math.sin(a) * 0.22 + 0.02, 0, 0, 0, a + Math.PI / 2, 0.14, 0.035, 0.015), '#d6dde2', 0.04);
        }
        break;
      case 'shovel':
        b.add(P.boxC(), M(0, 0.35, 0, 0, 0, 0, 0.05, 0.9, 0.05), '#8a5a2b', 0.05);
        b.add(P.boxC(), M(0, 0.82, 0, 0, 0, 0, 0.22, 0.05, 0.05), '#6b3d1c', 0.05);
        b.add(P.boxC(), M(0, -0.18, 0, 0, 0, 0, 0.26, 0.3, 0.03), '#b8c4cc', 0.04);
        b.add(P.cone(4), M(0, -0.33, 0, Math.PI, Math.PI / 4, 0, 0.18, 0.1, 0.02), '#b8c4cc', 0.04);
        break;
      case 'bag':
        b.add(P.boxC(), M(0, 0, 0, 0, 0, 0, 0.36, 0.44, 0.2), '#e8c27a', 0.04);
        b.add(P.boxC(), M(0, 0.25, 0, 0, 0, 0, 0.3, 0.08, 0.16), '#d4a95e', 0.04);
        b.add(P.box(), M(0, -0.08, 0.101, 0, 0, 0, 0.2, 0.16, 0.01), '#5cc93b', 0.03);
        break;
      case 'pouch':
        b.add(P.ico(1), M(0, 0, 0, 0, 0, 0, 0.2, 0.22, 0.18), '#c8925a', 0.05);
        b.add(P.cylC(8), M(0, 0.2, 0, 0, 0, 0, 0.1, 0.06, 0.1), '#a87543', 0.05);
        b.add(P.cylC(8), M(0, 0.18, 0, 0, 0, 0, 0.12, 0.02, 0.12), '#e53935', 0.03);
        break;
    }
    const g = b.group({ mats: { std: MAT.std } });
    g.visible = false;
    this.scene.add(g);
    this.models[kind] = g;
    return g;
  }

  play(kind, pos, opts = {}) {
    const p = pos.clone();
    const top = new V3(p.x, 0.55, p.z);
    const A = (modelKind, dur, fn) => {
      const obj = modelKind ? this.model(modelKind) : null;
      if (obj) {
        const existing = this.anims.find((a) => a.obj === obj);
        if (existing) existing.t = existing.dur;
      }
      this.anims.push({ obj, t: 0, dur, fn, last: 0 });
    };
    switch (kind) {
      case 'water':
        A('can', 1.15, (o, t, dt) => {
          o.position.set(p.x - 0.55, 1.45, p.z + 0.15);
          o.scale.setScalar(easeOutBack(seg(t, 0, 0.2)) * (1 - seg(t, 0.95, 1.15)));
          o.rotation.set(0, 0, -0.75 * seg(t, 0.15, 0.35) + 0.75 * seg(t, 0.85, 1.05));
          if (t > 0.32 && t < 0.9) {
            o.updateMatrixWorld();
            const tip = o.localToWorld(_v.set(0.5, 0.2, 0));
            for (let i = 0; i < 3; i++) this.burst(tip, { n: 1, colors: ['#7fd4ff', '#bfe9ff', '#4fb3ff'], speed: 0.5, up: -0.5, size: 0.04, life: 0.6, spread: 0.12, floor: 0.3 });
          }
        });
        setTimeout(() => this.burst(top, { n: 10, colors: ['#bfe9ff', '#ffffff'], glow: true, speed: 1.2, up: 1.2, g: 2, size: 0.05, life: 0.7, spread: 1.6, bounce: false, mult: 1.6 }), 650);
        break;
      case 'weed':
        A('sickle', 0.85, (o, t) => {
          o.position.set(p.x, 0.95, p.z);
          o.scale.setScalar(easeOutBack(seg(t, 0, 0.15)) * 1.4 * (1 - seg(t, 0.7, 0.85)));
          o.rotation.set(0.4, Math.sin(t * Math.PI * 4) * 1.4, 0.3);
        });
        for (const d of [200, 420]) setTimeout(() => this.burst(top, { n: 10, colors: ['#5cc93b', '#7ed957', '#3c9a24', '#8a6a3c'], speed: 2.6, up: 3.2, size: 0.07, life: 0.9, spread: 1.4 }), d);
        break;
      case 'bug':
        A('spray', 1.0, (o, t) => {
          o.position.set(p.x - 0.6, 1.25, p.z + 0.2);
          o.scale.setScalar(easeOutBack(seg(t, 0, 0.18)) * 1.4 * (1 - seg(t, 0.85, 1.0)));
          o.rotation.set(0, 0, -0.35);
          if (t > 0.2 && t < 0.75) {
            o.updateMatrixWorld();
            const tip = o.localToWorld(_v.set(0.22, 0.25, 0));
            this.burst(tip, { n: 2, colors: ['#e9d5ff', '#ffffff', '#c7f5a0'], glow: true, speed: 0.4, up: -0.6, g: 0.5, size: 0.06, life: 0.8, spread: 0.1, bounce: false, mult: 1.3, dir: new V3(1.4, -0.6, 0) });
          }
        });
        setTimeout(() => this.burst(top, { n: 12, colors: ['#e53935', '#222222', '#b06ce0'], speed: 2.2, up: 3, size: 0.06, life: 0.8, spread: 1.2 }), 550);
        break;
      case 'fert':
        A('bag', 1.0, (o, t) => {
          o.position.set(p.x - 0.2, 1.5, p.z);
          o.scale.setScalar(easeOutBack(seg(t, 0, 0.18)) * 1.3 * (1 - seg(t, 0.85, 1.0)));
          o.rotation.set(0, 0, -1.6 * seg(t, 0.15, 0.4));
          if (t > 0.35 && t < 0.8) {
            o.updateMatrixWorld();
            const tip = o.localToWorld(_v.set(0, 0.3, 0));
            this.burst(tip, { n: 2, colors: ['#ffe066', '#fff3a0', '#7ed957'], glow: true, speed: 0.6, up: -0.4, g: 4, size: 0.05, life: 0.7, spread: 0.2, bounce: false, mult: 2.2 });
          }
        });
        setTimeout(() => { this.sparkleColumn(top, ['#b8ff8a', '#fff3a0', '#ffffff']); this.ring(p, '#9dff6b'); }, 750);
        break;
      case 'plant':
        A('pouch', 0.75, (o, t) => {
          o.position.set(p.x, 1.25 + Math.sin(t * 30) * 0.03, p.z);
          o.scale.setScalar(easeOutBack(seg(t, 0, 0.15)) * 1.5 * (1 - seg(t, 0.6, 0.75)));
          o.rotation.set(Math.PI * 0.85 * seg(t, 0.1, 0.3), 0, 0);
          if (t > 0.25 && t < 0.6) this.burst(new V3(p.x, 1.2, p.z), { n: 1, colors: ['#e8d29a', '#c9a56a'], speed: 0.6, up: 0, size: 0.035, life: 0.7, spread: 1.2 });
        });
        setTimeout(() => this.burst(top, { n: 10, colors: ['#8a5a2b', '#6e4223', '#a87543'], speed: 1.8, up: 1.8, size: 0.06, life: 0.6, spread: 1.6 }), 520);
        break;
      case 'shovel':
        A('shovel', 0.8, (o, t) => {
          const d = seg(t, 0.15, 0.4);
          o.position.set(p.x + 0.2, 1.5 - d * 0.75, p.z);
          o.scale.setScalar(easeOutBack(seg(t, 0, 0.15)) * 1.3 * (1 - seg(t, 0.68, 0.8)));
          o.rotation.set(0, Math.PI / 4, 0.35 - seg(t, 0.4, 0.6) * 0.9);
        });
        setTimeout(() => this.burst(top, { n: 16, colors: ['#8a5a2b', '#6e4223', '#a0784a', '#c9a16a'], speed: 2.6, up: 3.4, size: 0.08, life: 0.9, spread: 1.4 }), 380);
        break;
      case 'harvest': {
        const colors = opts.colors || ['#ffcf3f'];
        this.burst(top, { n: 18, colors, speed: 2.8, up: 4.2, size: 0.09, life: 1.0, spread: 1.4 });
        this.burst(top, { n: 18, colors: ['#fff3a0', '#ffd23f', '#ffffff'], glow: true, speed: 1.8, up: 3.2, g: 1.5, size: 0.07, life: 1.1, spread: 1.6, bounce: false });
        this.ring(p, '#ffe066');
        break;
      }
      case 'steal':
        this.burst(top, { n: 14, colors: opts.colors || ['#ffcf3f'], speed: 2.0, up: 3.6, size: 0.08, life: 0.9, spread: 1.2 });
        this.burst(top, { n: 14, colors: ['#e1b3ff', '#b388ff', '#ffffff'], glow: true, speed: 1.4, up: 2.4, g: 1, size: 0.06, life: 1.0, spread: 1.4, bounce: false });
        break;
      case 'unlock':
        this.burst(top, { n: 30, colors: ['#8a5a2b', '#6e4223', '#5cc93b', '#7ed957'], speed: 3.4, up: 4.5, size: 0.09, life: 1.1, spread: 2 });
        this.sparkleColumn(top);
        this.ring(p, '#ffe066', 2.8, 0.9);
        break;
      case 'bite':
        this.burst(top, { n: 12, colors: ['#ffcf3f', '#ffe066'], speed: 2.4, up: 3, size: 0.06, life: 0.8, spread: 0.6 });
        break;
    }
  }

  update(dt) {
    this.bits.update(dt);
    this.glows.update(dt);
    for (const r of this.rings) {
      const u = r.userData;
      if (u.t >= 1) continue;
      u.t = Math.min(1, u.t + dt / u.dur);
      const e = 1 - Math.pow(1 - u.t, 3);
      r.scale.setScalar(0.4 + e * u.scale);
      r.material.opacity = (1 - u.t) * 0.9;
      if (u.t >= 1) r.visible = false;
    }
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      if (a.obj) a.obj.visible = true;
      a.fn(a.obj, Math.min(a.t, a.dur), dt);
      if (a.t >= a.dur) {
        if (a.obj && !this.anims.some((o, j) => j !== i && o.obj === a.obj)) a.obj.visible = false;
        this.anims.splice(i, 1);
      }
    }
  }
}
