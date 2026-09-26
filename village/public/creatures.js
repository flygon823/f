// 魚・虫・磯の生きものの見た目。魚は「月と潮の磯」（リポジトリの一番上の index.html）の makeFish / makeOctopus を
// そのまま持ってきて、種類ごとの形と色の数字だけ変えている。カニ・ヤドカリ・ヒトデ・ウニ・イソギンチャク・クリオネも同じページから。
// M(color, opts) はマテリアルを作る関数（島の中ではセル調・図鑑の絵では曲げないもの、と使い分ける）。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const sphereGeo = new THREE.SphereGeometry(1, 18, 14);
function blob(parent, mat, x, y, z, sx, sy = sx, sz = sx) {
  const m = new THREE.Mesh(sphereGeo, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  parent.add(m);
  return m;
}
// 決まった乱数（同じ魚はいつも同じもようになる）
function seeded(seed) {
  let a = seed | 0;
  return (lo, hi) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return lo + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (hi - lo);
  };
}

// ---------- 魚（月と潮の磯の makeFish） ----------
// len: 体長, w: 体の幅, d: 体の高さ, head: 頭を大きく, eyesTop: 目が上（ハゼ・カレイ）, spots: 斑点の色
export const FISH_LOOK = {
  funa: { len: 0.5, w: 0.08, d: 0.15, body: '#8b8a5c', fin: '#6f6d48', belly: '#cfc9a0', iris: '#e6dcae' },
  oikawa: { len: 0.46, w: 0.06, d: 0.11, body: '#7fa3a6', fin: '#e0664f', belly: '#e9d2c4', iris: '#f1e2c2', spots: '#5f8f96' },
  yamame: { len: 0.5, w: 0.07, d: 0.11, body: '#9aa88a', fin: '#7c8a6a', belly: '#e6e2d0', iris: '#f0e6c8', spots: '#4b5a54' },
  ayu: { len: 0.5, w: 0.065, d: 0.1, body: '#8f9a6a', fin: '#d6c35a', belly: '#e7e2c6', iris: '#f2e8c4' },
  nijimasu: { len: 0.56, w: 0.08, d: 0.13, body: '#8aa0a0', fin: '#7d8f8f', belly: '#f0a6b0', iris: '#f0e6c8', spots: '#3e4a4a' },
  namazu: { len: 0.7, w: 0.13, d: 0.11, head: true, body: '#4b4a3e', fin: '#3b3a30', belly: '#8d8a72', whisker: true },
  medaka: { len: 0.26, w: 0.045, d: 0.06, body: '#d9cf9c', fin: '#e8dfb6', belly: '#f2ecd0', iris: '#9fd3ea' },
  koi: { len: 0.7, w: 0.12, d: 0.17, body: '#f3efe6', fin: '#f1e7d6', belly: '#fffaf0', spots: '#e2532f', whisker: true },
  kingyo: { len: 0.36, w: 0.09, d: 0.15, body: '#f0502c', fin: '#ff8a5a', belly: '#ffb08a', iris: '#fff0c0', bigTail: true },
  aji: { len: 0.46, w: 0.06, d: 0.12, body: '#8fa7ad', fin: '#c8c060', belly: '#e8eef0', iris: '#f2e6b0' },
  iwashi: { len: 0.4, w: 0.05, d: 0.09, body: '#4f7a9c', fin: '#6f95b0', belly: '#e3eef4', iris: '#e8eef0', spots: '#1f3a52' },
  mejina: { len: 0.36, w: 0.05, d: 0.085, body: '#4a7a84', fin: '#3a6670', belly: '#9ab9b5', iris: '#d7e2da' },
  agohaze: { len: 0.46, w: 0.07, d: 0.06, head: true, eyesTop: true, body: '#a48e66', fin: '#cbb994', spots: '#6f5c3f', belly: '#cdbd98' },
  karei: { len: 0.5, w: 0.2, d: 0.035, eyesTop: true, body: '#9b8a6a', fin: '#b09d7a', spots: '#6f604a' },
  fugu: { len: 0.42, w: 0.17, d: 0.17, body: '#b3a37a', fin: '#d6c890', belly: '#f4f0e4', iris: '#2f6e5a', spots: '#3d3a2c' },
  tai: { len: 0.56, w: 0.08, d: 0.22, body: '#e8736c', fin: '#e98a80', belly: '#f6c7bd', iris: '#f4e0a8', spots: '#8fd3f0' },
  sake: { len: 0.7, w: 0.07, d: 0.12, body: '#8f9ea4', fin: '#5d6a70', belly: '#d9d2c8', spots: '#7a3f5c', iris: '#e0e0d8' },
  coelacanth: { len: 0.95, w: 0.14, d: 0.22, body: '#2d4466', fin: '#233752', belly: '#3a5578', spots: '#e8eef6', iris: '#d8e4c0' },
};
export function makeFish(o, M, seed = 1) {
  const rr = seeded(seed);
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  const bm = M(o.body);
  const fm = M(o.fin, { transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const eyeMat = M('#17191a');
  blob(body, bm, 0, 0, 0, o.w, o.d, o.len * 0.5);
  if (o.head) blob(body, bm, 0, o.d * 0.1, o.len * 0.3, o.w * 1.15, o.d * 0.95, o.len * 0.24);
  if (o.belly) blob(body, M(o.belly), 0, -o.d * 0.35, 0.02, o.w * 0.85, o.d * 0.6, o.len * 0.42);
  if (o.spots) for (let i = 0; i < 7; i++) {
    const s = i % 2 ? 1 : -1, z = rr(-0.3, 0.3) * o.len;
    blob(body, M(o.spots), s * o.w * 0.8, rr(-0.2, 0.5) * o.d, z, o.w * 0.28, o.d * 0.28, o.len * 0.07);
  }
  const eyeY = o.eyesTop ? o.d * 0.8 : o.d * 0.2;
  const eyeX = o.eyesTop ? o.w * 0.45 : o.w * 0.78;
  for (const s of [-1, 1]) {
    if (o.iris) blob(body, M(o.iris), s * eyeX, eyeY, o.len * 0.34, o.len * 0.06);
    blob(body, eyeMat, s * (eyeX + 0.006), eyeY, o.len * 0.345, o.len * 0.04);
  }
  if (o.whisker) for (const s of [-1, 1]) {
    const wsk = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.004, o.len * 0.35, 4), M('#2e2d24'));
    wsk.position.set(s * o.w * 0.6, -o.d * 0.1, o.len * 0.5);
    wsk.rotation.set(1.2, 0, s * 0.8);
    body.add(wsk);
  }
  const tail = new THREE.Group();
  tail.position.z = -o.len * 0.44;
  body.add(tail);
  const ts = new THREE.Shape();
  ts.moveTo(0, 0); ts.lineTo(0.3, 0.2); ts.quadraticCurveTo(0.22, 0, 0.3, -0.2); ts.lineTo(0, 0);
  const tg = new THREE.ShapeGeometry(ts); tg.rotateY(Math.PI / 2);
  const tf = new THREE.Mesh(tg, fm); tf.scale.setScalar(o.len * (o.bigTail ? 1.7 : 1)); tail.add(tf);
  const ds = new THREE.Shape();
  ds.moveTo(-0.2, 0); ds.quadraticCurveTo(-0.05, 0.16, 0.2, 0.02); ds.lineTo(0.2, 0); ds.lineTo(-0.2, 0);
  const dg = new THREE.ShapeGeometry(ds); dg.rotateY(Math.PI / 2);
  const df = new THREE.Mesh(dg, fm); df.scale.setScalar(o.len); df.position.y = o.d * 0.85; body.add(df);
  return { group: g, body, tail };
}

