// 決まった場所にいる住民（こむぎ は resident.js で島を歩く）。
// どこにいるかも 何を話すかも 決まっているので、サーバーがなくても全員の画面で同じ。
import { SHOP, RIVER_W, BRIDGES, riverXAt, walkable, inPlot, FISH, inHours, SELL_PRICES } from './world.js';

// ちゃぷ の立ち位置：南の橋より すこし下流の、川の東がわの岸
function riverSpot() {
  for (let z = 25; z < 40; z += 0.5) {
    const x = riverXAt(z) + RIVER_W + 1.4;
    const b = BRIDGES[1];
    if (Math.hypot(x - b.x, z - b.z) < 6 || !walkable(x, z, 0.4) || inPlot(x, z, 1)) continue;
    return { x, z, r: -Math.PI / 2 }; // 川（西）を向く
  }
  return { x: -13, z: 27.5, r: -Math.PI / 2 };
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const WHERE = { river: '川', pond: '池', sea: '海' };

// いまの時間に つれる魚のうち、めずらしいもの
function rareNow(hour) {
  const out = [];
  for (const where of ['river', 'pond', 'sea']) {
    // シーラカンスは ひみつ。めずらしい上から3つのうち どれかを 教える
    const list = FISH.filter((f) => f.where === where && f.sz < 6 && inHours(hour, f.h)).sort((a, b) => a.w - b.w).slice(0, 3);
    if (list.length) out.push(`${WHERE[where]}なら ${pick(list).name}`);
  }
  return out;
}

export const NPCS = [
  {
    id: '__momiji',
    name: 'もみじ',
    role: 'shop', // 話しおわると よろず屋が ひらく
    look: { s: 'redpanda', furHex: '#c9643a', shirtHex: '#f6d55c', stripe: '#fff4d6' },
    model: 'momiji',
    voice: 1.3,
    spot: { x: SHOP.x, z: SHOP.z - 0.75, r: 0 },
    lines(name, hour, count) {
      const n = name || 'おきゃくさん';
      const hello = hour < 11 ? 'おはようございます' : hour < 18 ? 'いらっしゃいませ' : 'こんばんは';
      const tips = [
        `ダイヤモンドは ${SELL_PRICES.gem.diamond.toLocaleString('ja-JP')} ポカで 買いとりますよ♪ 地下で ほれたら 見せてくださいね`,
        'つりざおと 虫とりあみは、ただで さしあげていますよ♪',
        'シーラカンスを つった人は、まだ 見たことが ないんですよ…',
        '売っても 図鑑からは 消えないので、安心してくださいね♪',
      ];
      return count === 0
        ? [`${hello}！ よろず屋の もみじです♪ ${n}さん、なにを 売ってくれますか？`]
        : [`${hello}、${n}さん♪ ${pick(tips)}`];
    },
  },
  {
    id: '__chapu',
    name: 'ちゃぷ',
    look: { s: 'otter', furHex: '#8a6448', shirtHex: '#4fb3bf', stripe: '#ffffff' },
    model: 'chapu',
    voice: 0.95,
    tool: 'rod',
    spot: riverSpot(),
    lines(name, hour, count) {
      const n = name || 'きみ';
      const rare = rareNow(hour);
      const tips = [
        '影が 大きいほど 大物だっぷ。いちばん大きい影は…海の おきで 見たことが あるっぷ',
        'ウキが ツンツンしても がまんだっぷ。ぐっと しずんだら いまだっぷ！',
        '岸を 走ると 魚が にげるっぷ。そーっと 近づくのが コツだっぷ',
        '影の すぐ近くに なげないと、魚は 気づかないっぷ',
        '大物は ひっぱりあいが 長いっぷ。ふんばれっぷ！',
      ];
      const lines = [];
      if (count === 0) lines.push(`おっ、${n}も つりが すきっぷ？ おいらは ちゃぷ。この川で つりばっかり してるっぷ`);
      lines.push(pick(tips));
      if (rare.length) lines.push(`いまの時間は、${rare.join('、')} が ねらい目だっぷ`);
      return lines;
    },
  },
];
