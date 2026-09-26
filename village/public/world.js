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
  if (x > INDOOR_X) return 0;
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
  if (x > INDOOR_X) return 0;
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

// ---------- 売り地（プレイヤーが買える土地） ----------
// 区画の中心。家は区画の少し奥（北）に建ち、ドアは手前（南）を向く。
export const PLOT_SIZE = 6.4;
export const PLOT_PRICE = 30000;   // 土地の値段（ポカ）
export const PLOT_REFUND = 0.5;    // 手放したときに もどる割合
export const PLOTS = [
  [-9, -29], [15, -23], [-2, -22], [27, -15], [-31, -13], [19, -8],
  [15, 3], [30, 6], [1, 12], [-32, 25], [14, 26], [-6, 28],
].map(([x, z], i) => ({ i, x, z, house: { x, z: z - 0.5, w: 4.6, d: 4.0 }, sign: { x: x - 2.3, z: z + 2.4 } }));
export const inPlot = (x, z, m = 0) => PLOTS.some((p) => Math.abs(x - p.x) < PLOT_SIZE / 2 + m && Math.abs(z - p.z) < PLOT_SIZE / 2 + m);
// 持ち主のいる区画（家が建っている区画）
const ownedPlots = new Set();
export function setPlotOwned(i, owned) { if (owned) ownedPlots.add(i); else ownedPlots.delete(i); }
export const plotOwned = (i) => ownedPlots.has(i);