// ---------- マダコ（月と潮の磯の makeOctopus を、腕を止めた形に） ----------
export function makeOctopus(M) {
  const rr = seeded(7);
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  const skin = M('#dd8661');
  const mantle = blob(body, skin, 0, 0.8, -0.3, 0.4, 0.48, 0.46);
  mantle.rotation.x = -0.55;
  blob(body, skin, 0, 0.4, 0.02, 0.36, 0.24, 0.32);
  const pap = M('#c86f4d');
  for (let i = 0; i < 12; i++) {
    const a = rr(0, TAU), b = rr(0.2, 1.3);
    blob(body, pap, Math.cos(a) * Math.sin(b) * 0.39, 0.8 + Math.cos(b) * 0.46, -0.3 + Math.sin(a) * Math.sin(b) * 0.44, 0.035);
  }
  const eyeW = M('#f1e3b4'), eyeMat = M('#17191a');
  for (const s of [-1, 1]) {
    const e = blob(body, eyeW, s * 0.23, 0.52, 0.13, 0.085);
    const pu = blob(e, eyeMat, s * 0.55, 0.05, 0.65, 0.6, 0.2, 0.3);
    pu.rotation.y = s * 0.7;
  }
  const SEGS = 7, LEN = 0.2, base = [0.62, 0.18, 0.05, -0.05, -0.2, -0.35, -0.5];
  const geos = [];
  for (let j = 0; j < SEGS; j++) {
    const r = 0.1 + (0.028 - 0.1) * (j / (SEGS - 1));
    const cg = new THREE.CapsuleGeometry(r, LEN * 0.9, 3, 8);
    cg.rotateX(Math.PI / 2); cg.translate(0, 0, LEN / 2);
    geos.push(cg);
  }
  for (let i = 0; i < 8; i++) {
    const ang = ((i + 0.5) / 8) * TAU;
    const root = new THREE.Group();
    root.position.set(Math.sin(ang) * 0.2, 0.24, Math.cos(ang) * 0.2);
    root.rotation.y = ang;
    body.add(root);
    let parent = root;
    for (let j = 0; j < SEGS; j++) {
      const jt = new THREE.Group();
      if (j > 0) jt.position.z = LEN;
      jt.rotation.x = base[j];
      jt.add(new THREE.Mesh(geos[j], skin));
      parent.add(jt);
      parent = jt;
    }
  }
  g.scale.setScalar(0.56);
  return { group: g, body };
}

