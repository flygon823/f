// 島の地形と配置。すべて決まった乱数で作るので、誰の画面でも同じ島になる。

export const HALF = 64;          // 地面メッシュ／テクスチャが覆う範囲（±HALF）
export const WATER_Y = -0.3;
export const WALK_MIN_H = -0.38; // これより深い所には入れない
export const RIVER_W = 2.6;      // 川の水面の半幅

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------- 島のかたち ----------
export function islandSDF(x, z) {
  const hx = 45, hz = 43, r = 17;
  const qx = Math.abs(x) - (hx - r), qz = Math.abs(z) - (hz - r);
  let d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
  const a = Math.atan2(z, x);
  d += Math.sin(a * 5 + 1.3) * 1.3 + Math.sin(a * 11 + 0.4) * 0.6 + Math.sin(a * 3 - 2) * 1.1;
  return d;
}

// 北の海から南の海へ流れる川
export const RIVER = [
  [-12, -64], [-13, -44], [-19, -30], [-17, -17], [-10, -7], [-11, 5],
  [-18, 16], [-17, 29], [-10, 41], [-9, 64],
];
const RIVER_BOX = RIVER.slice(1).map((b, i) => {
  const a = RIVER[i];
  return [Math.min(a[0], b[0]) - 8, Math.max(a[0], b[0]) + 8, Math.min(a[1], b[1]) - 8, Math.max(a[1], b[1]) + 8];
});
export function riverDist(x, z) {
  let best = 99;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const bx = RIVER_BOX[i];
    if (x < bx[0] || x > bx[1] || z < bx[2] || z > bx[3]) continue;
    const [ax, az] = RIVER[i], [cx, cz] = RIVER[i + 1];
    const vx = cx - ax, vz = cz - az;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) best = d;
  }
  return best;
}
export function riverXAt(z) {
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
    if (z >= az && z <= bz) return lerp(ax, bx, (z - az) / (bz - az));
  }
  return RIVER[0][0];
}

// 広場の東の小さな池
export const POND = { x: 19, z: 12, rx: 5.2, rz: 3.6 };
export function pondDist(x, z) {
  return (Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz) - 1) * Math.min(POND.rx, POND.rz);
}

export const PLAZA = { x: 5, z: -5, r: 7.5 };

// ---------- 橋 ----------
export const BRIDGES = [-21, 23].map((z) => {
  const x = riverXAt(z);
  const i = RIVER.findIndex((p, k) => k < RIVER.length - 1 && z >= p[1] && z <= RIVER[k + 1][1]);
  const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
  const along = Math.atan2(bx - ax, bz - az); // 川の流れの向き
  return { x, z, rot: along, len: 9.5, wid: 2.6 };
});
function bridgeLocal(b, x, z) {
  // 橋の座標系（u: 渡る向き, v: 川の向き）
  const dx = x - b.x, dz = z - b.z;
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return { u: dx * c - dz * s, v: dx * s + dz * c };
}
export function onBridge(x, z) {
  for (const b of BRIDGES) {
    const { u, v } = bridgeLocal(b, x, z);
    if (Math.abs(u) < b.len / 2 && Math.abs(v) < b.wid / 2 - 0.25) return b;
  }
  return null;
}

// ---------- 高さ ----------
export function groundHeight(x, z) {
  const d = islandSDF(x, z);
  let h;
  if (d < -7) h = 0;
  else if (d < 1) h = lerp(0, -0.58, smoothstep(-7, 1, d));
  else h = -0.58 - Math.min(2.4, (d - 1) * 0.22);
  const rd = riverDist(x, z);
  if (rd < RIVER_W + 1.4) h = Math.min(h, lerp(-1.05, h, smoothstep(RIVER_W - 0.9, RIVER_W + 1.0, rd)));
  const pd = pondDist(x, z);
  if (pd < 1.2) h = Math.min(h, lerp(-0.95, h, smoothstep(-1.4, 0.9, pd)));
  return h;
}
export function standHeight(x, z) {
  const b = onBridge(x, z);
  if (b) return 0.2;
  return Math.max(groundHeight(x, z), WATER_Y - 0.08);
}

// ---------- 家 ----------
export const HOUSES = [
  { x: 24, z: -24, roof: '#e2574c', wall: '#fff4dc', name: 'あかい屋根の家' },
  { x: 33, z: -4, roof: '#4f8fd8', wall: '#fdf0e6', name: 'あおい屋根の家' },
  { x: 30, z: 27, roof: '#5bb363', wall: '#fff8e8', name: 'みどり屋根の家' },
  { x: 5, z: 25, roof: '#f2b233', wall: '#fbe9ec', name: 'きいろ屋根の家' },
  { x: -32, z: -26, roof: '#9a6dd0', wall: '#f7f1e3', name: 'むらさき屋根の家' },
  { x: -33, z: 12, roof: '#f08a3c', wall: '#fff4dc', name: 'オレンジ屋根の家' },
].map((h) => ({ ...h, w: 5.2, d: 4.4 }));