// ---------- 家の中 ----------
// 部屋は島から遠く離れた場所に並べてある。座標がそのまま同期されるので、同じ家に入った人どうしは中で会える。
export const INDOOR_X = 900;
export const ROOM = { w: 9, d: 7.5 };
export const ROOM_THEMES = [
  { wall: '#f6e3c8', trim: '#d98f6f', floor: ['#c98f5a', '#b97e4c'], rug: '#e87a6a', bed: '#f3a6a0', accent: '#e2574c' },
  { wall: '#dcecf7', trim: '#7fa8d6', floor: ['#d7b88e', '#c9a77a'], rug: '#7fb6e8', bed: '#9cc4ef', accent: '#4f8fd8' },
  { wall: '#e6f2dc', trim: '#8fbf7a', floor: ['#b98d62', '#a97d54'], rug: '#9ed38a', bed: '#bfe3a8', accent: '#5bb363' },
  { wall: '#fff2cc', trim: '#e0b347', floor: ['#d2a878', '#c4996a'], rug: '#f7d06b', bed: '#ffe29a', accent: '#f2b233' },
  { wall: '#ece3f5', trim: '#a88fd0', floor: ['#bf9a73', '#ae8a64'], rug: '#b89ee6', bed: '#d3c2f2', accent: '#9a6dd0' },
  { wall: '#fde7d6', trim: '#e9a070', floor: ['#c79363', '#b88355'], rug: '#f5a66b', bed: '#ffc9a3', accent: '#f08a3c' },
];
export const INTERIORS = [
  ...HOUSES.map((h, i) => ({ i, x: INDOOR_X + 100 + i * 40, z: 0, house: h, theme: ROOM_THEMES[i % ROOM_THEMES.length] })),
  // 売り地に建つ家の部屋
  ...PLOTS.map((p, k) => ({
    i: HOUSES.length + k, plot: p.i, x: INDOOR_X + 600 + k * 40, z: 0,
    house: { ...p.house, name: 'だれかの家' }, theme: ROOM_THEMES[(k + 2) % ROOM_THEMES.length],
  })),
];
export function interiorAt(x) {
  if (x <= INDOOR_X) return null;
  let best = null, bd = 1e9;
  for (const r of INTERIORS) { const d = Math.abs(x - r.x); if (d < bd) { bd = d; best = r; } }
  return bd < 20 ? best : null;
}
// 家具（ぶつかり判定用。見た目は app.js が同じ配置で作る）: [x, z, 幅, 奥行き]（部屋の中心からの位置）
export const FURNITURE = [
  ['bed', -2.9, -2.3, 2.0, 2.6],
  ['shelf', 0.6, -3.35, 2.4, 0.7],
  ['table', 1.6, 0.4, 1.6, 1.6],
  ['plant', 3.8, -3.1, 0.8, 0.8],
  ['lamp', -1.2, -3.2, 0.6, 0.6],
  ['chair', 1.6, 1.65, 0.7, 0.6],
  ['sofa', -3.4, 1.0, 1.2, 2.2],
];
// すわる・ねころぶ場所（部屋の中心からの位置）。y は足もとの高さ、r は向き、pitch はねころぶときの傾き
export const SEATS = [
  { kind: 'sofa', pose: 'sit', x: -3.25, z: 0.5, y: 0.22, r: Math.PI / 2 },
  { kind: 'sofa', pose: 'sit', x: -3.25, z: 1.5, y: 0.22, r: Math.PI / 2 },
  { kind: 'chair', pose: 'sit', x: 1.6, z: 1.6, y: 0.14, r: Math.PI },
  { kind: 'bed', pose: 'lie', x: -2.9, z: -1.85, y: 1.05, r: 0 },
];
export function seatsNear(x, z, range) {
  const r = interiorAt(x);
  if (!r) return [];
  return SEATS.map((s, i) => ({ ...s, i, wx: r.x + s.x, wz: r.z + s.z }))
    .filter((s) => Math.hypot(s.wx - x, s.wz - z) < range)
    .sort((a, b) => Math.hypot(a.wx - x, a.wz - z) - Math.hypot(b.wx - x, b.wz - z));
}
// 立ち上がったときに立つ場所
export function standSpot(seat) {
  const r = interiorAt(seat.wx);
  for (const [dx, dz] of [[1.2, 0], [0, 1.2], [1.4, 0.6], [0.8, 1.6], [-1.2, 0], [0, -1.2], [1.6, 1.6]]) {
    const x = seat.wx + dx, z = seat.wz + dz;
    if (r && walkable(x, z)) return { x, z };
  }
  return roomEntry(r);
}
export const doorOf = (h) => ({ x: h.x, z: h.z + h.d / 2 + 0.55 });
export const roomEntry = (r) => ({ x: r.x, z: r.z + ROOM.d / 2 - 1.1 });
export function atRoomExit(x, z) {
  const r = interiorAt(x);
  return !!r && Math.abs(x - r.x) < 0.9 && z > r.z + ROOM.d / 2 - 0.45;
}
function roomWalkable(x, z, rad) {
  const r = interiorAt(x);
  if (!r) return false;
  const lx = x - r.x, lz = z - r.z;
  if (Math.abs(lx) > ROOM.w / 2 - 0.25 - rad || lz < -ROOM.d / 2 + 0.3 + rad) return false;
  // 手前は出口マットのところだけ開いている
  if (lz > ROOM.d / 2 - 0.35 - rad && Math.abs(lx) > 0.9) return false;
  if (lz > ROOM.d / 2) return false;
  for (const [, fx, fz, fw, fd] of FURNITURE) {
    if (Math.abs(lx - fx) < fw / 2 + rad && Math.abs(lz - fz) < fd / 2 + rad) return false;
  }
  return true;
}

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
    if (inPlot(x, z, 1.5) || !clearOf(x, z, trees, 4.2)) continue;
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
    if (nearHouse(x, z, 2) || nearBridge(x, z, 2) || pathDist(x, z) < 1.8 || inPlot(x, z, 1) || !clearOf(x, z, trees, 3) || !clearOf(x, z, rocks, 8)) continue;
    rocks.push({ x, z, s: 0.7 + rnd() * 0.5, r: rnd() * 6 });
  }
  // 花のかたまり
  const palette = ['#f24b5b', '#ffd23f', '#ffffff', '#ff8fc0', '#ff9d3d', '#a77be0', '#6fa8ff'];
  let clumps = 0;
  for (let tries = 0; tries < 3000 && clumps < 34; tries++) {
    const cx = (rnd() * 2 - 1) * 42, cz = (rnd() * 2 - 1) * 40;
    if (!inland(cx, cz, 8) || plazaD(cx, cz) < 0.5 || nearHouse(cx, cz, 0.6) || pathDist(cx, cz) < 1.6 || inPlot(cx, cz, 1)) continue;
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
    if (!inland(x, z, 7.5) || plazaD(x, z) < 0.8 || pathDist(x, z) < 1.2 || nearHouse(x, z, 0.3) || inPlot(x, z, 0.3)) continue;
    tufts.push({ x, z, s: 0.6 + rnd() * 0.6, r: rnd() * 6 });
  }
  return { trees, rocks, flowers, tufts };
}

