import * as THREE from 'three';
import { Builder, M, mul, P, hashStr, meshesFrom, MAT } from './geo.js';
import { CROP } from './data.js';

export const SOIL_TOP = 0.28;
const TAU = Math.PI * 2;

const LEAF = ['#4caf50', '#5cbf4a', '#43a047', '#66c24f'];
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function leaf(b, B, x, y, z, len, wid, tilt, yaw, color, thick = 0.02) {
  b.add(P.leaf(), mul(B, M(x, y, z, tilt, yaw, 0, wid, len, thick)), color, 0.08);
}
// 从 (x,y,z) 沿 (tilt,yaw) 方向走 d 的位置
function along(x, y, z, tilt, yaw, d) {
  return [x + Math.sin(tilt) * Math.sin(yaw) * d, y + Math.cos(tilt) * d, z + Math.sin(tilt) * Math.cos(yaw) * d];
}

/* ---------- 果实（作物和图标共用） ---------- */
export const FRUIT = {
  carrot(b, m, s = 1) {
    b.add(P.cone(7), mul(m, M(0, 0, 0, Math.PI, 0, 0, 0.1 * s, 0.42 * s, 0.1 * s)), '#ff8a2a', 0.06);
    b.add(P.cyl(7, 0.9), mul(m, M(0, -0.01, 0, 0, 0, 0, 0.1 * s, 0.04 * s, 0.1 * s)), '#ff9a3c', 0.04);
  },
  corn(b, m, s = 1) {
    b.add(P.cyl(7, 0.6), mul(m, M(0, 0, 0, 0, 0, 0, 0.075 * s, 0.32 * s, 0.075 * s)), '#ffd54f', 0.12);
    b.add(P.cone(7), mul(m, M(0, 0.32 * s, 0, 0, 0, 0, 0.045 * s, 0.06 * s, 0.045 * s)), '#ffe082', 0.1);
    for (let i = 0; i < 3; i++) {
      b.add(P.leaf(), mul(m, M(0, -0.03 * s, 0, 0.22, (i / 3) * TAU, 0, 0.07 * s, 0.34 * s, 0.025 * s)), '#a5d46a', 0.08);
    }
    b.add(P.cone(4), mul(m, M(0, 0.36 * s, 0, 0, 0, 0, 0.025 * s, 0.07 * s, 0.025 * s)), '#c58b4a', 0.1);
  },
  tomato(b, m, s = 1) {
    b.add(P.ico(1), mul(m, M(0, 0, 0, 0, 0, 0, 0.1 * s, 0.088 * s, 0.1 * s)), '#e8392f', 0.08);
    b.add(P.oct(), mul(m, M(0, 0.085 * s, 0, 0, 0.4, 0, 0.055 * s, 0.014 * s, 0.055 * s)), '#2e7d32', 0.05);
    b.add(P.cyl(4), mul(m, M(0, 0.085 * s, 0, 0, 0, 0, 0.008 * s, 0.035 * s, 0.008 * s)), '#3a7d2c', 0.05);
  },
  eggplant(b, m, s = 1) {
    b.add(P.ico(1), mul(m, M(0, 0, 0, 0, 0, 0, 0.075 * s, 0.2 * s, 0.075 * s)), '#6a1b9a', 0.1);
    b.add(P.cone(6), mul(m, M(0, 0.15 * s, 0, 0, 0, 0, 0.062 * s, 0.075 * s, 0.062 * s)), '#4e8b3a', 0.06);
    b.add(P.cyl(4), mul(m, M(0, 0.21 * s, 0, 0, 0, 0, 0.012 * s, 0.05 * s, 0.012 * s)), '#3f7a2f', 0.05);
  },
  strawberry(b, m, s = 1) {
    b.add(P.cone(7), mul(m, M(0, 0.02 * s, 0, Math.PI, 0, 0, 0.06 * s, 0.13 * s, 0.06 * s)), '#ff3b4e', 0.12);
    b.add(P.oct(), mul(m, M(0, 0.025 * s, 0, 0, 0.5, 0, 0.055 * s, 0.014 * s, 0.055 * s)), '#3e9b3a', 0.06);
  },
  sunflower(b, m, s = 1) {
    b.add(P.cylC(10), mul(m, M(0, 0, 0, 0, 0, 0, 0.2 * s, 0.07 * s, 0.2 * s)), '#5d4037', 0.12);
    b.add(P.cylC(10), mul(m, M(0, 0.025 * s, 0, 0, 0, 0, 0.12 * s, 0.04 * s, 0.12 * s)), '#3e2a20', 0.1);
    b.add(P.cylC(10), mul(m, M(0, -0.045 * s, 0, 0, 0, 0, 0.17 * s, 0.04 * s, 0.17 * s)), '#6b9e3a', 0.06);
    for (let ring = 0; ring < 2; ring++) {
      const n = 13;
      for (let i = 0; i < n; i++) {
        const phi = (i / n) * TAU + ring * (Math.PI / n);
        const dx = Math.cos(phi), dz = Math.sin(phi);
        b.add(P.leaf(), mul(m, M(dx * 0.15 * s, 0.01 * s - ring * 0.012 * s, dz * 0.15 * s, Math.PI / 2 - 0.12, Math.atan2(dx, dz), 0, 0.065 * s, (0.17 - ring * 0.02) * s, 0.02 * s)), ring ? '#ffb300' : '#ffcf2e', 0.08);
      }
    }
  },
  pumpkin(b, m, s = 1) {
    const n = 8;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      b.add(P.sph(8, 6), mul(m, M(Math.cos(a) * 0.12 * s, 0.17 * s, Math.sin(a) * 0.12 * s, 0, -a, 0, 0.15 * s, 0.17 * s, 0.11 * s)), k % 2 ? '#ff8f00' : '#f57c00', 0.05);
    }
    b.add(P.sph(8, 6), mul(m, M(0, 0.17 * s, 0, 0, 0, 0, 0.2 * s, 0.16 * s, 0.2 * s)), '#fb8c00', 0.04);
    b.add(P.cyl(5, 0.7), mul(m, M(0, 0.31 * s, 0, 0.25, 0, 0, 0.035 * s, 0.13 * s, 0.035 * s)), '#6d8b3a', 0.06);
  },
  watermelon(b, m, s = 1) {
    b.add(P.sph(12, 8), mul(m, M(0, 0.25 * s, 0, Math.PI / 2, 0, 0, 0.34 * s, 0.44 * s, 0.27 * s)), (x, y, z) => {
      const sec = Math.floor(((Math.atan2(z, x) + Math.PI) / TAU) * 12);
      return sec % 2 ? '#2e7d32' : '#7cb342';
    }, 0.05);
    b.add(P.cyl(4), mul(m, M(0, 0.25 * s, -0.44 * s, Math.PI / 2 + 0.4, 0, 0, 0.015 * s, 0.07 * s, 0.015 * s)), '#5a7d2c', 0.05);
  },
  starfruit(b, m, s = 1, ch = 'glow') {
    b.add(P.star(), mul(m, M(0, 0, 0, 0, 0, 0, 0.13 * s, 0.13 * s, 0.13 * s)), '#ffd54f', 0.05, ch);
  },
  wheat(b, m, s = 1) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      const lean = 0.12 + (i % 3) * 0.05;
      b.add(P.cyl(4), mul(m, M(Math.cos(a) * 0.03 * s, -0.2 * s, Math.sin(a) * 0.03 * s, lean, a, 0, 0.012 * s, 0.55 * s, 0.012 * s)), '#e2b04a', 0.06);
      const [x, y, z] = along(Math.cos(a) * 0.03 * s, -0.2 * s, Math.sin(a) * 0.03 * s, lean, a, 0.55 * s);
      b.add(P.oct(), mul(m, M(x, y + 0.07 * s, z, lean, a, 0, 0.035 * s, 0.11 * s, 0.035 * s)), '#f6d36b', 0.08);
    }
    b.add(P.cylC(8), mul(m, M(0, 0, 0, 0, 0, 0, 0.055 * s, 0.05 * s, 0.055 * s)), '#c0392b', 0.05);
  },
};

