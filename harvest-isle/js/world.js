import * as THREE from 'three';
import { EffectComposer } from '../vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/addons/postprocessing/ShaderPass.js';
import { OutputPass } from '../vendor/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from '../vendor/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from '../vendor/addons/shaders/VerticalTiltShiftShader.js';
import { Builder, M, mul, P, MAT, U, rng, smooth, lerp, clamp, meshesFrom } from './geo.js';
import { FX } from './fx.js';
import { DAY_LENGTH } from './data.js';

const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const _v = new V3();

// t, 天顶, 地平线, 阳光色, 阳光强度, 天光, 地光, 环境强度, 夜晚系数
const SKY_KEYS = [
  [0.0, '#050a22', '#141d48', '#8fa6ff', 0.55, '#3b4c8f', '#151b30', 0.55, 1],
  [0.2, '#0b1640', '#34397a', '#a0b0ff', 0.45, '#4a5a9a', '#1a2030', 0.6, 1],
  [0.26, '#4060b0', '#ffb27c', '#ffb06a', 1.6, '#ffd6b8', '#5a5a40', 0.95, 0.25],
  [0.33, '#4b9ef2', '#cdeaff', '#fff1d6', 2.9, '#d8efff', '#6b8f3a', 1.25, 0],
  [0.5, '#3a8cf0', '#d2ecff', '#fffaf0', 3.2, '#e0f2ff', '#6b8f3a', 1.3, 0],
  [0.67, '#4895ec', '#d6ebff', '#fff3dc', 2.9, '#dceeff', '#6b8f3a', 1.25, 0],
  [0.745, '#5b4ea6', '#ff9666', '#ff9450', 1.7, '#ffc8a8', '#5a4a3a', 0.95, 0.25],
  [0.8, '#1a1f5c', '#46387a', '#a0a8ff', 0.5, '#4a4a8a', '#1a1a2e', 0.6, 0.9],
  [1.0, '#050a22', '#141d48', '#8fa6ff', 0.55, '#3b4c8f', '#151b30', 0.55, 1],
].map(([t, top, bottom, sunC, sunI, hs, hg, hi, night]) => ({
  t, top: new THREE.Color(top), bottom: new THREE.Color(bottom), sunC: new THREE.Color(sunC), sunI,
  hs: new THREE.Color(hs), hg: new THREE.Color(hg), hi, night,
}));

function upTri(b, a, c, d, col) {
  const ux = c.x - a.x, uy = c.y - a.y, uz = c.z - a.z;
  const vx = d.x - a.x, vy = d.y - a.y, vz = d.z - a.z;
  const ny = uz * vx - ux * vz;
  if (ny < 0) b.tri(a, c, d, col, 0.06); else b.tri(a, d, c, col, 0.06);
}

