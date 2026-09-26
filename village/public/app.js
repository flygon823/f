import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  HALF, WATER_Y, RIVER_W, clamp, lerp, smoothstep, hashStr, mulberry32,
  islandSDF, riverDist, pondDist, groundHeight, standHeight, walkable, onBridge,
  HOUSES, PATHS, BRIDGES, PLAZA, POND, PLACE, FRUITS, TOWN_TREE, BOARD, LAMPS, SPAWN, pathDist,
  INDOOR_X, ROOM, INTERIORS, FURNITURE, interiorAt, doorOf, roomEntry, atRoomExit, seatsNear, standSpot,
  UNDER_X, TUNNEL_W, UNDER_SPOTS, UNDER_NODES, UNDER_EDGES, UNDER_ROOMS, CHEST, tunnelDist, surfaceExit, underEntry,
  GEM_KINDS, GEM_SPOTS, gemPlan, gemDay, PICKAXE_SPOT,
  PLOTS, PLOT_SIZE, PLOT_PRICE, PLOT_REFUND, setPlotOwned, plotOwned, inPlot, SHOP, SELL_PRICES,
  FISH, BUGS, BUG_SPOTS, WHERE_NAMES, RANKS, rankOf, dexCount, DEX_TOTAL, waterAt, inHours,
} from './world.js';
import { RESIDENT, residentPose, residentLines } from './resident.js';
import { makeCreature } from './creatures.js';
import { CURVE, curveY, curvify, toon, basic, blob, GEO, mesh, GRADIENT } from './gfx.js';
import { makeVillager, MOMO_ACCENT } from './villager.js';
import { Sound } from './audio.js';
import { connect } from './net.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('pokapoka.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pokapoka.' + k, JSON.stringify(v)); } catch { /* 保存できない環境でも遊べる */ } },
};
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

const EMOTES = [
  { key: 'wave', icon: '👋', name: 'あいさつ' },
  { key: 'happy', icon: '😊', name: 'よろこび' },
  { key: 'sad', icon: '😢', name: 'かなしみ' },
  { key: 'angry', icon: '💢', name: 'おこる' },
  { key: 'wow', icon: '❗', name: 'びっくり' },
  { key: 'sleepy', icon: '💤', name: 'ねむい' },
  { key: 'love', icon: '❤️', name: 'すき' },
  { key: 'music', icon: '🎵', name: 'ごきげん' },
];
const VOICE = { momo: 1.15, cat: 1.3, dog: 1.0, rabbit: 1.45, bear: 0.78, pig: 0.95 };
const TAG_COLORS = ['#f59ab5', '#6cc4f0', '#f7b84a', '#8bd07a', '#b69af0', '#f58c6c', '#4fcfbf', '#e8a0e0'];

const sound = new Sound();
sound.bgmOn = store.get('bgm', true);
sound.seOn = store.get('se', true);

// =====================================================================
// レンダラーとシーン
// =====================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
$('#game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 600);
scene.fog = new THREE.Fog(0xd3f0fb, 60, 120);

const hemi = new THREE.HemisphereLight(0xffffff, 0x9bc27a, 1.5);
const sun = new THREE.DirectionalLight(0xfff6e0, 1.9);
scene.add(hemi, sun, sun.target);

// 空：上下のグラデーションと、夜の星
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(300, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, bot: { value: new THREE.Color() }, night: { value: 0 }, time: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 bot; uniform float night; uniform float time; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        float h = clamp(vDir.y*1.6 + 0.25, 0.0, 1.0);
        vec3 c = mix(bot, top, smoothstep(0.0, 1.0, h));
        vec3 q = floor(vDir*180.0);
        float s = step(0.9965, hash(q)) * smoothstep(0.1, 0.5, vDir.y);
        s *= 0.6 + 0.4*sin(time*2.0 + hash(q+3.1)*20.0);
        c += vec3(s) * night;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }),
);
sky.renderOrder = -10;
scene.add(sky);