export const PLACE = buildPlacements();

// 虫が出る場所：花・木の幹・草むら・水辺・岩のそば
function buildBugSpots() {
  const spots = [];
  PLACE.flowers.forEach((f, i) => { if (i % 3 === 0) spots.push({ x: f.x, z: f.z, y: 0.7, hab: 'flower' }); });
  PLACE.trees.forEach((t) => { if (t.kind !== 'palm') spots.push({ x: t.x, z: t.z + 0.3 * t.s, y: 1.0 * t.s, hab: 'tree' }); });
  PLACE.tufts.forEach((t, i) => { if (i % 5 === 0) spots.push({ x: t.x, z: t.z + 0.15, y: 0.18, hab: 'grass' }); });
  PLACE.rocks.forEach((r) => spots.push({ x: r.x, z: r.z + 0.85 * r.s, y: 0.1, hab: 'rock' }));
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
    const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (let t = 3; t < len; t += 7) {
      for (const sgn of [-1, 1]) {
        const x = ax + (bx - ax) * (t / len) + nx * sgn * (RIVER_W + 0.9), z = az + (bz - az) * (t / len) + nz * sgn * (RIVER_W + 0.9);
        if (islandSDF(x, z) < -8 && pondDist(x, z) > 1) spots.push({ x, z, y: 1.1, hab: 'water' });
      }
    }
  }
  for (let a = 0; a < 6.28; a += 0.9) spots.push({ x: POND.x + Math.cos(a) * (POND.rx + 0.9), z: POND.z + Math.sin(a) * (POND.rz + 0.9), y: 1.0, hab: 'water' });
  return spots;
}
export const BUG_SPOTS = buildBugSpots();

// 広場の飾り
export const TOWN_TREE = { x: PLAZA.x, z: PLAZA.z };
export const BOARD = { x: PLAZA.x + 4.5, z: PLAZA.z - 6.2 };
export const LAMPS = [0.6, 2.2, 3.9, 5.4].map((a) => ({ x: PLAZA.x + Math.cos(a) * 8.6, z: PLAZA.z + Math.sin(a) * 8.6 }));
export const SPAWN = { x: PLAZA.x, z: PLAZA.z + 5 };
export const SHOP = { x: -4, z: -3 }; // よろず屋（果物や宝石を買い取ってくれる）