// ザリガニ（月と潮の磯のカニの作り方を、細長い形に）
function makeCrayfish(M) {
  const g = new THREE.Group();
  const shell = M('#c2422e'), dark = M('#8f2a1e'), eye = M('#17191a');
  g.add(new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.1, 0.22, 2, 0.04), shell).translateZ(0.06));
  for (let k = 0; k < 4; k++) blob(g, k % 2 ? dark : shell, 0, 0.0, -0.08 - k * 0.07, 0.07 - k * 0.01, 0.045, 0.045);
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.07, 8, Math.PI, Math.PI), dark);
  fan.position.set(0, 0, -0.36); fan.rotation.x = -Math.PI / 2; g.add(fan);
  for (const s of [-1, 1]) {
    blob(g, eye, s * 0.04, 0.06, 0.18, 0.018);
    const arm = new THREE.Group();
    arm.position.set(s * 0.07, 0, 0.14); arm.rotation.y = s * 0.35; g.add(arm);
    arm.add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.14, 6).rotateX(Math.PI / 2).translate(0, 0, 0.07), shell));
    const claw = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.045, 0.12, 2, 0.02), shell);
    claw.position.set(0, 0, 0.18); arm.add(claw);
    for (let k = 0; k < 3; k++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.006, 0.12, 4), dark);
      leg.position.set(s * 0.1, -0.03, 0.06 - k * 0.05); leg.rotation.z = s * 1.1; g.add(leg);
    }
  }
  g.scale.setScalar(1.6);
  return { group: g };
}

