// 島の住民。どこにいるかは「いまの時刻」だけで決まるので、サーバーがなくても全員の画面で同じ場所を歩く。
import { walkable, PLAZA, HOUSES, doorOf, inPlot } from './world.js';

export const RESIDENT = {
  id: '__resident',
  name: 'こむぎ',
  look: { s: 'hamster', furHex: '#f3cf92', shirtHex: '#8fd0ea', stripe: '#ffffff' },
  voice: 1.6,
};

const SPEED = 1.9;   // 歩く速さ（住民はのんびり）
const PAUSE = 8;     // 立ち止まる秒数

// 立ち寄る場所
const d = (h) => { const p = doorOf(h); return [p.x, p.z + 1.2]; };
const STOPS = [
  [PLAZA.x, PLAZA.z + 9.2],
  [12.5, 12.5],
  d(HOUSES[3]),
  d(HOUSES[2]),
  [23, 8],
  d(HOUSES[1]),
  d(HOUSES[0]),
  [PLAZA.x + 9.5, PLAZA.z - 1],
];

// 0.5 きざみの格子で道をさがし、見通しのきく点だけ残す
function findPath(a, b) {
  const S = 0.5, R = 48, N = Math.round((2 * R) / S);
  const key = (i, j) => j * N + i;
  const toI = (v) => Math.round((v + R) / S);
  const ok = new Map();
  const free = (i, j) => {
    const k = key(i, j);
    // 売り地には あとから家が建つので、はじめから通らない
    if (!ok.has(k)) ok.set(k, i >= 0 && j >= 0 && i < N && j < N && walkable(i * S - R, j * S - R, 0.45) && !inPlot(i * S - R, j * S - R, 0.6));
    return ok.get(k);
  };
  const si = toI(a[0]), sj = toI(a[1]), gi = toI(b[0]), gj = toI(b[1]);
  const prev = new Map([[key(si, sj), -1]]);
  let q = [[si, sj]];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (q.length && !prev.has(key(gi, gj))) {
    const next = [];
    for (const [i, j] of q) for (const [di, dj] of dirs) {
      const ni = i + di, nj = j + dj, k = key(ni, nj);
      if (prev.has(k) || !free(ni, nj)) continue;
      prev.set(k, key(i, j));
      next.push([ni, nj]);
    }
    q = next;
  }
  if (!prev.has(key(gi, gj))) return [a, b];
  const cells = [];
  for (let k = key(gi, gj); k !== -1; k = prev.get(k)) cells.push([(k % N) * S - R, Math.floor(k / N) * S - R]);
  cells.reverse();
  const clear = (p, q2) => {
    const n = Math.ceil(Math.hypot(q2[0] - p[0], q2[1] - p[1]) / 0.25);
    for (let t = 1; t < n; t++) {
      const x = p[0] + (q2[0] - p[0]) * t / n, z = p[1] + (q2[1] - p[1]) * t / n;
      if (!walkable(x, z, 0.4) || inPlot(x, z, 0.6)) return false;
    }
    return true;
  };
  const out = [a];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !clear(out[out.length - 1], cells[j])) j--;
    out.push(cells[j]);
    i = j;
  }
  out[out.length - 1] = b;
  return out;
}

// 1周ぶんの予定表：[開始秒, 種類, データ]
let plan = null, cycle = 0;
function buildPlan() {
  plan = [];
  let t = 0;
  for (let s = 0; s < STOPS.length; s++) {
    const a = STOPS[s], b = STOPS[(s + 1) % STOPS.length];
    plan.push({ t, kind: 'stay', at: a, dur: PAUSE });
    t += PAUSE;
    const pts = findPath(a, b);
    for (let k = 0; k < pts.length - 1; k++) {
      const p = pts[k], q = pts[k + 1];
      const dur = Math.hypot(q[0] - p[0], q[1] - p[1]) / SPEED;
      if (dur <= 0) continue;
      plan.push({ t, kind: 'walk', from: p, to: q, dur });
      t += dur;
    }
  }
  cycle = t;
}