// ---------- 地下通路 ----------
// 地下は x = UNDER_X だけずらした場所にある。地上と同じ向き・同じ縮尺なので、地下で歩いた先は地上のその場所の真下。
export const UNDER_X = 3000;
export const TUNNEL_W = 1.7; // 通路の半分の幅
// 地上の入り口（hatch は家の中の床の扉）
export const UNDER_SPOTS = [
  { key: 'well', kind: 'well', name: '古い井戸', x: 0, z: 6 },
  { key: 'cave', kind: 'cave', name: '北の森のほらあな', x: 6, z: -32 },
  { key: 'beach', kind: 'cave', name: '海辺のほらあな', x: 24, z: 37 },
  { key: 'house', kind: 'hatch', name: 'むらさき屋根の家', x: -32, z: -26, room: 4, hatch: { x: 3.3, z: 1.9 } },
];
// 通路の分かれ道と部屋（地上の座標で）。T は宝箱の部屋
export const UNDER_NODES = {
  well: [0, 6], cave: [6, -32], beach: [24, 37], house: [-32, -26], T: [33, 12],
  J1: [-4, -10], J2: [-21, -17], J3: [14, 22],
};
export const UNDER_EDGES = [['well', 'J1'], ['J1', 'cave'], ['J1', 'J2'], ['J2', 'house'], ['well', 'J3'], ['J3', 'beach'], ['J3', 'T']];
export const UNDER_ROOMS = { well: 3.2, cave: 3.2, beach: 3.2, house: 3.2, T: 3.8, J1: 2.4, J2: 2.4, J3: 2.4 };
export const CHEST = { x: 33, z: 10.4 };