// ---------- 虫 ----------
const thin = (M, c, len, r = 0.008) => new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.7, len, 4), M(c));
function legs(g, M, color, n, spread, y, len) {
  for (const s of [-1, 1]) for (let k = 0; k < n; k++) {
    const l = thin(M, color, len);
    l.position.set(s * spread, y, 0.05 - k * 0.05);
    l.rotation.set(0, 0, s * 1.0);
    g.add(l);
  }
}
function antennae(g, M, color, len, y, z, spread = 0.03) {
  for (const s of [-1, 1]) {
    const a = thin(M, color, len, 0.005);
    a.position.set(s * spread, y + len * 0.35, z + len * 0.3);
    a.rotation.set(0.9, 0, s * -0.35);
    g.add(a);
  }
}
function wingPair(M, color, spot, w, h, back = true) {
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    const wing = new THREE.Group();
    const f = new THREE.Mesh(new THREE.CircleGeometry(1, 14), M(color, { side: THREE.DoubleSide }));
    f.scale.set(w, h, 1); f.position.set(s * w * 0.95, 0, 0.02); wing.add(f);
    if (back) { const b = new THREE.Mesh(new THREE.CircleGeometry(1, 12), M(color, { side: THREE.DoubleSide })); b.scale.set(w * 0.7, h * 0.7, 1); b.position.set(s * w * 0.7, 0, -h * 1.0); wing.add(b); }
    if (spot) { const d = new THREE.Mesh(new THREE.CircleGeometry(1, 10), M(spot, { side: THREE.DoubleSide })); d.scale.set(w * 0.25, w * 0.25, 1); d.position.set(s * w * 1.2, h * 0.2, 0.021); wing.add(d); }
    wing.rotation.x = -Math.PI / 2; // 横に広げた羽
    pivot.add(wing);
    pivot.userData.side = s;
    wings.push(pivot);
  }
  return wings;
}
function butterfly(M, color, spot, body = '#2b2723') {
  const g = new THREE.Group();
  blob(g, M(body), 0, 0, 0, 0.025, 0.025, 0.12);
  antennae(g, M, body, 0.12, 0.02, 0.1);
  const wings = wingPair(M, color, spot, 0.12, 0.1);
  wings.forEach((w) => g.add(w));
  return { group: g, wings, flyer: true };
}
function beetle(M, shell, opts = {}) {
  const g = new THREE.Group();
  const sm = M(shell), dark = M(opts.head || '#1f1a17');
  blob(g, sm, 0, 0.05, -0.02, 0.08, 0.05, 0.12);
  blob(g, dark, 0, 0.045, 0.11, 0.05, 0.04, 0.04);
  legs(g, M, '#1f1a17', 3, 0.08, 0.02, 0.1);
  if (opts.horn) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.16, 6), dark); h.position.set(0, 0.1, 0.18); h.rotation.x = 0.6; g.add(h); }
  if (opts.jaws) for (const s of [-1, 1]) { const j = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.12, 5), dark); j.position.set(s * 0.03, 0.05, 0.18); j.rotation.set(Math.PI / 2, 0, s * 0.5); g.add(j); }
  if (opts.long) antennae(g, M, '#2a2a2a', 0.3, 0.06, 0.1, 0.03);
  if (opts.dots) for (let k = 0; k < 6; k++) blob(g, M(opts.dots), (k % 2 ? 1 : -1) * 0.04, 0.095, -0.08 + Math.floor(k / 2) * 0.06, 0.015, 0.005, 0.015);
  return { group: g };
}
function hopper(M, color, dark) {
  const g = new THREE.Group();
  blob(g, M(color), 0, 0.04, 0, 0.035, 0.035, 0.13);
  blob(g, M(color), 0, 0.05, 0.12, 0.03, 0.035, 0.035);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.007, 0.16, 4), M(dark));
    leg.position.set(s * 0.04, 0.07, -0.05); leg.rotation.set(-1.0, 0, s * 0.3); g.add(leg);
  }
  legs(g, M, dark, 2, 0.04, 0.02, 0.07);
  antennae(g, M, dark, 0.14, 0.06, 0.13);
  return { group: g };
}
function mantis(M) {
  const g = new THREE.Group(), c = M('#7fb54a');
  blob(g, c, 0, 0.05, -0.05, 0.035, 0.03, 0.12);
  const th = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.14, 6), c);
  th.position.set(0, 0.1, 0.08); th.rotation.x = -0.9; g.add(th);
  const head = blob(g, c, 0, 0.16, 0.13, 0.03, 0.025, 0.02);
  head.rotation.z = Math.PI / 4;
  for (const s of [-1, 1]) {
    blob(g, M('#2c3a18'), s * 0.028, 0.165, 0.14, 0.012);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.007, 0.09, 4), c);
    arm.position.set(s * 0.025, 0.11, 0.15); arm.rotation.x = 0.5; g.add(arm);
  }
  legs(g, M, '#6aa03a', 2, 0.04, 0.03, 0.12);
  return { group: g };
}
function cicada(M) {
  const g = new THREE.Group();
  blob(g, M('#5b4a33'), 0, 0.04, 0, 0.05, 0.04, 0.1);
  blob(g, M('#3d3226'), 0, 0.05, 0.1, 0.05, 0.035, 0.03);
  for (const s of [-1, 1]) {
    blob(g, M('#2a2a2a'), s * 0.045, 0.06, 0.11, 0.015);
    const w = new THREE.Mesh(new THREE.CircleGeometry(1, 10), M('#e6f0ea', { transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    w.scale.set(0.05, 0.14, 1); w.position.set(s * 0.035, 0.085, -0.05); w.rotation.set(-Math.PI / 2, 0, s * 0.2); g.add(w);
  }
  return { group: g };
}
function bee(M) {
  const g = new THREE.Group();
  for (let k = 0; k < 3; k++) blob(g, M(k % 2 ? '#2b2420' : '#f2c230'), 0, 0, -0.03 - k * 0.035, 0.045 - k * 0.006, 0.045 - k * 0.006, 0.03);
  blob(g, M('#2b2420'), 0, 0, 0.04, 0.035);
  const wings = wingPair(M, '#eef6ff', null, 0.05, 0.035, false);
  wings.forEach((w) => { w.position.y = 0.035; g.add(w); });
  return { group: g, wings, flyer: true };
}
function dragonfly(M, body, eye, big = false) {
  const g = new THREE.Group();
  const k = big ? 1.3 : 1;
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * k, 0.018 * k, 0.3 * k, 6).rotateX(Math.PI / 2), M(body));
  tail.position.z = -0.13 * k; g.add(tail);
  blob(g, M(body), 0, 0, 0.03, 0.03 * k, 0.03 * k, 0.05 * k);
  for (const s of [-1, 1]) blob(g, M(eye), s * 0.022 * k, 0.01, 0.08 * k, 0.025 * k);
  const wings = [];
  for (const z of [0.04, -0.01]) {
    const ws = wingPair(M, '#eaf4ff', null, 0.14 * k, 0.025 * k, false);
    ws.forEach((w) => { w.position.set(0, 0.03, z * k); g.add(w); wings.push(w); });
  }
  if (big) for (let i = 0; i < 4; i++) blob(g, M('#f0d23a'), 0, 0.012, -0.05 - i * 0.07, 0.02, 0.008, 0.012);
  return { group: g, wings, flyer: true };
}
function firefly(M) {
  const g = new THREE.Group();
  blob(g, M('#2a2622'), 0, 0, 0.02, 0.025, 0.02, 0.05);
  blob(g, M('#d9412e'), 0, 0.005, 0.07, 0.018);
  const light = blob(g, M('#e8ff8a', { glow: true }), 0, -0.005, -0.05, 0.028, 0.022, 0.035);
  return { group: g, light, flyer: true, glow: '#d8ff7a' };
}
function ladybug(M) {
  const g = new THREE.Group();
  blob(g, M('#d8312a'), 0, 0.02, 0, 0.07, 0.05, 0.075);
  blob(g, M('#1b1716'), 0, 0.02, 0.07, 0.035, 0.03, 0.03);
  for (const [x, z] of [[0.03, 0.02], [-0.03, 0.02], [0.035, -0.03], [-0.035, -0.03], [0, -0.05]]) blob(g, M('#1b1716'), x, 0.062, z, 0.013, 0.006, 0.013);
  return { group: g };
}
function pillbug(M) {
  const g = new THREE.Group();
  for (let k = 0; k < 6; k++) blob(g, M(k % 2 ? '#6b6e74' : '#5a5d63'), 0, 0.02, 0.07 - k * 0.028, 0.055 - Math.abs(k - 2.5) * 0.006, 0.035, 0.02);
  antennae(g, M, '#44464a', 0.06, 0.02, 0.09);
  return { group: g };
}
// ---------- 磯の生きもの（月と潮の磯の makeCrab / makeHermit / makeAnemone / makeUrchin / makeStar / makeClione） ----------
const segCache = new Map();
function segGeo(r, l) {
  const k = r.toFixed(3) + '_' + l.toFixed(3);
  if (!segCache.has(k)) { const g = new THREE.CylinderGeometry(r * 0.8, r, l, 6); g.rotateZ(-Math.PI / 2); g.translate(l / 2, 0, 0); segCache.set(k, g); }
  return segCache.get(k);
}
function makeLeg(m1, m2, l1, l2, r) {
  const root = new THREE.Group(), knee = new THREE.Group();
  root.add(new THREE.Mesh(segGeo(r, l1), m1));
  knee.position.x = l1;
  root.add(knee);
  knee.add(new THREE.Mesh(segGeo(r * 0.8, l2), m2));
  return { root, knee };
}
function makeCrab(M) {
  const rr = seeded(11);
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  const shell = M('#7c8452'), legM = M('#86875b'), legM2 = M('#9c9a6d'), claw = M('#e3d6c4'), dot = M('#8a3e55'), eye = M('#17191a');
  const cara = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.11, 0.3, 3, 0.045), shell);
  cara.position.y = 0.13; body.add(cara);
  for (let i = 0; i < 7; i++) blob(body, M('#5e4a62'), rr(-0.13, 0.13), 0.186, rr(-0.1, 0.1), 0.022, 0.006, 0.022);
  for (const s of [-1, 1]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 5), shell);
    st.position.set(s * 0.1, 0.2, 0.14); body.add(st);
    blob(body, eye, s * 0.1, 0.235, 0.145, 0.026);
  }
  const legs = [];
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
    const L = makeLeg(legM, legM2, 0.2, 0.22, 0.02);
    const fan = (i - 1.5) * 0.38;
    L.root.position.set(s * 0.17, 0.12, 0.09 - i * 0.065);
    L.base = s > 0 ? fan : Math.PI - fan;
    L.root.rotation.set(0, L.base, 0.55);
    L.knee.rotation.z = -1.7;
    L.phase = i * 1.6 + (s > 0 ? 0 : Math.PI);
    body.add(L.root);
    legs.push(L);
  }
  for (const s of [-1, 1]) {
    const cr = new THREE.Group();
    cr.position.set(s * 0.12, 0.12, 0.15);
    cr.rotation.set(-0.2, s * 0.35, 0);
    cr.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.12, 6).rotateX(Math.PI / 2).translate(0, 0, 0.06), legM));
    const ch = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.06, 0.12, 2, 0.02), claw);
    ch.position.set(0, 0.01, 0.16); cr.add(ch);
    for (let k = 0; k < 3; k++) blob(ch, dot, rr(-0.025, 0.025), 0.031, rr(-0.04, 0.04), 0.012, 0.004, 0.012);
    body.add(cr);
  }
  return { group: g, legs, walker: true };
}
function makeHermit(M) {
  const g = new THREE.Group(), soft = new THREE.Group(), shell = new THREE.Group();
  g.add(shell, soft);
  const s1 = M('#c8b08c'), s2 = M('#a4876a');
  const whorl = new THREE.IcosahedronGeometry(1, 1);
  let y = 0;
  for (let k = 0; k < 7; k++) {
    const R = 0.15 * Math.pow(0.76, k);
    const m = new THREE.Mesh(whorl, k % 2 ? s2 : s1);
    m.scale.setScalar(R);
    m.position.set(Math.cos(k * 1.4) * R * 0.5, y, Math.sin(k * 1.4) * R * 0.5);
    shell.add(m);
    y += R * 0.95;
  }
  shell.position.set(0, 0.15, -0.06);
  shell.rotation.x = -1.05;
  const legM = M('#8d4d34'), tip = M('#e2d3bf'), clawM = M('#a3593a'), eye = M('#17191a');
  blob(soft, legM, 0, 0.12, 0.1, 0.07, 0.055, 0.07);
  const big = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.055, 0.11, 2, 0.02), clawM);
  big.position.set(0.06, 0.09, 0.2); big.rotation.y = -0.2; soft.add(big);
  const small = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.04, 0.08, 2, 0.015), clawM);
  small.position.set(-0.05, 0.09, 0.18); small.rotation.y = 0.2; soft.add(small);
  for (const s of [-1, 1]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.08, 5), legM);
    st.position.set(s * 0.03, 0.18, 0.16); st.rotation.x = 0.3; soft.add(st);
    blob(soft, eye, s * 0.03, 0.22, 0.175, 0.018);
    const an = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.24, 4), M('#b8412c'));
    an.position.set(s * 0.04, 0.2, 0.27); an.rotation.set(1.1, 0, s * -0.4); soft.add(an);
  }
  const legs = [];
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
    const L = makeLeg(legM, tip, 0.13, 0.16, 0.017);
    const fan = -0.5 + i * 0.5;
    L.root.position.set(s * 0.05, 0.1, 0.12 - i * 0.05);
    L.base = s > 0 ? fan : Math.PI - fan;
    L.root.rotation.set(0, L.base, 0.5);
    L.knee.rotation.z = -1.6;
    L.phase = i * 2 + (s > 0 ? 0 : Math.PI);
    soft.add(L.root);
    legs.push(L);
  }
  return { group: g, legs, walker: true };
}
const tentGeo = new THREE.ConeGeometry(0.02, 0.2, 6).translate(0, 0.1, 0);
function makeAnemone(M) {
  const g = new THREE.Group();
  const deep = M('#8e1c26'), red = M('#b8252f'), tent = M('#c93240'), blue = M('#3b6fd6');
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.1, 20), deep);
  col.position.y = 0.05; g.add(col);
  const ball = blob(g, red, 0, 0.1, 0, 0.16 * 0.85, 0.16 * 0.35, 0.16 * 0.85); // ひらいた形
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; blob(g, blue, Math.cos(a) * 0.125, 0.1, Math.sin(a) * 0.125, 0.017); }
  const tg = new THREE.Group(); tg.position.y = 0.13; g.add(tg);
  const tents = [];
  for (let i = 0; i < 30; i++) {
    const ring = i < 14 ? 0 : 1, n = ring ? 16 : 14, ang = (ring ? i - 14 : i) / n * TAU + ring * 0.2;
    const pv = new THREE.Group();
    pv.position.set(Math.cos(ang) * (ring ? 0.1 : 0.055), 0, Math.sin(ang) * (ring ? 0.1 : 0.055));
    pv.add(new THREE.Mesh(tentGeo, tent));
    pv.rotation.set(0, -ang, -(ring ? 1.15 : 0.6));
    tg.add(pv);
    tents.push({ pv, ang, ring });
  }
  // 触手を ゆらす
  const sway = (t) => tents.forEach((tt, i) => tt.pv.rotation.set(Math.sin(t * 1.2 + i) * 0.12, -tt.ang, -(tt.ring ? 1.15 : 0.6)));
  return { group: g, ball, sway };
}
function makeUrchin(M) {
  const g = new THREE.Group();
  blob(g, M('#3a2340'), 0, 0.12, 0, 0.14, 0.11, 0.14);
  const spines = [], q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  const N = 90;
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + 0.5) / N * 1.7;
    if (y < -0.6) continue;
    const r = Math.sqrt(1 - y * y), th = i * 2.39996;
    dir.set(Math.cos(th) * r, y, Math.sin(th) * r).normalize();
    const c = new THREE.ConeGeometry(0.011, 0.26, 4);
    c.translate(0, 0.13 + 0.11, 0);
    q.setFromUnitVectors(up, dir);
    c.applyQuaternion(q);
    spines.push(c);
  }
  const sp = new THREE.Mesh(mergeGeometries(spines), M('#4d2c57'));
  sp.position.y = 0.12;
  g.add(sp);
  return { group: g };
}
function makeStar(M) {
  const rr = seeded(5);
  const g = new THREE.Group();
  const s = new THREE.Shape();
  const pt = (i, r) => { const a = i / 5 * TAU + Math.PI / 2; return [Math.cos(a) * r, Math.sin(a) * r]; };
  s.moveTo(...pt(0, 0.33));
  for (let i = 0; i < 5; i++) { const [cx, cy] = pt(i + 0.5, 0.1), [ex, ey] = pt(i + 1, 0.33); s.quadraticCurveTo(cx, cy, ex, ey); }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.035, bevelSegments: 2, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, M('#41619d'));
  m.position.y = 0.03;
  g.add(m);
  for (let i = 0; i < 9; i++) {
    const a = rr(0, TAU), r = rr(0, 0.2);
    blob(g, M('#e27b3c'), Math.cos(a) * r, 0.09, Math.sin(a) * r, rr(0.03, 0.06), 0.012, rr(0.03, 0.06));
  }
  return { group: g };
}
function makeClione(M) {
  const g = new THREE.Group();
  const skin = M('#e3f1f7', { transparent: true, opacity: 0.6, emissive: '#9ed4f5', emissiveIntensity: 0.25, depthWrite: false });
  const core = M('#e5553a', { emissive: '#e5553a', emissiveIntensity: 0.35 });
  blob(g, skin, 0, 0, 0, 0.055, 0.13, 0.055);
  blob(g, skin, 0, 0.14, 0, 0.05, 0.048, 0.05);
  blob(g, core, 0, -0.01, 0, 0.026, 0.055, 0.026);
  blob(g, core, 0, 0.17, 0, 0.018, 0.014, 0.018);
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(s * 0.04, 0.07, 0); g.add(w);
    const m = blob(w, skin, s * 0.07, 0, 0, 0.075, 0.012, 0.045); m.rotation.z = s * 0.2;
    w.userData.side = s;
    wings.push(w);
  }
  return { group: g, wings, swimmer: true };
}
const ISO_LOOK = { hitode: makeStar, uni: makeUrchin, umeboshi: makeAnemone, clione: makeClione };