// =====================================================================
// 地面：高さのあるメッシュ＋手描き風テクスチャ
// =====================================================================
function paintGround() {
  const S = 1536;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  const px = img.data;
  const rnd = mulberry32(7);
  const k = (2 * HALF) / S;
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const GRASS = [124, 196, 92], GRASS2 = [108, 182, 80], SAND = [243, 228, 186], WET = [222, 203, 150];
  const SEABED = [214, 214, 170], DEEP = [150, 176, 150], RIVERBED = [150, 175, 152], BANK = [184, 158, 110];
  for (let py = 0; py < S; py++) {
    const z = -HALF + (py + 0.5) * k;
    for (let pxi = 0; pxi < S; pxi++) {
      const x = -HALF + (pxi + 0.5) * k;
      const d = islandSDF(x, z);
      const h = groundHeight(x, z);
      const n = rnd();
      let c;
      const shoreT = -7.4 + Math.sin(x * 0.7) * 0.35 + Math.sin(z * 0.9 + 1) * 0.35;
      const nearWaterInland = (riverDist(x, z) < RIVER_W + 1.3 || pondDist(x, z) < 1.1) && d < -7;
      if (h < WATER_Y) {
        if (d > -7.5) c = mix(SEABED, DEEP, smoothstep(-0.3, -2.2, h));
        else c = mix(RIVERBED, [120, 150, 130], n * 0.5);
        c = mix(c, [255, 255, 255], (n - 0.5) * 0.06);
      } else if (nearWaterInland && h < -0.04) {
        c = mix(BANK, [150, 125, 85], smoothstep(-0.04, -0.3, h));
        c = mix(c, [255, 255, 255], (n - 0.5) * 0.08);
      } else if (d > shoreT) {
        c = h < -0.2 ? mix(SAND, WET, smoothstep(-0.2, -0.29, h)) : SAND;
        c = mix(c, [255, 255, 255], (n - 0.5) * 0.09);
      } else {
        // 三角もようの芝生
        const u = x * 1.25, v = z * 1.25 * 1.1547;
        const tri = (Math.floor(u + v * 0.5) + Math.floor(v)) & 1;
        const big = Math.sin(x * 0.13 + Math.sin(z * 0.11) * 2) * 0.5 + 0.5;
        c = mix(GRASS, GRASS2, big * 0.6 + tri * 0.18);
        c = mix(c, [60, 120, 50], n < 0.035 ? 0.35 : 0);
        c = mix(c, [255, 255, 230], n > 0.985 ? 0.25 : 0);
        // 砂浜との境目は少し黄色っぽく
        c = mix(c, [190, 205, 120], smoothstep(shoreT - 1.2, shoreT, d) * 0.6);
      }
      const o = (py * S + pxi) * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  const toPx = (x, z) => [(x + HALF) / k, (z + HALF) / k];
  g.lineCap = g.lineJoin = 'round';
  // 土の道
  const strokePaths = (w, color) => {
    g.strokeStyle = color;
    g.lineWidth = w / k;
    for (const p of PATHS) {
      g.beginPath();
      p.forEach(([x, z], i) => { const [a, b] = toPx(x, z); i ? g.lineTo(a, b) : g.moveTo(a, b); });
      g.stroke();
    }
  };
  strokePaths(2.5, '#c9ae78');
  strokePaths(2.0, '#dcc592');
  g.fillStyle = 'rgba(160,130,80,0.35)';
  for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) {
    for (let s = 0; s < 40; s++) {
      const t = rnd();
      const x = lerp(p[i][0], p[i + 1][0], t) + (rnd() - 0.5) * 1.8, z = lerp(p[i][1], p[i + 1][1], t) + (rnd() - 0.5) * 1.8;
      const [a, b] = toPx(x, z);
      g.beginPath(); g.arc(a, b, 1.5 + rnd() * 2, 0, 7); g.fill();
    }
  }
  // 広場の石だたみ
  const [pcx, pcz] = toPx(PLAZA.x, PLAZA.z);
  const R = PLAZA.r / k;
  g.fillStyle = '#e9dfc5';
  g.beginPath(); g.arc(pcx, pcz, R, 0, 7); g.fill();
  g.strokeStyle = '#d3c6a5';
  g.lineWidth = 3;
  for (let r = 2.1; r < PLAZA.r; r += 1.35) {
    g.beginPath(); g.arc(pcx, pcz, r / k, 0, 7); g.stroke();
    const n = Math.round(r * 3.2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r;
      g.beginPath();
      g.moveTo(pcx + Math.cos(a) * r / k, pcz + Math.sin(a) * r / k);
      g.lineTo(pcx + Math.cos(a) * (r + 1.35) / k, pcz + Math.sin(a) * (r + 1.35) / k);
      g.stroke();
    }
  }
  g.lineWidth = 6;
  g.strokeStyle = '#cbbd98';
  g.beginPath(); g.arc(pcx, pcz, R, 0, 7); g.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function buildGround() {
  const SEG = 256;
  const geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, curvify(new THREE.MeshLambertMaterial({ map: paintGround() })));
  scene.add(ground);

  // テクスチャの外側の海底
  const outer = new THREE.Mesh(
    new THREE.RingGeometry(HALF * 0.98, 320, 64, 4).rotateX(-Math.PI / 2),
    curvify(new THREE.MeshLambertMaterial({ color: '#96b096' })),
  );
  outer.position.y = -2.98;
  scene.add(outer);
}

// =====================================================================
// 水：深さで色が変わり、岸に白い波が寄せる
// =====================================================================
const waterUniforms = {
  uTime: { value: 0 },
  uHeight: { value: null },
  uShallow: { value: new THREE.Color('#7fe6d6') },
  uDeep: { value: new THREE.Color('#3b9fe0') },
  uLight: { value: 1 },
  uFogColor: { value: new THREE.Color() },
  uFogNear: { value: 60 },
  uFogFar: { value: 120 },
};
function buildWater() {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    const z = -HALF + ((j + 0.5) / N) * 2 * HALF;
    for (let i = 0; i < N; i++) {
      const x = -HALF + ((i + 0.5) / N) * 2 * HALF;
      const v = Math.round(clamp((groundHeight(x, z) + 3) / 4, 0, 1) * 255);
      data.set([v, v, v, 255], (j * N + i) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  waterUniforms.uHeight.value = tex;

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { ...waterUniforms, uCurve: CURVE.uCurve, uCenterZ: CURVE.uCenterZ },
    vertexShader: `
      uniform float uCurve; uniform float uCenterZ;
      varying vec2 vXZ; varying float vFog;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vXZ = w.xz;
        float dz = w.z - uCenterZ;
        w.y -= dz*dz*uCurve;
        vec4 mv = viewMatrix * w;
        vFog = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; uniform sampler2D uHeight; uniform vec3 uShallow; uniform vec3 uDeep; uniform float uLight;
      uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
      varying vec2 vXZ; varying float vFog;
      void main(){
        vec2 uv = vXZ / ${(2 * HALF).toFixed(1)} + 0.5;
        float h = -3.0;
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) h = texture2D(uHeight, uv).r * 4.0 - 3.0;
        float depth = ${WATER_Y.toFixed(2)} - h;
        vec3 col = mix(uShallow, uDeep, smoothstep(0.05, 1.6, depth));
        float alpha = mix(0.5, 0.94, smoothstep(0.0, 1.2, depth));
        // きらきら
        float sp = sin(vXZ.x*1.3 + uTime*1.1 + sin(vXZ.y*0.7 + uTime*0.8)*1.5) * sin(vXZ.y*1.7 - uTime*0.9 + sin(vXZ.x*0.5)*1.2);
        col += vec3(0.9, 1.0, 1.0) * pow(max(sp, 0.0), 14.0) * 0.35;
        // 岸の泡
        float wob = sin(uTime*1.6 + vXZ.x*0.8 + vXZ.y*0.6)*0.035 + sin(uTime*2.3 - vXZ.x*1.7)*0.02;
        float foam = 1.0 - smoothstep(0.02, 0.11 + wob, depth);
        float wave = fract(uTime*0.22 + sin(vXZ.x*0.13)*0.2);
        float band = smoothstep(0.04, 0.0, abs(depth - (0.34 - wave*0.3))) * (1.0 - wave) * step(depth, 0.5);
        foam = max(foam, band * 0.8);
        col = mix(col, vec3(1.0), foam * 0.9);
        alpha = max(alpha, foam * 0.95);
        col *= uLight;
        float f = smoothstep(uFogNear, uFogFar, vFog);
        col = mix(col, uFogColor, f);
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(520, 520, 130, 130).rotateX(-Math.PI / 2), mat);
  water.position.y = WATER_Y;
  water.renderOrder = 2;
  scene.add(water);
}

// =====================================================================
// 木・家・橋・広場
// =====================================================================
const treeObjs = [];
const dayNightMats = { windows: [], lamps: [], inWindows: [] };

function lumpyCanopy(group, parts, colors) {
  for (const [x, y, z, r, ci] of parts) {
    const m = mesh(GEO.blobby, toon(colors[ci]), x, y, z, r, r * 0.88, r);
    group.add(m);
  }
}

function makeRoundTree(t, i) {
  const root = new THREE.Group();
  const s = t.s;
  root.scale.setScalar(s);
  root.add(blob(3.4));
  const trunkMat = toon('#9a6536');
  root.add(mesh(new THREE.CylinderGeometry(0.2, 0.34, 1.9, 10), trunkMat, 0, 0.95, 0));
  const canopy = new THREE.Group();
  canopy.position.y = 2.55;
  root.add(canopy);
  const greens = t.fruit === 'cherry' ? ['#5bb84f', '#4aa845', '#72c860'] : ['#57b64b', '#45a342', '#6fc65e'];
  lumpyCanopy(canopy, [
    [0, 0, 0, 1.35, 0], [0.75, 0.25, 0.25, 0.95, 1], [-0.7, 0.3, -0.15, 1.0, 1], [0.05, 0.9, -0.1, 0.95, 2],
    [-0.25, -0.2, 0.75, 0.85, 2], [0.45, -0.3, -0.7, 0.85, 1],
  ], greens);
  const fruitMeshes = [];
  if (t.fruit) {
    const F = FRUITS[t.fruit];
    const fm = toon(F.color);
    const spots = [[-0.65, -0.35, 1.05], [0.6, 0.05, 1.05], [0.05, 0.6, 1.1]];
    for (const [x, y, z] of spots) {
      const f = new THREE.Group();
      f.position.set(x, y, z);
      if (t.fruit === 'cherry') {
        f.add(mesh(GEO.sphereLo, fm, -0.09, 0, 0, 0.13));
        f.add(mesh(GEO.sphereLo, fm, 0.1, -0.03, 0.02, 0.13));
      } else {
        f.add(mesh(GEO.sphereLo, fm, 0, 0, 0, 0.21, 0.2, 0.21));
        f.add(mesh(GEO.sphereLo, toon('#4c9a3a'), 0.06, 0.2, 0, 0.08, 0.03, 0.05));
      }
      canopy.add(f);
      fruitMeshes.push(f);
    }
  }
  return { root, canopy, fruitMeshes };
}
function makeCedar(t) {
  const root = new THREE.Group();
  root.scale.setScalar(t.s);
  root.add(blob(3));
  root.add(mesh(new THREE.CylinderGeometry(0.18, 0.28, 1.2, 8), toon('#8a5a32'), 0, 0.6, 0));
  const canopy = new THREE.Group();
  canopy.position.y = 1;
  root.add(canopy);
  [[0.4, 1.6, 1.35, '#3f9a55'], [1.3, 1.4, 1.1, '#48a65c'], [2.1, 1.2, 0.8, '#52b163']].forEach(([y, h, r, c]) => {
    canopy.add(mesh(new THREE.ConeGeometry(1, 1, 10), toon(c), 0, y + h / 2, 0, r, h, r));
  });
  return { root, canopy, fruitMeshes: [] };
}
function makePalm(t) {
  const root = new THREE.Group();
  root.scale.setScalar(t.s);
  root.add(blob(2.6));
  const canopy = new THREE.Group();
  // 少しかたむいて弓なりにのびる幹
  const dir = new THREE.Vector3(Math.cos(t.lean), 0, Math.sin(t.lean));
  const pts = [];
  for (let k = 0; k <= 7; k++) {
    const h = k * 0.5;
    pts.push(new THREE.Vector3().addScaledVector(dir, 0.045 * h * h * 1.2).setY(h));
  }
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < 7; k++) {
    const a = pts[k], b = pts[k + 1];
    const seg = mesh(new THREE.CylinderGeometry(0.17 - k * 0.008, 0.22 - k * 0.008, 1, 8), toon(k % 2 ? '#b08a5a' : '#9c774a'));
    seg.position.copy(a).lerp(b, 0.5);
    seg.scale.y = a.distanceTo(b) * 1.08;
    seg.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    root.add(seg);
  }
  const p = pts[7];
  canopy.position.copy(p);
  root.add(canopy);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const leaf = new THREE.Group();
    leaf.rotation.y = a;
    const blade = mesh(GEO.sphereLo, toon(k % 2 ? '#4fae4a' : '#5dbd52'), 0, -0.2, 0.95, 0.28, 0.05, 1.05);
    blade.rotation.x = 0.4;
    leaf.add(blade);
    canopy.add(leaf);
  }
  for (let k = 0; k < 3; k++) canopy.add(mesh(GEO.sphereLo, toon('#7a5230'), Math.cos(k * 2.1) * 0.22, -0.2, Math.sin(k * 2.1) * 0.22, 0.16));
  return { root, canopy, fruitMeshes: [] };
}

function buildTrees() {
  PLACE.trees.forEach((t, i) => {
    const o = t.kind === 'cedar' ? makeCedar(t) : t.kind === 'palm' ? makePalm(t) : makeRoundTree(t, i);
    o.root.position.set(t.x, groundHeight(t.x, t.z), t.z);
    o.root.rotation.y = (i * 1.37) % (Math.PI * 2) * (t.kind === 'round' ? 0 : 1);
    scene.add(o.root);
    treeObjs.push({ ...o, t, i, fruit: t.fruit ? 3 : 0, shakeT: 0 });
  });
  // 広場の大きな木と、まわりの花だん
  const big = makeRoundTree({ s: 1.75 }, -1);
  big.root.position.set(TOWN_TREE.x, 0, TOWN_TREE.z);
  scene.add(big.root);
  const ring = mesh(new THREE.CylinderGeometry(1.85, 1.95, 0.35, 28, 1, true), toon('#c9b894', { side: THREE.DoubleSide }), TOWN_TREE.x, 0.17, TOWN_TREE.z);
  scene.add(ring);
  scene.add(mesh(new THREE.TorusGeometry(1.9, 0.12, 8, 32).rotateX(Math.PI / 2), toon('#d9cba6'), TOWN_TREE.x, 0.34, TOWN_TREE.z));
}

function setTreeFruit(i, n) {
  const o = treeObjs[i];
  if (!o) return;
  o.fruit = n;
  o.fruitMeshes.forEach((f, k) => { f.visible = k < n; });
}

function makeRoof(w, h, d, color) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2 });
  geo.translate(0, 0, -d / 2);
  return new THREE.Mesh(geo, toon(color));
}

function buildHouses() {
  for (const h of HOUSES) scene.add(makeHouse(h));
}
function makeHouse(h) {
  {
    const g = new THREE.Group();
    g.position.set(h.x, 0, h.z);
    g.add(mesh(GEO.box, toon('#cfc3a6'), 0, 0.12, 0, h.w + 0.5, 0.24, h.d + 0.5));
    g.add(mesh(GEO.box, toon(h.wall), 0, 1.35, 0, h.w, 2.3, h.d));
    // 木の柱
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(mesh(GEO.box, toon('#b88a5a'), sx * (h.w / 2 - 0.05), 1.35, sz * (h.d / 2 - 0.05), 0.22, 2.3, 0.22));
    }
    const roof = makeRoof(h.w + 1.0, 1.9, h.d + 0.9, h.roof);
    roof.position.y = 2.5;
    g.add(roof);
    g.add(mesh(GEO.box, toon(new THREE.Color(h.roof).multiplyScalar(0.75).getStyle()), 0, 2.52, 0, h.w + 1.25, 0.14, h.d + 1.15));
    g.add(mesh(GEO.box, toon('#b9a88a'), h.w * 0.25, 3.7, -0.4, 0.5, 1.0, 0.5));
    // ドア
    const front = h.d / 2 + 0.02;
    g.add(mesh(GEO.box, toon('#9b6a3c'), 0, 1.05, front, 1.05, 1.7, 0.1));
    g.add(mesh(GEO.box, toon('#835630'), 0, 1.05, front + 0.03, 0.8, 1.45, 0.06));
    g.add(mesh(GEO.sphereLo, toon('#f2c94c'), 0.3, 1.0, front + 0.1, 0.07));
    g.add(mesh(GEO.box, toon('#d8ccb0'), 0, 0.26, front + 0.45, 1.5, 0.12, 0.8));
    // 窓
    for (const sx of [-1, 1]) {
      g.add(mesh(GEO.box, toon('#ffffff'), sx * 1.6, 1.5, front, 1.05, 1.05, 0.08));
      const winMat = curvify(new THREE.MeshBasicMaterial({ color: '#bfe6f5' }));
      const win = mesh(GEO.box, winMat, sx * 1.6, 1.5, front + 0.03, 0.82, 0.82, 0.06);
      dayNightMats.windows.push(winMat);
      g.add(win);
      g.add(mesh(GEO.box, toon('#ffffff'), sx * 1.6, 1.5, front + 0.07, 0.07, 0.82, 0.04));
      g.add(mesh(GEO.box, toon('#ffffff'), sx * 1.6, 1.5, front + 0.07, 0.82, 0.07, 0.04));
      g.add(mesh(GEO.box, toon(h.roof), sx * 1.6, 0.95, front + 0.15, 1.1, 0.16, 0.3));
    }
    // ポスト
    const mail = new THREE.Group();
    mail.position.set(h.w / 2 + 0.9, 0, front + 0.6);
    mail.add(mesh(GEO.box, toon('#8a6040'), 0, 0.45, 0, 0.1, 0.9, 0.1));
    mail.add(mesh(GEO.box, toon(h.roof), 0, 1.0, 0, 0.36, 0.3, 0.5));
    g.add(mail);
    return g;
  }
}

function buildBridges() {
  const wood = toon('#c79a64'), wood2 = toon('#b0844f'), rail = toon('#a8743f');
  for (const b of BRIDGES) {
    const g = new THREE.Group();
    g.position.set(b.x, 0, b.z);
    g.rotation.y = b.rot;
    const n = 13;
    for (let k = 0; k < n; k++) {
      const u = -b.len / 2 + (k + 0.5) * (b.len / n);
      g.add(mesh(GEO.box, k % 2 ? wood : wood2, u, 0.1, 0, b.len / n - 0.05, 0.2, b.wid));
    }
    for (const sv of [-1, 1]) {
      const v = sv * (b.wid / 2 - 0.08);
      g.add(mesh(GEO.box, rail, 0, 0.95, v, b.len + 0.2, 0.14, 0.14));
      g.add(mesh(GEO.box, rail, 0, 0.55, v, b.len, 0.08, 0.08));
      for (let k = 0; k <= 4; k++) {
        const u = -b.len / 2 + (k / 4) * b.len;
        g.add(mesh(GEO.box, rail, u, 0.5, v, 0.18, 1.0, 0.18));
      }
    }
    scene.add(g);
  }
}

function buildPlazaProps() {
  // けいじばん
  const g = new THREE.Group();
  g.position.set(BOARD.x, 0, BOARD.z);
  const post = toon('#8a5a32');
  for (const sx of [-1, 1]) g.add(mesh(GEO.box, post, sx * 0.9, 0.8, 0, 0.14, 1.6, 0.14));
  g.add(mesh(GEO.box, toon('#b88550'), 0, 1.35, 0, 2.2, 1.1, 0.12));
  g.add(mesh(GEO.box, toon('#e8d9b4'), 0, 1.35, 0.07, 2.0, 0.92, 0.03));
  const notes = ['#ffffff', '#fbe7a0', '#c7ecf7', '#ffd1dc'];
  notes.forEach((c, k) => {
    const n = mesh(GEO.box, basic(c), -0.65 + k * 0.44, 1.35 + (k % 2 ? 0.12 : -0.1), 0.1, 0.34, 0.42, 0.01);
    n.rotation.z = (k - 1.5) * 0.08;
    g.add(n);
  });
  g.add(mesh(GEO.box, toon('#7a4e2a'), 0, 2.0, 0, 2.5, 0.12, 0.45));
  g.add(blob(2.6));
  scene.add(g);

  // 街灯
  const lampMat = curvify(new THREE.MeshBasicMaterial({ color: '#f6eed2' }));
  dayNightMats.lamps.push(lampMat);
  for (const l of LAMPS) {
    const lg = new THREE.Group();
    lg.position.set(l.x, 0, l.z);
    lg.add(mesh(GEO.cyl, toon('#3d5f55'), 0, 1.2, 0, 0.08, 2.4, 0.08));
    lg.add(mesh(GEO.cyl, toon('#3d5f55'), 0, 0.1, 0, 0.2, 0.2, 0.2));
    lg.add(mesh(GEO.sphereLo, lampMat, 0, 2.55, 0, 0.26, 0.3, 0.26));
    lg.add(mesh(GEO.cone, toon('#3d5f55'), 0, 2.9, 0, 0.3, 0.25, 0.3));
    lg.add(blob(1));
    scene.add(lg);
  }
}

function buildRocks() {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  for (const r of PLACE.rocks) {
    const m = mesh(geo, toon('#b3aea4'), r.x, groundHeight(r.x, r.z) + 0.35 * r.s, r.z, r.s * 0.95, r.s * 0.7, r.s * 0.85);
    m.rotation.y = r.r;
    scene.add(m);
    const b = blob(2.2 * r.s);
    b.position.set(r.x, groundHeight(r.x, r.z) + 0.02, r.z);
    scene.add(b);
  }
}

function buildFlowers() {
  const F = PLACE.flowers;
  const dummy = new THREE.Object3D();
  const stemGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.025, 0.03, 0.4, 5).translate(0, 0.2, 0),
    new THREE.SphereGeometry(1, 6, 4).scale(0.12, 0.03, 0.06).rotateZ(0.5).translate(0.08, 0.12, 0),
    new THREE.SphereGeometry(1, 6, 4).scale(0.12, 0.03, 0.06).rotateZ(-0.5).translate(-0.08, 0.1, 0),
  ]);
  const tulipGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.13, 0.07, 0.22, 7).translate(0, 0.5, 0),
    new THREE.SphereGeometry(0.1, 7, 5).translate(0, 0.4, 0),
  ]);
  const petals = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    petals.push(new THREE.SphereGeometry(1, 7, 5).scale(0.1, 0.035, 0.065).translate(0.1, 0, 0).rotateY(a).translate(0, 0.44, 0));
  }
  const daisyGeo = mergeGeometries(petals);
  const centerGeo = new THREE.SphereGeometry(0.055, 7, 5).translate(0, 0.46, 0);

  const stems = new THREE.InstancedMesh(stemGeo, toon('#4e9f3d'), F.length);
  const tulips = F.filter((f) => f.kind === 'tulip');
  const daisies = F.filter((f) => f.kind === 'daisy');
  const tulipMesh = new THREE.InstancedMesh(tulipGeo, toon('#ffffff'), tulips.length);
  const daisyMesh = new THREE.InstancedMesh(daisyGeo, toon('#ffffff'), daisies.length);
  const centerMesh = new THREE.InstancedMesh(centerGeo, toon('#f7c531'), daisies.length);
  const col = new THREE.Color();
  F.forEach((f, i) => {
    dummy.position.set(f.x, groundHeight(f.x, f.z), f.z);
    dummy.rotation.set(0, i * 2.3, 0);
    dummy.scale.setScalar(1.25);
    dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix);
  });
  tulips.forEach((f, i) => {
    dummy.position.set(f.x, groundHeight(f.x, f.z), f.z);
    dummy.rotation.set(0, i, 0); dummy.scale.setScalar(1.25); dummy.updateMatrix();
    tulipMesh.setMatrixAt(i, dummy.matrix);
    tulipMesh.setColorAt(i, col.set(f.color));
  });
  daisies.forEach((f, i) => {
    dummy.position.set(f.x, groundHeight(f.x, f.z), f.z);
    dummy.rotation.set(0, i, 0); dummy.scale.setScalar(1.25); dummy.updateMatrix();
    daisyMesh.setMatrixAt(i, dummy.matrix);
    daisyMesh.setColorAt(i, col.set(f.color));
    centerMesh.setMatrixAt(i, dummy.matrix);
  });
  for (const m of [stems, tulipMesh, daisyMesh, centerMesh]) { m.frustumCulled = false; scene.add(m); }

  // 草むら
  const T = PLACE.tufts;
  const blades = [];
  for (let k = 0; k < 4; k++) {
    blades.push(new THREE.ConeGeometry(0.07, 0.45, 4).translate(0, 0.22, 0).rotateZ((k - 1.5) * 0.35).translate((k - 1.5) * 0.07, 0, (k % 2) * 0.06));
  }
  const tuftMesh = new THREE.InstancedMesh(mergeGeometries(blades), toon('#5aaa48'), T.length);
  T.forEach((t, i) => {
    dummy.position.set(t.x, groundHeight(t.x, t.z), t.z);
    dummy.rotation.set(0, t.r, 0); dummy.scale.setScalar(t.s); dummy.updateMatrix();
    tuftMesh.setMatrixAt(i, dummy.matrix);
  });
  tuftMesh.frustumCulled = false;
  scene.add(tuftMesh);

  // 池のハス
  const padRnd = mulberry32(3);
  for (let k = 0; k < 6; k++) {
    const a = padRnd() * 7, r = padRnd() * 0.7;
    const x = POND.x + Math.cos(a) * POND.rx * r, z = POND.z + Math.sin(a) * POND.rz * r;
    scene.add(mesh(GEO.cyl, toon('#58a94c'), x, WATER_Y + 0.02, z, 0.45 + padRnd() * 0.2, 0.03, 0.45));
    if (k % 3 === 0) scene.add(mesh(GEO.sphereLo, toon('#ffb3cc'), x + 0.1, WATER_Y + 0.12, z, 0.14, 0.1, 0.14));
  }
}

// ちょうちょ（昼だけ）
const butterflies = [];
function buildButterflies() {
  const rnd = mulberry32(11);
  const wingGeo = new THREE.CircleGeometry(0.16, 8).translate(0.15, 0, 0);
  const colors = ['#ffffff', '#ffe066', '#ff9ec7', '#8ecbff'];
  for (let k = 0; k < 7; k++) {
    const f = PLACE.flowers[Math.floor(rnd() * PLACE.flowers.length)];
    const g = new THREE.Group();
    const mat = curvify(new THREE.MeshBasicMaterial({ color: colors[k % colors.length], side: THREE.DoubleSide }));
    const l = new THREE.Mesh(wingGeo, mat), r = new THREE.Mesh(wingGeo, mat);
    r.scale.x = -1;
    const wl = new THREE.Group(), wr = new THREE.Group();
    wl.add(l); wr.add(r);
    g.add(wl, wr);
    scene.add(g);
    butterflies.push({ g, wl, wr, cx: f.x, cz: f.z, ph: rnd() * 10, sp: 0.5 + rnd() * 0.4 });
  }
}

// =====================================================================
// 家の中
// =====================================================================
function plankTexture(c1, c2) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const rnd = mulberry32(5);
  for (let row = 0; row < 8; row++) {
    let x = -rnd() * 120;
    while (x < 256) {
      const w = 90 + rnd() * 80;
      g.fillStyle = rnd() < 0.5 ? c1 : c2;
      g.fillRect(x, row * 32, w, 32);
      g.fillStyle = 'rgba(80,50,25,0.35)';
      g.fillRect(x, row * 32, 2, 32);
      x += w;
    }
    g.fillStyle = 'rgba(80,50,25,0.3)';
    g.fillRect(0, row * 32 + 30, 256, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.2, 2);
  return tex;
}

function buildFurniture(kind, th) {
  const g = new THREE.Group();
  const wood = toon('#b98555'), woodDark = toon('#8f623b'), white = toon('#fbf8f0');
  if (kind === 'bed') {
    g.add(mesh(GEO.box, wood, 0, 0.25, 0, 2.0, 0.5, 2.6));
    g.add(mesh(GEO.box, white, 0, 0.58, 0.05, 1.85, 0.2, 2.4));
    g.add(mesh(GEO.box, toon(th.bed), 0, 0.72, 0.35, 1.9, 0.16, 1.75));
    g.add(mesh(GEO.sphereLo, white, 0, 0.78, -0.85, 0.6, 0.14, 0.32));
    g.add(mesh(GEO.box, woodDark, 0, 0.75, -1.3, 2.05, 1.5, 0.14));
  } else if (kind === 'shelf') {
    // 前があいた棚：背板・側板・天板と、段ごとの本
    g.add(mesh(GEO.box, woodDark, 0, 0.9, -0.25, 2.4, 1.8, 0.1));
    for (const sx of [-1, 1]) g.add(mesh(GEO.box, wood, sx * 1.15, 0.9, 0, 0.1, 1.8, 0.6));
    g.add(mesh(GEO.box, wood, 0, 1.78, 0, 2.4, 0.08, 0.6));
    const books = ['#e2574c', '#4f8fd8', '#f2b233', '#5bb363', '#9a6dd0', '#f08a3c', '#fbf8f0'];
    for (const y of [0.35, 0.95, 1.5]) {
      g.add(mesh(GEO.box, wood, 0, y - 0.22, 0, 2.2, 0.06, 0.58));
      let x = -0.95;
      for (let k = 0; k < 7 && x < 0.9; k++) {
        const w = 0.14 + ((k * 7 + y * 10) % 3) * 0.04, h = 0.34 + ((k + y * 3) % 2) * 0.08;
        g.add(mesh(GEO.box, toon(books[(k + Math.round(y * 3)) % books.length]), x + w / 2, y - 0.19 + h / 2, 0.05, w, h, 0.4));
        x += w + 0.03;
      }
    }
  } else if (kind === 'table') {
    g.add(mesh(GEO.cyl, wood, 0, 0.72, 0, 0.8, 0.08, 0.8));
    g.add(mesh(GEO.cyl, woodDark, 0, 0.36, 0, 0.1, 0.72, 0.1));
    g.add(mesh(GEO.cyl, woodDark, 0, 0.03, 0, 0.4, 0.06, 0.4));
    g.add(mesh(GEO.cyl, toon('#ffffff'), 0.25, 0.84, 0.1, 0.09, 0.16, 0.09));
    g.add(mesh(GEO.cyl, toon(th.accent), -0.2, 0.9, -0.15, 0.1, 0.28, 0.1));
    g.add(mesh(GEO.sphereLo, toon('#ffd23f'), -0.2, 1.1, -0.15, 0.1));
  } else if (kind === 'plant') {
    g.add(mesh(GEO.cyl, toon('#d98f6f'), 0, 0.3, 0, 0.3, 0.6, 0.3));
    for (const [x, y, z, r] of [[0, 1.0, 0, 0.42], [0.2, 1.3, 0.1, 0.3], [-0.2, 1.25, -0.05, 0.32]]) {
      g.add(mesh(GEO.blobby, toon('#5bb35a'), x, y, z, r));
    }
  } else if (kind === 'lamp') {
    g.add(mesh(GEO.cyl, woodDark, 0, 0.04, 0, 0.25, 0.08, 0.25));
    g.add(mesh(GEO.cyl, woodDark, 0, 0.8, 0, 0.04, 1.6, 0.04));
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.35, 0.45, 16), basic('#fff1c4'), 0, 1.75, 0));
  } else if (kind === 'chair') {
    g.add(mesh(GEO.box, wood, 0, 0.45, 0, 0.62, 0.08, 0.55));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(GEO.box, woodDark, sx * 0.25, 0.22, sz * 0.22, 0.07, 0.45, 0.07));
    g.add(mesh(GEO.box, wood, 0, 0.85, 0.24, 0.62, 0.7, 0.07));
  } else if (kind === 'sofa') {
    const c = toon(th.accent);
    g.add(mesh(GEO.box, c, 0, 0.3, 0, 1.1, 0.5, 2.2));
    g.add(mesh(GEO.box, c, -0.45, 0.75, 0, 0.25, 0.7, 2.2));
    for (const sz of [-1, 1]) g.add(mesh(GEO.box, c, 0, 0.62, sz * 1.02, 1.1, 0.35, 0.2));
    for (const sz of [-0.5, 0.5]) g.add(mesh(GEO.sphereLo, toon('#fbf8f0'), 0.1, 0.65, sz, 0.35, 0.16, 0.42));
  }
  return g;
}

function buildInteriors() {
  const H = 3.3, W = ROOM.w, D = ROOM.d;
  for (const r of INTERIORS) {
    const th = r.theme;
    const g = new THREE.Group();
    g.position.set(r.x, 0, r.z);
    // 床と、そのまわりの台（ジオラマのような箱）
    const floorMat = curvify(new THREE.MeshToonMaterial({ map: plankTexture(th.floor[0], th.floor[1]), gradientMap: GRADIENT }));
    g.add(mesh(GEO.box, floorMat, 0, -0.1, 0, W + 0.4, 0.2, D + 0.4));
    g.add(mesh(GEO.box, toon('#4a3526'), 0, -0.7, 0, W + 0.9, 1.0, D + 0.9));
    const wall = toon(th.wall), trim = toon(th.trim);
    g.add(mesh(GEO.box, wall, 0, H / 2, -D / 2 - 0.15, W + 0.6, H, 0.3));
    for (const sx of [-1, 1]) g.add(mesh(GEO.box, wall, sx * (W / 2 + 0.15), H / 2, 0, 0.3, H, D + 0.6));
    // 腰板と上のふち
    g.add(mesh(GEO.box, trim, 0, 0.45, -D / 2 + 0.02, W, 0.9, 0.06));
    for (const sx of [-1, 1]) g.add(mesh(GEO.box, trim, sx * (W / 2 - 0.02), 0.45, 0, 0.06, 0.9, D));
    g.add(mesh(GEO.box, trim, 0, H + 0.05, -D / 2 - 0.15, W + 0.7, 0.14, 0.4));
    for (const sx of [-1, 1]) g.add(mesh(GEO.box, trim, sx * (W / 2 + 0.15), H + 0.05, 0, 0.4, 0.14, D + 0.7));
    // 窓（外の時間で色が変わる）
    g.add(mesh(GEO.box, toon('#ffffff'), 2.4, 1.9, -D / 2 + 0.03, 1.6, 1.3, 0.08));
    const pane = curvify(new THREE.MeshBasicMaterial({ color: '#bfe6f5' }));
    dayNightMats.inWindows.push(pane);
    g.add(mesh(GEO.box, pane, 2.4, 1.9, -D / 2 + 0.08, 1.35, 1.05, 0.04));
    g.add(mesh(GEO.box, toon('#ffffff'), 2.4, 1.9, -D / 2 + 0.11, 0.07, 1.05, 0.03));
    g.add(mesh(GEO.box, toon('#ffffff'), 2.4, 1.9, -D / 2 + 0.11, 1.35, 0.07, 0.03));
    g.add(mesh(GEO.box, toon(th.accent), 2.4, 2.62, -D / 2 + 0.12, 1.8, 0.2, 0.12));
    // 壁の絵
    g.add(mesh(GEO.box, toon('#8f623b'), -1.9, 2.1, -D / 2 + 0.04, 1.0, 0.8, 0.06));
    g.add(mesh(GEO.box, basic('#9ed8f0'), -1.9, 2.15, -D / 2 + 0.08, 0.84, 0.64, 0.02));
    g.add(mesh(GEO.box, basic('#7cc35a'), -1.9, 1.94, -D / 2 + 0.1, 0.84, 0.22, 0.02));
    // じゅうたん・出口のマット
    g.add(mesh(GEO.cyl, toon(th.rug), 0.6, 0.02, 0.6, 2.2, 0.04, 1.6));
    g.add(mesh(GEO.cyl, toon('#ffffff', { transparent: true, opacity: 0.35 }), 0.6, 0.045, 0.6, 1.7, 0.02, 1.2));
    g.add(mesh(GEO.box, toon('#b0763f'), 0, 0.02, D / 2 - 0.35, 1.7, 0.04, 0.6));
    const hatchSpot = UNDER_SPOTS.find((sp) => sp.kind === 'hatch' && sp.room === r.i);
    if (hatchSpot) {
      // 床の扉（地下通路への入り口）
      const hx = hatchSpot.hatch.x, hz = hatchSpot.hatch.z;
      g.add(mesh(GEO.box, toon('#6d4a2b'), hx, 0.02, hz, 1.25, 0.04, 1.25));
      for (let k = -1; k <= 1; k++) g.add(mesh(GEO.box, toon('#9c6b3e'), hx + k * 0.37, 0.05, hz, 0.33, 0.04, 1.1));
      g.add(mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 14).rotateX(Math.PI / 2), toon('#d9b24a'), hx, 0.08, hz + 0.3));
    }
    for (const [kind, fx, fz] of FURNITURE) {
      const f = buildFurniture(kind, th);
      f.position.set(fx, 0, fz);
      if (kind === 'sofa') f.rotation.y = 0;
      g.add(f);
    }
    scene.add(g);
  }
}

// =====================================================================
// 地下通路
// =====================================================================
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const GLOW_TEX = glowTexture();
function glow(color, size, opacity = 0.8) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  sp.scale.setScalar(size);
  return sp;
}
const chestLid = { mesh: null, open: 0, target: 0 };
const shafts = []; // はしごの上からさす光。MOMO より手前（カメラ側）にあるときはうすくする
const gemObjs = [];
const gemMinedUntil = new Map(); // spot -> この端末の時計での時刻（ms）
let hasPickaxe = store.get('pickaxe', false);
let pickaxeOnRack = null;
// 今日の宝石を岩に出す（掘られたばかりの岩は出さない）
function refreshGems() {
  const day = gemDay(), now = Date.now();
  gemObjs.forEach((o, i) => {
    const plan = gemPlan(i, day);
    if (o.kind !== plan.kind) {
      const c = GEM_KINDS.find((k) => k.key === plan.kind).color;
      o.mat.color.set(c); o.mat.emissive.set(c); o.glowMat.color.set(c);
      o.kind = plan.kind;
    }
    o.visible = plan.active && !((gemMinedUntil.get(i) || 0) > now);
    o.crystals.visible = o.visible;
  });
}
// 火花・きらきら
const sparks = [];
const SPARK_GEO = new THREE.SphereGeometry(0.05, 6, 4);
function spawnSparks(x, y, z, color, n = 8, speed = 3) {
  for (let k = 0; k < n; k++) {
    const m = new THREE.Mesh(SPARK_GEO, new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.set(x, y, z);
    const a = Math.random() * Math.PI * 2, up = 0.5 + Math.random();
    sparks.push({ m, vx: Math.cos(a) * speed * Math.random(), vy: up * speed, vz: Math.sin(a) * speed * Math.random(), life: 0.5 + Math.random() * 0.3, max: 0.8 });
    scene.add(m);
  }
}
function updateSparks(dt) {
  for (let k = sparks.length - 1; k >= 0; k--) {
    const sp = sparks[k];
    sp.life -= dt;
    if (sp.life <= 0) { scene.remove(sp.m); sp.m.material.dispose(); sparks.splice(k, 1); continue; }
    sp.vy -= 9 * dt;
    sp.m.position.x += sp.vx * dt; sp.m.position.y += sp.vy * dt; sp.m.position.z += sp.vz * dt;
    sp.m.material.opacity = sp.life / sp.max;
  }
}
function gemWorldPos(i) { const sp = GEM_SPOTS[i]; return { x: UNDER_X + sp.x, z: sp.z }; }
let swingCooldown = 0;
function mineGem(i) {
  if (!hasPickaxe) { toast('ピッケルが必要みたい。古い井戸の下に あったような…'); sound.click(); return; }
  if (performance.now() < swingCooldown) return;
  swingCooldown = performance.now() + 480;
  const g = gemWorldPos(i);
  me.r = Math.atan2(g.x - me.x, g.z - me.z);
  me.v.swing();
  setTimeout(() => { sound.clink(); spawnSparks(g.x, 0.7, g.z + 0.3, '#ffe9a8', 7); }, 230);
  net.send({ t: 'hit', i });
}
function buildUnderground() {
  const g = new THREE.Group();
  g.position.set(UNDER_X, 0, 0);
  scene.add(g);
  const X0 = -42, X1 = 44, Z0 = -42, Z1 = 46;
  // 床：通路は石だたみ、それ以外は暗い土
  const S = 1024, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(S, S);
  const rnd = mulberry32(21);
  for (let py = 0; py < S; py++) {
    const z = Z0 + ((py + 0.5) / S) * (Z1 - Z0);
    for (let px = 0; px < S; px++) {
      const x = X0 + ((px + 0.5) / S) * (X1 - X0);
      const d = tunnelDist(x, z), n = rnd();
      let c;
      if (d < 0) {
        const cell = ((Math.floor(x * 1.1) + Math.floor(z * 1.1)) & 1) ? 0.95 : 1;
        const edge = smoothstep(-0.9, 0, d);
        c = [118 * cell - edge * 38 + n * 14, 104 * cell - edge * 36 + n * 12, 92 * cell - edge * 34 + n * 10];
      } else c = [32 + n * 8, 26 + n * 6, 22 + n * 6];
      const o = (py * S + px) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0).rotateX(-Math.PI / 2), curvify(new THREE.MeshLambertMaterial({ map: tex })));
  floor.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  g.add(floor);

  // 岩の壁：通路と部屋のふちに岩をならべる
  const rocks = [];
  const addRock = (x, z) => { if (tunnelDist(x, z) > 0.25 && tunnelDist(x, z) < 1.6) rocks.push([x, z]); };
  for (const [a, b] of UNDER_EDGES) {
    const [ax, az] = UNDER_NODES[a], [bx, bz] = UNDER_NODES[b];
    const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    for (let t = 0; t < len; t += 1.25) {
      for (const side of [-1, 1]) {
        const off = TUNNEL_W + 0.75 + (rnd() - 0.5) * 0.4;
        addRock(ax + ux * t - uz * off * side, az + uz * t + ux * off * side);
      }
    }
  }
  for (const [k, r] of Object.entries(UNDER_ROOMS)) {
    const [nx, nz] = UNDER_NODES[k];
    const n = Math.ceil((2 * Math.PI * (r + 0.8)) / 1.2);
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; addRock(nx + Math.cos(a) * (r + 0.8), nz + Math.sin(a) * (r + 0.8)); }
  }
  const rockMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), toon('#ffffff'), rocks.length);
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  const rockColors = ['#6d6258', '#5f564e', '#776a5c', '#5a5360'];
  rocks.forEach(([x, z], i) => {
    // カメラ側（通路より手前）の岩は低くして、通路が見えるようにする
    const near = tunnelDist(x, z - 1.3) < 0 || tunnelDist(x, z - 2.2) < 0;
    const sz = near ? 0.55 + rnd() * 0.25 : 0.7 + rnd() * 0.35;
    dummy.position.set(x, near ? 0.05 : 0.45 + rnd() * 0.3, z);
    dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    dummy.scale.set(sz, near ? 0.35 + rnd() * 0.25 : 1.1 + rnd() * 0.9, sz);
    dummy.updateMatrix();
    rockMesh.setMatrixAt(i, dummy.matrix);
    rockMesh.setColorAt(i, col.set(rockColors[i % rockColors.length]));
  });
  rockMesh.frustumCulled = false;
  g.add(rockMesh);

  // 坑道の木の柱と、ランタン
  const wood = toon('#8a6038'), woodDark = toon('#6d4a2b');
  let beamN = 0;
  for (const [a, b] of UNDER_EDGES) {
    const [ax, az] = UNDER_NODES[a], [bx, bz] = UNDER_NODES[b];
    const len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(bx - ax, bz - az);
    for (let t = 5; t < len - 3; t += 7) {
      const x = ax + (bx - ax) * (t / len), z = az + (bz - az) * (t / len);
      const beam = new THREE.Group();
      beam.position.set(x, 0, z);
      beam.rotation.y = ang;
      for (const sx of [-1, 1]) beam.add(mesh(GEO.box, wood, sx * (TUNNEL_W - 0.1), 1.1, 0, 0.22, 2.2, 0.22));
      beam.add(mesh(GEO.box, woodDark, 0, 2.25, 0, TUNNEL_W * 2 + 0.3, 0.22, 0.26));
      if (beamN++ % 2 === 0) {
        beam.add(mesh(GEO.cyl, woodDark, 0.5, 2.0, 0, 0.015, 0.3, 0.015));
        beam.add(mesh(GEO.sphereLo, basic('#ffd27a'), 0.5, 1.8, 0, 0.12, 0.15, 0.12));
        const gl = glow('#ffb347', 2.6, 0.7);
        gl.position.set(0.5, 1.8, 0);
        beam.add(gl);
      }
      g.add(beam);
    }
  }
  // 光る水晶
  const crystalColors = ['#8fe3ff', '#c7a6ff', '#9ff0da'];
  const crystal = (x, z, k) => {
    const cg = new THREE.Group();
    cg.position.set(x, 0, z);
    const c = crystalColors[k % crystalColors.length];
    for (let i = 0; i < 3; i++) {
      const m = mesh(new THREE.ConeGeometry(0.16, 0.9, 6), basic(c), (i - 1) * 0.18, 0.4, (i % 2) * 0.12, 1, 0.7 + i * 0.3, 1);
      m.rotation.z = (i - 1) * 0.35;
      cg.add(m);
    }
    const gl = glow(c, 2.2, 0.55);
    gl.position.y = 0.6;
    cg.add(gl);
    g.add(cg);
  };
  let ck = 0;
  for (const [k, r] of Object.entries(UNDER_ROOMS)) {
    const [nx, nz] = UNDER_NODES[k];
    for (const a of [0.8, 2.6, 4.2]) {
      const x = nx + Math.cos(a + ck) * (r - 0.35), z = nz + Math.sin(a + ck) * (r - 0.35);
      if (tunnelDist(x, z) > -0.2 && tunnelDist(x, z) < 0.6) crystal(x, z, ck);
      ck++;
    }
  }
  // はしごと、上からさしこむ光
  for (const sp of UNDER_SPOTS) {
    const lg = new THREE.Group();
    lg.position.set(sp.x, 0, sp.z);
    for (const sx of [-1, 1]) lg.add(mesh(GEO.box, wood, sx * 0.32, 2.2, 0, 0.09, 4.4, 0.09));
    for (let y = 0.35; y < 4.3; y += 0.45) lg.add(mesh(GEO.box, woodDark, 0, y, 0, 0.64, 0.06, 0.07));
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 1.2, 4.6, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: sp.kind === 'hatch' ? '#ffd9a0' : '#fff6d6', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    shaft.position.y = 2.3;
    lg.add(shaft);
    shafts.push({ mat: shaft.material, z: sp.z });
    lg.add(mesh(GEO.cyl, basic('#f3e2b8'), 0, 0.01, 0, 1.1, 0.01, 1.1));
    g.add(lg);
  }
  // 宝石の岩
  GEM_SPOTS.forEach((sp, i) => {
    const gg = new THREE.Group();
    gg.position.set(sp.x, 0, sp.z);
    gg.rotation.y = sp.face;
    gg.add(mesh(GEO.blobby, toon('#4d4552'), 0, 0.45, -0.15, 0.62, 0.7, 0.5));
    const crystals = new THREE.Group();
    const mat = curvify(new THREE.MeshToonMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.45, gradientMap: GRADIENT }));
    const oct = new THREE.OctahedronGeometry(0.15, 0);
    [[-0.22, 0.55, 0.28, 0.5, 1], [0.05, 0.8, 0.3, -0.3, 1.25], [0.25, 0.45, 0.3, -0.7, 0.9], [-0.05, 0.3, 0.38, 0.9, 0.8]].forEach(([x, y, z, rz, k]) => {
      const c = new THREE.Mesh(oct, mat);
      c.position.set(x, y, z);
      c.scale.set(k, k * 1.7, k);
      c.rotation.set(0.5, 0, rz);
      crystals.add(c);
    });
    const gl = glow('#ffffff', 1.8, 0.5);
    gl.position.set(0, 0.6, 0.35);
    crystals.add(gl);
    gg.add(crystals);
    g.add(gg);
    gemObjs.push({ sp, crystals, mat, glowMat: gl.material, kind: null, visible: false });
  });
  // 古い井戸の下の部屋に立てかけてあるピッケル
  const rack = new THREE.Group();
  rack.position.set(PICKAXE_SPOT.x, 0, PICKAXE_SPOT.z);
  rack.add(mesh(GEO.box, toon('#7a5230'), 0, 0.5, -0.1, 0.5, 1.0, 0.08));
  rack.add(mesh(GEO.box, toon('#f3e2b8'), 0, 0.72, -0.05, 0.36, 0.2, 0.02));
  const rackPick = new THREE.Group();
  rackPick.position.set(0, 0.05, 0.08);
  rackPick.rotation.set(-0.25, 0, 0.25);
  rackPick.add(mesh(GEO.cyl, toon('#9c6b3e'), 0, 0.42, 0, 0.035, 0.84, 0.035));
  rackPick.add(mesh(GEO.box, toon('#8d96a3'), 0, 0.84, 0, 0.42, 0.08, 0.1));
  for (const sx of [-1, 1]) {
    const tip = mesh(GEO.cone, toon('#b8c0cb'), sx * 0.3, 0.8, 0, 0.055, 0.22, 0.055);
    tip.rotation.z = sx > 0 ? -1.9 : 1.9;
    rackPick.add(tip);
  }
  rack.add(rackPick);
  const rg = glow('#fff1b0', 1.6, 0.35);
  rg.position.y = 0.6;
  rackPick.add(rg);
  g.add(rack);
  pickaxeOnRack = rackPick;
  rackPick.visible = !hasPickaxe;

  // 宝箱の部屋
  const chest = new THREE.Group();
  chest.position.set(CHEST.x, 0, CHEST.z);
  chest.add(mesh(GEO.box, toon('#a0662f'), 0, 0.35, 0, 1.3, 0.7, 0.8));
  chest.add(mesh(GEO.box, toon('#e4b43c'), 0, 0.35, 0.41, 1.34, 0.12, 0.02));
  const lid = new THREE.Group();
  lid.position.set(0, 0.7, -0.4);
  lid.add(mesh(GEO.box, toon('#b5773a'), 0, 0.18, 0.4, 1.34, 0.36, 0.84));
  lid.add(mesh(GEO.box, toon('#e4b43c'), 0, 0.18, 0.83, 0.2, 0.28, 0.04));
  chest.add(lid);
  chest.add(mesh(GEO.sphereLo, basic('#ffe27a'), 0, 0.72, 0, 0.5, 0.12, 0.3));
  const cg = glow('#ffd35a', 3.2, 0.45);
  cg.position.y = 0.9;
  chest.add(cg);
  chest.add(blob(2));
  g.add(chest);
  chestLid.mesh = lid;
}

// 地上の入り口（井戸・ほらあな）
function buildEntrances() {
  for (const sp of UNDER_SPOTS) {
    if (sp.kind === 'hatch') continue;
    const g = new THREE.Group();
    g.position.set(sp.x, groundHeight(sp.x, sp.z), sp.z);
    if (sp.kind === 'well') {
      const stone = toon('#b8b0a2');
      g.add(mesh(new THREE.CylinderGeometry(1.0, 1.08, 0.8, 22, 1, true), toon('#b8b0a2', { side: THREE.DoubleSide }), 0, 0.4, 0));
      g.add(mesh(new THREE.TorusGeometry(1.0, 0.12, 8, 24).rotateX(Math.PI / 2), stone, 0, 0.8, 0));
      g.add(mesh(GEO.cyl, basic('#121016'), 0, 0.3, 0, 0.92, 0.02, 0.92));
      for (const sx of [-1, 1]) g.add(mesh(GEO.box, toon('#8a5a32'), sx * 1.0, 1.25, 0, 0.14, 2.1, 0.14));
      const roof = makeRoof(2.8, 0.8, 1.5, '#7c5a3a');
      roof.position.y = 2.25;
      g.add(roof);
      g.add(mesh(GEO.cyl, toon('#8a5a32'), 0, 1.85, 0, 0.06, 2.1, 0.06).rotateZ(Math.PI / 2));
      g.add(mesh(GEO.cyl, toon('#c9a26b'), 0, 1.3, 0, 0.012, 1.0, 0.012));
      g.add(mesh(GEO.cyl, toon('#9c774a'), 0, 0.72, 0, 0.18, 0.22, 0.18));
      g.add(blob(3.2));
    } else {
      const beach = sp.key === 'beach';
      const rock = (c) => toon(beach ? c[1] : c[0]);
      const parts = [
        [-1.05, 0.6, -0.3, 1.0, 1.3, 0.9, ['#8f877c', '#c9b99a']],
        [1.05, 0.6, -0.3, 1.0, 1.25, 0.95, ['#978e82', '#d2c2a2']],
        [0, 1.45, -0.45, 1.5, 0.75, 0.95, ['#a39a8d', '#dccdae']],
        [-0.3, 0.5, -1.2, 1.3, 1.1, 0.9, ['#857d72', '#c1b193']],
      ];
      for (const [x, y, z, sx, sy, sz, c] of parts) {
        const m = mesh(GEO.blobby, rock(c), x, y, z, sx, sy, sz);
        m.rotation.y = x;
        g.add(m);
      }
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), basic('#0e0b0a'));
      hole.position.set(0, 0.72, 0.05);
      hole.scale.set(0.85, 1, 1);
      g.add(hole);
      g.add(mesh(GEO.cyl, basic('#0e0b0a'), 0, 0.02, 0.2, 0.75, 0.02, 0.55));
      g.add(blob(3.6));
    }
    scene.add(g);
  }
}

// =====================================================================
// 売り地と、よろず屋
// =====================================================================
function signTexture(lines, bg = '#f6ead0', ink = '#6b4f2a') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = 'rgba(107,79,42,0.35)'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 122);
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  const font = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif';
  if (lines.length === 1) { g.font = `800 ${lines[0].length > 6 ? 30 : 40}px ${font}`; g.fillText(lines[0], 128, 66); }
  else { g.font = `800 34px ${font}`; g.fillText(lines[0], 128, 46); g.font = `700 26px ${font}`; g.fillText(lines[1], 128, 90); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const plotObjs = []; // i -> { stakes, sign material, house, owner }
const plotInfo = PLOTS.map(() => ({ owner: null, color: 0 }));
function buildPlots() {
  for (const p of PLOTS) {
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    // 空き地のしるし：四すみのくいと、なわ
    const stakes = new THREE.Group();
    const h = PLOT_SIZE / 2;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) stakes.add(mesh(GEO.box, toon('#a8743f'), sx * h, 0.3, sz * h, 0.12, 0.6, 0.12));
    for (const [x, z, w, d] of [[0, -h, PLOT_SIZE, 0.04], [0, h, PLOT_SIZE, 0.04], [-h, 0, 0.04, PLOT_SIZE], [h, 0, 0.04, PLOT_SIZE]]) {
      stakes.add(mesh(GEO.box, toon('#e7d3a0'), x, 0.48, z, w, 0.03, d));
    }
    g.add(stakes);
    scene.add(g);
    // 看板
    const sign = new THREE.Group();
    sign.position.set(p.sign.x, 0, p.sign.z);
    sign.add(mesh(GEO.box, toon('#8a5a32'), 0, 0.55, 0, 0.1, 1.1, 0.1));
    const mat = curvify(new THREE.MeshBasicMaterial({ map: signTexture(['売り地', `${PLOT_PRICE.toLocaleString('ja-JP')} ポカ`]) }));
    sign.add(mesh(GEO.box, toon('#9c6b3e'), 0, 1.15, -0.02, 1.25, 0.66, 0.06));
    sign.add(mesh(new THREE.PlaneGeometry(1.15, 0.575), mat, 0, 1.15, 0.015));
    sign.add(blob(0.9));
    scene.add(sign);
    plotObjs.push({ stakes, mat, house: null, owner: undefined, color: undefined });
  }
}
// サーバーから届いた持ち主の一覧を島に反映する：[番号, 持ち主の名前 or null, 色]
function applyPlots(list) {
  for (const [i, owner, color] of list || []) {
    const o = plotObjs[i], p = PLOTS[i];
    if (!o) continue;
    plotInfo[i] = { owner, color };
    setPlotOwned(i, !!owner);
    const room = INTERIORS[HOUSES.length + i];
    if (room) room.house.name = owner ? `${owner}の家` : 'だれかの家';
    if (o.owner === owner && o.color === color) continue;
    o.owner = owner; o.color = color;
    o.stakes.visible = !owner;
    o.mat.map.dispose();
    o.mat.map = signTexture(owner ? [`${owner}`, 'の家'] : ['売り地', `${PLOT_PRICE.toLocaleString('ja-JP')} ポカ`]);
    o.mat.needsUpdate = true;
    if (o.house) { scene.remove(o.house); o.house = null; }
    if (owner) {
      o.house = makeHouse({ ...p.house, roof: MOMO_ACCENT[color] || MOMO_ACCENT[0], wall: '#fffaf0' });
      scene.add(o.house);
    }
  }
  // 自分がいる場所に家が建ったら、手前に出す
  if (me && layerOf(me.x) === 'surface' && !walkable(me.x, me.z)) {
    const p = PLOTS.find((q) => Math.abs(me.x - q.house.x) < q.house.w / 2 + 0.5 && Math.abs(me.z - q.house.z) < q.house.d / 2 + 0.5);
    if (p) { me.x = p.x; me.z = p.z + PLOT_SIZE / 2 + 0.6; }
  }
}
function applyMe(v) {
  if (!v) return;
  pocket = { coins: v.coins || 0, fruit: v.fruit || {}, gems: v.gems || {}, fish: v.fish || {}, bugs: v.bugs || {}, dex: v.dex || { fish: {}, bug: {}, gem: {} } };
  if (Number.isInteger(v.rank) && me) setRank(me, v.rank);
  myPlot = Number.isInteger(v.plot) ? v.plot : null;
  renderPocket();
  renderShop();
  if (plotModalFor !== null) renderPlotModal(plotModalFor);
}

// 土地の看板を調べたとき
let plotModalFor = null, releaseArmed = false;
function openPlotModal(i) {
  plotModalFor = i; releaseArmed = false;
  renderPlotModal(i);
  openModal('#plotModal');
}
function renderPlotModal(i) {
  const info = plotInfo[i];
  const mine = myPlot === i;
  const btn = $('#plotAction');
  btn.hidden = false; btn.disabled = false;
  $('#plotTitle').textContent = info.owner ? (mine ? 'あなたの土地' : `${info.owner}さんの土地`) : `売り地 No.${i + 1}`;
  if (mine) {
    $('#plotText').textContent = 'あなたの家が建っています。しばらく（30日）島に来ないと、空き地にもどります。';
    btn.textContent = releaseArmed ? '本当に手放す' : `土地を手放す（${Math.floor(PLOT_PRICE * PLOT_REFUND).toLocaleString('ja-JP')} ポカもどる）`;
    btn.classList.toggle('danger', true);
  } else if (info.owner) {
    $('#plotText').textContent = `${info.owner}さんの家が建っています。ドアから遊びに行けます。`;
    btn.hidden = true;
  } else {
    btn.classList.toggle('danger', false);
    btn.textContent = `この土地を ${PLOT_PRICE.toLocaleString('ja-JP')} ポカで買う`;
    let note = `買うと、ここに あなたの家が建ちます。土地は ひとり ひとつまでです。いまのポカ：${pocket.coins.toLocaleString('ja-JP')}`;
    if (!serverMode()) { note = '土地は、みんなの島（公開中のサーバー）でだけ買えます。'; btn.disabled = true; }
    else if (myPlot !== null) { note = `もう No.${myPlot + 1} の土地を持っています。土地は ひとり ひとつまでです。`; btn.disabled = true; }
    else if (pocket.coins < PLOT_PRICE) { note += `（あと ${(PLOT_PRICE - pocket.coins).toLocaleString('ja-JP')} ポカ）`; btn.disabled = true; }
    $('#plotText').textContent = note;
  }
}
$('#plotAction').addEventListener('click', () => {
  const i = plotModalFor;
  if (i === null || !serverMode()) return;
  if (myPlot === i) {
    if (!releaseArmed) { releaseArmed = true; renderPlotModal(i); return; }
    net.send({ t: 'releasePlot' });
  } else {
    net.send({ t: 'buyPlot', i });
  }
  $('#plotAction').disabled = true;
});
function onPlotResult(msg) {
  closeModals();
  plotModalFor = null;
  if (msg.action === 'buy') {
    if (!msg.error) { toast('土地を買いました！ あなたの家が建ちました'); sound.sparkle(); me.v.hop(); }
    else toast({ taken: 'ほかの人が先に買いました', not_enough: 'ポカが足りません', already_own: '土地は ひとり ひとつまでです' }[msg.error] || '買えませんでした');
  } else if (msg.refund) {
    toast(`土地を手放しました（${msg.refund.toLocaleString('ja-JP')} ポカもどりました）`);
  }
}

// よろず屋：果物や宝石を ぜんぶ売る
function buildShop() {
  const g = new THREE.Group();
  g.position.set(SHOP.x, groundHeight(SHOP.x, SHOP.z), SHOP.z);
  const wood = toon('#b98555'), woodDark = toon('#8f623b');
  g.add(mesh(GEO.box, wood, 0, 0.55, 0.15, 2.5, 1.1, 0.9));
  g.add(mesh(GEO.box, toon('#f6ead0'), 0, 1.13, 0.15, 2.6, 0.08, 1.0));
  for (const sx of [-1, 1]) g.add(mesh(GEO.box, woodDark, sx * 1.2, 1.4, -0.35, 0.12, 2.8, 0.12));
  // しましまの屋根
  for (let k = 0; k < 6; k++) {
    const m = mesh(GEO.box, toon(k % 2 ? '#fdfdf8' : '#e2574c'), -1.25 + 0.5 * k + 0.25, 2.75, 0.1, 0.5, 0.08, 1.5);
    m.rotation.x = 0.28;
    g.add(m);
  }
  const mat = curvify(new THREE.MeshBasicMaterial({ map: signTexture(['よろず屋', '買い取り']) }));
  g.add(mesh(new THREE.PlaneGeometry(1.4, 0.7), mat, 0, 2.2, -0.28));
  // 台の上の品もの
  g.add(mesh(GEO.sphereLo, toon('#ffa7a0'), -0.7, 1.28, 0.2, 0.16));
  g.add(mesh(GEO.sphereLo, toon('#e8423b'), -0.4, 1.28, 0.3, 0.15));
  g.add(mesh(new THREE.OctahedronGeometry(0.15), toon('#4f8cff'), 0.5, 1.32, 0.25, 1, 1.5, 1));
  g.add(mesh(new THREE.OctahedronGeometry(0.13), toon('#b77cf0'), 0.8, 1.3, 0.1, 1, 1.5, 1));
  g.add(blob(3.2));
  scene.add(g);
}
function renderShop() {
  const list = $('#shopList');
  if (!list) return;
  list.textContent = '';
  const rows = [];
  for (const [key, n] of Object.entries(pocket.fruit || {})) if (n && SELL_PRICES.fruit[key]) rows.push({ what: 'fruit', key, n, name: FRUITS[key].name, color: FRUITS[key].color, price: SELL_PRICES.fruit[key] });
  for (const k of GEM_KINDS) { const n = pocket.gems?.[k.key]; if (n) rows.push({ what: 'gem', key: k.key, n, name: k.name, color: k.color, price: SELL_PRICES.gem[k.key] }); }
  for (const f of FISH) { const n = pocket.fish?.[f.key]; if (n) rows.push({ what: 'fish', key: f.key, n, name: f.name, color: '#6cb7d9', price: f.price }); }
  for (const b of BUGS) { const n = pocket.bugs?.[b.key]; if (n) rows.push({ what: 'bug', key: b.key, n, name: b.name, color: '#8fc45a', price: b.price }); }
  $('#shopEmpty').hidden = rows.length > 0;
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'shoprow';
    const dot = document.createElement('i');
    dot.style.background = r.color;
    if (r.what === 'gem') dot.className = 'gemdot';
    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = `${r.name} ×${r.n}`;
    const price = document.createElement('span');
    price.className = 'pr';
    price.textContent = `${(r.price * r.n).toLocaleString('ja-JP')} ポカ`;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'ぜんぶ売る';
    b.addEventListener('click', () => sellItem(r.what, r.key));
    row.append(dot, name, price, b);
    list.appendChild(row);
  }
  $('#shopCoins').textContent = pocket.coins.toLocaleString('ja-JP');
  // はじめての人への道具
  const tools = $('#shopTools');
  tools.textContent = '';
  for (const [k, name] of [['rod', 'つりざお'], ['net', '虫とりあみ']]) {
    if (hasTool(k)) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${name}を もらう`;
    b.addEventListener('click', () => { store.set(k, true); toast(`${name}を もらった！`); sound.coins(); renderShop(); });
    tools.appendChild(b);
  }
  $('#shopToolsBox').hidden = !tools.children.length;
}
function sellItem(what, key) {
  if (serverMode()) { net.send({ t: 'sell', what, key }); return; }
  const bag = { fruit: pocket.fruit, gem: pocket.gems, fish: pocket.fish, bug: pocket.bugs }[what];
  const gained = (bag[key] || 0) * SELL_PRICES[what][key];
  delete bag[key];
  pocket.coins += gained;
  savePocket();
  renderPocket();
  renderShop();
  if (gained) { toast(`${gained.toLocaleString('ja-JP')} ポカで 売れました！`); sound.coins(); }
}

// =====================================================================
// 虫・魚つり・図鑑
// =====================================================================
// 島の中の生き物は、セル調で地面といっしょに曲がるマテリアル
function sceneM(c, o = {}) {
  const { glow: g, ...rest } = o;
  return g ? basic(c) : toon(c, rest);
}
const hasTool = (k) => store.get(k, false);
const bugObjs = new Map(); // id -> { g, key, sp, flyer, wings, t0, fleeT }
const TREE_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 1).normalize(), Math.PI);
function applyBugs(list, fled = []) {
  const alive = new Set();
  for (const [id, key, spot] of list || []) {
    alive.add(id);
    if (bugObjs.has(id)) continue;
    const sp = BUG_SPOTS[spot];
    const c = sp && makeCreature('bug', key, sceneM);
    if (!c) continue;
    const g = new THREE.Group();
    g.add(c.group);
    c.group.scale.setScalar(2.4);
    if (sp.hab === 'tree' && !c.flyer) c.group.quaternion.copy(TREE_Q); // 幹にとまる
    else c.group.rotation.y = Math.random() * 6.28;
    if (c.glow) { const gl = glow(c.glow, 1.4, 0.8); c.group.add(gl); }
    g.position.set(sp.x, groundHeight(sp.x, sp.z) + sp.y, sp.z);
    scene.add(g);
    bugObjs.set(id, { g, c, key, sp, flyer: !!c.flyer, t0: Math.random() * 10, fleeT: 0 });
  }
  for (const [id, o] of bugObjs) {
    if (alive.has(id) || o.fleeT) continue;
    if (fled.includes(id)) o.fleeT = 0.9; // 飛んでにげる
    else { scene.remove(o.g); bugObjs.delete(id); }
  }
}
function bugPos(o) { return o.g.position; }
function updateBugs(dt, now) {
  for (const [id, o] of bugObjs) {
    const base = o.sp, t = now + o.t0;
    if (o.fleeT) {
      o.fleeT -= dt;
      o.g.position.y += dt * 5; o.g.position.x += dt * 2;
      if (o.fleeT <= 0) { scene.remove(o.g); bugObjs.delete(id); }
      continue;
    }
    if (o.flyer) {
      o.g.position.set(base.x + Math.sin(t * 0.7) * 0.8, groundHeight(base.x, base.z) + base.y + 0.3 + Math.sin(t * 2.1) * 0.25, base.z + Math.cos(t * 0.5) * 0.6);
      o.c.group.rotation.y = Math.atan2(Math.cos(t * 0.7), -Math.sin(t * 0.5));
      for (const w of o.c.wings || []) w.rotation.z = w.userData.side * Math.sin(t * 24) * 0.7;
    } else if (base.hab !== 'tree') {
      o.c.group.rotation.y += Math.sin(t * 0.8) * dt * 0.6;
    }
  }
}
function nearestBug(range) {
  let best = null, bd = range;
  for (const [id, o] of bugObjs) {
    if (o.fleeT) continue;
    const p = bugPos(o), d = Math.hypot(p.x - me.x, p.z - me.z);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}
function tryCatchBug(id) {
  if (!hasTool('net')) { toast('あみが あれば つかまえられそう…（よろず屋で もらえるよ）'); sound.click(); return; }
  if (performance.now() < swingCooldown) return;
  swingCooldown = performance.now() + 550;
  const o = bugObjs.get(id);
  if (o) me.r = Math.atan2(bugPos(o).x - me.x, bugPos(o).z - me.z);
  me.v.swing('net');
  sound.rustle();
  net.send({ t: 'catch', id, x: me.x, z: me.z });
}

// ---- 魚つり ----
let fishing = null; // { phase, bob, line, biteAt, nibbles, until }
const BOB_Y = WATER_Y + 0.03;
function castPoint() {
  for (const turn of [0, 0.35, -0.35, 0.7, -0.7]) {
    const r = me.r + turn, fx = Math.sin(r), fz = Math.cos(r);
    for (const d of [3.0, 2.6, 3.4, 2.2, 3.8]) {
      const x = me.x + fx * d, z = me.z + fz * d;
      if (waterAt(x, z)) return { x, z, r };
    }
  }
  return null;
}
function canFishHere() { return layerOf(me.x) === 'surface' && !!castPoint(); }
function startFishing() {
  if (!hasTool('rod')) { toast('つりざおが あれば つりができそう…（よろず屋で もらえるよ）'); sound.click(); return; }
  const cp = castPoint();
  if (!cp) { toast('水のほうを向いて つりをしよう'); return; }
  me.r = cp.r;
  me.v.hold('rod');
  sound.cast();
  const bob = new THREE.Group();
  bob.add(mesh(GEO.sphereLo, toon('#f4f1ea'), 0, 0.05, 0, 0.11, 0.08, 0.11));
  bob.add(mesh(GEO.sphereLo, toon('#e2574c'), 0, 0.1, 0, 0.1, 0.07, 0.1));
  bob.position.set(cp.x, BOB_Y, cp.z);
  scene.add(bob);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#f5f5f0', transparent: true, opacity: 0.8 }));
  line.frustumCulled = false;
  scene.add(line);
  const now = performance.now() / 1000;
  const biteAt = now + 3 + Math.random() * 6;
  const nibbles = [];
  for (let k = 0; k < Math.floor(Math.random() * 4); k++) nibbles.push(now + 1.2 + Math.random() * (biteAt - now - 1.8));
  nibbles.sort((a, b) => a - b);
  fishing = { phase: 'wait', bob, line, cp, biteAt, nibbles, dip: 0, until: 0 };
}
function endFishing(msg) {
  if (!fishing) return;
  scene.remove(fishing.bob); scene.remove(fishing.line);
  fishing.line.geometry.dispose();
  fishing = null;
  me.v.hold(null);
  me.v.setRodPull(0);
  if (msg) toast(msg);
}
function fishingAction() {
  if (!fishing) return false;
  if (fishing.phase === 'bite') {
    fishing.phase = 'reel';
    sound.splash();
    net.send({ t: 'fish', x: me.x, z: me.z });
    setTimeout(() => endFishing(), 600);
  } else if (fishing.phase === 'wait') {
    endFishing('はやすぎた… にげられちゃった');
  }
  return true;
}
const tipV = new THREE.Vector3();
function updateFishing(now) {
  if (!fishing) return;
  const f = fishing;
  if (f.phase === 'wait') {
    if (f.nibbles.length && now > f.nibbles[0]) { f.nibbles.shift(); f.dip = 0.22; sound.nibble(); }
    if (now > f.biteAt) {
      f.phase = 'bite'; f.until = now + 0.95; f.dip = 1;
      sound.splash();
      doEmote(me, 'wow');
    }
  } else if (f.phase === 'bite' && now > f.until) {
    endFishing('にげられた…');
    return;
  }
  f.dip = Math.max(0, f.dip - 0.02);
  const sink = f.phase === 'bite' ? 0.28 : f.dip * 0.5;
  f.bob.position.y = BOB_Y - sink + Math.sin(now * 3) * 0.02;
  me.v.setRodPull(f.phase === 'bite' ? 1 : f.dip);
  me.v.rodTip(tipV);
  tipV.y -= curveY(tipV.z);
  const pos = f.line.geometry.attributes.position;
  pos.setXYZ(0, tipV.x, tipV.y, tipV.z);
  pos.setXYZ(1, f.bob.position.x, f.bob.position.y + 0.1 - curveY(f.bob.position.z), f.bob.position.z);
  pos.needsUpdate = true;
}

// ---- 図鑑 ----
const flatCache = new Map();
function flatM(c, o = {}) { // 図鑑の絵用（地面といっしょに曲げない）
  const { glow: g, ...rest } = o;
  const key = c + JSON.stringify(rest) + (g ? 'g' : '');
  if (!flatCache.has(key)) flatCache.set(key, g ? new THREE.MeshBasicMaterial({ color: c }) : new THREE.MeshToonMaterial({ color: c, gradientMap: GRADIENT, ...rest }));
  return flatCache.get(key);
}
let portrait = null;
const thumbs = new Map();
function thumb(cat, key, shown) {
  const id = `${cat}:${key}:${shown ? 1 : 0}`;
  if (thumbs.has(id)) return thumbs.get(id);
  if (!portrait) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(160, 160);
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xffffff, 0xb8a888, 1.6));
    const l = new THREE.DirectionalLight(0xffffff, 1.6); l.position.set(2, 4, 3); sc.add(l);
    portrait = { r, sc, cam: new THREE.PerspectiveCamera(30, 1, 0.01, 50), dark: new THREE.MeshBasicMaterial({ color: '#b9aa8f' }) };
  }
  const { r, sc, cam } = portrait;
  let obj;
  if (cat === 'gem') {
    obj = new THREE.Group();
    const c = GEM_KINDS.find((k) => k.key === key).color;
    const m = new THREE.MeshToonMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, gradientMap: GRADIENT });
    [[0, 0.1, 0, 1.3], [-0.2, -0.05, 0.05, 0.9], [0.22, -0.08, -0.02, 0.8]].forEach(([x, y, z, k]) => {
      const o = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), m); o.position.set(x, y, z); o.scale.set(k, k * 1.6, k); o.rotation.z = x * 2; obj.add(o);
    });
  } else {
    obj = makeCreature(cat, key, flatM).group;
    if (cat === 'fish') obj.rotation.y = key === 'madako' ? 0.5 : Math.PI / 2 - 0.35;
    else obj.rotation.set(0.9, 0.5, 0);
  }
  sc.add(obj);
  sc.overrideMaterial = shown ? null : portrait.dark;
  // 大きさをそろえて まん中に
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const rad = Math.max(size.x, size.y, size.z) * 0.62;
  cam.position.set(center.x, center.y + rad * 0.5, center.z + rad / Math.tan((15 * Math.PI) / 180) * 1.05);
  cam.lookAt(center);
  r.render(sc, cam);
  const url = r.domElement.toDataURL();
  sc.remove(obj);
  thumbs.set(id, url);
  return url;
}
let dexTab = 'fish';
function hoursText(h) {
  if (h.length === 1 && h[0][0] === 0 && h[0][1] === 24) return '一日中';
  return h.map(([a, b]) => `${a}時〜${b}時`).join('・');
}
function renderDex() {
  const dex = pocket.dex || { fish: {}, bug: {}, gem: {} };
  const n = dexCount(dex), total = DEX_TOTAL();
  const rk = rankOf(dex);
  $('#dexRank').textContent = `${rk.mark} ${rk.name}`;
  $('#dexCount').textContent = `${n} / ${total}（${Math.floor(rk.pct)}%）`;
  $('#dexBar').style.width = `${(n / total) * 100}%`;
  const next = RANKS[rk.i + 1];
  $('#dexNext').textContent = next ? `あと ${Math.max(1, Math.ceil((next.min / 100) * total) - n)}種類で ${next.mark} ${next.name}` : 'すべて そろえました！';
  const lists = { fish: FISH, bug: BUGS, gem: GEM_KINDS };
  for (const cat of ['fish', 'bug', 'gem']) {
    const got = lists[cat].filter((x) => dex[cat]?.[x.key]).length;
    $(`#dexTab-${cat} b`).textContent = `${got}/${lists[cat].length}`;
    $(`#dexTab-${cat}`).classList.toggle('on', cat === dexTab);
  }
  const grid = $('#dexGrid');
  grid.textContent = '';
  for (const x of lists[dexTab]) {
    const has = !!dex[dexTab]?.[x.key];
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'dexcell' + (has ? '' : ' unknown');
    const img = document.createElement('img');
    img.alt = has ? x.name : 'まだ見つけていない';
    img.src = thumb(dexTab, x.key, has);
    const nm = document.createElement('span');
    nm.textContent = has ? x.name : '？？？';
    cell.append(img, nm);
    cell.addEventListener('click', () => {
      if (!has) { $('#dexInfo').textContent = dexTab === 'gem' ? 'どこかの宝石の岩で ほれるみたい…' : `${WHERE_NAMES[x.where || x.hab]}で 見つかるかも…`; return; }
      const where = dexTab === 'gem' ? '地下の宝石の岩' : `${WHERE_NAMES[x.where || x.hab]}・${hoursText(x.h)}`;
      const price = SELL_PRICES[dexTab]?.[x.key];
      $('#dexInfo').textContent = `${x.name}：${where}・よろず屋で ${price.toLocaleString('ja-JP')} ポカ`;
    });
    grid.appendChild(cell);
  }
}
function openDex() { renderDex(); $('#dexInfo').textContent = 'マスをおすと、くわしく見られます。'; openModal('#dexModal'); }
$('#dexBtn').addEventListener('click', openDex);
for (const cat of ['fish', 'bug', 'gem']) $(`#dexTab-${cat}`).addEventListener('click', () => { dexTab = cat; renderDex(); sound.click(); });