// ---------- 宝石 ----------
// 通路の奥がわの壁に、宝石の岩がある。どの岩に宝石が出るか・何の宝石かは、日（UTC）ごとに決まる。
// サーバー（server.js の gemPlan）も同じ計算をするので、変えるときは両方そろえること。
export const GEM_KINDS = [
  { key: 'amethyst', name: 'アメジスト', color: '#b77cf0', w: 30 },
  { key: 'topaz', name: 'トパーズ', color: '#ffc94a', w: 25 },
  { key: 'emerald', name: 'エメラルド', color: '#3fd08a', w: 18 },
  { key: 'sapphire', name: 'サファイア', color: '#4f8cff', w: 15 },
  { key: 'ruby', name: 'ルビー', color: '#ff4d6d', w: 9 },
  { key: 'diamond', name: 'ダイヤモンド', color: '#e8fbff', w: 3 },
];
export const GEM_HITS = 3; // 何回たたくと取れるか
// ---------- 魚と虫 ----------
// h: 出てくる時間（[はじめ, おわり) の時。はじめ > おわり なら夜をまたぐ）、w: 出やすさ、price: よろず屋の値段
const ALL_DAY = [[0, 24]];
export const FISH = [
  { key: 'funa', name: 'フナ', where: 'river', h: ALL_DAY, w: 30, price: 150 },
  { key: 'oikawa', name: 'オイカワ', where: 'river', h: [[6, 18]], w: 25, price: 200 },
  { key: 'yamame', name: 'ヤマメ', where: 'river', h: [[4, 9], [16, 19]], w: 12, price: 800 },
  { key: 'ayu', name: 'アユ', where: 'river', h: [[6, 18]], w: 12, price: 700 },
  { key: 'nijimasu', name: 'ニジマス', where: 'river', h: ALL_DAY, w: 10, price: 600 },
  { key: 'namazu', name: 'ナマズ', where: 'river', h: [[19, 4]], w: 6, price: 1200 },
  { key: 'medaka', name: 'メダカ', where: 'pond', h: ALL_DAY, w: 30, price: 100 },
  { key: 'koi', name: 'コイ', where: 'pond', h: ALL_DAY, w: 22, price: 400 },
  { key: 'zarigani', name: 'ザリガニ', where: 'pond', h: ALL_DAY, w: 15, price: 300 },
  { key: 'kingyo', name: 'キンギョ', where: 'pond', h: ALL_DAY, w: 5, price: 1300 },
  { key: 'aji', name: 'アジ', where: 'sea', h: ALL_DAY, w: 28, price: 150 },
  { key: 'iwashi', name: 'イワシ', where: 'sea', h: ALL_DAY, w: 25, price: 120 },
  { key: 'mejina', name: 'メジナ', where: 'sea', h: ALL_DAY, w: 15, price: 400 },
  { key: 'agohaze', name: 'アゴハゼ', where: 'sea', h: ALL_DAY, w: 14, price: 200 },
  { key: 'karei', name: 'カレイ', where: 'sea', h: ALL_DAY, w: 10, price: 500 },
  { key: 'fugu', name: 'フグ', where: 'sea', h: [[19, 4]], w: 8, price: 600 },
  { key: 'madako', name: 'マダコ', where: 'sea', h: [[18, 6]], w: 6, price: 1000 },
  { key: 'tai', name: 'タイ', where: 'sea', h: ALL_DAY, w: 4, price: 1500 },
  { key: 'coelacanth', name: 'シーラカンス', where: 'sea', h: ALL_DAY, w: 0.6, price: 15000 },
];
export const BUGS = [
  { key: 'monshiro', name: 'モンシロチョウ', hab: 'flower', h: [[6, 17]], w: 30, price: 120 },
  { key: 'ageha', name: 'アゲハチョウ', hab: 'flower', h: [[6, 17]], w: 12, price: 400 },
  { key: 'tentou', name: 'テントウムシ', hab: 'flower', h: [[6, 17]], w: 20, price: 150 },
  { key: 'mitsubachi', name: 'ミツバチ', hab: 'flower', h: [[8, 17]], w: 15, price: 250 },
  { key: 'semi', name: 'セミ', hab: 'tree', h: [[8, 17]], w: 25, price: 250 },
  { key: 'kamikiri', name: 'カミキリムシ', hab: 'tree', h: ALL_DAY, w: 12, price: 350 },
  { key: 'kabuto', name: 'カブトムシ', hab: 'tree', h: [[17, 8]], w: 6, price: 1500 },
  { key: 'kuwagata', name: 'クワガタ', hab: 'tree', h: [[17, 8]], w: 5, price: 2000 },
  { key: 'batta', name: 'バッタ', hab: 'grass', h: [[6, 17]], w: 28, price: 150 },
  { key: 'korogi', name: 'コオロギ', hab: 'grass', h: [[17, 6]], w: 22, price: 150 },
  { key: 'kamakiri', name: 'カマキリ', hab: 'grass', h: [[8, 17]], w: 10, price: 450 },
  { key: 'tonbo', name: 'トンボ', hab: 'water', h: [[6, 17]], w: 25, price: 200 },
  { key: 'oniyanma', name: 'オニヤンマ', hab: 'water', h: [[8, 16]], w: 6, price: 900 },
  { key: 'hotaru', name: 'ホタル', hab: 'water', h: [[19, 4]], w: 20, price: 300 },
  { key: 'dangomushi', name: 'ダンゴムシ', hab: 'rock', h: ALL_DAY, w: 25, price: 80 },
];
export const WHERE_NAMES = { river: '川', pond: '池', sea: '海', flower: '花', tree: '木', grass: '草むら', water: '水辺', rock: '岩' };
export const inHours = (hour, ranges) => ranges.some(([a, b]) => (a <= b ? hour >= a && hour < b : hour >= a || hour < b));
function pickWeighted(list, r) {
  const total = list.reduce((t, x) => t + x.w, 0);
  let v = r * total;
  for (const x of list) { if (v < x.w) return x.key; v -= x.w; }
  return list.length ? list[list.length - 1].key : null;
}
// いまの時間に、その場所で釣れる魚／出てくる虫（r は 0〜1 の乱数）
export const fishFor = (where, hour, r) => pickWeighted(FISH.filter((f) => f.where === where && inHours(hour, f.h)), r);
export const bugFor = (hab, hour, r) => pickWeighted(BUGS.filter((b) => b.hab === hab && inHours(hour, b.h)), r);
// その場所の水の種類（深さが足りないところは null）
export function waterAt(x, z) {
  if (x > INDOOR_X) return null;
  if (groundHeight(x, z) > WATER_Y - 0.12) return null;
  if (pondDist(x, z) < 0.6) return 'pond';
  if (riverDist(x, z) < RIVER_W + 0.6 && islandSDF(x, z) < -2) return 'river';
  return 'sea';
}
// まわり（半径 r）で一番近い水
export function waterNear(x, z, r = 4.5) {
  for (let d = 0.5; d <= r; d += 0.5) {
    for (let a = 0; a < 6.28; a += 0.4) { const w = waterAt(x + Math.cos(a) * d, z + Math.sin(a) * d); if (w) return w; }
  }
  return null;
}