const BUG_LOOK = {
  monshiro: (M) => butterfly(M, '#fbfbf2', '#2e2e2e'),
  ageha: (M) => butterfly(M, '#f5d64a', '#1e1e1e'),
  tentou: ladybug,
  mitsubachi: bee,
  semi: cicada,
  kamikiri: (M) => beetle(M, '#1f1f24', { long: true, dots: '#f2f2f2' }),
  kabuto: (M) => beetle(M, '#5a3520', { horn: true, head: '#3f2415' }),
  kuwagata: (M) => beetle(M, '#2a1d17', { jaws: true }),
  batta: (M) => hopper(M, '#8ec24a', '#5f8a2a'),
  korogi: (M) => hopper(M, '#3a2c22', '#241a14'),
  kamakiri: mantis,
  tonbo: (M) => dragonfly(M, '#d8563a', '#b84430'),
  oniyanma: (M) => dragonfly(M, '#262626', '#3fbf7a', true),
  hotaru: firefly,
  dangomushi: pillbug,
  isogani: makeCrab,
  yadokari: makeHermit,
};

// どの生き物でも：cat は 'fish' | 'bug' | 'iso'
export function makeCreature(cat, key, M) {
  if (cat === 'fish') {
    if (key === 'madako') return makeOctopus(M);
    if (key === 'zarigani') return makeCrayfish(M);
    const look = FISH_LOOK[key];
    return look ? makeFish(look, M, key.length * 17) : null;
  }
  const make = cat === 'iso' ? ISO_LOOK[key] : BUG_LOOK[key];
  return make ? make(M) : null;
}