// ---- つかまえた！ ----
let localFirst = false;
function addLocalDex(cat, key) {
  localFirst = !pocket.dex[cat][key];
  if (localFirst) pocket.dex[cat][key] = Date.now();
  return localFirst;
}
let trophy = null; // 頭の上にかかげる生き物
function onCaught(msg) {
  const cat = msg.kind;
  if (!msg.key) { toast(cat === 'bug' ? 'にげられた…' : 'なにも つれなかった…'); return; }
  const info = (cat === 'fish' ? FISH : BUGS).find((x) => x.key === msg.key);
  let first = !!msg.first;
  const before = me.rank || 0;
  if (!serverMode()) {
    const bag = cat === 'fish' ? pocket.fish : pocket.bugs;
    bag[msg.key] = (bag[msg.key] || 0) + 1;
    first = addLocalDex(cat === 'fish' ? 'fish' : 'bug', msg.key);
    savePocket();
    renderPocket();
    const r = rankOf(pocket.dex).i;
    setRank(me, r);
    net.send({ t: 'rank', rank: r });
  }
  // 頭の上に かかげる
  if (trophy) scene.remove(trophy.g);
  const c = makeCreature(cat, msg.key, sceneM);
  if (c) {
    const g = new THREE.Group();
    g.add(c.group);
    c.group.scale.setScalar(cat === 'fish' ? 1.3 : 3.2);
    if (cat === 'fish') c.group.rotation.y = Math.PI / 2;
    scene.add(g);
    trophy = { g, until: performance.now() / 1000 + 2.8 };
  }
  me.v.hop();
  sound.sparkle();
  toast(`${info.name}を ${cat === 'fish' ? 'つりあげた' : 'つかまえた'}！`);
  if (first) setTimeout(() => toast(`📖 ${info.name}が 図鑑に のったよ！`), 1700);
  setTimeout(() => {
    const now = me.rank || 0;
    if (now > before) { toast(`🎉 ランクアップ！ ${RANKS[now].mark} ${RANKS[now].name} になった！`); sound.coins(); }
  }, first ? 3400 : 1700);
}
function updateTrophy(now) {
  if (!trophy) return;
  if (now > trophy.until) { scene.remove(trophy.g); trophy = null; return; }
  trophy.g.position.set(me.x, standHeight(me.x, me.z) + 2.9 + Math.sin(now * 3) * 0.05, me.z);
  trophy.g.rotation.y = Math.sin(now * 1.5) * 0.4;
}