/* ---------- 通用阶段 ---------- */
function seedStage(b, B, r) {
  b.add(P.ico(0), mul(B, M(0, -0.02, 0, 0, r() * 3, 0, 0.16, 0.07, 0.16)), '#6e4223', 0.08);
  b.add(P.ico(0), mul(B, M(0.02, 0.04, -0.01, 0, 0, 0, 0.035, 0.025, 0.035)), '#e8d29a', 0.05);
}
function sproutStage(b, B, r, s = 1) {
  b.add(P.cyl(5), mul(B, M(0, 0, 0, 0, 0, 0, 0.016 * s, 0.15 * s, 0.016 * s)), '#6dbb3c', 0.05);
  const yaw = r() * TAU;
  leaf(b, B, 0, 0.14 * s, 0, 0.13 * s, 0.065 * s, 1.05, yaw, '#9be15d');
  leaf(b, B, 0, 0.14 * s, 0, 0.13 * s, 0.065 * s, 1.05, yaw + Math.PI, '#8fd654');
}
function witheredStage(b, B, r, big) {
  const n = big ? 5 : 3;
  for (let i = 0; i < n; i++) {
    const tilt = 0.4 + r() * 0.7, yaw = r() * TAU, h = (big ? 0.5 : 0.32) * (0.7 + r() * 0.5);
    b.add(P.cyl(4), mul(B, M((r() - 0.5) * 0.12, 0, (r() - 0.5) * 0.12, tilt, yaw, 0, 0.02, h, 0.02)), pick(r, ['#8d6e4a', '#9c7b52', '#7a5c3c']), 0.08);
    const [x, y, z] = along(0, 0, 0, tilt, yaw, h * 0.8);
    leaf(b, B, x, y, z, 0.16, 0.06, 2.2 + r() * 0.5, yaw + (r() - 0.5), pick(r, ['#a0784a', '#b08850', '#8b6a3e']));
  }
}