// ---------- 図鑑とランク ----------
export const DEX_TOTAL = () => FISH.length + BUGS.length + GEM_KINDS.length;
export const RANKS = [
  { min: 0, mark: '🌱', name: 'わかば' },
  { min: 10, mark: '🍀', name: 'みならい' },
  { min: 30, mark: '🌼', name: 'コレクター' },
  { min: 55, mark: '⭐', name: 'はかせ' },
  { min: 80, mark: '🌟', name: 'だいはかせ' },
  { min: 100, mark: '👑', name: 'でんせつ' },
];
export function dexCount(dex) {
  if (!dex) return 0;
  const has = (cat, list) => list.filter((x) => dex[cat] && dex[cat][x.key]).length;
  return has('fish', FISH) + has('bug', BUGS) + has('gem', GEM_KINDS);
}
export function rankOf(dex) {
  const pct = (dexCount(dex) / DEX_TOTAL()) * 100;
  let i = 0;
  RANKS.forEach((r, k) => { if (pct >= r.min) i = k; });
  return { i, pct, ...RANKS[i] };
}

// よろず屋の買い取り値段（ポカ）
export const SELL_PRICES = {
  fruit: { peach: 100, apple: 150, orange: 150, pear: 150, cherry: 200 },
  gem: { amethyst: 300, topaz: 400, emerald: 600, sapphire: 800, ruby: 1500, diamond: 5000 },
  fish: Object.fromEntries(FISH.map((f) => [f.key, f.price])),
  bug: Object.fromEntries(BUGS.map((b) => [b.key, b.price])),
};
export const gemDay = (ms = Date.now()) => Math.floor(ms / 86400000);
export function gemPlan(i, day) {
  const h = hashStr(`gem:${day}:${i}`);
  const active = h % 100 < 60;
  let r = (h >>> 8) % 100;
  let kind = GEM_KINDS[0].key;
  for (const k of GEM_KINDS) { if (r < k.w) { kind = k.key; break; } r -= k.w; }
  return { active, kind };
}
// 置き場所：通路にそって、柱をよけながら、北がわ（画面の奥）の壁に置く
export const PICKAXE_SPOT = { x: -2.3, z: 7.4 }; // 古い井戸の下の部屋（はしごから少しはなす）
function buildGemSpots() {
  const spots = [];
  const segDistLocal = (x, z, a, b) => {
    const vx = b[0] - a[0], vz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz)));
    return Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
  };
  for (const [a, b] of UNDER_EDGES) {
    const A = UNDER_NODES[a], B = UNDER_NODES[b];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const ux = (B[0] - A[0]) / len, uz = (B[1] - A[1]) / len;
    let nx = -uz, nz = ux;
    if (nz > 0) { nx = -nx; nz = -nz; } // 北がわ
    for (let t = 3.5; t < len - 3.5; t += 5.5) {
      if (Math.abs(((t - 5) % 7 + 7) % 7) < 1.3 || Math.abs(((t - 5) % 7 + 7) % 7) > 5.7) continue; // 柱のそば
      const x = A[0] + ux * t + nx * (TUNNEL_W - 0.25), z = A[1] + uz * t + nz * (TUNNEL_W - 0.25);
      // ほかの通路のまん中や部屋にかからない所だけ
      const inOther = UNDER_EDGES.some(([c, d]) => (c !== a || d !== b) && segDistLocal(x, z, UNDER_NODES[c], UNDER_NODES[d]) < TUNNEL_W + 0.3);
      const inRoom = Object.entries(UNDER_ROOMS).some(([k, r]) => Math.hypot(x - UNDER_NODES[k][0], z - UNDER_NODES[k][1]) < r + 0.5);
      if (inOther || inRoom) continue;
      spots.push({ x, z, face: Math.atan2(-nx, -nz) });
    }
  }
  return spots;
}
export const GEM_SPOTS = buildGemSpots();
// 地下での、通路のまん中からの近さ（小さいほど通路の中）
export function tunnelDist(lx, lz) {
  let best = 99;
  for (const [a, b] of UNDER_EDGES) best = Math.min(best, segDist(lx, lz, UNDER_NODES[a], UNDER_NODES[b]) - TUNNEL_W);
  for (const [k, r] of Object.entries(UNDER_ROOMS)) best = Math.min(best, Math.hypot(lx - UNDER_NODES[k][0], lz - UNDER_NODES[k][1]) - r);
  return best;
}
function tunnelWalkable(x, z, rad) {
  const lx = x - UNDER_X;
  // 壁ぎわまで歩けるよう、通路の判定は少しゆるめ
  if (tunnelDist(lx, z) > -rad * 0.5) return false;
  // はしご（部屋のまん中）と宝箱
  for (const sp of UNDER_SPOTS) if (Math.hypot(lx - sp.x, z - sp.z) < 0.25 + rad) return false;
  if (Math.abs(lx - CHEST.x) < 0.75 + rad && Math.abs(z - CHEST.z) < 0.5 + rad) return false;
  for (const g of GEM_SPOTS) if (Math.hypot(lx - g.x, z - g.z) < 0.3 + rad) return false;
  if (Math.hypot(lx - PICKAXE_SPOT.x, z - PICKAXE_SPOT.z) < 0.3 + rad) return false;
  return true;
}
// 地上に出たときに立つ場所（入り口の手前）と、地下におりたときに立つ場所（はしごの手前）
export function surfaceExit(sp) {
  if (sp.kind === 'hatch') {
    const r = INTERIORS[sp.room];
    return { x: r.x + sp.hatch.x - 0.7, z: r.z + sp.hatch.z + 0.9 };
  }
  return { x: sp.x, z: sp.z + 2.1 };
}
export const underEntry = (sp) => ({ x: UNDER_X + sp.x, z: sp.z + 1.4 });