// =====================================================================
// 落ちた果物・ポカぶくろ
// =====================================================================
const drops = new Map(); // id -> { obj, kind, tree, t0 }
function dropSpot(treeIndex, slot) {
  const t = PLACE.trees[treeIndex];
  if (!t) return { x: SPAWN.x, z: SPAWN.z };
  // 手前（カメラ側）に落ちるようにする。木の奥だと葉にかくれて見えないため
  for (let k = 0; k < 12; k++) {
    const a = Math.PI * (0.22 + slot * 0.19) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.22;
    const r = 1.7 + (k > 6 ? 0.5 : 0);
    const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
    if (walkable(x, z, 0.05)) return { x, z };
  }
  return { x: t.x + 1.3, z: t.z + 1.3 };
}
function makeDropObj(kind, treeIndex) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  if (kind === 'coin') {
    inner.add(mesh(GEO.sphereLo, toon('#efdcaa'), 0, 0.3, 0, 0.32, 0.3, 0.3));
    inner.add(mesh(GEO.cyl, toon('#d8bf85'), 0, 0.6, 0, 0.1, 0.12, 0.1));
    inner.add(mesh(GEO.sphereLo, toon('#efdcaa'), 0, 0.72, 0, 0.14, 0.08, 0.14));
    inner.add(mesh(GEO.cyl, toon('#f2c94c'), 0, 0.32, 0.29, 0.13, 0.03, 0.13).rotateX(Math.PI / 2));
  } else {
    const key = PLACE.trees[treeIndex]?.fruit || 'peach';
    const fm = toon(FRUITS[key].color);
    if (key === 'cherry') {
      inner.add(mesh(GEO.sphereLo, fm, -0.12, 0.17, 0, 0.17));
      inner.add(mesh(GEO.sphereLo, fm, 0.13, 0.17, 0.04, 0.17));
    } else {
      inner.add(mesh(GEO.sphereLo, fm, 0, 0.25, 0, 0.28, 0.26, 0.28));
      inner.add(mesh(GEO.sphereLo, toon('#4c9a3a'), 0.08, 0.53, 0, 0.12, 0.04, 0.07));
    }
  }
  g.add(blob(0.9));
  return { g, inner };
}
function addDrop(d, animate) {
  if (drops.has(d.id)) return;
  const { x, z } = dropSpot(d.tree, d.slot);
  const { g, inner } = makeDropObj(d.kind, d.tree);
  g.position.set(x, standHeight(x, z), z);
  scene.add(g);
  drops.set(d.id, { ...d, obj: g, inner, x, z, t0: animate ? performance.now() / 1000 + d.slot * 0.08 : -99 });
}
function removeDrop(id) {
  const d = drops.get(id);
  if (!d) return;
  drops.delete(id);
  scene.remove(d.obj);
}