/* ---------- 各作物的生长形态（st: 2..4） ---------- */
const GROW = {
  carrot(b, B, st, r) {
    const s = [0, 0, 0.6, 0.85, 1][st];
    const n = st === 2 ? 4 : 6;
    for (let i = 0; i < n; i++) {
      const yaw = (i / n) * TAU + r() * 0.5, tilt = 0.3 + r() * 0.3, len = (0.4 + r() * 0.14) * s;
      leaf(b, B, 0, 0.02, 0, len, 0.035, tilt, yaw, '#3f9e3a');
      for (const k of [0.45, 0.72]) {
        const [x, y, z] = along(0, 0.02, 0, tilt, yaw, len * k);
        leaf(b, B, x, y, z, 0.13 * s, 0.05 * s, tilt + 0.7, yaw + 0.6, '#58b947');
        leaf(b, B, x, y, z, 0.13 * s, 0.05 * s, tilt + 0.7, yaw - 0.6, '#4fae42');
      }
    }
    if (st >= 3) FRUIT.carrot(b, mul(B, M(0, st === 4 ? 0.13 : 0.05, 0)), st === 4 ? 1 : 0.75);
  },
  wheat(b, B, st, r) {
    const s = [0, 0, 0.55, 0.9, 1][st];
    const ripe = st === 4;
    for (let i = 0; i < 6; i++) {
      const ox = (r() - 0.5) * 0.32, oz = (r() - 0.5) * 0.32;
      const h = (0.62 + r() * 0.25) * s, lean = (r() - 0.5) * 0.3, yaw = r() * TAU;
      if (st === 2) {
        leaf(b, B, ox, 0, oz, h * 0.9, 0.035, lean * 1.5, yaw, pick(r, ['#7cc04a', '#6fb443']));
        continue;
      }
      b.add(P.cyl(4), mul(B, M(ox, 0, oz, lean, yaw, 0, 0.013, h, 0.013)), ripe ? '#e2b04a' : '#79bd48', 0.06);
      const [x, y, z] = along(ox, 0, oz, lean, yaw, h);
      b.add(P.oct(), mul(B, M(x, y + 0.08, z, lean, yaw, 0, 0.038, 0.12, 0.038)), ripe ? '#f6d36b' : '#a9d86a', 0.08);
      leaf(b, B, ox, h * 0.25, oz, h * 0.5, 0.03, 0.6 + r() * 0.3, yaw + 1.5, ripe ? '#cfa848' : '#6fb443');
    }
  },
  corn(b, B, st, r) {
    const h = [0, 0, 0.6, 1.25, 1.5][st];
    b.add(P.cyl(6, 0.7), mul(B, M(0, 0, 0, 0, 0, 0, 0.055, h, 0.055)), '#5f9e3a', 0.06);
    const n = st === 2 ? 4 : 7;
    for (let i = 0; i < n; i++) {
      const y = 0.1 + (i / n) * h * 0.78;
      leaf(b, B, 0, y, 0, (0.58 - i * 0.03) * (st === 2 ? 0.7 : 1), 0.075, 0.95 + r() * 0.3, i * 2.4 + r() * 0.3, i % 2 ? '#5aa83a' : '#6fbd45', 0.015);
    }
    if (st < 3) return;
    for (let i = 0; i < 5; i++) {
      b.add(P.cyl(3), mul(B, M(0, h, 0, (r() - 0.3) * 0.9, r() * TAU, 0, 0.01, 0.24, 0.01)), '#e8d590', 0.08);
    }
    for (let i = 0; i < 2; i++) {
      const yaw = i * Math.PI + 0.6, y = h * (0.45 + i * 0.13);
      const m = mul(B, M(Math.sin(yaw) * 0.07, y, Math.cos(yaw) * 0.07, 0.45, yaw, 0));
      if (st === 4) FRUIT.corn(b, m, 0.95);
      else b.add(P.cyl(6, 0.6), mul(m, M(0, 0, 0, 0, 0, 0, 0.05, 0.22, 0.05)), '#8bc34a', 0.06);
    }
  },
  tomato(b, B, st, r) {
    const s = [0, 0, 0.6, 0.9, 1][st];
    b.add(P.box(), mul(B, M(0.1, 0, -0.08, 0, 0, 0, 0.03, 0.95 * s + 0.15, 0.03)), '#a47548', 0.06);
    const n = st === 2 ? 4 : 7;
    for (let i = 0; i < n; i++) {
      const a = i * 2.1 + r() * 0.4, y = (0.22 + (i / n) * 0.62) * s, rad = 0.11 * s;
      b.add(P.ico(0), mul(B, M(Math.cos(a) * rad, y, Math.sin(a) * rad, r(), r() * 3, 0, (0.15 + r() * 0.06) * s)), pick(r, ['#3f8f3c', '#4ca64a', '#3a7f36']), 0.1);
    }
    for (let i = 0; i < 4; i++) leaf(b, B, 0, (0.3 + i * 0.12) * s, 0, 0.24 * s, 0.1 * s, 1.25, i * 1.7, '#4caf50');
    if (st === 3) {
      for (let i = 0; i < 4; i++) {
        const a = i * 1.6 + 0.3, y = (0.35 + i * 0.12) * s;
        b.add(P.ico(0), mul(B, M(Math.cos(a) * 0.22 * s, y, Math.sin(a) * 0.22 * s, 0, 0, 0, i % 2 ? 0.045 : 0.03)), i % 2 ? '#8bc34a' : '#ffe14d', 0.05);
      }
    }
    if (st === 4) {
      for (let i = 0; i < 6; i++) {
        const a = i * 1.15 + 0.4, y = 0.3 + (i % 3) * 0.18;
        FRUIT.tomato(b, mul(B, M(Math.cos(a) * 0.25, y, Math.sin(a) * 0.25)), 0.85 + (i % 2) * 0.2);
      }
    }
  },
  eggplant(b, B, st, r) {
    const s = [0, 0, 0.6, 0.9, 1][st];
    b.add(P.cyl(5), mul(B, M(0, 0, 0, 0, 0, 0, 0.03, 0.5 * s, 0.03)), '#5d4a6d', 0.05);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3, y = (0.2 + i * 0.09) * s;
      b.add(P.ico(0), mul(B, M(Math.cos(a) * 0.1 * s, y, Math.sin(a) * 0.1 * s, r(), r() * 3, 0, 0.16 * s)), pick(r, ['#2f7d32', '#3d8b3d']), 0.1);
    }
    for (let i = 0; i < 5; i++) leaf(b, B, 0, 0.12 * s, 0, 0.32 * s, 0.14 * s, 1.2, i * 1.25 + r() * 0.3, pick(r, ['#3f9142', '#4b9e46']));
    if (st === 3) {
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1;
        b.add(P.ico(0), mul(B, M(Math.cos(a) * 0.2, 0.42, Math.sin(a) * 0.2, 0, 0, 0, 0.04)), '#b388ff', 0.05);
      }
    }
    if (st === 4) {
      for (let i = 0; i < 4; i++) {
        const a = i * 1.57 + 0.5;
        FRUIT.eggplant(b, mul(B, M(Math.cos(a) * 0.24, 0.3, Math.sin(a) * 0.24, -0.35, Math.PI / 2 - a, 0)), 1);
      }
    }
  },
  strawberry(b, B, st, r) {
    const s = [0, 0, 0.65, 0.9, 1][st];
    const n = st === 2 ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const yaw = (i / n) * TAU + r() * 0.4, tilt = 0.85;
      const len = 0.17 * s;
      b.add(P.cyl(4), mul(B, M(0, 0, 0, tilt, yaw, 0, 0.012, len, 0.012)), '#5a9e3a', 0.05);
      const [x, y, z] = along(0, 0, 0, tilt, yaw, len);
      for (const d of [-0.65, 0, 0.65]) leaf(b, B, x, y, z, 0.12 * s, 0.075 * s, 1.3, yaw + d, pick(r, ['#3fa143', '#4cb24f']), 0.025);
    }
    if (st === 3) {
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + 0.5, x = Math.cos(a) * 0.17, z = Math.sin(a) * 0.17;
        b.add(P.ico(0), mul(B, M(x, 0.13, z, 0, 0, 0, 0.045, 0.014, 0.045)), '#ffffff', 0.03);
        b.add(P.ico(0), mul(B, M(x, 0.14, z, 0, 0, 0, 0.016)), '#ffd23f', 0.03);
      }
    }
    if (st === 4) {
      for (let i = 0; i < 4; i++) {
        const a = i * 1.57 + 0.3;
        FRUIT.strawberry(b, mul(B, M(Math.cos(a) * 0.19, 0.1, Math.sin(a) * 0.19, 0.6, Math.atan2(-Math.cos(a), -Math.sin(a)), 0)), 1.1);
      }
    }
  },
  sunflower(b, B, st, r) {
    const h = [0, 0, 0.45, 1.2, 1.45][st];
    b.add(P.cyl(6, 0.7), mul(B, M(0, 0, 0, 0, 0, 0, 0.045, h, 0.045)), '#5b9a32', 0.05);
    const n = st === 2 ? 3 : 5;
    for (let i = 0; i < n; i++) leaf(b, B, 0, 0.1 + i * h * 0.14, 0, 0.3 * (st === 2 ? 0.7 : 1), 0.16, 1.1, i * 2.3, i % 2 ? '#4f9a36' : '#62b043', 0.02);
    if (st === 3) {
      b.add(P.ico(0), mul(B, M(0, h + 0.04, 0, 0, 0, 0, 0.1, 0.08, 0.1)), '#6ba63a', 0.06);
      for (let i = 0; i < 6; i++) b.add(P.cone(3), mul(B, M(Math.cos(i) * 0.06, h + 0.06, Math.sin(i) * 0.06, 0, 0, 0, 0.02, 0.06, 0.02)), '#ffcf2e', 0.05);
    }
    if (st === 4) FRUIT.sunflower(b, mul(B, M(0, h + 0.02, 0, 1.15, Math.PI / 4, 0)), 1.15);
  },
  pumpkin(b, B, st, r) {
    vinesAndLeaves(b, B, st, r, ['#4f9a36', '#5daf43']);
    if (st === 3) {
      FRUIT.pumpkin(b, mul(B, M(0.05, 0, 0.02, 0, r(), 0)), 0.5);
      flower(b, B, -0.2, 0.12, 0.15, '#ffd23f');
    }
    if (st === 4) FRUIT.pumpkin(b, mul(B, M(0.04, 0, 0.02, 0, r() * TAU, 0)), 1.3);
  },
  watermelon(b, B, st, r) {
    vinesAndLeaves(b, B, st, r, ['#3e8e41', '#4c9e48']);
    if (st === 3) {
      FRUIT.watermelon(b, mul(B, M(0, 0, 0, 0, r() * TAU, 0)), 0.5);
      flower(b, B, 0.22, 0.12, -0.12, '#ffe14d');
    }
    if (st === 4) FRUIT.watermelon(b, mul(B, M(0, 0, 0, 0, r() * TAU, 0)), 1.05);
  },
  starfruit(b, B, st, r) {
    if (st === 2) {
      b.add(P.cyl(5, 0.6), mul(B, M(0, 0, 0, 0, 0, 0, 0.05, 0.5, 0.05)), '#8d6e63', 0.05);
      for (let i = 0; i < 3; i++) b.add(P.ico(1), mul(B, M(Math.cos(i * 2.1) * 0.1, 0.5 + i * 0.05, Math.sin(i * 2.1) * 0.1, 0, 0, 0, 0.16)), pick(r, ['#4db6ac', '#26a69a']), 0.08);
      return;
    }
    const s = st === 3 ? 0.85 : 1;
    b.add(P.cyl(6, 0.55), mul(B, M(0, 0, 0, 0, 0, 0, 0.11 * s, 1.05 * s, 0.11 * s)), '#8d6e63', 0.06);
    for (let i = 0; i < 3; i++) b.add(P.cyl(4, 0.5), mul(B, M(0, 0.7 * s, 0, 0.7, i * 2.1, 0, 0.04, 0.45 * s, 0.04)), '#8d6e63', 0.06);
    const canopy = [[0, 1.35, 0, 0.42], [0.3, 1.15, 0.1, 0.32], [-0.25, 1.2, 0.2, 0.33], [0.05, 1.18, -0.3, 0.34], [-0.15, 1.5, -0.1, 0.28], [0.2, 1.45, 0.25, 0.26]];
    for (const [x, y, z, rad] of canopy) b.add(P.ico(1), mul(B, M(x * s, y * s, z * s, r(), r(), 0, rad * s)), pick(r, ['#4db6ac', '#26a69a', '#5ec8bb']), 0.1);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.57 + 0.7;
      b.add(P.oct(), mul(B, M(Math.cos(a) * 0.55, 0.06, Math.sin(a) * 0.55, 0, a, 0, 0.04, 0.1, 0.04)), i % 2 ? '#b388ff' : '#7fdbff', 0.05, 'glow');
    }
    if (st === 3) {
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05;
        b.add(P.ico(0), mul(B, M(Math.cos(a) * 0.38, 1.15 + (i % 2) * 0.2, Math.sin(a) * 0.38, 0, 0, 0, 0.035)), '#fff59d', 0.05, 'glow');
      }
    }
    if (st === 4) {
      for (let i = 0; i < 7; i++) {
        const a = i * 0.9 + 0.2, y = 1.0 + (i % 3) * 0.2;
        const x = Math.cos(a) * 0.48, z = Math.sin(a) * 0.48;
        b.add(P.cyl(3), mul(B, M(x, y, z, 0, 0, 0, 0.006, 0.12, 0.006)), '#6d5a4a', 0.05);
        FRUIT.starfruit(b, mul(B, M(x, y - 0.04, z, 0, a + Math.PI / 4, 0.3)), 1);
      }
    }
  },
};

