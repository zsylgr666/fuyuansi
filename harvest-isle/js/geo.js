import * as THREE from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

// 旋转顺序 YXZ：先绕 Z 滚转，再绕 X 俯仰（+Y 倒向 +Z），最后绕 Y 偏航
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}
export const mul = (a, b) => a.clone().multiply(b);

const cache = new Map();
function ni(key, make) {
  let g = cache.get(key);
  if (!g) {
    g = make();
    if (g.index) g = g.toNonIndexed();
    cache.set(key, g);
  }
  return g;
}

function starShape(points = 5, outer = 1, inner = 0.45) {
  const s = new THREE.Shape();
  for (let i = 0; i <= points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  return s;
}

// 单位尺寸的基础几何体；底座在 y=0 的版本便于"种"在地面上
export const P = {
  box: () => ni('box', () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)),
  boxC: () => ni('boxC', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: (n = 6, top = 1) => ni(`cyl${n}_${top}`, () => new THREE.CylinderGeometry(top, 1, 1, n).translate(0, 0.5, 0)),
  cylC: (n = 8) => ni(`cylC${n}`, () => new THREE.CylinderGeometry(1, 1, 1, n)),
  cone: (n = 6) => ni(`cone${n}`, () => new THREE.ConeGeometry(1, 1, n).translate(0, 0.5, 0)),
  ico: (d = 0) => ni(`ico${d}`, () => new THREE.IcosahedronGeometry(1, d)),
  sph: (w = 8, h = 6) => ni(`sph${w}_${h}`, () => new THREE.SphereGeometry(1, w, h)),
  oct: () => ni('oct', () => new THREE.OctahedronGeometry(1, 0)),
  dod: () => ni('dod', () => new THREE.DodecahedronGeometry(1, 0)),
  tet: () => ni('tet', () => new THREE.TetrahedronGeometry(1, 0)),
  leaf: () => ni('leaf', () => new THREE.OctahedronGeometry(1, 0).translate(0, 1, 0).scale(1, 0.5, 1)),
  torus: () => ni('torus', () => new THREE.TorusGeometry(1, 0.18, 4, 10, Math.PI)),
  star: () => ni('star', () => new THREE.ExtrudeGeometry(starShape(), { depth: 0.35, bevelEnabled: false }).center()),
  plane: () => ni('plane', () => new THREE.PlaneGeometry(1, 1)),
};

const _v = new THREE.Vector3();
const _c = new THREE.Color();

// 把很多小几何体烘焙成一个带顶点色的网格（每个通道一个 draw call）
export class Builder {
  constructor(seed = 1) {
    this.ch = {};
    this.r = rng(seed);
  }
  _get(ch) {
    return (this.ch[ch] ||= { pos: [], col: [] });
  }
  add(geo, m, color, jitter = 0.07, ch = 'std') {
    const out = this._get(ch);
    const a = geo.attributes.position.array;
    const fn = typeof color === 'function';
    if (!fn) _c.set(color);
    const flip = m.determinant() < 0;
    for (let i = 0; i < a.length; i += 9) {
      if (fn) _c.set(color((a[i] + a[i + 3] + a[i + 6]) / 3, (a[i + 1] + a[i + 4] + a[i + 7]) / 3, (a[i + 2] + a[i + 5] + a[i + 8]) / 3));
      const k = 1 + (this.r() - 0.5) * 2 * jitter;
      const order = flip ? [0, 6, 3] : [0, 3, 6];
      for (const j of order) {
        _v.set(a[i + j], a[i + j + 1], a[i + j + 2]).applyMatrix4(m);
        out.pos.push(_v.x, _v.y, _v.z);
        out.col.push(_c.r * k, _c.g * k, _c.b * k);
      }
    }
    return this;
  }
  tri(a, b, c, color, jitter = 0.07, ch = 'std') {
    const out = this._get(ch);
    _c.set(color);
    const k = 1 + (this.r() - 0.5) * 2 * jitter;
    out.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) out.col.push(_c.r * k, _c.g * k, _c.b * k);
    return this;
  }
  has(ch) {
    return !!this.ch[ch] && this.ch[ch].pos.length > 0;
  }
  geometry(ch = 'std') {
    const o = this.ch[ch];
    if (!o || !o.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(o.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
  geometries() {
    const out = {};
    for (const ch in this.ch) {
      const g = this.geometry(ch);
      if (g) out[ch] = g;
    }
    return out;
  }
  group({ cast = true, receive = true, mats = MAT } = {}) {
    return meshesFrom(this.geometries(), { cast, receive, mats });
  }
}

export function meshesFrom(geoms, { cast = true, receive = true, mats = MAT } = {}) {
  const grp = new THREE.Group();
  for (const ch in geoms) {
    const mesh = new THREE.Mesh(geoms[ch], mats[ch] || MAT.std);
    mesh.castShadow = cast && ch !== 'glow' && ch !== 'lamp';
    mesh.receiveShadow = receive && ch !== 'glow' && ch !== 'lamp';
    grp.add(mesh);
  }
  return grp;
}

// 所有摇摆材质共享同一个时间 uniform
export const U = { uTime: { value: 0 }, uWind: { value: 1 } };

function sway(mat, amp, key) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uWind = U.uWind;
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec4 swW = modelMatrix * vec4(transformed, 1.0);
      float swH = max(transformed.y, 0.0);
      float swP = uTime * 1.8 + swW.x * 0.37 + swW.z * 0.29;
      float swA = ${amp.toFixed(4)} * uWind * swH * swH;
      transformed.x += (sin(swP) + 0.35 * sin(swP * 2.3)) * swA;
      transformed.z += cos(swP * 0.83) * swA * 0.7;`
    );
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

const std = (o = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0, ...o });

export const MAT = {
  std: std(),
  dbl: std({ side: THREE.DoubleSide }),
  crop: sway(std({ side: THREE.DoubleSide }), 0.045, 'sway-crop'),
  tree: sway(std(), 0.0035, 'sway-tree'),
  lamp: new THREE.MeshBasicMaterial({ vertexColors: true }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.4, 2.4, 2.4) }),
};

export function smooth(t) {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
