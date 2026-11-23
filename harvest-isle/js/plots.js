import * as THREE from 'three';
import { Builder, M, P, MAT, meshesFrom, lerp } from './geo.js';
import { cropMeshes, SOIL_TOP } from './crops3d.js';
import { GRID, PLOT_COUNT, CROP } from './data.js';

export const PITCH = 2.85;
export const SIZE = 2.45;
const TAU = Math.PI * 2;

export function plotPos(i) {
  const c = i % GRID, r = Math.floor(i / GRID);
  return new THREE.Vector3((c - 1.5) * PITCH, 0, (r - 1.5) * PITCH);
}

const SOIL = {
  empty: new THREE.Color('#b98352'),
  wet: new THREE.Color('#7a4a28'),
  dry: new THREE.Color('#d6a86c'),
  withered: new THREE.Color('#a87a4c'),
};
const RING = { ok: new THREE.Color('#9dff6b'), bad: new THREE.Color('#ff7a6b'), info: new THREE.Color('#ffffff'), ready: new THREE.Color('#ffe066') };
const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

function makeShared() {
  const soil = new Builder(21);
  soil.add(P.box(), M(0, 0, 0, 0, 0, 0, SIZE, 0.2, SIZE), '#e6e6e6', 0.05);
  for (const z of [-0.75, 0, 0.75]) soil.add(P.cylC(7), M(0, 0.19, z, 0, 0, Math.PI / 2, 0.24, SIZE - 0.2, 0.11), '#ffffff', 0.08);
  const r = soil.r;
  for (let i = 0; i < 26; i++) soil.add(P.dod(), M((r() - 0.5) * 2.1, 0.22 + r() * 0.05, (r() - 0.5) * 2.1, r(), r(), 0, 0.06 + r() * 0.05), '#d9d9d9', 0.1);

  const cracks = new Builder(22);
  for (let i = 0; i < 14; i++) {
    const x = (cracks.r() - 0.5) * 2, z = (cracks.r() - 0.5) * 2;
    cracks.add(P.boxC(), M(x, 0.305, z, 0, cracks.r() * 3, 0, 0.32, 0.012, 0.03), '#5a3a1c', 0.05);
  }

  const locked = new Builder(23);
  locked.add(P.box(), M(0, 0, 0, 0, 0, 0, SIZE, 0.1, SIZE), '#79c94c', 0.08);
  for (let i = 0; i < 26; i++) {
    const x = (locked.r() - 0.5) * 2.2, z = (locked.r() - 0.5) * 2.2;
    for (let k = 0; k < 3; k++) locked.add(P.leaf(), M(x, 0.1, z, 0.3 + locked.r() * 0.3, locked.r() * TAU, 0, 0.05, 0.22 + locked.r() * 0.12, 0.02), locked.r() < 0.5 ? '#5fb33c' : '#6abf45', 0.06);
  }
  for (let i = 0; i < 3; i++) locked.add(P.dod(), M((locked.r() - 0.5) * 1.6, 0.1, (locked.r() - 0.5) * 1.6, locked.r(), locked.r(), 0, 0.14, 0.09, 0.12), '#a7a29a', 0.1);
  const S = M(0.55, 0.1, 0.55, 0, Math.PI / 4, 0);
  locked.add(P.box(), S.clone().multiply(M(0, 0, 0, 0, 0, 0, 0.08, 0.8, 0.08)), '#8a5a2b', 0.05);
  locked.add(P.box(), S.clone().multiply(M(0, 0.55, 0.05, 0, 0, 0, 0.62, 0.36, 0.05)), '#d9a066', 0.05);
  locked.add(P.box(), S.clone().multiply(M(0, 0.62, 0.085, 0, 0, 0, 0.18, 0.15, 0.03)), '#ffc83d', 0.03);
  locked.add(P.torus(), S.clone().multiply(M(0, 0.77, 0.085, 0, 0, 0, 0.06, 0.06, 0.06)), '#8a6a3c', 0.03);

  const weeds = [0, 1, 2].map((lvl) => {
    const b = new Builder(30 + lvl);
    const spots = [[[-0.6, -0.4], [0.5, 0.7]], [[0.7, -0.6], [-0.4, 0.6]], [[0, -0.85], [-0.85, 0.1], [0.85, 0.2]]][lvl];
    for (const [x, z] of spots) {
      const n = 6;
      for (let k = 0; k < n; k++) b.add(P.leaf(), M(x, SOIL_TOP - 0.03, z, 0.35 + b.r() * 0.35, (k / n) * TAU + b.r(), 0, 0.06, 0.34 + b.r() * 0.18, 0.02), b.r() < 0.5 ? '#2f7a2a' : '#3a8c30', 0.08);
      b.add(P.ico(0), M(x, SOIL_TOP + 0.3, z, 0, 0, 0, 0.05), '#d6f06b', 0.05);
    }
    return b.geometry();
  });

  const bug = new Builder(40);
  bug.add(P.sph(8, 5), M(0, 0, 0, 0, 0, 0, 0.11, 0.08, 0.13), (x, y, z) => (y < -0.2 ? '#222222' : '#e53935'), 0.04);
  bug.add(P.sph(6, 4), M(0, 0.01, 0.12, 0, 0, 0, 0.06, 0.05, 0.05), '#222222', 0.03);
  bug.add(P.boxC(), M(0, 0.075, 0, 0, 0, 0, 0.01, 0.01, 0.24), '#222222', 0.02);
  for (const [x, z] of [[0.05, 0.03], [-0.05, 0.03], [0.05, -0.06], [-0.05, -0.06]]) bug.add(P.sph(5, 3), M(x, 0.065, z, 0, 0, 0, 0.022, 0.012, 0.022), '#222222', 0.02);
  for (const s of [-1, 1]) bug.add(P.boxC(), M(s * 0.03, 0.05, 0.18, -0.6, s * 0.4, 0, 0.008, 0.008, 0.08), '#222222', 0.02);

  const ring = new Builder(50);
  const h = SIZE / 2 + 0.12, w = 0.1;
  ring.add(P.boxC(), M(0, 0, h, 0, 0, 0, h * 2 + w, 0.04, w), '#ffffff', 0);
  ring.add(P.boxC(), M(0, 0, -h, 0, 0, 0, h * 2 + w, 0.04, w), '#ffffff', 0);
  ring.add(P.boxC(), M(h, 0, 0, 0, 0, 0, w, 0.04, h * 2 + w), '#ffffff', 0);
  ring.add(P.boxC(), M(-h, 0, 0, 0, 0, 0, w, 0.04, h * 2 + w), '#ffffff', 0);

  return {
    soilGeo: soil.geometry(),
    crackGeo: cracks.geometry(),
    lockedGeoms: locked.geometries(),
    weedGeos: weeds,
    bugGeo: bug.geometry(),
    ringGeo: ring.geometry(),
    hitGeo: new THREE.BoxGeometry(PITCH * 0.98, 1.4, PITCH * 0.98).translate(0, 0.7, 0),
    hitMat: new THREE.MeshBasicMaterial({ visible: false }),
  };
}