function vinesAndLeaves(b, B, st, r, greens) {
  const n = st === 2 ? 3 : 5;
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * TAU + r() * 0.5;
    b.add(P.cyl(4), mul(B, M(0, 0.02, 0, Math.PI / 2 - 0.08, yaw, 0, 0.018, 0.42, 0.018)), '#5c9b3a', 0.05);
    const d = 0.18 + r() * 0.2;
    leaf(b, B, Math.sin(yaw) * d, 0.04, Math.cos(yaw) * d, 0.26 * (st === 2 ? 0.7 : 1), 0.2, 1.3, yaw + (r() - 0.5), pick(r, greens), 0.02);
  }
}
function flower(b, B, x, y, z, color) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    b.add(P.leaf(), mul(B, M(x, y, z, 1.3, a, 0, 0.04, 0.07, 0.015)), color, 0.05);
  }
  b.add(P.ico(0), mul(B, M(x, y + 0.01, z, 0, 0, 0, 0.02)), '#ff9800', 0.03);
}

function layoutOffsets(n) {
  if (n === 3) return [-0.75, 0, 0.75];
  if (n === 2) return [-0.52, 0.52];
  return [0];
}

const geomCache = new Map();

// stage: 0..4 或 'w'（枯萎）。返回按通道合并的几何体，多个地块共享
export function cropGeoms(id, stage) {
  const key = `${id}|${stage}`;
  if (geomCache.has(key)) return geomCache.get(key);
  const def = CROP[id];
  const b = new Builder(hashStr(key));
  const r = b.r;
  const offs = layoutOffsets(def.layout);
  const big = def.layout <= 2;
  for (const oz of offs) {
    for (const ox of offs) {
      const jx = (r() - 0.5) * 0.12, jz = (r() - 0.5) * 0.12;
      const B = M(ox + jx, SOIL_TOP, oz + jz, 0, r() * TAU, 0);
      if (stage === 'w') witheredStage(b, B, r, big);
      else if (stage === 0) seedStage(b, B, r);
      else if (stage === 1) sproutStage(b, B, r, big ? 1.4 : 1);
      else GROW[id](b, B, stage, r);
    }
  }
  const out = b.geometries();
  geomCache.set(key, out);
  return out;
}