// =====================================================================
// 人（自分とみんな）と、頭の上の表示
// =====================================================================
const overlay = $('#overlay');
const people = new Map(); // id -> person
let me = null;
let myId = null;

function tagColor(name) { return TAG_COLORS[hashStr(name) % TAG_COLORS.length]; }

function createPerson(id, name, look, x, z, r, isMe, npc = false) {
  // 島にくる人は みんな MOMO。どうぶつの見た目は住民だけ
  // 色はサーバーが有料プランかどうかを確かめてから配る。サーバーがないとき（claude.ai のページ・ひとり）は無料の色にそろえる
  if (!npc) {
    const verified = net && net.mode === 'server';
    const f = Number.isInteger(look?.f) && look.f >= 0 && look.f < MOMO_ACCENT.length ? look.f : FREE_COLOR;
    look = { s: 'momo', f: verified || isMe ? f : FREE_COLOR, c: 0 };
  }
  const v = makeVillager(look);
  v.root.scale.setScalar(1.2);
  v.root.position.set(x, standHeight(x, z), z);
  v.root.rotation.y = r;
  scene.add(v.root);
  const wrap = document.createElement('div');
  wrap.className = 'tagwrap';
  const tag = document.createElement('div');
  tag.className = 'nametag' + (isMe ? ' me' : npc ? ' npc' : '');
  tag.textContent = `${RANKS[0].mark} ${name}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = name;
  who.style.setProperty('--c', tagColor(name));
  const text = document.createElement('span');
  bubble.append(who, text);
  const emote = document.createElement('div');
  emote.className = 'emote';
  wrap.append(tag, bubble, emote);
  overlay.appendChild(wrap);
  const p = {
    id, name, look, v, wrap, tag, bubble, text, emote, isMe,
    x, z, r, tx: x, tz: z, tr: r, speed: 0,
    sayUntil: 0, emoteUntil: 0, typer: null,
    voice: (VOICE[look.s] || 1) * (0.9 + (hashStr(name) % 20) / 100),
    robot: look.s === 'momo',
  };
  if (!npc) people.set(id, p);
  return p;
}
// ランクのマークは、名前の横にいつも出す
function setRank(p, r) {
  const rank = RANKS[Math.max(0, Math.min(RANKS.length - 1, Number(r) || 0))];
  p.rank = RANKS.indexOf(rank);
  p.tag.textContent = `${rank.mark} ${p.name}`;
  p.tag.title = `ランク：${rank.name}`;
}
function removePerson(id) {
  const p = people.get(id);
  if (!p) return;
  scene.remove(p.v.root);
  p.wrap.remove();
  clearInterval(p.typer);
  people.delete(id);
}

function say(p, text, log = true) {
  clearInterval(p.typer);
  p.text.textContent = '';
  p.bubble.classList.add('on');
  const chars = [...text];
  let i = 0;
  p.typer = setInterval(() => {
    p.text.textContent += chars[i++] || '';
    if (i >= chars.length) clearInterval(p.typer);
  }, 58);
  const dur = 2.6 + chars.length * 0.13;
  p.sayUntil = performance.now() / 1000 + dur;
  p.v.talk(Math.min(chars.length * 0.058 + 0.1, 5));
  const dist = me ? Math.hypot(p.x - me.x, p.z - me.z) : 0;
  sound.speak(text, p.voice, clamp(1 - dist / 30, 0, 1), p.robot);
  if (log) addLog(p.name, text, tagColor(p.name));
}

function doEmote(p, key) {
  const e = EMOTES.find((x) => x.key === key);
  if (!e) return;
  p.emote.textContent = e.icon;
  p.emote.classList.remove('on');
  void p.emote.offsetWidth;
  p.emote.classList.add('on');
  p.emoteUntil = performance.now() / 1000 + 2.6;
  if (key === 'wave') p.v.wave();
  else if (['happy', 'wow', 'love', 'music'].includes(key)) p.v.hop();
  const dist = me ? Math.hypot(p.x - me.x, p.z - me.z) : 0;
  if (dist < 25) sound.pop();
}

function addLog(name, text, color) {
  const log = $('#log');
  const row = document.createElement('div');
  if (name) {
    const b = document.createElement('b');
    b.textContent = name;
    b.style.color = color;
    row.append(b, document.createTextNode(text));
  } else {
    row.className = 'sys';
    row.textContent = text;
  }
  log.appendChild(row);
  while (log.children.length > 8) log.firstChild.remove();
}

let toastTimer = 0;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}

// =====================================================================
// ポケット（果物とポカは、この端末に保存）
// =====================================================================
// サーバーにつながっているときは、ポケットの中身はサーバーが持っている（端末では書きかえられない）。
// ひとりモード・claude.ai のページ版では、この端末に保存する。
let pocket = store.get('pocket', { fruit: {}, coins: 0 });
if (!Number.isFinite(pocket.coins)) pocket.coins = Number(pocket.bells) || 0;
if (!pocket.gems || typeof pocket.gems !== 'object') pocket.gems = {};
delete pocket.bells;
const serverMode = () => !!net && net.mode === 'server';
function savePocket() { if (!serverMode()) savePocket(); }
let myPlot = null;           // 自分の土地の番号
let accountToken = store.get('token', null);
const formatCode = (t) => (t || '').match(/.{1,5}/g)?.join('-') || '';
if (!pocket.fish || typeof pocket.fish !== 'object') pocket.fish = {};
if (!pocket.bugs || typeof pocket.bugs !== 'object') pocket.bugs = {};
if (!pocket.dex || typeof pocket.dex !== 'object') pocket.dex = { fish: {}, bug: {}, gem: {} };
for (const k of Object.keys(pocket.gems)) pocket.dex.gem[k] ||= Date.now();
// 持ちものは、種類ごとの数だけ出す（くわしくは よろず屋で見られる）
function renderPocket() {
  $('#coinCount').textContent = pocket.coins.toLocaleString('ja-JP');
  const box = $('#fruits');
  box.textContent = '';
  const sum = (bag) => Object.values(bag || {}).reduce((t, n) => t + (n || 0), 0);
  for (const [icon, label, n] of [['🍑', 'くだもの', sum(pocket.fruit)], ['🐟', '魚', sum(pocket.fish)], ['🐛', '虫', sum(pocket.bugs)], ['💎', '宝石', sum(pocket.gems)]]) {
    if (!n) continue;
    const chip = document.createElement('span');
    chip.className = 'pill fchip';
    chip.title = label;
    chip.textContent = `${icon} ×${n}`;
    box.appendChild(chip);
  }
}

// =====================================================================
// 通信
// =====================================================================
let net = null;
function handle(msg) {
  switch (msg.t) {
    case 'welcome': {
      // つなぎなおしたときも、ここで島のようすを最新にする
      for (const id of [...people.keys()]) if (people.get(id) !== me) removePerson(id);
      for (const id of [...drops.keys()]) removeDrop(id);
      people.delete(me.id);
      myId = msg.id;
      me.id = myId;
      people.set(myId, me);
      for (const p of msg.players || []) if (!people.has(p.id)) { const q = createPerson(p.id, p.name, p.look, p.x, p.z, p.r, false); q.m = p.m; setRank(q, p.rank); }
      for (const [i, n] of msg.world?.trees || []) setTreeFruit(i, n);
      for (const d of msg.world?.drops || []) addDrop(d, false);
      gemMinedUntil.clear();
      for (const [i, left] of msg.world?.gems || []) gemMinedUntil.set(i, Date.now() + left);
      refreshGems();
      if (msg.token) { accountToken = msg.token; store.set('token', accountToken); }
      if (msg.pass && !pass) { pass = msg.pass; store.set('pass', pass); premium = true; }
      if (msg.me) applyMe(msg.me);
      if (msg.plots) applyPlots(msg.plots);
      if (msg.bugs) applyBugs(msg.bugs);
      if (!serverMode()) setRank(me, rankOf(pocket.dex).i);
      updateOnline();
      break;
    }
    case 'join':
      if (!people.has(msg.p.id)) {
        { const q = createPerson(msg.p.id, msg.p.name, msg.p.look, msg.p.x, msg.p.z, msg.p.r, false); q.m = msg.p.m; setRank(q, msg.p.rank); }
        addLog(null, `${msg.p.name} さんが島にやってきました`);
        updateOnline();
      }
      break;
    case 'leave': {
      const p = people.get(msg.id);
      if (p && !p.isMe) {
        addLog(null, `${p.name} さんが帰っていきました`);
        removePerson(msg.id);
        updateOnline();
      }
      break;
    }
    case 'state':
      for (const [id, x, z, r, m] of msg.ps) {
        const p = people.get(id);
        if (!p || p.isMe) continue;
        p.tx = x; p.tz = z; p.tr = r; p.m = m;
      }
      break;
    case 'chat': {
      const p = people.get(msg.id);
      if (p) say(p, msg.text);
      break;
    }
    case 'emote': {
      const p = people.get(msg.id);
      if (p) doEmote(p, msg.e);
      break;
    }
    case 'shake': {
      const o = treeObjs[msg.i];
      if (o) {
        o.shakeT = 0.9;
        setTreeFruit(msg.i, msg.fruit);
        const d = me ? Math.hypot(o.t.x - me.x, o.t.z - me.z) : 0;
        if (d < 22) sound.rustle();
      }
      const p = people.get(msg.id);
      if (p && !p.isMe) p.v.shake();
      (msg.drops || []).forEach((d) => addDrop(d, true));
      if (msg.drops?.length) setTimeout(() => sound.thud(), 450);
      break;
    }
    case 'picked':
      removeDrop(msg.id);
      break;
    case 'hit': {
      // ほかの人がピッケルをふった
      const p = people.get(msg.id);
      if (!p || p.isMe || !GEM_SPOTS[msg.i]) break;
      p.v.swing();
      const g = gemWorldPos(msg.i);
      const near = me && Math.hypot(g.x - me.x, g.z - me.z) < 20;
      setTimeout(() => { if (near) { sound.clink(0.6); spawnSparks(g.x, 0.7, g.z + 0.3, '#ffe9a8', 5); } }, 230);
      break;
    }
    case 'gem': {
      const i = msg.i;
      if (!GEM_SPOTS[i]) break;
      gemMinedUntil.set(i, Date.now() + (Number(msg.regrow) || 600000));
      refreshGems();
      const g = gemWorldPos(i);
      const kind = GEM_KINDS.find((k) => k.key === msg.kind) || GEM_KINDS[0];
      spawnSparks(g.x, 0.7, g.z + 0.3, kind.color, 16, 4);
      if (msg.id === myId) {
        if (!serverMode()) { pocket.gems[kind.key] = (pocket.gems[kind.key] || 0) + 1; addLocalDex('gem', kind.key); }
        if (msg.first || (!serverMode() && localFirst)) setTimeout(() => toast(`📖 ${kind.name}が 図鑑に のったよ！`), 1600);
        savePocket();
        renderPocket();
        sound.sparkle();
        toast(`${kind.name}を ほりあてた！`);
      } else {
        const p = people.get(msg.id);
        if (p) p.v.swing();
      }
      break;
    }
    case 'got': {
      if (msg.kind === 'coin') {
        const amt = msg.amount || [100, 200, 300, 500, 1000][Math.floor(Math.random() * 5)];
        if (!serverMode()) pocket.coins += amt;
        toast(`${amt.toLocaleString('ja-JP')} ポカを手に入れた！`);
        sound.coins();
      } else {
        const key = PLACE.trees[msg.tree]?.fruit || 'peach';
        if (!serverMode()) pocket.fruit[key] = (pocket.fruit[key] || 0) + 1;
        toast(`${FRUITS[key].name}を手に入れた！`);
        sound.pop();
      }
      savePocket();
      renderPocket();
      break;
    }
    case 'full':
      toast('島がいっぱいです。少し待ってからまた来てね');
      break;
    case 'me':
      applyMe(msg.me);
      break;
    case 'bugs':
      applyBugs(msg.list, msg.fled);
      break;
    case 'caught':
      onCaught(msg);
      break;
    case 'rank': {
      const p = people.get(msg.id);
      if (p && !p.isMe) setRank(p, msg.rank);
      break;
    }
    case 'plots':
      applyPlots(msg.plots);
      break;
    case 'chest':
      if (msg.amount > 0) { toast(`宝箱に ${msg.amount.toLocaleString('ja-JP')} ポカ 入っていた！`); sound.coins(); }
      else { toast('宝箱はからっぽ… また明日来てね'); sound.click(); }
      break;
    case 'sold':
      if (msg.gained > 0) { toast(`${msg.gained.toLocaleString('ja-JP')} ポカで 売れました！`); sound.coins(); }
      renderShop();
      break;
    case 'plotResult':
      onPlotResult(msg);
      break;
    case 'dup':
      // 同じアカウントで ほかの画面から入った
      net.stop?.();
      toast('ほかの画面で この島に入ったので、ここは切断しました');
      addLog(null, 'ほかの画面で同じアカウントが使われたので、切断しました。この画面を使うときは、ページを開きなおしてください。');
      $('#online').classList.add('offline');
      $('#onlineText').textContent = '切断しました';
      break;
  }
}

function updateOnline() {
  const el = $('#online');
  const text = $('#onlineText');
  el.classList.remove('solo', 'offline');
  if (!net) { text.textContent = '…'; return; }
  const n = people.size;
  text.textContent = '';
  const lbl = document.createElement('span');
  lbl.className = 'lbl';
  if (net.mode === 'solo') {
    el.classList.add('solo');
    lbl.textContent = 'ひとりで';
    text.append(lbl, '遊んでいます');
  } else {
    lbl.textContent = '島にいる人 ';
    text.append(lbl, `${n}人`);
  }
}

// =====================================================================
// 入力
// =====================================================================
const keys = new Set();
let clickTarget = null;
let stickVec = { x: 0, y: 0 };
let zoom = 1;
const chatInput = $('#chat');

addEventListener('keydown', (e) => {
  if (document.activeElement === chatInput || document.activeElement === $('#name')) {
    if (e.key === 'Escape') chatInput.blur();
    return;
  }
  if (!me) return;
  if (dialog.open) {
    if (['e', 'E', ' ', 'z', 'Z', 'Enter'].includes(e.key)) { e.preventDefault(); if (!e.repeat) advanceDialog(); }
    return;
  }
  if (e.key === 'm' || e.key === 'M') { toggleMap(); return; }
  if (e.key === 'b' || e.key === 'B') { openDex(); return; }
  if (e.key === 'Enter') { e.preventDefault(); chatInput.focus(); return; }
  if (e.key === 'Escape') { closeModals(); return; }
  if (/^[1-8]$/.test(e.key)) { sendEmote(EMOTES[+e.key - 1].key); return; }
  if (['e', 'E', ' ', 'z', 'Z'].includes(e.key)) { e.preventDefault(); if (!e.repeat) action(); return; }
  keys.add(e.code);
  if (e.code.startsWith('Arrow')) e.preventDefault();
  clickTarget = null;
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

$('#chatform').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text && net) net.send({ t: 'chat', text });
  chatInput.value = '';
  chatInput.blur();
});

// 落ちている果物の近くをクリック／タップしたら、そこまで歩いて拾う
function setClickTarget(p) {
  let best = null, bd = 1.3;
  for (const d of drops.values()) {
    const dist = Math.hypot(d.x - p.x, d.z - p.z);
    if (dist < bd) { bd = dist; best = d; }
  }
  clickTarget = best ? { x: best.x, z: best.z, pickId: best.id } : p;
}
const pickRequested = new Set();
function requestPick(id) {
  if (pickRequested.has(id) || !net) return;
  pickRequested.add(id);
  setTimeout(() => pickRequested.delete(id), 3000);
  net.send({ t: 'pick', id });
}

const raycaster = new THREE.Raycaster();
function pickGround(cx, cy) {
  const ndc = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  for (let t = 1; t < 220; t += 0.2) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y <= Math.max(groundHeight(x, z), WATER_Y) - curveY(z)) return { x, z };
  }
  return null;
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  closeEmotes();
  if (!me || e.pointerType === 'touch' || e.button !== 0) return;
  const p = pickGround(e.clientX, e.clientY);
  if (p) setClickTarget(p);
});
renderer.domElement.addEventListener('wheel', (e) => {
  zoom = clamp(zoom * (e.deltaY > 0 ? 1.08 : 0.93), 0.6, 1.6);
}, { passive: true });

// タッチ：スティックと、2本指ズーム
const stick = $('#stick'), knob = stick.querySelector('i');
let stickId = null;
stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); });
stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
const endStick = (e) => { if (e.pointerId !== stickId) return; stickId = null; stickVec = { x: 0, y: 0 }; knob.style.transform = ''; };
stick.addEventListener('pointerup', endStick);
stick.addEventListener('pointercancel', endStick);
function moveStick(e) {
  const r = stick.getBoundingClientRect();
  let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  stickVec = { x, y };
  knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
  clickTarget = null;
}
$('#actBtn').addEventListener('click', () => (dialog.open ? advanceDialog() : action()));
let pinch = null;
renderer.domElement.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), z: zoom };
}, { passive: true });
renderer.domElement.addEventListener('touchmove', (e) => {
  if (pinch && e.touches.length === 2) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    zoom = clamp(pinch.z * (pinch.d / d), 0.6, 1.6);
  }
}, { passive: true });
renderer.domElement.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) pinch = null;
}, { passive: true });
// タッチでのタップ移動
renderer.domElement.addEventListener('click', (e) => {
  if (!me || !isTouch) return;
  const p = pickGround(e.clientX, e.clientY);
  if (p) setClickTarget(p);
});

// リアクション
const emotesBox = $('#emotes');
EMOTES.forEach((em, k) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.title = `${em.name}（${k + 1}）`;
  b.append(em.icon);
  const s = document.createElement('span');
  s.textContent = em.name;
  b.appendChild(s);
  b.addEventListener('click', () => { sendEmote(em.key); closeEmotes(); });
  emotesBox.appendChild(b);
});
$('#emoteBtn').addEventListener('click', (e) => { e.stopPropagation(); emotesBox.classList.toggle('on'); sound.click(); });
function closeEmotes() { emotesBox.classList.remove('on'); }
let lastEmote = 0;
function sendEmote(key) {
  if (!net || performance.now() - lastEmote < 450) return;
  lastEmote = performance.now();
  net.send({ t: 'emote', e: key });
}

// HUDのボタン
function syncSoundButtons() {
  $('#bgmBtn').classList.toggle('off', !sound.bgmOn);
  $('#seBtn').classList.toggle('off', !sound.seOn);
}
$('#bgmBtn').addEventListener('click', () => { sound.setBgm(!sound.bgmOn); store.set('bgm', sound.bgmOn); syncSoundButtons(); });
$('#seBtn').addEventListener('click', () => { sound.setSe(!sound.seOn); store.set('se', sound.seOn); syncSoundButtons(); sound.click(); });
syncSoundButtons();

// ボタンにフォーカスが残ると、スペースキーでもう一度押されてしまうので外す
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('button');
  if (b && b.id !== 'go') b.blur();
});
// タブを離れているあいだは音を止める
document.addEventListener('visibilitychange', () => {
  if (!sound.ctx) return;
  if (document.hidden) sound.ctx.suspend(); else sound.ctx.resume();
});

function openModal(id) { $(id).classList.add('on'); sound.open(); keys.clear(); }
function closeModals() { document.querySelectorAll('.modal.on').forEach((m) => m.classList.remove('on')); }
document.querySelectorAll('.modal').forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-close')) closeModals(); });
});
$('#helpBtn').addEventListener('click', () => {
  $('#shareUrl').value = location.href.split('#')[0];
  $('#accountBox').hidden = !(serverMode() && accountToken);
  $('#myCode').value = formatCode(accountToken);
  $('#shareNote').textContent = net?.mode === 'solo'
    ? 'いまはひとりモードです。サーバー（server.js）で開くと、URLを送った友だちと同じ島で会えます。'
    : 'このページのURLを友だちに送ると、同じ島で会えます。';
  openModal('#helpModal');
});
$('#copyCode').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#myCode').value); toast('引き継ぎコードをコピーしました'); }
  catch { $('#myCode').select(); }
});
// 引き継ぎコードで続きから：本物か確かめてから、この端末に保存する
$('#joinCodeOpen').addEventListener('click', () => { $('#joinCodeForm').hidden = false; $('#joinCodeInput').focus(); });
$('#joinCodeGo').addEventListener('click', async () => {
  const code = $('#joinCodeInput').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 16) { $('#status').textContent = 'コードが短すぎます。もう一度確かめてください。'; return; }
  const r = await api('/api/account?code=' + encodeURIComponent(code));
  if (r && r.ok) {
    accountToken = code; store.set('token', code);
    $('#joinCodeForm').hidden = true;
    $('#status').textContent = '✅ 引き継ぎコードを確認しました。「島へ行く」で続きから遊べます。';
  } else {
    $('#status').textContent = r ? 'そのコードは見つかりませんでした。' : 'いまはコードを確認できません（サーバーにつながっていません）。';
  }
});
$('#copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#shareUrl').value); toast('URLをコピーしました'); }
  catch { $('#shareUrl').select(); }
});

// =====================================================================
// アクション：ひろう／ゆらす／読む
// =====================================================================
function findTarget() {
  if (!me || transitioning) return null;
  if (layerOf(me.x) === 'under') {
    const lx = me.x - UNDER_X;
    for (const sp of UNDER_SPOTS) if (Math.hypot(lx - sp.x, me.z - sp.z) < 1.9) return { type: 'up', sp };
    if (Math.hypot(lx - CHEST.x, me.z - CHEST.z) < 2.0) return { type: 'chest' };
    if (!hasPickaxe && Math.hypot(lx - PICKAXE_SPOT.x, me.z - PICKAXE_SPOT.z) < 1.7) return { type: 'pickaxe' };
    let best = null, bd = 1.9;
    gemObjs.forEach((o, i) => {
      if (!o.visible) return;
      const d = Math.hypot(lx - o.sp.x, me.z - o.sp.z);
      if (d < bd) { bd = d; best = { type: 'mine', i }; }
    });
    return best;
  }
  const room = interiorAt(me.x);
  if (room) {
    if (me.seat) return { type: 'stand' };
    const hatch = UNDER_SPOTS.find((sp) => sp.kind === 'hatch' && sp.room === room.i);
    if (hatch && Math.hypot(me.x - (room.x + hatch.hatch.x), me.z - (room.z + hatch.hatch.z)) < 1.3) return { type: 'down', sp: hatch };
    if (Math.abs(me.x - room.x) < 1.2 && me.z > room.z + ROOM.d / 2 - 1.3) return { type: 'exit' };
    const seat = seatsNear(me.x, me.z, 1.9).find((st) => !seatTaken(st));
    if (seat) return { type: 'seat', seat };
    return null;
  }
  let best = null, bd = 1.5;
  for (const d of drops.values()) {
    const dist = Math.hypot(d.x - me.x, d.z - me.z);
    if (dist < bd) { bd = dist; best = { type: 'pick', d }; }
  }
  if (best) return best;
  if (resident && Math.hypot(resident.x - me.x, resident.z - me.z) < 2.0) return { type: 'talk' };
  { const b = nearestBug(2.3); if (b) return { type: 'bug', id: b }; }
  for (const sp of UNDER_SPOTS) {
    if (sp.kind !== 'hatch' && Math.hypot(me.x - sp.x, me.z - sp.z) < 2.6) return { type: 'down', sp };
  }
  if (Math.hypot(me.x - SHOP.x, me.z - SHOP.z) < 2.4) return { type: 'shop' };
  for (const p of PLOTS) {
    if (plotOwned(p.i)) {
      const h = p.house;
      if (Math.abs(me.x - h.x) < 1.0 && Math.abs(me.z - (h.z + h.d / 2 + 0.55)) < 1.1) return { type: 'door', i: HOUSES.length + p.i };
    }
    if (Math.hypot(me.x - p.sign.x, me.z - p.sign.z) < 1.6) return { type: 'plot', i: p.i };
  }
  for (let i = 0; i < HOUSES.length; i++) {
    const d = doorOf(HOUSES[i]);
    if (Math.abs(me.x - d.x) < 1.0 && Math.abs(me.z - d.z) < 1.1) return { type: 'door', i };
  }
  const fx = Math.sin(me.r), fz = Math.cos(me.r);
  let bs = 99;
  for (const o of treeObjs) {
    const dx = o.t.x - me.x, dz = o.t.z - me.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 2.1 * o.t.s + 0.2) continue;
    const facing = (dx * fx + dz * fz) / dist;
    const score = dist - facing * 0.8;
    if (facing > -0.2 && score < bs) { bs = score; best = { type: 'shake', o }; }
  }
  if (best) return best;
  if (Math.hypot(BOARD.x - me.x, BOARD.z - me.z) < 2.2) return { type: 'board' };
  if (canFishHere()) return { type: 'fish' };
  return null;
}
let shakeCooldown = 0;
function action() {
  if (!me || !net) return;
  if (fishingAction()) return;
  const t = findTarget();
  if (!t) { me.v.hop(); return; }
  if (t.type === 'door') { enterHouse(t.i); return; }
  if (t.type === 'down') { enterUnder(t.sp); return; }
  if (t.type === 'up') { exitUnder(t.sp); return; }
  if (t.type === 'chest') { openChest(); return; }
  if (t.type === 'shop') { renderShop(); openModal('#shopModal'); return; }
  if (t.type === 'plot') { openPlotModal(t.i); return; }
  if (t.type === 'mine') { mineGem(t.i); return; }
  if (t.type === 'bug') { tryCatchBug(t.id); return; }
  if (t.type === 'fish') { startFishing(); return; }
  if (t.type === 'pickaxe') {
    hasPickaxe = true;
    store.set('pickaxe', true);
    if (pickaxeOnRack) pickaxeOnRack.visible = false;
    me.v.hop();
    sound.coins();
    toast('ピッケルを手に入れた！ 宝石の岩を ほってみよう');
    return;
  }
  if (t.type === 'exit') { exitHouse(); return; }
  if (t.type === 'talk') { startTalk(); return; }
  if (t.type === 'seat') { sitDown(t.seat); return; }
  if (t.type === 'stand') { standUp(); return; }
  if (t.type === 'pick') {
    requestPick(t.d.id);
    me.v.hop();
  } else if (t.type === 'shake') {
    if (performance.now() < shakeCooldown) return;
    shakeCooldown = performance.now() + 800;
    me.r = Math.atan2(t.o.t.x - me.x, t.o.t.z - me.z);
    me.v.shake();
    net.send({ t: 'shake', i: t.o.i, fruit: !!t.o.t.fruit });
  } else if (t.type === 'board') {
    $('#boardNow').textContent = net.mode === 'solo'
      ? 'いまは ひとりで遊んでいます。'
      : `いま島には ${people.size}人 がいます。`;
    openModal('#boardModal');
  }
}
$('#promptKey').textContent = isTouch ? 'A' : 'E';
let lastPrompt = null;
function updatePrompt() {
  if (fishing) {
    const label = fishing.phase === 'bite' ? 'いまだ！ つりあげる' : 'ウキが しずんだら おす';
    if (label !== lastPrompt) { lastPrompt = label; $('#prompt').classList.add('on'); $('#promptText').textContent = label; }
    return;
  }
  const t = findTarget();
  const label = !t ? '' : {
    pick: 'ひろう', board: 'けいじばんを読む', talk: `${RESIDENT.name}と はなす`, door: '家に入る', exit: '外に出る',
    stand: 'たちあがる', chest: '宝箱をあける', pickaxe: 'ピッケルをひろう', shop: 'よろず屋で売る',
    bug: t.id && (hasTool('net') ? `${BUGS.find((b) => b.key === bugObjs.get(t.id)?.key)?.name || '虫'}を つかまえる` : '虫がいる…（あみが ほしい）'),
    fish: hasTool('rod') ? 'つりをする' : 'ここで つりが できそう',
    plot: t.i !== undefined && (plotInfo[t.i]?.owner ? '看板を読む' : '売り地を見る'),
    mine: hasPickaxe ? 'ピッケルで ほる' : 'ピッケルがあれば ほれそう…',
    down: t.sp && (t.sp.kind === 'well' ? '井戸をおりる' : t.sp.kind === 'hatch' ? '床の扉からおりる' : 'ほらあなに入る'),
    up: t.sp && `はしごをのぼる（${t.sp.name}へ）`, seat: t.seat && (t.seat.pose === 'lie' ? 'ベッドでねころぶ' : t.seat.kind === 'sofa' ? 'ソファにすわる' : 'いすにすわる'),
  }[t.type] || (t.o.t.fruit && t.o.fruit > 0 ? '木をゆらす' : '木をゆらしてみる');
  if (label === lastPrompt) return;
  lastPrompt = label;
  $('#prompt').classList.toggle('on', !!label);
  if (label) $('#promptText').textContent = label;
}

// =====================================================================
// 住民との会話
// =====================================================================
let resident = null;
let talkCount = 0;
const dialog = { open: false, lines: [], idx: 0, typing: null, full: '' };
function startTalk() {
  if (!resident || dialog.open) return;
  dialog.open = true;
  dialog.lines = residentLines(me.name, currentHour(), talkCount++);
  dialog.idx = 0;
  keys.clear(); clickTarget = null; stickVec = { x: 0, y: 0 };
  me.r = Math.atan2(resident.x - me.x, resident.z - me.z);
  $('#dialogWho').textContent = RESIDENT.name;
  $('#dialog').classList.add('on');
  document.body.classList.add('talking');
  showLine();
}
function showLine() {
  const el = $('#dialogText');
  const text = dialog.lines[dialog.idx];
  const chars = [...text];
  dialog.full = text;
  el.textContent = '';
  $('#dialog').classList.remove('done');
  clearInterval(dialog.typing);
  let i = 0;
  dialog.typing = setInterval(() => {
    el.textContent += chars[i++] || '';
    if (i >= chars.length) { clearInterval(dialog.typing); dialog.typing = null; $('#dialog').classList.add('done'); }
  }, 50);
  sound.speak(text, RESIDENT.voice, 1);
  resident.v.talk(Math.min(chars.length * 0.058 + 0.1, 5));
}
function advanceDialog() {
  if (dialog.typing) {
    clearInterval(dialog.typing); dialog.typing = null;
    $('#dialogText').textContent = dialog.full;
    $('#dialog').classList.add('done');
    return;
  }
  dialog.idx++;
  if (dialog.idx < dialog.lines.length) { showLine(); return; }
  dialog.open = false;
  $('#dialog').classList.remove('on');
  document.body.classList.remove('talking');
  resident.v.hop();
}
$('#dialog').addEventListener('click', () => advanceDialog());

// ときどき、ひとりごと（近くにいる人にだけ聞こえる）
const MUTTER = ['ふんふん♪', 'いい天気だもち〜', 'おなか すいたもち…', 'ひまわりのたね、どこに しまったっけ', 'あっ、ちょうちょだもち！'];
let mutterAt = performance.now() / 1000 + 20;

// =====================================================================
// すわる・ねころぶ
// =====================================================================
function seatTaken(seat) {
  for (const p of people.values()) {
    if (!p.isMe && (p.m || 0) >= 3 && Math.hypot(p.tx - seat.wx, p.tz - seat.wz) < 0.5) return true;
  }
  return false;
}
function sitDown(seat) {
  me.seat = seat;
  me.x = seat.wx; me.z = seat.wz; me.r = seat.r;
  clickTarget = null;
  sound.step(1, 'wood');
}
function standUp() {
  if (!me.seat) return;
  const sp = standSpot(me.seat);
  me.seat = null;
  me.x = sp.x; me.z = sp.z;
  sound.step(1, 'wood');
}
// 他の人が すわっている／ねころんでいる家具
function seatOf(p) {
  if ((p.m || 0) < 3) return null;
  return seatsNear(p.x, p.z, 0.9)[0] || null;
}

// =====================================================================
// 家に入る・出る
// =====================================================================
let transitioning = false;
const INDOOR_BG = new THREE.Color('#1f1712');
const UNDER_BG = new THREE.Color('#0d0b10');
// いまいる場所：'surface'（島）/'room'（家の中）/'under'（地下）
function layerOf(x) { return x > UNDER_X - 500 ? 'under' : x > INDOOR_X ? 'room' : 'surface'; }
// 地下では MOMO の顔の画面がライトになる
const momoLamp = new THREE.PointLight('#c8fff0', 0, 14, 1.1);
scene.add(momoLamp);
function enterUnder(sp) {
  if (transitioning || !me) return;
  me.seat = null;
  sound.ladder();
  fadeThen(() => { const e = underEntry(sp); me.x = e.x; me.z = e.z; me.r = 0; });
}
function exitUnder(sp) {
  if (transitioning || !me) return;
  sound.ladder();
  fadeThen(() => { const e = surfaceExit(sp); me.x = e.x; me.z = e.z; me.r = 0; });
}
function openChest() {
  chestLid.target = 1;
  if (serverMode()) { net.send({ t: 'chest' }); return; }
  const today = new Date().toDateString();
  if (store.get('chestDay', '') === today) {
    toast('宝箱はからっぽ… また明日来てね');
    sound.click();
    return;
  }
  const amt = [300, 500, 800, 1000][Math.floor(Math.random() * 4)];
  pocket.coins += amt;
  savePocket();
  store.set('chestDay', today);
  renderPocket();
  toast(`宝箱に ${amt.toLocaleString('ja-JP')} ポカ 入っていた！`);
  sound.coins();
}
function fadeThen(fn) {
  transitioning = true;
  keys.clear(); clickTarget = null;
  $('#fade').classList.add('on');
  setTimeout(() => {
    fn();
    updateEnvironment();
    const goal = cameraGoal(0);
    camPos.copy(goal.pos); camLook.copy(goal.look);
    lastSent = '';
    setTimeout(() => { $('#fade').classList.remove('on'); transitioning = false; }, 150);
  }, 280);
}
function enterHouse(i) {
  if (transitioning || !me) return;
  me.seat = null;
  sound.door();
  fadeThen(() => {
    const r = INTERIORS[i];
    const e = roomEntry(r);
    me.x = e.x; me.z = e.z; me.r = Math.PI;
  });
}
function exitHouse() {
  if (transitioning || !me) return;
  me.seat = null;
  const r = interiorAt(me.x);
  if (!r) return;
  sound.door();
  fadeThen(() => {
    const d = doorOf(r.house);
    me.x = d.x; me.z = d.z + 0.5; me.r = 0;
  });
}
function updateEnvironment() {
  const layer = me ? layerOf(me.x) : 'surface';
  sky.visible = layer === 'surface';
  scene.background = layer === 'room' ? INDOOR_BG : layer === 'under' ? UNDER_BG : null;
  CURVE.uCurve.value = layer === 'room' ? 0.0012 : layer === 'under' ? 0 : 0.0055;
  scene.fog.near = layer === 'under' ? 9 : 60;
  scene.fog.far = layer === 'under' ? 34 : 120;
  momoLamp.intensity = layer === 'under' ? 6 : 0;
  applyDayNight();
}

// =====================================================================
// 地図
// =====================================================================
const MAP_E = 54; // 地図にうつす範囲（±）
const mapCanvas = $('#map');
const mapCtx = mapCanvas.getContext('2d');
let mapBase = null;
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
}
function buildMapBase() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const SEA = hex('#7fd0e6'), RIVER = hex('#67bfe2'), SAND = hex('#f3e5b8'), GRASS = hex('#95d27a'), GRASS2 = hex('#86c86c'), PATH = hex('#e2cb96');
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const x = -MAP_E + ((px + 0.5) / S) * 2 * MAP_E, z = -MAP_E + ((py + 0.5) / S) * 2 * MAP_E;
    const h = groundHeight(x, z), d = islandSDF(x, z);
    let c2;
    if (h < WATER_Y) c2 = d > -7.5 ? SEA : RIVER;
    else if (d > -7.4) c2 = SAND;
    else if (pathDist(x, z) < 1.1) c2 = PATH;
    else c2 = z < -22 ? GRASS2 : GRASS;
    const o = (py * S + px) * 4;
    img.data[o] = c2[0]; img.data[o + 1] = c2[1]; img.data[o + 2] = c2[2]; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const k = S / (2 * MAP_E);
  const P = (x, z) => [(x + MAP_E) * k, (z + MAP_E) * k];
  // 広場
  g.fillStyle = '#efe4c9';
  g.beginPath(); g.arc(...P(PLAZA.x, PLAZA.z), PLAZA.r * k, 0, 7); g.fill();
  g.fillStyle = '#4c9a47';
  g.beginPath(); g.arc(...P(TOWN_TREE.x, TOWN_TREE.z), 2.2 * k, 0, 7); g.fill();
  // 橋
  g.fillStyle = '#b3824f';
  for (const b of BRIDGES) {
    g.save(); g.translate(...P(b.x, b.z)); g.rotate(-b.rot);
    g.fillRect(-b.len / 2 * k, -b.wid / 2 * k, b.len * k, b.wid * k);
    g.restore();
  }
  // 地下への入り口
  for (const sp of UNDER_SPOTS) {
    if (sp.kind === 'hatch') continue;
    const [ex, ey] = P(sp.x, sp.z);
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(ex, ey, 4.2, 0, 7); g.fill();
    g.fillStyle = sp.kind === 'well' ? '#7c8a99' : '#5b4a3c'; g.beginPath(); g.arc(ex, ey, 2.8, 0, 7); g.fill();
  }
  // 家
  for (const h of HOUSES) {
    const [cx, cy] = P(h.x, h.z);
    const w = (h.w + 1) * k, dd = (h.d + 1) * k;
    g.fillStyle = '#ffffff';
    g.beginPath(); g.roundRect(cx - w / 2 - 2, cy - dd / 2 - 2, w + 4, dd + 4, 5); g.fill();
    g.fillStyle = h.roof;
    g.beginPath(); g.roundRect(cx - w / 2, cy - dd / 2, w, dd, 4); g.fill();
  }
  mapBase = c;
}
function mapPos(x, z) {
  if (layerOf(x) === 'under') x -= UNDER_X;
  // 家の中にいる人は、その家の場所に出す
  const r = interiorAt(x);
  if (r) { const d = doorOf(r.house); x = d.x; z = d.z - 1.5; }
  return [(x + MAP_E) / (2 * MAP_E), (z + MAP_E) / (2 * MAP_E)];
}
function drawMap() {
  const box = $('#mapbox');
  const cssW = mapCanvas.clientWidth;
  const dpr = Math.min(window.devicePixelRatio, 2);
  if (mapCanvas.width !== Math.round(cssW * dpr)) { mapCanvas.width = mapCanvas.height = Math.round(cssW * dpr); }
  const W = mapCanvas.width;
  const g = mapCtx;
  g.clearRect(0, 0, W, W);
  g.imageSmoothingEnabled = true;
  const under = me && layerOf(me.x) === 'under';
  if (mapBase) {
    g.globalAlpha = under ? 0.28 : 1;
    g.drawImage(mapBase, 0, 0, W, W);
    g.globalAlpha = 1;
  }
  if (under) {
    // 地下では通路の地図
    const k = W / (2 * MAP_E), P = (x, z) => [(x + MAP_E) * k, (z + MAP_E) * k];
    g.fillStyle = 'rgba(30,24,20,0.45)'; g.fillRect(0, 0, W, W);
    g.strokeStyle = '#e8d9b6'; g.lineCap = 'round'; g.lineWidth = TUNNEL_W * 2 * k;
    for (const [a, b] of UNDER_EDGES) { g.beginPath(); g.moveTo(...P(...UNDER_NODES[a])); g.lineTo(...P(...UNDER_NODES[b])); g.stroke(); }
    g.fillStyle = '#e8d9b6';
    for (const [key, r] of Object.entries(UNDER_ROOMS)) { g.beginPath(); g.arc(...P(...UNDER_NODES[key]), r * k, 0, 7); g.fill(); }
    g.fillStyle = '#8a5a32';
    for (const sp of UNDER_SPOTS) { const [px, py] = P(sp.x, sp.z); g.fillRect(px - 2 * dpr, py - 3 * dpr, 4 * dpr, 6 * dpr); }
    g.fillStyle = '#e4b43c';
    { const [px, py] = P(CHEST.x, CHEST.z); g.fillRect(px - 3 * dpr, py - 2 * dpr, 6 * dpr, 4 * dpr); }
  }
  const dot = (x, z, color, rad) => {
    const [u, v] = mapPos(x, z);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(u * W, v * W, rad + 2 * dpr, 0, 7); g.fill();
    g.fillStyle = color;
    g.beginPath(); g.arc(u * W, v * W, rad, 0, 7); g.fill();
  };
  const big = box.classList.contains('big');
  const R = (big ? 5 : 3.2) * dpr;
  if (!under) {
    // 土地：空き地は点線、家が建っている所は屋根の色
    const k = W / (2 * MAP_E), P = (x, z) => [(x + MAP_E) * k, (z + MAP_E) * k];
    for (const p of PLOTS) {
      const [cx, cy] = P(p.x, p.z), hs = (PLOT_SIZE / 2) * k;
      const info = plotInfo[p.i];
      if (info.owner) {
        g.fillStyle = '#ffffff'; g.fillRect(cx - hs * 0.8 - dpr, cy - hs * 0.8 - dpr, hs * 1.6 + 2 * dpr, hs * 1.6 + 2 * dpr);
        g.fillStyle = MOMO_ACCENT[info.color] || MOMO_ACCENT[0]; g.fillRect(cx - hs * 0.8, cy - hs * 0.8, hs * 1.6, hs * 1.6);
        if (p.i === myPlot) { g.strokeStyle = '#1fc3b3'; g.lineWidth = 2 * dpr; g.strokeRect(cx - hs, cy - hs, hs * 2, hs * 2); }
      } else {
        g.setLineDash([2 * dpr, 2 * dpr]); g.strokeStyle = 'rgba(114,93,66,0.7)'; g.lineWidth = dpr;
        g.strokeRect(cx - hs, cy - hs, hs * 2, hs * 2); g.setLineDash([]);
      }
    }
    // よろず屋
    const [sx, sy] = P(SHOP.x, SHOP.z);
    g.fillStyle = '#ffffff'; g.fillRect(sx - 4 * dpr, sy - 3 * dpr, 8 * dpr, 6 * dpr);
    g.fillStyle = '#e2574c'; g.fillRect(sx - 3 * dpr, sy - 2 * dpr, 6 * dpr, 4 * dpr);
  }
  // 同じ階（地上か地下か）にいる人だけ出す
  const same = (x) => (layerOf(x) === 'under') === !!under;
  for (const p of people.values()) if (!p.isMe && same(p.x)) dot(p.x, p.z, tagColor(p.name), R);
  if (resident && !under) dot(resident.x, resident.z, '#e2a91e', R);
  if (me) {
    const [u, v] = mapPos(me.x, me.z);
    const t = performance.now() / 1000;
    g.fillStyle = 'rgba(31,195,179,0.25)';
    g.beginPath(); g.arc(u * W, v * W, R * (2.2 + Math.sin(t * 4) * 0.4), 0, 7); g.fill();
    g.save();
    g.translate(u * W, v * W);
    g.rotate(Math.atan2(Math.cos(me.r), Math.sin(me.r)));
    const a = R * 1.9;
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(a + 3 * dpr, 0); g.lineTo(-a * 0.8 - 2 * dpr, a * 0.9 + 2 * dpr); g.lineTo(-a * 0.35, 0); g.lineTo(-a * 0.8 - 2 * dpr, -a * 0.9 - 2 * dpr); g.closePath(); g.fill();
    g.fillStyle = '#1fc3b3';
    g.beginPath(); g.moveTo(a, 0); g.lineTo(-a * 0.8, a * 0.9); g.lineTo(-a * 0.35, 0); g.lineTo(-a * 0.8, -a * 0.9); g.closePath(); g.fill();
    g.restore();
  }
}
function whereName(x, z) {
  if (layerOf(x) === 'under') {
    const lx = x - UNDER_X;
    if (Math.hypot(lx - UNDER_NODES.T[0], z - UNDER_NODES.T[1]) < UNDER_ROOMS.T + 0.5) return '地下の宝箱の部屋';
    const sp = UNDER_SPOTS.find((s2) => Math.hypot(lx - s2.x, z - s2.z) < UNDER_ROOMS[s2.key] + 0.5);
    return sp ? `地下通路（${sp.name}の下）` : '地下通路';
  }
  const r = interiorAt(x);
  if (r) return `${r.house.name}の中`;
  if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 1) return 'ひろば';
  if (onBridge(x, z)) return '橋の上';
  if (Math.hypot(x - SHOP.x, z - SHOP.z) < 3) return 'よろず屋のまえ';
  const plot = PLOTS.find((p) => Math.abs(x - p.x) < PLOT_SIZE / 2 + 0.8 && Math.abs(z - p.z) < PLOT_SIZE / 2 + 1.2);
  if (plot) return plotInfo[plot.i].owner ? `${plotInfo[plot.i].owner}の土地` : `売り地 No.${plot.i + 1}`;
  for (const h of HOUSES) if (Math.abs(x - h.x) < h.w / 2 + 2.5 && Math.abs(z - h.z) < h.d / 2 + 3) return `${h.name}のまえ`;
  if (pondDist(x, z) < 3) return '池のほとり';
  if (riverDist(x, z) < RIVER_W + 3) return '川べり';
  if (islandSDF(x, z) > -7.4) return '砂浜';
  const ns = z < -15 ? '北' : z > 15 ? '南' : '';
  const ew = x < -15 ? '西' : x > 15 ? '東' : '';
  return ns || ew ? `島の${ns}${ew}のほう` : '島のまんなか';
}
let lastWhere = '';
function updateWhere() {
  if (!me) return;
  const w = whereName(me.x, me.z);
  if (w !== lastWhere) { lastWhere = w; $('#where').textContent = `📍 ${w}`; }
}
function toggleMap() { $('#mapbox').classList.toggle('big'); sound.click(); }
mapCanvas.addEventListener('click', toggleMap);

// =====================================================================
// 昼と夜
// =====================================================================
const SKY_KEYS = [
  { h: 0, top: '#0f1c44', bot: '#2c4580', sun: '#8fa3e6', sunI: 0.7, hTop: '#6d7fc0', hBot: '#243457', hI: 1.1, water: 0.5, night: 1 },
  { h: 4.3, top: '#0f1c44', bot: '#2c4580', sun: '#8fa3e6', sunI: 0.7, hTop: '#6d7fc0', hBot: '#243457', hI: 1.1, water: 0.5, night: 1 },
  { h: 5.6, top: '#5a7fc4', bot: '#f9c9b6', sun: '#ffc8a0', sunI: 1.3, hTop: '#ffe2d0', hBot: '#7f9a78', hI: 1.3, water: 0.82, night: 0.3 },
  { h: 7.2, top: '#62c3f2', bot: '#d3f0fb', sun: '#fff6e0', sunI: 1.9, hTop: '#ffffff', hBot: '#9bc27a', hI: 1.5, water: 1, night: 0 },
  { h: 15.8, top: '#62c3f2', bot: '#d3f0fb', sun: '#fff6e0', sunI: 1.9, hTop: '#ffffff', hBot: '#9bc27a', hI: 1.5, water: 1, night: 0 },
  { h: 17.3, top: '#7a9ee0', bot: '#ffd29a', sun: '#ffc07a', sunI: 1.7, hTop: '#fff0dc', hBot: '#a0b27a', hI: 1.4, water: 0.95, night: 0.05 },
  { h: 18.5, top: '#4a5ca6', bot: '#eeb09a', sun: '#ff9c70', sunI: 1.2, hTop: '#ffc7b0', hBot: '#6b7a6a', hI: 1.2, water: 0.75, night: 0.4 },
  { h: 19.8, top: '#0f1c44', bot: '#2c4580', sun: '#8fa3e6', sunI: 0.7, hTop: '#6d7fc0', hBot: '#243457', hI: 1.1, water: 0.5, night: 1 },
  { h: 24, top: '#0f1c44', bot: '#2c4580', sun: '#8fa3e6', sunI: 0.7, hTop: '#6d7fc0', hBot: '#243457', hI: 1.1, water: 0.5, night: 1 },
];
const cA = new THREE.Color(), cB = new THREE.Color();
const WINDOW_DAY = new THREE.Color('#bfe6f5'), WINDOW_NIGHT = new THREE.Color('#ffd98a');
const LAMP_DAY = new THREE.Color('#f6eed2'), LAMP_NIGHT = new THREE.Color('#ffe08a');
const IN_WINDOW_NIGHT = new THREE.Color('#2b3f73');
const sunOffset = new THREE.Vector3(0, 34, 18);
let nightAmt = 0;
const hourOverride = (() => { const h = parseFloat(new URLSearchParams(location.search).get('hour')); return Number.isFinite(h) ? h % 24 : null; })();
function currentHour() {
  if (hourOverride !== null) return hourOverride;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}
function applyDayNight() {
  const h = currentHour();
  let i = 0;
  while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].h <= h) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
  const t = smoothstep(0, 1, (h - a.h) / (b.h - a.h));
  const col = (k) => cA.set(a[k]).lerp(cB.set(b[k]), t);
  sky.material.uniforms.top.value.copy(col('top'));
  sky.material.uniforms.bot.value.copy(col('bot'));
  scene.fog.color.copy(col('bot'));
  waterUniforms.uFogColor.value.copy(scene.fog.color);
  sun.color.copy(col('sun'));
  sun.intensity = lerp(a.sunI, b.sunI, t);
  hemi.color.copy(col('hTop'));
  hemi.groundColor.copy(col('hBot'));
  hemi.intensity = lerp(a.hI, b.hI, t);
  waterUniforms.uLight.value = lerp(a.water, b.water, t);
  nightAmt = lerp(a.night, b.night, t);
  sky.material.uniforms.night.value = nightAmt;
  for (const m of dayNightMats.windows) m.color.copy(WINDOW_DAY).lerp(WINDOW_NIGHT, nightAmt);
  for (const m of dayNightMats.lamps) m.color.copy(LAMP_DAY).lerp(LAMP_NIGHT, nightAmt);
  for (const m of dayNightMats.inWindows) m.color.copy(WINDOW_DAY).lerp(IN_WINDOW_NIGHT, nightAmt);
  // 太陽は東から西へ
  const dayT = clamp((h - 6) / 12, 0, 1);
  const ang = lerp(-1.1, 1.1, dayT);
  sunOffset.set(Math.sin(ang) * 30, 34, 18);
  if (me && layerOf(me.x) === 'under') {
    // 地下は うす暗く、青っぽい
    hemi.color.set('#8a93c4'); hemi.groundColor.set('#3a2c22'); hemi.intensity = 0.75;
    sun.color.set('#b9c4ff'); sun.intensity = 0.35;
    sunOffset.set(-6, 30, 14);
    scene.fog.color.copy(UNDER_BG);
  } else if (me && interiorAt(me.x)) {
    // 家の中は いつも あかるい
    hemi.color.set('#fff8ee'); hemi.groundColor.set('#b89a7a'); hemi.intensity = 1.7;
    sun.color.set('#fff0dc'); sun.intensity = 1.5;
    sunOffset.set(-8, 30, 20);
    scene.fog.color.copy(INDOOR_BG);
  }
  document.body.style.background = '#' + scene.fog.color.getHexString();
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
function updateClock() {
  const d = new Date();
  if (hourOverride !== null) d.setHours(Math.floor(hourOverride), Math.round((hourOverride % 1) * 60));
  const h = d.getHours();
  $('#time').textContent = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')}`;
  $('#ampm').textContent = h < 12 ? 'AM' : 'PM';
  $('#date').textContent = `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
}

// =====================================================================
// 毎フレーム
// =====================================================================
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3();
let sendTimer = 0, lastSent = '';
let stepDist = 0;
let mapTick = 0;
let dripAt = 0;
const camPos = new THREE.Vector3(SPAWN.x, 14, SPAWN.z + 16);
const camLook = new THREE.Vector3(SPAWN.x, 0, SPAWN.z);

function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

function moveMe(dt) {
  if (transitioning || dialog.open) { me.speed = 0; return; }
  if (me.seat) {
    const moving = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((k) => keys.has(k))
      || Math.hypot(stickVec.x, stickVec.y) > 0.4 || clickTarget;
    if (moving) { standUp(); clickTarget = null; }
    me.speed = 0;
    return;
  }
  let ix = 0, iz = 0, run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
  let mag = Math.hypot(ix, iz);
  if (mag > 0) { ix /= mag; iz /= mag; mag = 1; }
  if (fishing && (mag || Math.hypot(stickVec.x, stickVec.y) > 0.4 || clickTarget)) endFishing();
  if (!mag && (stickVec.x || stickVec.y)) {
    mag = Math.hypot(stickVec.x, stickVec.y);
    if (mag > 0.15) { ix = stickVec.x / mag; iz = stickVec.y / mag; run = mag > 0.92; } else mag = 0;
  }
  if (!mag && clickTarget) {
    const dx = clickTarget.x - me.x, dz = clickTarget.z - me.z;
    const l = Math.hypot(dx, dz);
    if (clickTarget.pickId && l < 1.1) { requestPick(clickTarget.pickId); clickTarget = null; }
    else if (l < 0.25) clickTarget = null;
    else { ix = dx / l; iz = dz / l; mag = 1; run = l > 9; }
  }
  const speed = mag ? (run ? 7.4 : 4.2) * Math.min(1, mag * 1.2) : 0;
  let moved = 0;
  if (speed > 0) {
    me.r = angleLerp(me.r, Math.atan2(ix, iz), Math.min(1, dt * 14));
    const step = speed * dt;
    const ox = me.x, oz = me.z;
    const tryMove = (dx, dz) => {
      if (!walkable(me.x + dx, me.z + dz)) return false;
      me.x += dx; me.z += dz;
      return true;
    };
    if (!tryMove(ix * step, iz * step)) {
      // ぶつかったら、少し向きを変えて すべるように回りこむ（前にうまくいった側を先にためす）
      const side = me.slideSide || 1;
      let ok = false;
      for (const a of [0.45, 0.9, 1.3]) {
        for (const sgn of [side, -side]) {
          const c = Math.cos(a * sgn), sn = Math.sin(a * sgn);
          const rx = ix * c - iz * sn, rz = ix * sn + iz * c;
          if (tryMove(rx * step * 0.9, rz * step * 0.9)) { me.slideSide = sgn; ok = true; break; }
        }
        if (ok) break;
      }
      if (!ok) clickTarget = null;
    }
    moved = Math.hypot(me.x - ox, me.z - oz);
  }
  me.speed = moved / Math.max(dt, 1e-4);
  stepDist += moved;
  const room = interiorAt(me.x);
  if (stepDist > (me.speed > 5 ? 1.25 : 0.95)) {
    stepDist = 0;
    sound.step(0.9, layerOf(me.x) === 'under' ? 'stone' : room ? 'wood' : onBridge(me.x, me.z) ? 'wood' : islandSDF(me.x, me.z) > -7.4 ? 'sand' : 'grass');
  }
  // 果物の上を歩いたら拾う
  for (const d of drops.values()) {
    if (Math.hypot(d.x - me.x, d.z - me.z) < 0.75 && performance.now() / 1000 - d.t0 > 0.7) requestPick(d.id);
  }
  // ドアに向かって歩くと家に入り、出口のマットで下へ歩くと外に出る
  if (speed > 0 && !room && iz < -0.5) {
    const all = [...HOUSES.map((h, i) => [h, i]), ...PLOTS.filter((p) => plotOwned(p.i)).map((p) => [p.house, HOUSES.length + p.i])];
    for (const [h, i] of all) {
      if (Math.abs(me.x - h.x) < 0.7 && me.z - (h.z + h.d / 2) < 0.45 && me.z > h.z) { enterHouse(i); break; }
    }
  }
  if (speed > 0 && room && iz > 0.5 && atRoomExit(me.x, me.z)) exitHouse();
}

function cameraGoal(now) {
  const portrait = camera.aspect < 1 ? 1 + (1 - camera.aspect) * 0.55 : 1; // 縦長の画面では少し引く
  const room = me ? interiorAt(me.x) : null;
  if (room) {
    const t = new THREE.Vector3(room.x + (me.x - room.x) * 0.35, 0, room.z + (me.z - room.z) * 0.3);
    const zi = clamp(zoom, 0.8, 1.2) * portrait;
    return { pos: t.clone().add(new THREE.Vector3(0, 9.2 * zi, 11.5 * zi)), look: t.clone().add(new THREE.Vector3(0, 0.4, -0.6)) };
  }
  const focus = me || { x: SPAWN.x, z: SPAWN.z };
  if (me && layerOf(me.x) === 'under') {
    const t = new THREE.Vector3(me.x, 0, me.z);
    const zu = clamp(zoom, 0.7, 1.3) * portrait * 0.85;
    return { pos: t.clone().add(new THREE.Vector3(0, 10 * zu, 15 * zu)), look: t.clone().add(new THREE.Vector3(0, 0.8, -1.8)) };
  }
  const fy = me ? standHeight(me.x, me.z) : 0;
  const idle = me ? 0 : now * 0.05;
  const target = new THREE.Vector3(focus.x + Math.sin(idle) * 6, fy, focus.z + Math.cos(idle * 0.7) * 3);
  return {
    pos: target.clone().add(new THREE.Vector3(0, 10 * zoom * portrait, 18 * zoom * portrait)),
    look: target.clone().add(new THREE.Vector3(0, 1.1, -2.2)),
  };
}

function project(x, y, z) {
  tmpV.set(x, y - curveY(z), z).project(camera);
  return { sx: (tmpV.x * 0.5 + 0.5) * innerWidth, sy: (-tmpV.y * 0.5 + 0.5) * innerHeight, ok: tmpV.z < 1 && Math.abs(tmpV.x) < 1.3 && Math.abs(tmpV.y) < 1.3 };
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now() / 1000;

  if (me) {
    moveMe(dt);
    sendTimer -= dt;
    if (sendTimer <= 0 && net) {
      sendTimer = 0.1;
      const m = me.seat ? (me.seat.pose === 'lie' ? 4 : 3) : me.speed > 5 ? 2 : me.speed > 0.3 ? 1 : 0;
      const s = `${me.x.toFixed(2)},${me.z.toFixed(2)},${me.r.toFixed(2)},${m}`;
      if (s !== lastSent) { lastSent = s; net.send({ t: 'move', x: +me.x.toFixed(2), z: +me.z.toFixed(2), r: +me.r.toFixed(2), m }); }
    }
    updatePrompt();
  }

  // カメラ
  const goal = cameraGoal(now);
  const ck = 1 - Math.exp(-dt * 5);
  camPos.lerp(goal.pos, ck);
  camLook.lerp(goal.look, ck);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  CURVE.uCenterZ.value = camLook.z;
  sky.position.copy(camera.position);
  sun.target.position.copy(camLook);
  sun.position.copy(camLook).add(sunOffset);
  camera.updateMatrixWorld();

  // 住民
  if (resident) {
    if (dialog.open) {
      resident.tx = resident.x; resident.tz = resident.z;
      resident.tr = Math.atan2(me.x - resident.x, me.z - resident.z);
    } else {
      const pose = residentPose();
      resident.tx = pose.x; resident.tz = pose.z; resident.tr = pose.r;
      if (me && now > mutterAt) {
        mutterAt = now + 30 + Math.random() * 40;
        if (Math.hypot(resident.x - me.x, resident.z - me.z) < 12) say(resident, MUTTER[Math.floor(Math.random() * MUTTER.length)], false);
      }
    }
  }
  if (me && (mapTick -= dt) <= 0) { mapTick = 0.1; drawMap(); updateWhere(); }
  if (me && layerOf(me.x) === 'under') {
    momoLamp.position.set(me.x, 3.4, me.z - 0.8);
    if (now > dripAt) { dripAt = now + 2 + Math.random() * 5; sound.drip(); }
  }
  updateSparks(dt);
  updateBugs(dt, now);
  updateFishing(now);
  updateTrophy(now);
  if (me && layerOf(me.x) === 'under') {
    for (const sh of shafts) {
      const front = sh.z > me.z + 0.8;
      sh.mat.opacity += ((front ? 0.03 : 0.12) - sh.mat.opacity) * Math.min(1, dt * 6);
    }
  }
  if (chestLid.mesh) {
    const lx = me ? me.x - UNDER_X : 0;
    if (!me || Math.hypot(lx - CHEST.x, me.z - CHEST.z) > 4) chestLid.target = 0;
    chestLid.open += (chestLid.target - chestLid.open) * Math.min(1, dt * 6);
    chestLid.mesh.rotation.x = -chestLid.open * 1.2;
  }

  // 人の動き
  for (const p of (resident ? [...people.values(), resident] : people.values())) {
    if (!p.isMe) {
      const ox = p.x, oz = p.z;
      if (Math.hypot(p.tx - p.x, p.tz - p.z) > 10) { p.x = p.tx; p.z = p.tz; }
      const k = 1 - Math.exp(-dt * 9);
      p.x += (p.tx - p.x) * k;
      p.z += (p.tz - p.z) * k;
      p.r = angleLerp(p.r, p.tr, 1 - Math.exp(-dt * 12));
      const sp = Math.hypot(p.x - ox, p.z - oz) / Math.max(dt, 1e-4);
      p.speed += (sp - p.speed) * Math.min(1, dt * 10);
    }
    const seat = p.isMe ? me.seat : seatOf(p);
    const pose = seat ? seat.pose : 'stand';
    // すわる高さは、キャラクターの腰の高さに合わせる
    const y = seat ? seat.y + (pose === 'sit' ? (0.3 - p.v.hip) * 1.2 : 0) : standHeight(p.x, p.z);
    p.v.setPose(pose);
    p.v.root.position.set(p.x, y, p.z + (pose === 'lie' ? p.v.lieShift : 0));
    p.v.root.rotation.y = p.r;
    p.v.update(dt, seat ? 0 : p.speed);
    // 頭の上
    const s = project(p.x, y + (pose === 'lie' ? 0.9 : pose === 'sit' ? 2.0 : 2.3), p.z);
    p.wrap.style.display = s.ok ? '' : 'none';
    if (s.ok) p.wrap.style.transform = `translate(${s.sx.toFixed(1)}px, ${s.sy.toFixed(1)}px)`;
    const talking = now < p.sayUntil;
    if (!talking && p.bubble.classList.contains('on')) p.bubble.classList.remove('on');
    if (now > p.emoteUntil && p.emote.classList.contains('on')) p.emote.classList.remove('on');
  }

  // 木のゆれ
  for (const o of treeObjs) {
    if (o.shakeT > 0) {
      o.shakeT = Math.max(0, o.shakeT - dt);
      const a = o.shakeT / 0.9;
      o.canopy.rotation.z = Math.sin(now * 38) * 0.07 * a;
      o.canopy.rotation.x = Math.cos(now * 31) * 0.05 * a;
    }
  }
  // 落ちてくる果物
  for (const d of drops.values()) {
    const t = now - d.t0;
    if (t < 0) { d.inner.position.y = 2.4; d.inner.visible = false; continue; }
    d.inner.visible = true;
    if (t < 0.7) {
      const fall = Math.min(1, t / 0.45);
      const bounce = t > 0.45 ? Math.sin(((t - 0.45) / 0.25) * Math.PI) * 0.25 : 0;
      d.inner.position.y = 2.4 * (1 - fall * fall) + bounce;
    } else d.inner.position.y = 0;
    d.inner.rotation.y = now * 0.6 + d.slot;
  }
  // ちょうちょ
  const bfVisible = nightAmt < 0.5;
  for (const b of butterflies) {
    b.g.visible = bfVisible;
    if (!bfVisible) continue;
    const t = now * b.sp + b.ph;
    const x = b.cx + Math.sin(t * 0.9) * 2.2 + Math.sin(t * 2.3) * 0.4;
    const z = b.cz + Math.cos(t * 0.7) * 1.8;
    const y = groundHeight(b.cx, b.cz) + 0.9 + Math.sin(t * 3.1) * 0.3;
    b.g.position.set(x, y, z);
    b.g.rotation.y = Math.atan2(Math.cos(t * 0.9), -Math.sin(t * 0.7)) + Math.PI / 2;
    const flap = Math.sin(now * 22 + b.ph) * 0.9;
    b.wl.rotation.z = flap; b.wr.rotation.z = -flap;
  }

  waterUniforms.uTime.value = now;
  sky.material.uniforms.time.value = now;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// =====================================================================
// はじめの画面
// =====================================================================
const saved = store.get('look', null);
// 前にどうぶつを選んでいた人も MOMO になる（色は MOMO のアクセント色の範囲に直す）
const savedColor = saved && saved.s === 'momo' && saved.f < MOMO_ACCENT.length ? saved.f : 0;
const look = { s: 'momo', f: savedColor, c: 0 };
const nameInput = $('#name');
nameInput.value = store.get('name', '');

const pv = { renderer: null, scene: null, camera: null, v: null };
function setupPreview() {
  const cv = $('#preview');
  pv.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  pv.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  pv.scene = new THREE.Scene();
  pv.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  pv.camera.position.set(0, 1.6, 7.2);
  pv.camera.lookAt(0, 0.85, 0);
  pv.scene.add(new THREE.HemisphereLight(0xffffff, 0x9bc27a, 1.6));
  const l = new THREE.DirectionalLight(0xfff6e0, 1.8);
  l.position.set(-3, 5, 4);
  pv.scene.add(l);
  rebuildPreview();
  const loop = () => {
    if ($('#join').classList.contains('hide')) { pv.renderer.dispose(); return; }
    const r = cv.getBoundingClientRect();
    if (cv.width !== Math.round(r.width * pv.renderer.getPixelRatio())) {
      pv.renderer.setSize(r.width, r.height, false);
      pv.camera.aspect = r.width / r.height;
      pv.camera.updateProjectionMatrix();
    }
    if (pv.v) {
      pv.v.root.rotation.y = Math.sin(performance.now() / 1400) * 0.6;
      pv.v.update(1 / 60, 0);
    }
    pv.renderer.render(pv.scene, pv.camera);
    requestAnimationFrame(loop);
  };
  loop();
}
function rebuildPreview() {
  if (pv.v) pv.scene.remove(pv.v.root);
  pv.v = makeVillager(look);
  pv.v.root.position.y = -0.2;
  pv.v.root.scale.setScalar(1.25);
  pv.scene.add(pv.v.root);
  pv.v.hop();
}

// ---------- 有料プラン（カラーパス・買い切り） ----------
// 色を選べるのは、カラーパスを買った人だけ。買うと「購入の番号」がこの端末に保存され、
// サーバーが Stripe に問い合わせて確かめる。
const FREE_COLOR = 0; // 無料プランの MOMO はミント
let premium = false;
let pass = store.get('pass', null);
let payConfig = { payments: false, price: 300 };
function isPremium() { return premium; }
function apiBase() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q.replace(/^ws/, 'http').replace(/\/ws\/?$/, '').replace(/\/$/, '');
  return location.protocol.startsWith('http') ? '' : null;
}
async function api(path, opts) {
  const base = apiBase();
  if (base === null || (window.claude && !new URLSearchParams(location.search).get('server'))) return null;
  try {
    const res = await fetch(base + path, opts);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
async function checkPass(code) {
  const r = await api('/api/premium?code=' + encodeURIComponent(code));
  return !!(r && r.premium);
}
async function initPayments() {
  const params = new URLSearchParams(location.search);
  const paid = params.get('paid'), canceled = params.get('canceled');
  if (paid || canceled) {
    params.delete('paid'); params.delete('canceled');
    const q = params.toString();
    try { history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash); } catch { /* そのままでよい */ }
  }
  const cfg = await api('/api/config');
  if (cfg) payConfig = cfg;
  if (paid) {
    if (await checkPass(paid)) {
      pass = paid; store.set('pass', pass); premium = true;
      $('#colorNote').textContent = '🎉 カラーパスを手に入れました！ 好きな色を選んでね。';
    } else {
      $('#colorNote').textContent = '支払いを確認できませんでした。少し待ってからページを開きなおしてください。';
    }
  } else if (pass) {
    premium = await checkPass(pass);
  }
  if (canceled) $('#colorNote').textContent = '支払いを取りやめました。';
  renderPlan();
}
function renderPlan() {
  $('#planBadge').textContent = premium ? 'カラーパス' : '無料プラン';
  $('#planBadge').classList.toggle('paid', premium);
  $('#passBox').hidden = !payConfig.payments && !premium;
  $('#buyPass').hidden = premium;
  $('#buyPass').textContent = `🎨 カラーパスを買う（${payConfig.price.toLocaleString('ja-JP')}円・買い切り）`;
  $('#restoreRow').hidden = premium;
  $('#ownedRow').hidden = !premium;
  if (premium) $('#ownedCode').value = pass;
  renderSwatches();
}
$('#buyPass').addEventListener('click', async () => {
  $('#buyPass').disabled = true;
  store.set('name', nameInput.value.trim().slice(0, 12));
  const r = await api('/api/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ returnUrl: location.origin + location.pathname }),
  });
  if (r && r.url) { location.href = r.url; return; }
  $('#buyPass').disabled = false;
  $('#colorNote').textContent = 'いまは支払いページを開けません。少し待ってから試してください。';
});
$('#restoreOpen').addEventListener('click', () => { $('#restoreForm').hidden = false; $('#restoreInput').focus(); });
$('#restoreGo').addEventListener('click', async () => {
  const code = $('#restoreInput').value.trim();
  if (!code) return;
  if (await checkPass(code)) {
    pass = code; store.set('pass', pass); premium = true;
    $('#restoreForm').hidden = true;
    $('#colorNote').textContent = '🎉 カラーパスが使えるようになりました！';
    renderPlan();
  } else {
    $('#colorNote').textContent = 'その復元コードは使えませんでした。コードをもう一度確かめてください。';
  }
});
$('#ownedCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(pass); $('#colorNote').textContent = '復元コードをコピーしました。'; }
  catch { $('#ownedCode').select(); }
});

function buildChoices() { renderPlan(); }
function renderSwatches() {
  const el = $('#furChoices');
  el.textContent = '';
  look.f = premium ? savedColor : FREE_COLOR;
  MOMO_ACCENT.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.style.background = c; b.dataset.i = i;
    const locked = !premium && i !== FREE_COLOR;
    b.classList.toggle('locked', locked);
    b.title = locked ? 'カラーパスで選べる色です' : c;
    b.setAttribute('aria-disabled', locked ? 'true' : 'false');
    b.addEventListener('click', () => {
      if (locked) {
        $('#colorNote').textContent = payConfig.payments
          ? '🔒 この色はカラーパス（買い切り）で選べるようになります。'
          : '🔒 この色は有料プランの人だけ選べます。無料プランの MOMO はミント色です。';
        return;
      }
      look.f = i; syncChoices(); rebuildPreview();
    });
    el.appendChild(b);
  });
  syncChoices();
  if (pv.v) rebuildPreview();
}
function syncChoices() {
  document.querySelectorAll('#furChoices .swatch').forEach((b) => b.classList.toggle('on', +b.dataset.i === look.f));
}

// つなぎにいくのは、ボタンを押す前から始めておく
let netPromise = null;
const pending = [];
function startConnecting() {
  if (!netPromise) {
    netPromise = connect((m) => (me ? handle(m) : pending.push(m)), (st) => {
      $('#online').classList.toggle('offline', st === 'offline');
      if (st === 'offline') { $('#onlineText').textContent = 'つなぎなおし中…'; addLog(null, '通信が切れました。つなぎなおしています…'); }
      else if (st === 'upgraded') {
        net.send({ t: 'join', name: me.name, look: me.look, x: me.x, z: me.z, r: me.r, pass: premium ? pass : undefined, token: accountToken || undefined });
        lastSent = '';
        toast('サーバーにつながりました！');
        addLog(null, 'みんなの島につながりました');
      }
      else { updateOnline(); addLog(null, 'また つながりました'); }
    });
  }
  return netPromise;
}

async function enterIsland() {
  const name = nameInput.value.trim().slice(0, 12);
  if (!name) { nameInput.focus(); $('#status').textContent = 'なまえを入れてね'; return; }
  store.set('name', name);
  if (!isPremium()) look.f = FREE_COLOR;
  store.set('look', look);
  sound.init();
  const go = $('#go');
  go.disabled = true;
  $('#status').textContent = '島へむかっています…';
  net = await startConnecting();
  const a = Math.random() * Math.PI * 2;
  let sx = SPAWN.x + Math.cos(a) * 1.5, sz = SPAWN.z + Math.sin(a) * 1.2;
  if (!walkable(sx, sz)) { sx = SPAWN.x; sz = SPAWN.z; }
  me = createPerson('__me', name, look, sx, sz, 0, true);
  camPos.set(sx, 14, sz + 17);
  for (const m of pending.splice(0)) handle(m);
  net.send({ t: 'join', name, look, x: sx, z: sz, r: 0, pass: premium ? pass : undefined, token: accountToken || undefined });
  $('#join').classList.add('hide');
  updateEnvironment();
  updateOnline();
  renderPocket();
  addLog(null, net.mode === 'solo'
    ? 'ひとりモードで島に来ました（サーバーにつながりませんでした）'
    : net.mode === 'room' ? 'このページを開いている人と、同じ島にいます' : 'ようこそ！ Enter でおしゃべりできます');
  setTimeout(() => me && doEmote(me, 'wave'), 600);
}
$('#go').addEventListener('click', enterIsland);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterIsland(); });

// =====================================================================
// 起動
// =====================================================================
buildGround();
buildWater();
buildTrees();
buildHouses();
buildBridges();
buildPlazaProps();
buildRocks();
buildFlowers();
buildButterflies();
buildInteriors();
buildPlots();
buildShop();
buildUnderground();
refreshGems();
buildEntrances();
buildMapBase();
{
  const pose = residentPose();
  resident = createPerson(RESIDENT.id, RESIDENT.name, RESIDENT.look, pose.x, pose.z, pose.r, false, true);
  resident.voice = RESIDENT.voice;
}
applyDayNight();
updateClock();
setInterval(() => { applyDayNight(); updateClock(); refreshGems(); }, 5000);
buildChoices();
setupPreview();
initPayments();
startConnecting();
frame();
window.__island = { people, drops, treeObjs, handle, get me() { return me; }, get net() { return net; }, get resident() { return resident; }, room: () => me && interiorAt(me.x), enterHouse, gemObjs, bugObjs, get fishing() { return fishing; } };