// 家の戸口から広場・橋へ伸びる土の道
const door = (h) => [h.x, h.z + h.d / 2 + 0.8];
const bEnd = (b, side) => [b.x + Math.cos(b.rot) * side * (b.len / 2 + 0.6), b.z - Math.sin(b.rot) * side * (b.len / 2 + 0.6)];
export const PATHS = [
  [[PLAZA.x, PLAZA.z], [14, -12], [20, -17], door(HOUSES[0])],
  [[PLAZA.x, PLAZA.z], [18, -2], [26, 1], door(HOUSES[1])],
  [[PLAZA.x, PLAZA.z], [9, 8], [8, 17], door(HOUSES[3])],
  [[8, 17], [18, 21], [26, 29], door(HOUSES[2])],
  [[PLAZA.x, PLAZA.z], [-4, -12], bEnd(BRIDGES[0], 1)],
  [bEnd(BRIDGES[0], -1), [-27, -18], door(HOUSES[4])],
  [[8, 17], [-2, 22], bEnd(BRIDGES[1], 1)],
  [bEnd(BRIDGES[1], -1), [-28, 20], door(HOUSES[5])],
];
function segDist(x, z, a, b) {
  const vx = b[0] - a[0], vz = b[1] - a[1];
  const t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
}
export function pathDist(x, z) {
  let best = 99;
  for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) best = Math.min(best, segDist(x, z, p[i], p[i + 1]));
  return best;
}

// ---------- 木・岩・花 ----------
export const FRUITS = {
  peach: { name: 'もも', color: '#ffa7a0', leaf: true },
  apple: { name: 'りんご', color: '#e8423b', leaf: true },
  orange: { name: 'オレンジ', color: '#ff9a1f', leaf: true },
  pear: { name: 'なし', color: '#d9d65a', leaf: true },
  cherry: { name: 'さくらんぼ', color: '#d2203b', leaf: false },
};

function buildPlacements() {
  const rnd = mulberry32(20260925);
  const trees = [];   // { x, z, kind: 'round'|'cedar'|'palm', fruit?: key, s }
  const rocks = [];
  const flowers = []; // { x, z, color, kind }
  const tufts = [];

  const clearOf = (x, z, list, r) => list.every((o) => Math.hypot(o.x - x, o.z - z) > r);
  const nearHouse = (x, z, m) => HOUSES.some((h) => Math.abs(x - h.x) < h.w / 2 + m && Math.abs(z - h.z) < h.d / 2 + m + 1);
  const nearBridge = (x, z, m) => BRIDGES.some((b) => Math.hypot(x - b.x, z - b.z) < b.len / 2 + m);
  const inland = (x, z, m) => islandSDF(x, z) < -m && riverDist(x, z) > RIVER_W + m && pondDist(x, z) > m;
  const plazaD = (x, z) => Math.hypot(x - PLAZA.x, z - PLAZA.z) - PLAZA.r;

  // 広葉樹（実のなる木を含む）と針葉樹
  const fruitKeys = ['peach', 'peach', 'peach', 'apple', 'orange', 'pear', 'cherry'];
  for (let tries = 0; tries < 4000 && trees.length < 78; tries++) {
    const x = (rnd() * 2 - 1) * 44, z = (rnd() * 2 - 1) * 42;
    if (!inland(x, z, 8.5) && !(islandSDF(x, z) < -8.5 && riverDist(x, z) > RIVER_W + 2.2 && pondDist(x, z) > 2.2)) continue;
    if (plazaD(x, z) < 3 || nearHouse(x, z, 2.2) || nearBridge(x, z, 2) || pathDist(x, z) < 1.8) continue;
    if (!clearOf(x, z, trees, 4.2)) continue;
    const north = z < -22;
    const kind = north && rnd() < 0.65 ? 'cedar' : 'round';
    const t = { x, z, kind, s: 0.82 + rnd() * 0.2 };
    if (kind === 'round' && rnd() < 0.5) t.fruit = fruitKeys[Math.floor(rnd() * fruitKeys.length)];
    trees.push(t);
  }
  // 砂浜のヤシの木
  for (let tries = 0; tries < 3000 && trees.filter((t) => t.kind === 'palm').length < 12; tries++) {
    const x = (rnd() * 2 - 1) * 52, z = (rnd() * 2 - 1) * 50;
    const d = islandSDF(x, z);
    if (d < -6.2 || d > -3.8 || riverDist(x, z) < RIVER_W + 3 || !clearOf(x, z, trees, 6)) continue;
    trees.push({ x, z, kind: 'palm', s: 0.9 + rnd() * 0.2, lean: rnd() * Math.PI * 2 });
  }
  // 岩
  for (let tries = 0; tries < 2000 && rocks.length < 9; tries++) {
    const x = (rnd() * 2 - 1) * 44, z = (rnd() * 2 - 1) * 42;
    const d = islandSDF(x, z);
    if (d > -2.5 || riverDist(x, z) < RIVER_W + 1.5 || pondDist(x, z) < 1 || plazaD(x, z) < 2) continue;
    if (nearHouse(x, z, 2) || nearBridge(x, z, 2) || pathDist(x, z) < 1.8 || !clearOf(x, z, trees, 3) || !clearOf(x, z, rocks, 8)) continue;
    rocks.push({ x, z, s: 0.7 + rnd() * 0.5, r: rnd() * 6 });
  }
  // 花のかたまり
  const palette = ['#f24b5b', '#ffd23f', '#ffffff', '#ff8fc0', '#ff9d3d', '#a77be0', '#6fa8ff'];
  let clumps = 0;
  for (let tries = 0; tries < 3000 && clumps < 34; tries++) {
    const cx = (rnd() * 2 - 1) * 42, cz = (rnd() * 2 - 1) * 40;
    if (!inland(cx, cz, 8) || plazaD(cx, cz) < 0.5 || nearHouse(cx, cz, 0.6) || pathDist(cx, cz) < 1.6) continue;
    if (!clearOf(cx, cz, trees, 1.8) || !clearOf(cx, cz, rocks, 1.8)) continue;
    const color = palette[Math.floor(rnd() * palette.length)];
    const kind = rnd() < 0.5 ? 'tulip' : 'daisy';
    const n = 3 + Math.floor(rnd() * 6);
    for (let k = 0; k < n; k++) {
      const x = cx + (rnd() - 0.5) * 3, z = cz + (rnd() - 0.5) * 2.2;
      if (!inland(x, z, 7.5) || pathDist(x, z) < 1.2 || !clearOf(x, z, trees, 1.1) || !clearOf(x, z, flowers, 0.55)) continue;
      flowers.push({ x, z, color, kind });
    }
    clumps++;
  }
  // 草むら
  for (let tries = 0; tries < 4000 && tufts.length < 340; tries++) {
    const x = (rnd() * 2 - 1) * 46, z = (rnd() * 2 - 1) * 44;
    if (!inland(x, z, 7.5) || plazaD(x, z) < 0.8 || pathDist(x, z) < 1.2 || nearHouse(x, z, 0.3)) continue;
    tufts.push({ x, z, s: 0.6 + rnd() * 0.6, r: rnd() * 6 });
  }
  return { trees, rocks, flowers, tufts };
}