export function cropMeshes(id, stage) {
  return meshesFrom(cropGeoms(id, stage), { mats: { std: MAT.crop, glow: MAT.glow } });
}

// 单个果实，用于商店/仓库图标
export function produceGroup(id) {
  const b = new Builder(hashStr('produce' + id));
  const I = new THREE.Matrix4();
  switch (id) {
    case 'carrot': {
      const m = M(0, 0.05, 0, 0, 0, -0.7);
      FRUIT.carrot(b, mul(m, M(0, 0, 0)), 1.6);
      for (let i = 0; i < 5; i++) leaf(b, m, 0, 0, 0, 0.42, 0.05, 0.35, (i / 5) * TAU, i % 2 ? '#3f9e3a' : '#58b947');
      break;
    }
    case 'wheat': FRUIT.wheat(b, M(0, 0, 0, 0, 0, -0.35), 1.2); break;
    case 'corn': FRUIT.corn(b, M(0, -0.15, 0, 0, 0, -0.6), 1.5); break;
    case 'strawberry': FRUIT.strawberry(b, M(0, 0.05, 0, 0.15, 0, 0), 2.6); break;
    case 'eggplant': FRUIT.eggplant(b, M(0, -0.1, 0, 0, 0, -0.5), 1.6); break;
    case 'sunflower': FRUIT.sunflower(b, M(0, 0, 0, 1.25, 0, 0), 1.6); break;
    case 'starfruit': FRUIT.starfruit(b, M(0, 0, 0, 0, 0.3, 0.15), 2.4, 'glow'); break;
    default: FRUIT[id](b, I, id === 'tomato' ? 2.6 : 1.2);
  }
  return meshesFrom(b.geometries(), { mats: { std: MAT.dbl, glow: MAT.glow } });
}