// いまの時刻での位置と向き
export function residentPose(nowMs = Date.now()) {
  if (!plan) buildPlan();
  const t = (nowMs / 1000) % cycle;
  let seg = plan[0];
  for (const p of plan) { if (p.t <= t) seg = p; else break; }
  const u = (t - seg.t) / seg.dur;
  if (seg.kind === 'stay') {
    // 立ち止まっているあいだは、ときどき あたりを見まわす
    return { x: seg.at[0], z: seg.at[1], r: Math.sin(seg.t + Math.floor(u * 3) * 2.1) * 1.4, moving: false };
  }
  const [ax, az] = seg.from, [bx, bz] = seg.to;
  return { x: ax + (bx - ax) * u, z: az + (bz - az) * u, r: Math.atan2(bx - ax, bz - az), moving: true };
}

// ---------- おしゃべり ----------
const GREET = (h, n) => {
  if (h < 5) return `あれっ、${n}！ こんな夜中に おさんぽだもち？`;
  if (h < 11) return `おはよう、${n}！ きょうも いい朝だもち〜`;
  if (h < 17) return `こんにちは、${n}！ ぽかぽかして きもちいいもち`;
  if (h < 20) return `${n}、こんばんは！ 夕やけが きれいだもち`;
  return `${n}、こんばんは。夜の島も すてきだもち`;
};
const TIPS = [
  (n) => `わたし、こむぎ。この島に住んでる ハムスターだもち。${n}とは なかよくしたいもち！`,
  () => '実のなる木を ゆらすと、くだものが落ちてくるもち。3分まてば また実るんだもち',
  () => 'ポカは この島のお金だもち。木をゆらして ポカぶくろが出たら ラッキーもち！',
  () => '家の中には 入ってみたもち？ 家ごとに へやの色が ちがうんだもち',
  () => '左上の地図を見ると、いま島の どこにいるか わかるもち。タップすると大きくなるもち',
  (n) => `${n}の服、とっても にあってるもち！`,
  () => '川は 橋をわたらないと むこうに行けないもち。およぐのは ちょっとこわいもち…',
  () => 'ひろばの大きな木は、島で いちばん古い木なんだもち',
  () => 'ほかの人に会ったら、リアクションで あいさつしてみるもち！',
  () => 'ひろばの西の よろず屋で、くだものや宝石を ポカに かえてもらえるもち',
  () => 'よろず屋で つりざおと あみを もらえるもち。池では キンギョが つれることも あるらしいもち',
  () => 'ウキが ちょんちょん うごいても、まだだもち。ボチャン！と しずんだ しゅんかんに つりあげるもち',
  () => '水の中の 魚の影を よく見るもち。大きな影は 大物だもち。海の おきに すごく大きな影が いたら…もしかすると もしかするもち',
  () => '虫は 走って近づくと にげちゃうもち。そーっと あるくのが コツだもち',
  () => '夜の川べりには ホタルが 出るもち。木には カブトムシも いるかもしれないもち…！',
  () => '図鑑を うめると ランクが上がって、名前のよこの マークが かわるもち。わたしは まだ 🌱 だもち',
  () => '砂浜の 潮だまりを のぞいてみて。ヒトデや ウニが いるもち。夜には クリオネが およいでることも あるらしいもち',
  () => '島のあちこちに「売り地」の看板があるもち。ポカを ためたら、自分の家が たてられるもち！',
  () => '土地は ひとり ひとつまでだもち。しばらく来ないと 空き地にもどっちゃうから 気をつけるもち',
];
export function residentLines(playerName, hour, talkCount) {
  const n = playerName || 'あなた';
  const tip = TIPS[(talkCount * 5 + Math.floor(Math.random() * TIPS.length)) % TIPS.length](n);
  return talkCount === 0 ? [GREET(hour, n), tip] : [tip];
}