export const PLACE = buildPlacements();

// 広場の飾り
export const TOWN_TREE = { x: PLAZA.x, z: PLAZA.z };
export const BOARD = { x: PLAZA.x + 4.5, z: PLAZA.z - 6.2 };
export const LAMPS = [0.6, 2.2, 3.9, 5.4].map((a) => ({ x: PLAZA.x + Math.cos(a) * 8.6, z: PLAZA.z + Math.sin(a) * 8.6 }));
export const SPAWN = { x: PLAZA.x, z: PLAZA.z + 5 };

// ---------- ぶつかり判定 ----------
const CIRCLES = [
  ...PLACE.trees.map((t) => ({ x: t.x, z: t.z, r: t.kind === 'palm' ? 0.45 : 0.75 })),
  ...PLACE.rocks.map((r) => ({ x: r.x, z: r.z, r: 0.85 * r.s + 0.1 })),
  { x: TOWN_TREE.x, z: TOWN_TREE.z, r: 1.6 },
  { x: BOARD.x, z: BOARD.z, r: 0.8 },
  ...LAMPS.map((l) => ({ x: l.x, z: l.z, r: 0.25 })),
];
export function walkable(x, z, rad = 0.32) {
  if (onBridge(x, z)) return true;
  if (groundHeight(x, z) < WALK_MIN_H) return false;
  // 橋のたもとの手すり
  for (const b of BRIDGES) {
    const dx = x - b.x, dz = z - b.z;
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const u = dx * c - dz * s, v = dx * s + dz * c;
    if (Math.abs(u) < b.len / 2 + 0.2 && Math.abs(v) > b.wid / 2 - 0.25 && Math.abs(v) < b.wid / 2 + 0.3) return false;
  }
  for (const c of CIRCLES) {
    const dx = x - c.x, dz = z - c.z, rr = c.r + rad;
    if (dx * dx + dz * dz < rr * rr) return false;
  }
  for (const h of HOUSES) {
    if (Math.abs(x - h.x) < h.w / 2 + rad && Math.abs(z - h.z) < h.d / 2 + rad) return false;
  }
  return true;
}