// ---------- ぶつかり判定 ----------
// 当たり判定は見た目より小さめ（木は幹、岩は下のほう）。葉っぱの下はくぐれる
const CIRCLES = [
  ...PLACE.trees.map((t) => ({ x: t.x, z: t.z, r: (t.kind === 'palm' ? 0.25 : 0.34) * t.s })),
  ...PLACE.rocks.map((r) => ({ x: r.x, z: r.z, r: 0.6 * r.s })),
  { x: TOWN_TREE.x, z: TOWN_TREE.z, r: 1.45 },
  { x: BOARD.x, z: BOARD.z, r: 0.8 },
  { x: SHOP.x, z: SHOP.z - 0.2, r: 1.35 },
  ...UNDER_SPOTS.filter((s) => s.kind !== 'hatch').map((s) => ({ x: s.x, z: s.z - (s.kind === 'cave' ? 0.4 : 0), r: s.kind === 'cave' ? 1.5 : 1.1 })),
  ...LAMPS.map((l) => ({ x: l.x, z: l.z, r: 0.15 })),
];
export function walkable(x, z, rad = 0.25) {
  if (x > UNDER_X - 500) return tunnelWalkable(x, z, rad);
  if (x > INDOOR_X) return roomWalkable(x, z, rad);
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
  for (const p of PLOTS) {
    const h = p.house;
    if (ownedPlots.has(p.i) && Math.abs(x - h.x) < h.w / 2 + rad && Math.abs(z - h.z) < h.d / 2 + rad) return false;
    if (Math.hypot(x - p.sign.x, z - p.sign.z) < 0.3 + rad) return false;
  }
  return true;
}