function waterMat(opts, amp, key) {
  const m = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.22, metalness: 0.05, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec4 wW = modelMatrix * vec4(transformed, 1.0);
      transformed.y += (sin(wW.x * 0.35 + uTime * 1.1) * 0.6 + cos(wW.z * 0.28 + uTime * 0.9) * 0.5 + sin((wW.x + wW.z) * 0.6 + uTime * 1.9) * 0.25) * ${amp.toFixed(3)};`
    );
  };
  m.customProgramCacheKey = () => key;
  return m;
}

export class World {
  constructor(container) {
    this.container = container;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcfe8ff, 90, 330);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 2000);
    this.raycaster = new THREE.Raycaster();

    this.t0 = performance.now();
    this.dayStart = 0.29;
    this.timeOverride = null;
    this.rainTarget = 0;
    this.rain = 0;
    this.night = 0;

    this.pads = [
      { x: -12, z: -11.5, r: 5 }, { x: -15.5, z: 0.5, r: 2.8 }, { x: 0.5, z: -15.5, r: 4.5 },
      { x: 4.6, z: -16.2, r: 2 }, { x: 11, z: -10, r: 4 }, { x: 10, z: 3.5, r: 1.8 },
      { x: -1.8, z: 10.6, r: 2 }, { x: 3, z: 10, r: 1 }, { x: 9.6, z: -3.6, r: 1.2 },
    ];

    this.setupLights();
    this.setupSky();
    this.setupOcean();
    this.buildIsland();
    this.buildStatic();
    this.setupLife();
    this.setupRain();
    this.fx = new FX(this.scene);
    this.initCamera();
    this.setQuality('high');
    addEventListener('resize', () => this.resize());
  }

  /* ================= 渲染与画质 ================= */
  setQuality(q) {
    this.quality = q;
    const touch = matchMedia('(pointer: coarse)').matches;
    const pr = q === 'high' ? Math.min(devicePixelRatio, touch ? 1.75 : 2) : Math.min(devicePixelRatio, 1.25);
    this.renderer.setPixelRatio(pr);
    const size = q === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    if (q === 'high' && !this.composer) this.makeComposer();
    this.resize();
  }
  makeComposer() {
    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    const c = (this.composer = new EffectComposer(this.renderer, rt));
    c.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.55, 0.92);
    c.addPass(this.bloom);
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader);
    this.tiltV = new ShaderPass(VerticalTiltShiftShader);
    this.tiltH.uniforms.r.value = this.tiltV.uniforms.r.value = 0.48;
    c.addPass(this.tiltH);
    c.addPass(this.tiltV);
    c.addPass(new OutputPass());
  }
  resize() {
    const w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      this.tiltH.uniforms.h.value = 3.2 / w;
      this.tiltV.uniforms.v.value = 3.2 / h;
    }
    const old = this.baseDist;
    this.baseDist = this.fitDist();
    if (this.camGoal && old) this.camGoal.dist *= this.baseDist / old;
  }
  fitDist() {
    const vf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hf = Math.atan(Math.tan(vf) * this.camera.aspect);
    return Math.max(8.6 / Math.tan(hf), 8.4 / Math.tan(vf));
  }

  /* ================= 光照 / 天空 / 海洋 ================= */
  setupLights() {
    this.hemi = new THREE.HemisphereLight(0xdff0ff, 0x6b8f3a, 1.2);
    this.scene.add(this.hemi);
    const s = (this.sun = new THREE.DirectionalLight(0xffffff, 3));
    s.castShadow = true;
    const sc = s.shadow.camera;
    sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 160;
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.035;
    this.scene.add(s, s.target);
  }

  setupSky() {
    this.skyU = {
      top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() },
      sunDir: { value: new V3(0, 1, 0) }, sunCol: { value: new THREE.Color() },
      moonDir: { value: new V3(0, 1, 0) }, night: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 moonDir; uniform float night; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          vec3 col = mix(bottom, top, pow(smoothstep(-0.02, 0.7, d.y), 0.75));
          float s = max(dot(d, sunDir), 0.0);
          col += sunCol * (smoothstep(0.9993, 0.9997, s) * 3.0 + pow(s, 10.0) * 0.3) * (1.0 - night);
          float mo = max(dot(d, moonDir), 0.0);
          col += vec3(0.9, 0.95, 1.0) * (smoothstep(0.9988, 0.9993, mo) * 1.8 + pow(mo, 40.0) * 0.18) * night;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), m);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    const r = rng(42), n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = 0.08 + r() * 0.92, a = r() * TAU, rr = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * rr * 800, y * 800, Math.sin(a) * rr * 800], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  setupOcean() {
    const g = new THREE.PlaneGeometry(280, 280, 96, 96).rotateX(-Math.PI / 2);
    const pos = g.attributes.position, cols = [];
    const shallow = new THREE.Color('#5fe0e6'), deep = new THREE.Color('#1677c4'), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getZ(i));
      c.copy(shallow).lerp(deep, smooth((d - 27) / 26));
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.ocean = new THREE.Mesh(g, waterMat({ vertexColors: true, transparent: true, opacity: 0.86 }, 0.13, 'ocean'));
    this.ocean.position.y = -0.55;
    this.ocean.receiveShadow = true;
    this.scene.add(this.ocean);
    const far = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#1677c4', roughness: 0.4 }));
    far.position.y = -0.75;
    this.scene.add(far);
  }

  /* ================= 地形 ================= */
  islandR(a) {
    return 27 + 2.4 * Math.sin(3 * a + 0.6) + 1.5 * Math.sin(5 * a + 2.1) + 0.8 * Math.sin(9 * a + 0.3);
  }
  groundH(x, z) {
    const d = Math.hypot(x, z);
    let h = smooth((d - 12.5) / 6) * ((Math.sin(x * 0.42) * Math.cos(z * 0.37) + Math.sin((x + z) * 0.2 + 1.3)) * 0.26 + 0.14);
    for (const p of this.pads) h *= smooth((Math.hypot(x - p.x, z - p.z) - p.r) / 2.5);
    return h;
  }
  buildIsland() {
    const b = new Builder(11), r = b.r, N = 84;
    const F = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.88, 0.95, 1];
    const rings = [];
    for (let i = 0; i < F.length; i++) {
      const ring = [];
      for (let j = 0; j < N; j++) {
        const a = (j / N) * TAU, rr = this.islandR(a) * F[i];
        let x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (i > 0 && i < F.length - 1) { x += (r() - 0.5) * 0.8; z += (r() - 0.5) * 0.8; }
        let y = this.groundH(x, z);
        if (i === F.length - 1) y *= 0.4;
        ring.push(new V3(x, y, z));
      }
      rings.push(ring);
    }
    for (const [d, y] of [[0.8, -0.32], [1.9, -0.6], [3.5, -1.0], [8, -2.8]]) {
      const ring = [];
      for (let j = 0; j < N; j++) {
        const a = (j / N) * TAU, rr = this.islandR(a) + d + (r() - 0.5) * 0.4;
        ring.push(new V3(Math.cos(a) * rr, y + (r() - 0.5) * 0.08, Math.sin(a) * rr));
      }
      rings.push(ring);
    }
    const grass = ['#7ccf4f', '#74c64a', '#82d455', '#6fbf45', '#79cb4d', '#86d65a'];
    const nG = F.length;
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < N; j++) {
        const j2 = (j + 1) % N;
        const a = rings[i][j], b2 = rings[i][j2], c = rings[i + 1][j], d = rings[i + 1][j2];
        const col = () => (i < nG - 1 ? grass[Math.floor(r() * grass.length)] : i === nG - 1 ? '#b58a55' : i === nG ? '#f4dda5' : i === nG + 1 ? '#e6c98a' : '#c9ad72');
        if (i > 0) upTri(b, a, c, b2, col());
        upTri(b, b2, c, d, col());
      }
    }
    const mesh = new THREE.Mesh(b.geometry(), MAT.std);
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // 浪花
    const fg = [], N2 = 120;
    for (let j = 0; j < N2; j++) {
      const a0 = (j / N2) * TAU, a1 = ((j + 1) / N2) * TAU;
      const p = (a, d) => [Math.cos(a) * (this.islandR(a) + d), 0, Math.sin(a) * (this.islandR(a) + d)];
      fg.push(...p(a0, 1.3), ...p(a0, 2.3), ...p(a1, 1.3), ...p(a1, 1.3), ...p(a0, 2.3), ...p(a1, 2.3));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(fg, 3));
    this.foam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    this.foam.position.y = -0.47;
    this.foam.renderOrder = 2;
    this.scene.add(this.foam);
  }

  /* ================= 静态建筑与自然 ================= */
  buildStatic() {
    const b = new Builder(5);
    const roof = new Builder(6);
    const r = b.r;
    this.buildFarmBase(b);
    this.buildHouse(b, roof, M(-12, 0, -11.5, 0, Math.PI / 4, 0));
    this.buildWindmill(b, M(-15.5, 0, 0.5, 0, Math.PI / 4 + 0.35, 0));
    this.buildBarn(b, M(0.5, 0, -15.5, 0, 0.15, 0));
    this.buildSilo(b, M(4.6, 0, -16.2));
    this.buildDoghouse(b, M(10, 0, 3.5, 0, Math.PI / 4, 0));
    this.buildPond(b, 11, -10);
    this.buildMisc(b);
    this.buildNature(b, r);

    const grp = b.group({ mats: { std: MAT.std, lamp: MAT.lamp, tree: MAT.tree, dbl: MAT.dbl } });
    this.scene.add(grp);
    this.roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, color: '#e2574c' });
    const roofMesh = new THREE.Mesh(roof.geometry(), this.roofMat);
    roofMesh.castShadow = roofMesh.receiveShadow = true;
    this.scene.add(roofMesh);
    this.makeSign();
  }

  buildFarmBase(b) {
    b.add(P.box(), M(0, -0.06, 0, 0, 0, 0, 12.4, 0.12, 12.4), '#caa26b', 0.04);
    const hw = 6.3;
    for (const s of [-1, 1]) {
      b.add(P.box(), M(0, 0, s * hw, 0, 0, 0, 12.9, 0.2, 0.32), '#9c6b3f', 0.08);
      b.add(P.box(), M(s * hw, 0, 0, 0, 0, 0, 0.32, 0.2, 12.9), '#9c6b3f', 0.08);
    }
    const r = b.r;
    for (let i = 0; i < 70; i++) {
      const x = (r() - 0.5) * 12, z = (r() - 0.5) * 12;
      const gx = Math.abs(((x / 2.85 + 2) % 1) - 0.5), gz = Math.abs(((z / 2.85 + 2) % 1) - 0.5);
      if (gx < 0.4 && gz < 0.4) continue;
      b.add(P.dod(), M(x, 0.04, z, r(), r(), 0, 0.05 + r() * 0.06, 0.03, 0.05 + r() * 0.06), '#a89f92', 0.15);
    }
    // 篱笆：四边中间留门
    const fw = 7.7, n = 12, step = (fw * 2) / n;
    const post = (x, z) => {
      b.add(P.box(), M(x, 0, z, 0, 0, 0, 0.2, 0.9, 0.2), '#c08a52', 0.1);
      b.add(P.cone(4), M(x, 0.9, z, 0, Math.PI / 4, 0, 0.15, 0.16, 0.15), '#a87543', 0.1);
    };
    for (let side = 0; side < 4; side++) {
      for (let k = 0; k <= n; k++) {
        const t = -fw + k * step;
        if (Math.abs(t) < 1.1) continue;
        const [x, z] = [[t, fw], [t, -fw], [fw, t], [-fw, t]][side];
        post(x, z);
        const t2 = t + step;
        if (k < n && !(Math.abs(t2) < 1.1)) {
          const mid = t + step / 2;
          for (const y of [0.32, 0.62]) {
            const [mx, mz] = [[mid, fw], [mid, -fw], [fw, mid], [-fw, mid]][side];
            const along = side < 2;
            b.add(P.box(), M(mx, y, mz, 0, 0, 0, along ? step : 0.08, 0.1, along ? 0.08 : step), '#d39a5e', 0.08);
          }
        }
      }
    }
    // 门口的石板路
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      for (let k = 0; k < 4; k++) {
        const d = 8.3 + k * 0.9;
        b.add(P.dod(), M(dx * d + (r() - 0.5) * 0.3, 0.01, dz * d + (r() - 0.5) * 0.3, 0, r() * 3, 0, 0.42, 0.06, 0.36), '#d8cdb8', 0.08);
      }
    }
    // 灯柱
    this.lampSpots = [];
    for (const [x, z] of [[8.4, 8.4], [-8.4, 8.4], [8.4, -8.4], [-8.4, -8.4]]) {
      b.add(P.cyl(6), M(x, 0, z, 0, 0, 0, 0.08, 2.3, 0.08), '#3e3a39', 0.05);
      b.add(P.box(), M(x, 2.25, z, 0, 0, 0, 0.32, 0.06, 0.32), '#3e3a39', 0.05);
      b.add(P.box(), M(x, 2.3, z, 0, 0, 0, 0.24, 0.36, 0.24), '#ffcf6e', 0.02, 'lamp');
      b.add(P.cone(4), M(x, 2.66, z, 0, Math.PI / 4, 0, 0.26, 0.2, 0.26), '#3e3a39', 0.05);
      this.lampSpots.push(new V3(x, 2.45, z));
    }
  }

  buildHouse(b, rb, m) {
    const A = (g, mm, col, j = 0.05, ch = 'std') => b.add(g, mul(m, mm), col, j, ch);
    A(P.box(), M(0, -0.3, 0, 0, 0, 0, 6.4, 0.8, 5.2), '#a39e94', 0.1);
    A(P.box(), M(0, 0.5, 0, 0, 0, 0, 5.8, 2.8, 4.6), '#f6e8cc', 0.03);
    for (const [x, z] of [[-2.9, 2.3], [2.9, 2.3], [-2.9, -2.3], [2.9, -2.3]]) A(P.box(), M(x, 0.5, z, 0, 0, 0, 0.28, 2.8, 0.28), '#7a4a26');
    A(P.box(), M(0, 3.12, 2.32, 0, 0, 0, 5.9, 0.2, 0.1), '#7a4a26');
    A(P.box(), M(0, 3.12, -2.32, 0, 0, 0, 5.9, 0.2, 0.1), '#7a4a26');
    A(P.box(), M(2.92, 3.12, 0, 0, 0, 0, 0.1, 0.2, 4.7), '#7a4a26');
    A(P.box(), M(-2.92, 3.12, 0, 0, 0, 0, 0.1, 0.2, 4.7), '#7a4a26');
    A(P.box(), M(0, 1.0, 2.32, 0, 0, 0, 5.9, 0.12, 0.08), '#7a4a26');
    for (const gz of [2.3, -2.3]) {
      const pts = [[-2.9, 3.3, gz], [2.9, 3.3, gz], [0, 5.1, gz]].map((p) => new V3(...p).applyMatrix4(m));
      b.tri(pts[0], pts[1], pts[2], '#f1dfbd', 0.02);
      b.tri(pts[0], pts[2], pts[1], '#f1dfbd', 0.02);
    }
    const th = 0.62, hw = 2.75, L = 3.55;
    for (const s of [1, -1]) {
      const S = mul(m, M(0, 3.3 + (hw / 2) * Math.tan(th) + 0.1, (s * hw) / 2, s * th, 0, 0));
      rb.add(P.boxC(), mul(S, M(0, 0, 0, 0, 0, 0, 6.8, 0.22, L)), '#ededed', 0.05);
      for (let k = 0; k < 5; k++) rb.add(P.boxC(), mul(S, M(0, 0.13, (k / 4 - 0.5) * L * 0.85, 0, 0, 0, 6.85, 0.07, 0.16)), '#c9c9c9', 0.04);
    }
    rb.add(P.boxC(), mul(m, M(0, 5.32, 0, Math.PI / 4, 0, 0, 6.9, 0.3, 0.3)), '#bdbdbd', 0.03);
    A(P.box(), M(1.7, 3.6, -1.0, 0, 0, 0, 0.65, 2.3, 0.65), '#b5523b', 0.12);
    A(P.box(), M(1.7, 5.85, -1.0, 0, 0, 0, 0.82, 0.18, 0.82), '#8d3b2a', 0.06);
    this.chimneyTop = new V3(1.7, 6.1, -1.0).applyMatrix4(m);
    // 门窗
    A(P.box(), M(0, 0.5, 2.32, 0, 0, 0, 1.45, 2.2, 0.06), '#3e2410');
    A(P.box(), M(0, 0.5, 2.37, 0, 0, 0, 1.15, 2.0, 0.08), '#6b3d1c');
    A(P.ico(0), M(0.38, 1.45, 2.43, 0, 0, 0, 0.06), '#ffcf3f');
    A(P.box(), M(0, 0, 2.95, 0, 0, 0, 1.8, 0.32, 0.8), '#b8b2a6', 0.08);
    const win = (mm) => {
      A(P.box(), mul(mm, M(0, -0.55, 0, 0, 0, 0, 1.1, 1.1, 0.08)), '#5a3214');
      A(P.box(), mul(mm, M(0, -0.5, 0.04, 0, 0, 0, 0.9, 1.0, 0.04)), '#ffd98a', 0.02, 'lamp');
      A(P.box(), mul(mm, M(0, -0.5, 0.07, 0, 0, 0, 0.08, 1.0, 0.03)), '#5a3214');
      A(P.box(), mul(mm, M(0, -0.04, 0.07, 0, 0, 0, 0.9, 0.08, 0.03)), '#5a3214');
      for (const sx of [-0.7, 0.7]) A(P.box(), mul(mm, M(sx, -0.55, 0.02, 0, 0, 0, 0.32, 1.1, 0.06)), '#4f9a5a');
      A(P.box(), mul(mm, M(0, -0.82, 0.18, 0, 0, 0, 1.1, 0.26, 0.36)), '#8a5a2b');
      for (let i = 0; i < 5; i++) A(P.ico(0), mul(mm, M(-0.4 + i * 0.2, -0.5, 0.2, 0, i, 0, 0.1)), ['#ff6b8b', '#ffd23f', '#ff8a3d', '#ffffff', '#c07cff'][i], 0.05);
    };
    win(M(-1.75, 2.0, 2.31));
    win(M(1.75, 2.0, 2.31));
    win(M(2.91, 2.0, 0, 0, Math.PI / 2, 0));
    A(P.cylC(8), M(0, 4.15, 2.31, Math.PI / 2, 0, 0, 0.45, 0.06, 0.45), '#5a3214');
    A(P.cylC(8), M(0, 4.15, 2.34, Math.PI / 2, 0, 0, 0.35, 0.05, 0.35), '#ffd98a', 0.02, 'lamp');
    A(P.box(), M(0.95, 2.4, 2.45, 0, 0, 0, 0.22, 0.32, 0.22), '#ffcf6e', 0.02, 'lamp');
    A(P.cone(4), M(0.95, 2.72, 2.45, 0, Math.PI / 4, 0, 0.2, 0.15, 0.2), '#3e3a39');
    this.porch = new V3(0.95, 2.5, 2.9).applyMatrix4(m);
    for (let i = 0; i < 7; i++) {
      const x = -2.6 + i * 0.85;
      if (Math.abs(x) < 1) continue;
      A(P.ico(1), M(x, 0.3, 2.95, 0, i, 0, 0.42, 0.36, 0.38), i % 2 ? '#4caf50' : '#5cbf4a', 0.1, 'tree');
      A(P.ico(0), M(x + 0.1, 0.6, 3.15, 0, 0, 0, 0.08), ['#ff6b8b', '#ffd23f', '#ffffff'][i % 3], 0.05, 'tree');
    }
  }

  buildWindmill(b, m) {
    const A = (g, mm, col, j = 0.05, ch = 'std') => b.add(g, mul(m, mm), col, j, ch);
    A(P.cyl(8), M(0, -0.2, 0, 0, 0, 0, 2.1, 0.6, 2.1), '#a39e94', 0.1);
    A(P.cyl(8, 0.66), M(0, 0.4, 0, 0, 0, 0, 1.6, 6.0, 1.6), '#f3e6cf', 0.04);
    for (const y of [2.2, 4.2]) A(P.cyl(8, 0.95), M(0, y, 0, 0, 0, 0, 1.6 - y * 0.09, 0.2, 1.6 - y * 0.09), '#c9a77c', 0.05);
    A(P.box(), M(0, 0.4, 1.4, -0.08, 0, 0, 0.75, 1.35, 0.15), '#6b3d1c');
    A(P.box(), M(0, 3.2, 1.22, -0.08, 0, 0, 0.45, 0.55, 0.1), '#ffd98a', 0.02, 'lamp');
    A(P.cone(8), M(0, 6.3, 0, 0, Math.PI / 8, 0, 1.4, 1.7, 1.4), '#c0392b', 0.06);
    A(P.cylC(8), M(0, 6.55, 1.0, Math.PI / 2, 0, 0, 0.22, 0.5, 0.22), '#6b3d1c');
    const bb = new Builder(9);
    bb.add(P.cylC(8), M(0, 0, 0, Math.PI / 2, 0, 0, 0.32, 0.3, 0.32), '#8a5a2b');
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      const R = M(0, 0, 0.1, 0, 0, a);
      bb.add(P.box(), mul(R, M(0, 0, 0, 0, 0, 0, 0.14, 3.4, 0.1)), '#8a5a2b', 0.05);
      bb.add(P.boxC(), mul(R, M(0.42, 2.0, 0, 0, 0, 0, 0.66, 2.6, 0.04)), '#fff8ec', 0.04, 'dbl');
      for (let k = 0; k < 4; k++) bb.add(P.boxC(), mul(R, M(0.42, 0.9 + k * 0.72, 0.03, 0, 0, 0, 0.7, 0.05, 0.03)), '#a87543', 0.05);
      bb.add(P.boxC(), mul(R, M(0.76, 2.0, 0.03, 0, 0, 0, 0.05, 2.6, 0.03)), '#a87543', 0.05);
    }
    this.blades = bb.group({ mats: { std: MAT.std, dbl: MAT.dbl } });
    const hub = new V3(0, 6.55, 1.3).applyMatrix4(m);
    this.blades.position.copy(hub);
    this.blades.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(m));
    this.bladesSpin = new THREE.Group();
    this.bladesSpin.add(...this.blades.children);
    this.blades.add(this.bladesSpin);
    this.scene.add(this.blades);
  }

  buildBarn(b, m) {
    const A = (g, mm, col, j = 0.05, ch = 'std') => b.add(g, mul(m, mm), col, j, ch);
    A(P.box(), M(0, -0.3, 0, 0, 0, 0, 4.8, 0.6, 5.8), '#a39e94', 0.1);
    A(P.box(), M(0, 0.3, 0, 0, 0, 0, 4.4, 3.0, 5.4), '#d64541', 0.05);
    for (const [x, z] of [[-2.2, 2.7], [2.2, 2.7], [-2.2, -2.7], [2.2, -2.7]]) A(P.box(), M(x, 0.3, z, 0, 0, 0, 0.22, 3.0, 0.22), '#fff4e0', 0.03);
    const gz = 2.71;
    const poly = [[-2.2, 3.3], [2.2, 3.3], [1.4, 4.5], [0, 5.25], [-1.4, 4.5]];
    for (const z of [gz, -gz]) {
      const c = new V3(0, 4.1, z).applyMatrix4(m);
      for (let i = 0; i < poly.length; i++) {
        const p1 = new V3(poly[i][0], poly[i][1], z).applyMatrix4(m);
        const p2 = new V3(poly[(i + 1) % poly.length][0], poly[(i + 1) % poly.length][1], z).applyMatrix4(m);
        b.tri(c, p1, p2, '#d64541', 0.03);
        b.tri(c, p2, p1, '#d64541', 0.03);
      }
    }
    const slabs = [[-1.925, 3.95, 0.872, 1.75], [-0.7, 4.96, 0.519, 1.7]];
    for (const [x, y, a, len] of slabs) {
      A(P.boxC(), M(x, y, 0, 0, 0, a, len, 0.18, 6.0), '#6d4c41', 0.05);
      A(P.boxC(), M(-x, y, 0, 0, 0, -a, len, 0.18, 6.0), '#6d4c41', 0.05);
    }
    A(P.boxC(), M(0, 5.3, 0, 0, 0, Math.PI / 4, 0.28, 0.28, 6.1), '#5d4037');
    A(P.box(), M(0, 0.3, 2.72, 0, 0, 0, 2.3, 2.5, 0.06), '#fff4e0', 0.02);
    A(P.box(), M(0, 0.4, 2.76, 0, 0, 0, 2.0, 2.3, 0.06), '#b83a33', 0.03);
    for (const s of [-1, 1]) A(P.boxC(), M(0, 1.55, 2.8, 0, 0, s * 0.85, 0.14, 2.9, 0.04), '#fff4e0', 0.02);
    A(P.box(), M(0, 1.52, 2.8, 0, 0, 0, 0.1, 2.3, 0.04), '#fff4e0', 0.02);
    A(P.box(), M(0, 3.7, 2.72, 0, 0, 0, 0.9, 0.8, 0.06), '#fff4e0', 0.02);
    A(P.box(), M(0, 3.78, 2.75, 0, 0, 0, 0.7, 0.62, 0.06), '#4a2c17', 0.02);
    A(P.ico(0), M(0, 3.82, 2.78, 0, 0, 0, 0.3, 0.2, 0.08), '#e6c25a', 0.15);
    for (let i = 0; i < 3; i++) A(P.cylC(10), M(-3.0 + i * 0.2, 0.62, 1.2 - i * 1.4, 0, 0.3 * i, Math.PI / 2, 0.62, 1.2, 0.62), '#e6c25a', 0.12);
    for (let i = 0; i < 2; i++) {
      A(P.box(), M(3.0, 0, 1.6 - i * 0.9, 0, 0.2 * i, 0, 0.7, 0.7, 0.7), '#b9824a', 0.08);
      A(P.box(), M(3.0, 0.7, 1.6, 0, 0.5, 0, 0.55, 0.55, 0.55), '#c8925a', 0.08);
    }
  }

  buildSilo(b, m) {
    const A = (g, mm, col, j = 0.05) => b.add(g, mul(m, mm), col, j);
    A(P.cyl(12), M(0, 0, 0, 0, 0, 0, 1.4, 5.6, 1.4), '#b9c6cc', 0.03);
    for (const y of [1.2, 2.6, 4.0]) A(P.cyl(12), M(0, y, 0, 0, 0, 0, 1.44, 0.14, 1.44), '#8fa1a9', 0.03);
    A(P.sph(12, 6), M(0, 5.6, 0, 0, 0, 0, 1.42, 0.85, 1.42), '#d64541', 0.04);
  }

  buildDoghouse(b, m) {
    const A = (g, mm, col, j = 0.06) => b.add(g, mul(m, mm), col, j);
    A(P.box(), M(0, 0, 0, 0, 0, 0, 1.5, 1.1, 1.6), '#c68642');
    for (const s of [1, -1]) A(P.boxC(), M(s * 0.45, 1.38, 0, 0, 0, -s * 0.62, 1.15, 0.12, 1.85), '#c0392b');
    A(P.box(), M(0, 0, 0.8, 0, 0, 0, 0.62, 0.75, 0.04), '#3e2410');
    A(P.cylC(8), M(0, 0.75, 0.8, Math.PI / 2, 0, 0, 0.31, 0.04, 0.31), '#3e2410');
    for (const s of [1, -1]) b.tri(new V3(-0.75, 1.1, s * 0.8).applyMatrix4(m), new V3(0.75, 1.1, s * 0.8).applyMatrix4(m), new V3(0, 1.62, s * 0.8).applyMatrix4(m), '#c68642', 0.03),
      b.tri(new V3(-0.75, 1.1, s * 0.8).applyMatrix4(m), new V3(0, 1.62, s * 0.8).applyMatrix4(m), new V3(0.75, 1.1, s * 0.8).applyMatrix4(m), '#c68642', 0.03);
    A(P.cyl(10, 1.2), M(0.75, 0, 1.4, 0, 0, 0, 0.22, 0.1, 0.22), '#e53935');
    A(P.box(), M(0.3, 0.02, 1.5, 0, 0.4, 0, 0.32, 0.06, 0.07), '#fff8e1', 0.02);
    this.doghouseFront = new V3(0, 0, 1.5).applyMatrix4(m);
  }

  buildPond(b, px, pz) {
    this.pond = new V3(px, 0, pz);
    const r = b.r;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU, rr = 3.25 + (r() - 0.5) * 0.3;
      b.add(P.dod(), M(px + Math.cos(a) * rr, 0.0, pz + Math.sin(a) * rr, r(), r(), 0, 0.32 + r() * 0.15, 0.2 + r() * 0.1, 0.32 + r() * 0.15), ['#a7a29a', '#bdb7ad', '#958f86'][i % 3], 0.1);
    }
    b.add(P.cyl(20), M(px, -0.05, pz, 0, 0, 0, 3.25, 0.1, 3.25), '#c9ad72', 0.05);
    const g = new THREE.CylinderGeometry(3.15, 3.15, 0.05, 28, 1).translate(0, 0, 0);
    const water = new THREE.Mesh(g, waterMat({ color: '#45c3ec', transparent: true, opacity: 0.9 }, 0.02, 'pond'));
    water.position.set(px, 0.08, pz);
    water.receiveShadow = true;
    this.scene.add(water);
    for (let i = 0; i < 5; i++) {
      const a = r() * TAU, rr = 0.8 + r() * 1.8;
      b.add(P.cyl(9), M(px + Math.cos(a) * rr, 0.11, pz + Math.sin(a) * rr, 0, r() * 3, 0, 0.32, 0.02, 0.32), '#4caf50', 0.08, 'tree');
      if (i % 2 === 0) b.add(P.ico(0), M(px + Math.cos(a) * rr, 0.16, pz + Math.sin(a) * rr, 0, 0, 0, 0.09), '#ff8fb1', 0.05, 'tree');
    }
    for (let i = 0; i < 9; i++) {
      const a = 2.2 + r() * 1.6, rr = 3.1 + r() * 0.4;
      const x = px + Math.cos(a) * rr, z = pz + Math.sin(a) * rr, h = 0.9 + r() * 0.6;
      b.add(P.cyl(4), M(x, 0, z, (r() - 0.5) * 0.2, 0, 0, 0.025, h, 0.025), '#6d9b3a', 0.05, 'tree');
      b.add(P.cyl(6), M(x, h - 0.1, z, 0, 0, 0, 0.06, 0.25, 0.06), '#7a4a26', 0.05, 'tree');
    }
  }

  buildMisc(b) {
    const A = (g, mm, col, j = 0.06, ch = 'std') => b.add(g, mm, col, j, ch);
    // 信箱
    A(P.box(), M(3, 0, 10, 0, 0, 0, 0.12, 1.05, 0.12), '#8a5a2b');
    A(P.box(), M(3, 1.0, 10, 0, Math.PI / 4, 0, 0.42, 0.36, 0.7), '#3f7fd6');
    A(P.cylC(10), M(3, 1.36, 10, 0, Math.PI / 4, Math.PI / 2, 0.21, 0.7, 0.21), '#3f7fd6');
    A(P.box(), M(3.25, 1.2, 9.8, 0, Math.PI / 4, 0, 0.04, 0.4, 0.04), '#c0392b');
    A(P.box(), M(3.28, 1.5, 9.83, 0, Math.PI / 4, 0, 0.04, 0.16, 0.22), '#e53935');
    // 稻草人
    const S = M(9.6, 0, -3.6, 0, Math.PI / 4, 0);
    A(P.box(), mul(S, M(0, 0, 0, 0, 0, 0, 0.1, 2.0, 0.1)), '#8a5a2b');
    A(P.box(), mul(S, M(0, 1.45, 0, 0, 0, 0, 1.6, 0.08, 0.08)), '#8a5a2b');
    A(P.box(), mul(S, M(0, 0.9, 0, 0, 0, 0, 0.55, 0.7, 0.35)), '#3f6fb5');
    A(P.box(), mul(S, M(0, 1.3, 0, 0, 0, 0, 1.2, 0.26, 0.26)), '#4a7fc4');
    A(P.ico(1), mul(S, M(0, 1.85, 0, 0, 0, 0, 0.26)), '#e3c58f');
    A(P.cylC(10), mul(S, M(0, 2.02, 0, 0, 0, 0, 0.5, 0.04, 0.5)), '#e8c46a');
    A(P.cone(8), mul(S, M(0, 2.02, 0, 0, 0, 0, 0.26, 0.32, 0.26)), '#e8c46a');
    A(P.box(), mul(S, M(-0.09, 1.86, 0.24, 0, 0, 0, 0.05, 0.05, 0.03)), '#3e2410');
    A(P.box(), mul(S, M(0.09, 1.86, 0.24, 0, 0, 0, 0.05, 0.05, 0.03)), '#3e2410');
    A(P.box(), mul(S, M(0.25, 0.95, 0.18, 0, 0, 0, 0.14, 0.14, 0.02)), '#e53935');
    // 木牌柱子
    for (const s of [-1, 1]) A(P.box(), M(-1.8 + s * 1.1, 0, 10.6 - s * 1.1, 0, Math.PI / 4, 0, 0.14, 1.5, 0.14), '#8a5a2b');
  }

  buildNature(b, r) {
    const pads = this.pads;
    const blocked = (x, z, pad = 0) => {
      if (Math.abs(x) < 9.8 + pad && Math.abs(z) < 9.8 + pad) return true;
      for (const p of pads) if (Math.hypot(x - p.x, z - p.z) < p.r + 1.6 + pad) return true;
      return false;
    };
    const greens = ['#4caf50', '#43a047', '#5cb85c', '#3d9b40', '#66bb6a'];
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const tree = (x, z, s, kind) => {
      const y = this.groundH(x, z) - 0.05;
      if (kind === 'pine') {
        b.add(P.cyl(6, 0.7), M(x, y, z, 0, 0, 0, 0.22 * s, 1.0 * s, 0.22 * s), '#7a4a26');
        for (let k = 0; k < 3; k++) b.add(P.cone(7), M(x, y + (0.8 + k * 0.85) * s, z, 0, r() * 3, 0, (1.3 - k * 0.3) * s, 1.5 * s, (1.3 - k * 0.3) * s), pick(['#2e7d4f', '#358a57', '#2f8f5b']), 0.08, 'tree');
        return;
      }
      if (kind === 'palm') {
        let px = x, py = y, pz = z;
        const lean = r() * TAU, segs = 6;
        for (let k = 0; k < segs; k++) {
          const tilt = 0.08 + k * 0.05;
          b.add(P.cyl(6, 0.88), M(px, py, pz, tilt, lean, 0, (0.2 - k * 0.015) * s, 0.75 * s, (0.2 - k * 0.015) * s), k % 2 ? '#a9814f' : '#b88d58', 0.05);
          px += Math.sin(tilt) * Math.sin(lean) * 0.72 * s; py += Math.cos(tilt) * 0.72 * s; pz += Math.sin(tilt) * Math.cos(lean) * 0.72 * s;
        }
        for (let k = 0; k < 7; k++) b.add(P.leaf(), M(px, py, pz, 1.75 + r() * 0.3, (k / 7) * TAU, 0, 0.32 * s, 2.0 * s, 0.03), pick(['#3fa34d', '#4cb35a']), 0.08, 'tree');
        for (let k = 0; k < 3; k++) b.add(P.ico(0), M(px + Math.cos(k * 2) * 0.18, py - 0.15, pz + Math.sin(k * 2) * 0.18, 0, 0, 0, 0.14 * s), '#7a5230', 0.05, 'tree');
        return;
      }
      const trunkH = 1.7 * s;
      b.add(P.cyl(6, 0.65), M(x, y, z, 0, 0, 0, 0.26 * s, trunkH, 0.26 * s), kind === 'birch' ? '#efe9de' : '#8b5a2b', 0.06);
      const n = 3 + Math.floor(r() * 2);
      const col = kind === 'birch' ? ['#9ccc65', '#aed581', '#8bc34a'] : kind === 'autumn' ? ['#ffb74d', '#ff9f43', '#ffca5f'] : greens;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + r(), rr = k === 0 ? 0 : 0.7 * s;
        b.add(P.ico(1), M(x + Math.cos(a) * rr, y + trunkH + (k === 0 ? 0.9 : 0.4 + r() * 0.5) * s, z + Math.sin(a) * rr, r(), r(), 0, (k === 0 ? 1.35 : 1.0 + r() * 0.25) * s), pick(col), 0.08, 'tree');
      }
      if (kind === 'fruit') {
        for (let k = 0; k < 9; k++) {
          const a = r() * TAU, e = r() * 1.2;
          b.add(P.ico(0), M(x + Math.cos(a) * Math.cos(e) * 1.4 * s, y + trunkH + 0.8 * s + Math.sin(e) * 1.0 * s, z + Math.sin(a) * Math.cos(e) * 1.4 * s, 0, 0, 0, 0.13 * s), '#ef4b3c', 0.05, 'tree');
        }
      }
    };
    let placed = 0;
    for (let tries = 0; placed < 52 && tries < 900; tries++) {
      const a = r() * TAU, rr = 13 + r() * (this.islandR(a) - 15.5);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (blocked(x, z) || x + z > 13) continue;
      const k = r();
      tree(x, z, 0.85 + r() * 0.45, k < 0.4 ? 'round' : k < 0.68 ? 'pine' : k < 0.8 ? 'fruit' : k < 0.9 ? 'autumn' : 'birch');
      placed++;
    }
    for (const a of [-2.8, -2.3, 2.6, 3.05, -0.55, 1.75, -1.35]) {
      const rr = this.islandR(a) - 1.4;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (x + z > 16) continue;
      tree(x, z, 1 + r() * 0.2, 'palm');
    }
    // 灌木、花、草、石头
    for (let i = 0; i < 46; i++) {
      const a = r() * TAU, rr = 10.5 + r() * (this.islandR(a) - 12);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (blocked(x, z, -0.6)) continue;
      const y = this.groundH(x, z), s = 0.4 + r() * 0.35;
      b.add(P.ico(1), M(x, y + s * 0.5, z, r(), r(), 0, s * 1.2, s, s * 1.1), pick(['#3d8b40', '#46a049', '#358a3a']), 0.1, 'tree');
      if (r() < 0.5) for (let k = 0; k < 4; k++) b.add(P.ico(0), M(x + (r() - 0.5) * s * 1.6, y + s * (0.6 + r() * 0.5), z + (r() - 0.5) * s * 1.6, 0, 0, 0, 0.08), pick(['#ff6b8b', '#ffffff', '#ffd23f', '#c07cff']), 0.05, 'tree');
    }
    const flowerCols = ['#ff5a6e', '#ffd23f', '#ffffff', '#ff8fd0', '#b388ff', '#ff9f43', '#7fdbff'];
    const flowerAt = (x, z) => {
      const y = this.groundH(x, z);
      const h = 0.2 + r() * 0.2;
      b.add(P.cyl(3), M(x, y, z, 0, 0, 0, 0.015, h, 0.015), '#5aa83a', 0.05, 'tree');
      const c = pick(flowerCols);
      for (let k = 0; k < 5; k++) b.add(P.ico(0), M(x + Math.cos(k * 1.256) * 0.06, y + h, z + Math.sin(k * 1.256) * 0.06, 0, 0, 0, 0.05, 0.025, 0.05), c, 0.04, 'tree');
      b.add(P.ico(0), M(x, y + h + 0.01, z, 0, 0, 0, 0.035), '#ffb300', 0.04, 'tree');
    };
    for (let i = 0; i < 120; i++) {
      const side = Math.floor(r() * 4), t = (r() - 0.5) * 15, off = 8.2 + r() * 1.3;
      const [x, z] = [[t, off], [t, -off], [off, t], [-off, t]][side];
      if (Math.abs(t) < 1.6) continue;
      if (blocked(x, z, -2.2) && !(Math.abs(x) < 9.8 && Math.abs(z) < 9.8)) continue;
      flowerAt(x, z);
    }
    for (let i = 0; i < 90; i++) {
      const a = r() * TAU, rr = 10 + r() * (this.islandR(a) - 11);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (!blocked(x, z, -1)) flowerAt(x, z);
    }
    for (let i = 0; i < 260; i++) {
      const a = r() * TAU, rr = 8.6 + r() * (this.islandR(a) - 9);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (blocked(x, z, -1.5)) continue;
      const y = this.groundH(x, z);
      for (let k = 0; k < 3; k++) b.add(P.leaf(), M(x + (r() - 0.5) * 0.15, y, z + (r() - 0.5) * 0.15, 0.3 + r() * 0.3, r() * TAU, 0, 0.05, 0.3 + r() * 0.2, 0.02), pick(['#5fb33c', '#6abf45', '#4fa336']), 0.06, 'tree');
    }
    for (let i = 0; i < 34; i++) {
      const a = r() * TAU;
      const beach = i < 16;
      const rr = beach ? this.islandR(a) + 0.9 + r() * 0.8 : 12 + r() * (this.islandR(a) - 13);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (!beach && blocked(x, z)) continue;
      const y = beach ? -0.4 : this.groundH(x, z);
      const s = 0.25 + r() * 0.5;
      b.add(P.dod(), M(x, y + s * 0.2, z, r(), r(), 0, s * 1.2, s * 0.8, s), pick(['#a7a29a', '#bdb7ad', '#958f86', '#c4bdb1']), 0.1);
    }
  }

  makeSign() {
    const c = (this.signCanvas = document.createElement('canvas'));
    c.width = 512;
    c.height = 192;
    this.signTex = new THREE.CanvasTexture(c);
    this.signTex.colorSpace = THREE.SRGBColorSpace;
    this.signTex.anisotropy = 4;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.1, 0.12), [
      ...Array(4).fill(new THREE.MeshStandardMaterial({ color: '#8a5a2b' })),
      new THREE.MeshStandardMaterial({ map: this.signTex, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: '#8a5a2b' }),
    ]);
    mesh.position.set(-1.8, 1.25, 10.6);
    mesh.rotation.y = Math.PI / 4;
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.setSign('丰收岛', '欢迎光临');
  }
  setSign(title, sub) {
    const ctx = this.signCanvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 192);
    g.addColorStop(0, '#d9a066');
    g.addColorStop(1, '#a86d3a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 192);
    ctx.strokeStyle = 'rgba(90,50,21,.35)';
    ctx.lineWidth = 3;
    for (const y of [64, 128]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke(); }
    ctx.strokeStyle = '#5a3215';
    ctx.lineWidth = 12;
    ctx.strokeRect(6, 6, 500, 180);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 78px "PingFang SC","Microsoft YaHei","Noto Sans SC","WenQuanYi Micro Hei",sans-serif';
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#5a3215';
    ctx.strokeText(title, 256, 82);
    ctx.fillStyle = '#fff6e0';
    ctx.fillText(title, 256, 82);
    ctx.font = '800 34px "PingFang SC","Microsoft YaHei","Noto Sans SC","WenQuanYi Micro Hei",sans-serif';
    ctx.fillStyle = '#5a3215';
    ctx.fillText(sub, 256, 150);
    this.signTex.needsUpdate = true;
  }

  /* ================= 活物：云、鸟、蝴蝶、萤火虫、鸭子、炊烟、狗 ================= */
  setupLife() {
    const r = rng(77);
    this.clouds = [];
    const cloudMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.12 });
    for (let i = 0; i < 11; i++) {
      const b = new Builder(100 + i);
      const n = 4 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) b.add(P.ico(1), M((k - n / 2) * 1.5 + r(), r() * 0.8, (r() - 0.5) * 1.8, r(), r(), 0, 1.3 + r() * 1.1), '#ffffff', 0.03);
      const g = new THREE.Mesh(b.geometry(), cloudMat);
      g.castShadow = true;
      g.position.set((r() - 0.5) * 160, 17 + r() * 8, (r() - 0.5) * 120 - 10);
      g.scale.setScalar(0.9 + r() * 0.9);
      g.userData.speed = 0.6 + r() * 0.8;
      this.scene.add(g);
      this.clouds.push(g);
    }
    // 海鸥
    this.birds = [];
    for (let i = 0; i < 5; i++) {
      const grp = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, side: THREE.DoubleSide });
      const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), mat);
      body.scale.set(0.8, 0.7, 2);
      const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28).translate(0.45, 0, 0).rotateX(-Math.PI / 2), mat);
      const wr = wl.clone();
      wr.scale.x = -1;
      grp.add(body, wl, wr);
      grp.userData = { wl, wr, a: r() * TAU, rad: 26 + r() * 14, h: 11 + r() * 5, sp: 0.12 + r() * 0.08, ph: r() * 10 };
      this.scene.add(grp);
      this.birds.push(grp);
    }
    // 蝴蝶
    this.butterflies = [];
    const bcols = ['#ffb3e6', '#ffe066', '#7fdbff', '#ffffff', '#ff9f43', '#c7a3ff', '#ff6b8b', '#a5ff8a'];
    for (let i = 0; i < 9; i++) {
      const grp = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: bcols[i % bcols.length], side: THREE.DoubleSide, roughness: 0.6, emissive: bcols[i % bcols.length], emissiveIntensity: 0.25 });
      const wg = new THREE.CircleGeometry(0.13, 5).translate(0.13, 0, 0).rotateX(-Math.PI / 2);
      const wl = new THREE.Mesh(wg, mat), wr = new THREE.Mesh(wg, mat);
      wr.scale.x = -1;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 4).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3e2410' }));
      grp.add(wl, wr, body);
      grp.userData = { wl, wr, ph: r() * 100, cx: (r() - 0.5) * 18, cz: (r() - 0.5) * 18, sp: 0.4 + r() * 0.4 };
      this.scene.add(grp);
      this.butterflies.push(grp);
    }
    // 萤火虫
    const fc = document.createElement('canvas');
    fc.width = fc.height = 64;
    const fctx = fc.getContext('2d');
    const rg = fctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,220,1)');
    rg.addColorStop(0.25, 'rgba(230,255,120,.9)');
    rg.addColorStop(1, 'rgba(180,255,80,0)');
    fctx.fillStyle = rg;
    fctx.fillRect(0, 0, 64, 64);
    const nF = 90, fpos = new Float32Array(nF * 3);
    this.fireflySeeds = [];
    for (let i = 0; i < nF; i++) {
      const a = r() * TAU, rr = 6 + r() * 16;
      this.fireflySeeds.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, ph: r() * 100, sp: 0.3 + r() * 0.5 });
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
    this.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(fc), size: 0.55, color: new THREE.Color(3, 3, 2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.fireflies.frustumCulled = false;
    this.scene.add(this.fireflies);
    // 鸭子
    this.ducks = [];
    for (let i = 0; i < 2; i++) {
      const b = new Builder(300 + i);
      b.add(P.ico(1), M(0, 0.12, 0, 0, 0, 0, 0.22, 0.16, 0.32), '#ffffff', 0.04);
      b.add(P.ico(1), M(0, 0.36, 0.2, 0, 0, 0, 0.13), '#ffffff', 0.04);
      b.add(P.box(), M(0, 0.32, 0.32, 0, 0, 0, 0.1, 0.05, 0.12), '#ff9800', 0.04);
      b.add(P.box(), M(0.07, 0.4, 0.29, 0, 0, 0, 0.03, 0.03, 0.03), '#222222', 0.02);
      b.add(P.box(), M(-0.07, 0.4, 0.29, 0, 0, 0, 0.03, 0.03, 0.03), '#222222', 0.02);
      b.add(P.cone(4), M(0, 0.15, -0.3, -1.2, 0, 0, 0.08, 0.15, 0.08), '#ffffff', 0.04);
      const d = b.group();
      d.userData = { ph: i * Math.PI, rad: 1.7 - i * 0.6, sp: 0.25 + i * 0.1 };
      this.scene.add(d);
      this.ducks.push(d);
    }
    // 炊烟
    this.smoke = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(P.ico(1), new THREE.MeshStandardMaterial({ color: '#f2f2f2', flatShading: true, transparent: true, opacity: 0.6, depthWrite: false }));
      m.userData.t = i / 8;
      this.scene.add(m);
      this.smoke.push(m);
    }
    // 点光源
    this.points = [];
    for (const p of [this.lampSpots[0], this.lampSpots[1], this.lampSpots[2], this.porch]) {
      const l = new THREE.PointLight('#ffc26b', 0, 13, 1.6);
      l.position.copy(p);
      this.scene.add(l);
      this.points.push(l);
    }
    this.setupDog();
  }

  makeDogModel(pal) {
    const part = (fn) => {
      const b = new Builder(7);
      fn(b);
      return b.group();
    };
    const root = new THREE.Group();
    const body = part((b) => {
      b.add(P.boxC(), M(0, 0.62, 0, 0, 0, 0, 0.5, 0.44, 0.86), pal.fur, 0.05);
      b.add(P.boxC(), M(0, 0.58, 0.36, 0, 0, 0, 0.42, 0.36, 0.2), pal.belly, 0.04);
      b.add(P.boxC(), M(0, 0.86, 0.36, 0, 0, 0, 0.46, 0.1, 0.16), '#e53935', 0.03);
      b.add(P.boxC(), M(0, 0.78, 0.46, 0, 0, 0, 0.1, 0.1, 0.06), '#ffcf3f', 0.03);
      if (pal.patch) b.add(P.boxC(), M(0.12, 0.85, -0.15, 0, 0, 0, 0.3, 0.04, 0.4), pal.patch, 0.04);
    });
    const head = new THREE.Group();
    head.position.set(0, 0.98, 0.42);
    head.add(part((b) => {
      b.add(P.boxC(), M(0, 0, 0, 0, 0, 0, 0.42, 0.38, 0.4), pal.fur, 0.04);
      b.add(P.boxC(), M(0, -0.07, 0.25, 0, 0, 0, 0.24, 0.18, 0.2), pal.belly, 0.03);
      b.add(P.boxC(), M(0, -0.01, 0.36, 0, 0, 0, 0.1, 0.08, 0.06), '#222222', 0.02);
      for (const s of [-1, 1]) {
        b.add(P.boxC(), M(s * 0.11, 0.06, 0.205, 0, 0, 0, 0.07, 0.08, 0.02), '#222222', 0.02);
        b.add(P.boxC(), M(s * 0.115, 0.075, 0.215, 0, 0, 0, 0.025, 0.03, 0.01), '#ffffff', 0.02);
        b.add(P.boxC(), M(s * 0.24, 0.02, -0.02, 0, 0, s * 0.25, 0.08, 0.3, 0.18), pal.ear, 0.04);
      }
      b.add(P.boxC(), M(0, -0.18, 0.3, 0.2, 0, 0, 0.08, 0.02, 0.1), '#ff7c8a', 0.02);
    }));
    const legs = [];
    for (const [x, z] of [[-0.16, 0.3], [0.16, 0.3], [-0.16, -0.3], [0.16, -0.3]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.5, z);
      pivot.add(part((b) => {
        b.add(P.boxC(), M(0, -0.25, 0, 0, 0, 0, 0.13, 0.5, 0.14), pal.fur, 0.04);
        b.add(P.boxC(), M(0, -0.47, 0.02, 0, 0, 0, 0.14, 0.07, 0.17), pal.belly, 0.03);
      }));
      legs.push(pivot);
    }
    const tail = new THREE.Group();
    tail.position.set(0, 0.78, -0.42);
    tail.add(part((b) => b.add(P.boxC(), M(0, 0.12, -0.08, -0.7, 0, 0, 0.09, 0.32, 0.09), pal.fur, 0.04)));
    root.add(body, head, tail, ...legs);
    root.scale.setScalar(1.15);
    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return { root, head, tail, legs };
  }

  setupDog() {
    this.dogModels = {
      home: this.makeDogModel({ fur: '#e2a85e', belly: '#fff3e0', ear: '#b9773a' }),
      visit: this.makeDogModel({ fur: '#3b3b3f', belly: '#f2f2f2', ear: '#2a2a2e', patch: '#f2f2f2' }),
    };
    for (const k in this.dogModels) {
      this.scene.add(this.dogModels[k].root);
      this.dogModels[k].root.visible = false;
    }
    const start = this.doghouseFront.clone();
    this.dog = { model: this.dogModels.home, pos: start, heading: Math.PI / 4, state: 'idle', timer: 2, target: null, speed: 0, phase: 0, onArrive: null, barkT: 0, enabled: true };
    this.dog.model.root.visible = true;
  }

  setDog(kind) {
    for (const k in this.dogModels) this.dogModels[k].root.visible = false;
    this.dog.enabled = !!kind;
    if (!kind) return;
    this.dog.model = this.dogModels[kind];
    this.dog.model.root.visible = true;
    this.dog.pos.copy(this.doghouseFront);
    this.dog.state = 'idle';
    this.dog.timer = 1;
  }
  dogRun(pos, onArrive) {
    if (!this.dog.enabled) return onArrive && onArrive();
    this.dog.target = pos.clone();
    this.dog.state = 'run';
    this.dog.onArrive = onArrive;
  }
  dogScreenPos(out) {
    return this.project(_v.copy(this.dog.pos).setY(2.0), out);
  }

  updateDog(dt) {
    const d = this.dog;
    if (!d.enabled) return;
    const m = d.model;
    d.barkT = Math.max(0, d.barkT - dt);
    if (d.state === 'idle') {
      d.timer -= dt;
      d.speed = lerp(d.speed, 0, 1 - Math.exp(-dt * 6));
      if (d.timer <= 0) {
        const cur = Math.atan2(d.pos.z, d.pos.x);
        const a = cur + (Math.random() - 0.5) * 1.4;
        const rr = 8.9 + Math.random() * 2.2;
        d.target = new V3(Math.cos(a) * rr, 0, Math.sin(a) * rr);
        if (Math.random() < 0.25) d.target.copy(this.doghouseFront);
        d.state = 'walk';
      }
    }
    if (d.state === 'walk' || d.state === 'run') {
      const run = d.state === 'run';
      const to = _v.copy(d.target).sub(d.pos).setY(0);
      const dist = to.length();
      d.speed = lerp(d.speed, run ? 5.2 : 1.5, 1 - Math.exp(-dt * 4));
      if (dist < 0.25) {
        d.state = 'idle';
        d.timer = run ? 2.5 : 2 + Math.random() * 5;
        if (run) d.barkT = 1.2;
        if (d.onArrive) { const f = d.onArrive; d.onArrive = null; f(); }
      } else {
        to.normalize();
        d.pos.addScaledVector(to, Math.min(dist, d.speed * dt));
        const want = Math.atan2(to.x, to.z);
        let diff = want - d.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        d.heading += diff * (1 - Math.exp(-dt * 10));
      }
    }
    d.phase += dt * (2 + d.speed * 4.5);
    const moving = d.speed > 0.2;
    const sw = moving ? Math.sin(d.phase) * Math.min(0.75, d.speed * 0.35) : 0;
    m.legs[0].rotation.x = sw; m.legs[3].rotation.x = sw;
    m.legs[1].rotation.x = -sw; m.legs[2].rotation.x = -sw;
    m.tail.rotation.y = Math.sin(performance.now() * (d.barkT > 0 ? 0.03 : 0.012)) * 0.6;
    const bark = d.barkT > 0 ? Math.abs(Math.sin(d.barkT * 14)) * 0.25 : 0;
    m.head.rotation.x = -bark + (moving ? Math.sin(d.phase * 2) * 0.05 : Math.sin(performance.now() * 0.0015) * 0.06);
    m.root.position.set(d.pos.x, this.groundH(d.pos.x, d.pos.z) + (moving ? Math.abs(Math.sin(d.phase)) * 0.06 : 0), d.pos.z);
    m.root.rotation.y = d.heading;
  }

  setupRain() {
    const n = 1400, pos = new Float32Array(n * 6), r = rng(9);
    this.drops = [];
    for (let i = 0; i < n; i++) this.drops.push({ x: (r() - 0.5) * 70, y: r() * 30, z: (r() - 0.5) * 70, s: 22 + r() * 10 });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#c7dcff', transparent: true, opacity: 0, depthWrite: false }));
    this.rainLines.frustumCulled = false;
    this.scene.add(this.rainLines);
  }
  setRain(on) {
    this.rainTarget = on ? 1 : 0;
  }

  /* ================= 相机 ================= */
  initCamera() {
    this.resize();
    const goal = { target: new V3(0, 0, 0.4), dist: this.baseDist, az: Math.PI / 4, el: 0.68 };
    this.camGoal = goal;
    this.cam = { target: goal.target.clone(), dist: goal.dist * 1.6, az: goal.az + 0.9, el: 0.42 };
    this.camMode = 'splash';
    this.splashT = 0;
    this.applyCamera();
  }
  startIntro() {
    this.camMode = 'intro';
    this.introT = 0;
    this.introFrom = { target: this.cam.target.clone(), dist: this.cam.dist, az: this.cam.az, el: this.cam.el };
    this.camGoal.az = Math.PI / 4 + Math.round((this.cam.az - Math.PI / 4) / TAU) * TAU;
  }
  pan(dx, dy) {
    const g = this.camGoal;
    const s = (2 * this.cam.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / this.h;
    const rx = Math.cos(g.az), rz = -Math.sin(g.az);
    const fx = -Math.sin(g.az), fz = -Math.cos(g.az);
    const k = 1 / Math.max(0.5, Math.sin(g.el));
    g.target.x += -rx * dx * s + fx * dy * s * k;
    g.target.z += -rz * dx * s + fz * dy * s * k;
    const len = Math.hypot(g.target.x, g.target.z);
    if (len > 12) g.target.multiplyScalar(12 / len);
  }
  zoom(f) {
    const g = this.camGoal;
    g.dist = clamp(g.dist * f, this.baseDist * 0.42, this.baseDist * 1.5);
  }
  rotate(dAz, dEl) {
    const g = this.camGoal;
    g.az += dAz;
    g.el = clamp(g.el + dEl, 0.4, 1.25);
  }
  resetView() {
    const g = this.camGoal;
    g.target.set(0, 0, 0.4);
    g.dist = this.baseDist;
    g.az = Math.PI / 4 + Math.round((g.az - Math.PI / 4) / TAU) * TAU;
    g.el = 0.68;
  }
  updateCamera(dt) {
    const c = this.cam, g = this.camGoal;
    if (this.camMode === 'splash') {
      this.splashT += dt;
      c.az = Math.PI / 4 + 0.9 + this.splashT * 0.05;
      c.el = 0.42;
      c.dist = this.baseDist * 1.6;
      c.target.set(0, 1.5, 0);
    } else if (this.camMode === 'intro') {
      this.introT += dt;
      const t = Math.min(1, this.introT / 3.4);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const f = this.introFrom;
      c.az = lerp(f.az, g.az, e);
      c.el = lerp(f.el, g.el, e);
      c.dist = lerp(f.dist, g.dist, e);
      c.target.lerpVectors(f.target, g.target, e);
      if (t >= 1) this.camMode = 'play';
    } else {
      const k = 1 - Math.exp(-dt * 9);
      c.az = lerp(c.az, g.az, k);
      c.el = lerp(c.el, g.el, k);
      c.dist = lerp(c.dist, g.dist, k);
      c.target.lerp(g.target, k);
    }
    this.applyCamera();
  }
  applyCamera() {
    const c = this.cam;
    this.camera.position.set(
      c.target.x + Math.cos(c.el) * Math.sin(c.az) * c.dist,
      c.target.y + Math.sin(c.el) * c.dist,
      c.target.z + Math.cos(c.el) * Math.cos(c.az) * c.dist
    );
    this.camera.lookAt(c.target);
  }

  project(v, out = {}) {
    _v.copy(v).project(this.camera);
    out.x = (_v.x * 0.5 + 0.5) * this.w;
    out.y = (-_v.y * 0.5 + 0.5) * this.h;
    out.vis = _v.z < 1;
    return out;
  }
  pick(clientX, clientY, objects) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObjects(objects, false)[0] || null;
  }

  /* ================= 昼夜 ================= */
  sampleSky(t) {
    let i = 0;
    while (i < SKY_KEYS.length - 2 && t >= SKY_KEYS[i + 1].t) i++;
    const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
    const f = smooth((t - a.t) / (b.t - a.t));
    const o = this._sky || (this._sky = { top: new THREE.Color(), bottom: new THREE.Color(), sunC: new THREE.Color(), hs: new THREE.Color(), hg: new THREE.Color() });
    o.top.lerpColors(a.top, b.top, f);
    o.bottom.lerpColors(a.bottom, b.bottom, f);
    o.sunC.lerpColors(a.sunC, b.sunC, f);
    o.hs.lerpColors(a.hs, b.hs, f);
    o.hg.lerpColors(a.hg, b.hg, f);
    o.sunI = lerp(a.sunI, b.sunI, f);
    o.hi = lerp(a.hi, b.hi, f);
    o.night = lerp(a.night, b.night, f);
    return o;
  }
  get dayT() {
    if (this.timeOverride != null) return this.timeOverride;
    return (this.dayStart + (performance.now() - this.t0) / DAY_LENGTH) % 1;
  }
  lightDir(a, out) {
    const up = 0.18 + 0.82 * Math.max(Math.sin(a), 0);
    out.set(-Math.cos(a) * 0.85 * 0.7071 + 0.5 * 0.7071, up, Math.cos(a) * 0.85 * 0.7071 + 0.5 * 0.7071);
    return out.normalize();
  }
  updateDayNight(dt) {
    const t = this.dayT;
    const k = this.sampleSky(t);
    this.rain = lerp(this.rain, this.rainTarget, 1 - Math.exp(-dt * 0.8));
    const rn = this.rain;
    const gray = _gray.setRGB(0.32, 0.36, 0.42);
    const top = this.skyU.top.value.copy(k.top).lerp(gray, rn * 0.55);
    const bottom = this.skyU.bottom.value.copy(k.bottom).lerp(_gray2.setRGB(0.5, 0.55, 0.6), rn * 0.5 * (1 - k.night));
    this.scene.fog.color.copy(bottom);
    this.scene.fog.near = this.cam.dist + lerp(55, 10, rn);
    this.scene.fog.far = this.cam.dist + lerp(300, 160, rn);
    this.hemi.color.copy(k.hs);
    this.hemi.groundColor.copy(k.hg);
    this.hemi.intensity = k.hi * (1 - rn * 0.2);
    const a = (t - 0.25) * TAU;
    const day = Math.sin(a);
    const sunDir = this.lightDir(a, this.skyU.sunDir.value);
    const moonDir = this.lightDir(a - Math.PI, this.skyU.moonDir.value);
    const dir = day > 0 ? sunDir : moonDir;
    this.sun.color.copy(k.sunC);
    this.sun.intensity = k.sunI * clamp(Math.abs(day) * 6, 0, 1) * (1 - rn * 0.65);
    const tgt = this.cam.target;
    this.sun.target.position.set(tgt.x, 0, tgt.z);
    this.sun.position.set(tgt.x + dir.x * 70, dir.y * 70, tgt.z + dir.z * 70);
    this.skyU.sunCol.value.copy(k.sunC);
    this.night = k.night;
    this.skyU.night.value = k.night;
    MAT.lamp.color.setScalar(lerp(0.6, 3.2, k.night));
    for (const l of this.points) l.intensity = k.night * 9;
    this.stars.material.opacity = k.night * (1 - rn);
    this.fireflies.material.opacity = k.night * (1 - rn);
    if (this.bloom) this.bloom.strength = lerp(0.28, 0.8, k.night);
    this.foam.material.opacity = 0.32 + Math.sin(performance.now() * 0.0012) * 0.12;
    U.uWind.value = 1 + rn * 1.4;
  }

  /* ================= 每帧 ================= */
  update(dt, tSec) {
    U.uTime.value = tSec;
    this.updateCamera(dt);
    this.updateDayNight(dt);
    this.sky.position.copy(this.camera.position);
    this.bladesSpin.rotation.z += dt * (0.7 + this.rain * 0.8);
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt * (1 + this.rain);
      if (c.position.x > 90) c.position.x = -90;
    }
    const dayF = 1 - this.night;
    for (const bd of this.birds) {
      const u = bd.userData;
      u.a += u.sp * dt;
      bd.position.set(Math.cos(u.a) * u.rad, u.h + Math.sin(u.a * 3) * 0.6, Math.sin(u.a) * u.rad);
      bd.rotation.y = -u.a;
      const f = Math.sin(tSec * 5 + u.ph) * 0.5;
      u.wl.rotation.z = f;
      u.wr.rotation.z = -f;
      bd.visible = dayF > 0.3;
    }
    for (const bf of this.butterflies) {
      const u = bf.userData;
      const tt = tSec * u.sp + u.ph;
      const x = u.cx + Math.sin(tt * 0.7) * 5 + Math.sin(tt * 1.9) * 1.2;
      const z = u.cz + Math.cos(tt * 0.6) * 5 + Math.cos(tt * 2.3) * 1.2;
      const y = 1.0 + Math.sin(tt * 2.1) * 0.4 + 0.3;
      const dx = x - bf.position.x, dz = z - bf.position.z;
      bf.position.set(x, y, z);
      if (Math.abs(dx) + Math.abs(dz) > 1e-4) bf.rotation.y = Math.atan2(dx, dz);
      const f = Math.sin(tSec * 22 + u.ph) * 1.1;
      u.wl.rotation.z = f;
      u.wr.rotation.z = -f;
      bf.visible = dayF > 0.5 && this.rain < 0.5;
    }
    if (this.night > 0.02) {
      const arr = this.fireflies.geometry.attributes.position.array;
      this.fireflySeeds.forEach((f, i) => {
        const tt = tSec * f.sp + f.ph;
        arr[i * 3] = f.x + Math.sin(tt) * 1.5;
        arr[i * 3 + 1] = 0.6 + Math.sin(tt * 1.7) * 0.5 + 0.5;
        arr[i * 3 + 2] = f.z + Math.cos(tt * 0.8) * 1.5;
      });
      this.fireflies.geometry.attributes.position.needsUpdate = true;
    }
    for (const d of this.ducks) {
      const u = d.userData;
      const a = tSec * u.sp + u.ph;
      d.position.set(this.pond.x + Math.cos(a) * u.rad, 0.06 + Math.sin(tSec * 2 + u.ph) * 0.02, this.pond.z + Math.sin(a) * u.rad);
      d.rotation.y = -a;
    }
    for (const s of this.smoke) {
      const u = s.userData;
      u.t = (u.t + dt * 0.18) % 1;
      s.position.set(this.chimneyTop.x + u.t * 1.6 + Math.sin(u.t * 6) * 0.2, this.chimneyTop.y + u.t * 3.5, this.chimneyTop.z + u.t * 0.8);
      s.scale.setScalar(0.2 + u.t * 0.6);
      s.material.opacity = (1 - u.t) * 0.55 * (u.t < 0.1 ? u.t * 10 : 1);
    }
    this.updateDog(dt);
    if (this.rain > 0.01) {
      const arr = this.rainLines.geometry.attributes.position.array;
      const tx = this.cam.target.x, tz = this.cam.target.z;
      this.drops.forEach((d, i) => {
        d.y -= d.s * dt;
        if (d.y < 0) d.y += 30;
        const x = tx + d.x, z = tz + d.z;
        arr.set([x, d.y, z, x + 0.12, d.y + 0.8, z + 0.06], i * 6);
      });
      this.rainLines.geometry.attributes.position.needsUpdate = true;
    }
    this.rainLines.material.opacity = this.rain * 0.55;
    this.rainLines.visible = this.rain > 0.01;
    this.fx.update(dt, this.camera);
    if (this.quality === 'high' && this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}

const _gray = new THREE.Color();
const _gray2 = new THREE.Color();