class PlotView {
  constructor(scene, i, sh, fx) {
    this.i = i;
    this.fx = fx;
    this.pos = plotPos(i);
    const g = (this.group = new THREE.Group());
    g.position.copy(this.pos);
    scene.add(g);
    this.soilMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, color: SOIL.empty.clone() });
    this.soilTarget = SOIL.empty.clone();
    this.soil = new THREE.Mesh(sh.soilGeo, this.soilMat);
    this.soil.receiveShadow = true;
    this.soil.castShadow = true;
    this.cracks = new THREE.Mesh(sh.crackGeo, MAT.std);
    this.locked = meshesFrom(sh.lockedGeoms);
    this.weeds = sh.weedGeos.map((geo) => {
      const m = new THREE.Mesh(geo, MAT.crop);
      m.castShadow = true;
      return m;
    });
    this.bugs = [0, 1, 2].map((k) => {
      const m = new THREE.Mesh(sh.bugGeo, MAT.std);
      m.castShadow = true;
      m.userData = { ph: k * 2.1 + i, rad: 0.5 + k * 0.17, sp: (0.6 + k * 0.25) * (k % 2 ? -1 : 1) };
      return m;
    });
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    this.ring = new THREE.Mesh(sh.ringGeo, this.ringMat);
    this.ring.position.y = 0.33;
    this.ring.renderOrder = 3;
    this.hit = new THREE.Mesh(sh.hitGeo, sh.hitMat);
    this.hit.userData.plot = i;
    g.add(this.soil, this.cracks, this.locked, ...this.weeds, ...this.bugs, this.ring, this.hit);
    this.cropHolder = new THREE.Group();
    g.add(this.cropHolder);
    this.key = '';
    this.popT = 1;
    this.hover = null;
    this.ready = false;
    this.sparkT = Math.random();
    this.squash = 0;
  }

  sync(vm) {
    let key;
    if (vm.locked) key = 'L';
    else if (vm.state === 'empty') key = 'E';
    else if (vm.state === 'withered') key = `W:${vm.crop}`;
    else key = `G:${vm.crop}:${vm.stage}`;
    const locked = !!vm.locked;
    this.locked.visible = locked;
    this.soil.visible = !locked;
    if (key !== this.key) {
      const first = this.key === '';
      this.key = key;
      this.cropHolder.clear();
      if (vm.state === 'growing') this.cropHolder.add(cropMeshes(vm.crop, vm.stage));
      else if (vm.state === 'withered') this.cropHolder.add(cropMeshes(vm.crop, 'w'));
      if (!first) this.popT = 0;
    }
    this.cropHolder.visible = !locked;
    const grow = vm.state === 'growing' && !locked;
    this.cracks.visible = grow && vm.dry;
    this.soilTarget.copy(locked ? SOIL.empty : vm.state === 'withered' ? SOIL.withered : grow ? (vm.dry ? SOIL.dry : SOIL.wet) : SOIL.empty);
    this.weeds.forEach((w, k) => (w.visible = grow && k < vm.weeds));
    this.bugs.forEach((b, k) => (b.visible = grow && k < vm.bugs));
    this.ready = grow && vm.stage === 4;
  }

  bounce() {
    this.squash = 1;
  }

  update(dt, t) {
    this.soilMat.color.lerp(this.soilTarget, 1 - Math.exp(-dt * 4));
    if (this.popT < 1) this.popT = Math.min(1, this.popT + dt / 0.5);
    this.squash = Math.max(0, this.squash - dt * 3);
    const pop = 0.45 + 0.55 * easeOutBack(this.popT);
    const breathe = this.ready ? 1 + Math.sin(t * 3 + this.i) * 0.025 : 1;
    const sq = Math.sin(this.squash * Math.PI * 2) * this.squash * 0.18;
    this.cropHolder.scale.set(pop * breathe * (1 + sq), pop * breathe * (1 - sq), pop * breathe * (1 + sq));
    for (const b of this.bugs) {
      if (!b.visible) continue;
      const u = b.userData;
      const a = t * u.sp + u.ph;
      b.position.set(Math.cos(a) * u.rad, SOIL_TOP + 0.04 + Math.abs(Math.sin(t * 14 + u.ph)) * 0.015, Math.sin(a) * u.rad);
      b.rotation.y = -a + (u.sp > 0 ? 0 : Math.PI);
    }
    let target = 0, col = RING.info;
    if (this.hover) {
      target = 0.85;
      col = RING[this.hover] || RING.info;
    } else if (this.ready) {
      target = 0.35 + Math.sin(t * 4 + this.i) * 0.2;
      col = RING.ready;
    }
    this.ringMat.opacity = lerp(this.ringMat.opacity, target, 1 - Math.exp(-dt * 12));
    this.ringMat.color.lerp(col, 1 - Math.exp(-dt * 12));
    this.ring.visible = this.ringMat.opacity > 0.01;
    if (this.ready && this.fx) {
      this.sparkT -= dt;
      if (this.sparkT <= 0) {
        this.sparkT = 0.35 + Math.random() * 0.5;
        this.fx.burst(new THREE.Vector3(this.pos.x, 0.6, this.pos.z), { n: 1, colors: ['#fff3a0', '#ffffff', '#ffd23f'], glow: true, speed: 0.15, up: 0.6, g: -0.3, size: 0.06, life: 1.4, spread: 2.0, bounce: false, mult: 2.4 });
      }
    }
  }
}

export class Plots {
  constructor(world) {
    const sh = makeShared();
    this.views = [];
    for (let i = 0; i < PLOT_COUNT; i++) this.views.push(new PlotView(world.scene, i, sh, world.fx));
    this.hitBoxes = this.views.map((v) => v.hit);
  }
  sync(vms) {
    vms.forEach((vm, i) => this.views[i].sync(vm));
  }
  setHover(i, kind) {
    this.views.forEach((v, k) => (v.hover = k === i ? kind : null));
  }
  update(dt, t) {
    for (const v of this.views) v.update(dt, t);
  }
}
