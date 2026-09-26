// 島ナビ：MOMO の頭のテレビに住んでいる案内役。島のことを AI に たずねるための知識と、答えの読みかた。
// サーバー（server.js）とページ（app.js）の両方から使う。AI が使えないときは offlineAnswer がキーワードで答える。
import {
  SHOP, PLAZA, BOARD, POND, HOUSES, UNDER_SPOTS, CHEST, BRIDGES, TIDEPOOLS, PLOTS, PLOT_PRICE,
  FISH, BUGS, ISO, GEM_KINDS, RANKS, DEX_TOTAL, UNDER_X, INDOOR_X,
} from './world.js';
import { NPCS } from './npcs.js';

// 方角と きょり（北は画面の奥 = z がマイナス）
const DIRS = ['東', '南東', '南', '南西', '西', '北西', '北', '北東'];
export function direction(fromX, fromZ, x, z) {
  const dx = x - fromX, dz = z - fromZ, d = Math.hypot(dx, dz);
  if (d < 4) return 'すぐ近く';
  const i = Math.round(Math.atan2(dz, dx) / (Math.PI / 4));
  return `${DIRS[(i + 8) % 8]}へ ${Math.round(d)}歩くらい`;
}

// 地図にしるしを つけられる場所（key は AI が答えに使う）
const well = UNDER_SPOTS.find((s) => s.key === 'well');
const cave = UNDER_SPOTS.find((s) => s.key === 'cave');
const beachCave = UNDER_SPOTS.find((s) => s.key === 'beach');
export const PLACES = {
  shop: { name: 'よろず屋', x: SHOP.x, z: SHOP.z, note: '店主は レッサーパンダの もみじ。果物・魚・虫・磯の生きもの・宝石を ポカで買いとる。つりざおと虫とりあみを ただで くれる' },
  chapu: { name: 'ちゃぷ', x: NPCS[1].spot.x, z: NPCS[1].spot.z, note: 'カワウソの つり名人。南の橋の 下流の岸にいる。つりのコツと、いま ねらい目の魚を 教えてくれる' },
  plaza: { name: 'ひろば', x: PLAZA.x, z: PLAZA.z, note: '島のまんなか。大きな木がある。はじめはここに来る' },
  board: { name: 'けいじばん', x: BOARD.x, z: BOARD.z, note: 'ひろばにある。島のお知らせ' },
  pond: { name: '池', x: POND.x, z: POND.z, note: 'メダカ・コイ・ザリガニ・キンギョが つれる' },
  bridge_n: { name: '北の橋', x: BRIDGES[0].x, z: BRIDGES[0].z, note: '川をわたる橋' },
  bridge_s: { name: '南の橋', x: BRIDGES[1].x, z: BRIDGES[1].z, note: '川をわたる橋' },
  well: { name: '古い井戸', x: well.x, z: well.z, note: '地下通路の入り口。おりた部屋に ピッケルが ある' },
  cave: { name: '北の森のほらあな', x: cave.x, z: cave.z, note: '地下通路の入り口' },
  beach_cave: { name: '海辺のほらあな', x: beachCave.x, z: beachCave.z, note: '地下通路の入り口。宝箱の部屋に近い' },
  chest: { name: '地下の宝箱', x: CHEST.x, z: CHEST.z, note: '地下通路のおく（地上の この場所の真下）。1日1回 ポカが もらえる。海辺のほらあな か 古い井戸 から行く' },
  tidepool: { name: '潮だまり', x: TIDEPOOLS[0].x, z: TIDEPOOLS[0].z, note: '砂浜の7か所。ヒトデ・ウニ・イソギンチャク（夜はまれにクリオネ）を手でひろえる。まわりに カニ・ヤドカリ', near: 'tidepool' },
  plot: { name: '売り地', x: PLOTS[0].x, z: PLOTS[0].z, note: `12区画。${PLOT_PRICE.toLocaleString('ja-JP')} ポカで買うと 自分の家が建つ`, near: 'plot' },
  resident: { name: 'こむぎ', x: PLAZA.x, z: PLAZA.z, note: '島の住民のハムスター。島を おさんぽしている。話すと ヒントを くれる', near: 'resident' },
  ...Object.fromEntries(HOUSES.map((h, i) => [`house${i}`, { name: h.name, x: h.x, z: h.z, note: i === 4 ? '家の中の床の扉から 地下へ おりられる' : '中に入れる' }])),
};
export const PLACE_KEYS = Object.keys(PLACES);

const fishByWhere = (w) => FISH.filter((f) => f.where === w).map((f) => f.name).join('・');
const bugsByHab = (h) => BUGS.filter((b) => b.hab === h).map((b) => b.name).join('・');

// 島ナビのきまり（変わらない部分。サーバーではキャッシュする）
export const GUIDE_SYSTEM = `あなたは「ぽかぽか島」という、みんなで遊べるブラウザのゲームの案内役「島ナビ」です。
プレイヤーは テレビの頭をしたロボット「MOMO」で、あなたは その頭のテレビの中に住んでいます。

# 話しかた
- やさしく、ひらがな多めの 日本語で、2〜3文（全部で 100字くらいまで）。
- 場所を聞かれたら、方角（北・南東 など。北は画面の奥）と だいたいの歩数で 教える。
- 知らないこと・島にないものは「わからない」「この島には ないみたい」と言う。作り話をしない。
- 島と関係のない質問にも みじかく答えてよいが、島で遊ぶヒントに つなげる。

# 島のこと
- お金は「ポカ」。果物をひろう、ポカぶくろ、よろず屋で売る、地下の宝箱（1日1回）で ふえる。
- そうさ：WASD/矢印で歩く、Shift で走る、E か スペースで「しらべる・ひろう・つる・つかまえる・話す・入る」、B で図鑑、M で地図を大きく、Enter でおしゃべり、1〜8 でリアクション、Q で島ナビ。スマホは左下のスティックと A ボタン。
- 木をゆらすと 果物や ポカぶくろが落ちる（3分でまた実る）。
- 魚つり：よろず屋で つりざおを もらう。海・川・池に 魚の影が泳いでいる。影の近くに ウキを投げ（水ぎわで E）、ツンツンは まだ、ウキが しずんだ瞬間に E。早すぎると にげる。影が大きいほど 大物。岸を走ると にげる。
  - 川：${fishByWhere('river')}／池：${fishByWhere('pond')}／海：${fishByWhere('sea')}
  - 時間で出る魚が変わる（日本時間）。シーラカンスは海の とても大きな影。
- 虫とり：よろず屋で 虫とりあみを もらう。走って近づくと にげるので そっと。
  - 花：${bugsByHab('flower')}／木：${bugsByHab('tree')}／草むら：${bugsByHab('grass')}／水べ：${bugsByHab('water')}／岩：${bugsByHab('rock')}／砂浜：${bugsByHab('shore')}
- 磯あそび：砂浜の潮だまりに ${ISO.map((x) => x.name).join('・')}。道具なしで 手でひろえる。
- 宝石：地下通路の壁の 宝石の岩を、ピッケル（古い井戸をおりた部屋にある）で3回たたく。${GEM_KINDS.map((g) => g.name).join('・')}。どの岩に出るかは日ごとに変わる。
- 地下通路：入り口は 古い井戸・北の森のほらあな・海辺のほらあな・むらさき屋根の家の床の扉 の4か所。川の下を通る近道。
- 図鑑：魚・虫・磯・宝石の 全${DEX_TOTAL()}種類。うめるほど ランクが上がり、名前の横のマークが変わる（${RANKS.map((r) => `${r.mark}${r.name}`).join('→')}）。
- 売り地：${PLOT_PRICE.toLocaleString('ja-JP')} ポカで買うと 自分の家が建つ。ひとり1区画。30日来ないと空き地にもどる。手放すと半額もどる。
- アカウント：はじめて入ると自動でできる。「？」の画面の 引き継ぎコードを 別の端末で入れると 続きから遊べる。
- MOMO の色：無料はミント色。カラーパス（買い切り）で10色から選べる。
- 住民：ハムスターの こむぎ（島を おさんぽ）、レッサーパンダの もみじ（よろず屋の店主）、カワウソの ちゃぷ（川べりの つり名人）。
- 空・BGM・魚や虫は 本当の時間と つながっている。

# 場所（key：名前・ひろばからの方角・メモ）
${PLACE_KEYS.map((k) => { const p = PLACES[k]; return `- ${k}：${p.name}・${p.near === 'resident' ? 'いつも歩いている（いまいる所に しるしを つける）' : p.near ? 'いくつかある（プレイヤーに いちばん近い所に しるしを つける）' : direction(PLAZA.x, PLAZA.z, p.x, p.z)}・${p.note}`; }).join('\n')}

# 答えの形
次の JSON だけを返す（ほかの文字は書かない）：
{"answer": "プレイヤーへの返事", "place": "上の key のどれか、または null"}
place は「どこ？」「行きかた」など、地図に しるしを つけると役に立つときだけ入れる。`;

// プレイヤーごとに変わる部分
export function guideUser(q, ctx = {}) {
  const lines = [];
  if (ctx.where) lines.push(`プレイヤーは いま「${ctx.where}」にいます。`);
  // 地上（地下なら その真上）にいるときは、プレイヤーから見た方角を そえる
  let x = Number(ctx.x), z = Number(ctx.z);
  if (x > UNDER_X - 500) x -= UNDER_X;
  if (Number.isFinite(x) && Number.isFinite(z) && x < INDOOR_X) {
    lines.push('プレイヤーから見た 各場所の方角：');
    for (const k of PLACE_KEYS) { const p = PLACES[k]; if (!p.near) lines.push(`- ${k}（${p.name}）：${direction(x, z, p.x, p.z)}`); }
  }
  if (Number.isFinite(ctx.hour)) lines.push(`島の時刻：${ctx.hour}時ごろ（日本時間）。`);
  lines.push(`質問：${q}`);
  return lines.join('\n');
}

// AI の返事から { answer, place } を取りだす
export function parseAnswer(text) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(s.slice(a, b + 1));
      const place = typeof j.place === 'string' && PLACES[j.place] ? j.place : null;
      if (typeof j.answer === 'string' && j.answer.trim()) return { answer: j.answer.trim().slice(0, 300), place };
    } catch { /* JSON でなければ そのまま使う */ }
  }
  return { answer: s.replace(/[{}]/g, '').trim().slice(0, 300) || 'うまく こたえられなかった…もう一度 聞いてみてね。', place: null };
}

// AI が使えないときの答え（キーワードで さがす）
const RULES = [
  [/ちゃぷ|カワウソ|つり名人/, 'chapu', 'ちゃぷは 南の橋の 下流の岸で つりをしているよ。つりのコツを 教えてくれるよ。'],
  [/もみじ|レッサーパンダ|店主/, 'shop', 'もみじは よろず屋の 店主だよ。ひろばの西の お店にいるよ。'],
  [/店|みせ|ミセ|よろず|売|うる|買いと|かいと|つりざお|竿|あみ|網/, 'shop', 'よろず屋は ひろばの西がわだよ。売り買いと、つりざお・虫とりあみも そこで もらえるよ。'],
  [/宝箱|たからばこ/, 'chest', '宝箱は 地下通路の おくにあるよ。海辺のほらあな か 古い井戸 から 地下へ おりてね。1日1回 ポカが もらえるよ。'],
  [/宝石|ほうせき|ピッケル|掘|ほる/, 'well', '宝石は 地下通路の壁の岩に あるよ。古い井戸を おりた部屋の ピッケルを ひろって、岩を3回 たたいてね。'],
  [/地下|井戸|いど|ほらあな|洞窟/, 'well', '地下へは 古い井戸・北の森のほらあな・海辺のほらあな・むらさき屋根の家の床の扉 から おりられるよ。'],
  [/潮だまり|磯|いそ|ヒトデ|ウニ|イソギンチャク|クリオネ|カニ|ヤドカリ/, 'tidepool', '砂浜の 潮だまりに いるよ。ヒトデや ウニは 手で ひろえるし、まわりには カニや ヤドカリも いるよ。'],
  [/池|いけ|メダカ|コイ|キンギョ|ザリガニ/, 'pond', '池は ひろばの東にあるよ。つりざおで メダカや コイが つれるよ。'],
  [/釣|つり|つる|魚|さかな/, 'shop', '水の中の 魚の影の近くに ウキを投げてね。ツンツンは まだ、しずんだら E！ つりざおは よろず屋で もらえるよ。'],
  [/虫|むし|チョウ|カブト|クワガタ|セミ|ホタル/, 'shop', '虫は 花・木・草むら・水べ に いるよ。そっと近づいて、虫とりあみで E。あみは よろず屋で もらえるよ。'],
  [/土地|売り地|家を|いえを|建て/, 'plot', `売り地は 島に12区画あるよ。${PLOT_PRICE.toLocaleString('ja-JP')} ポカで買うと 自分の家が建つよ。`],
  [/こむぎ|住民|ハムスター/, 'resident', 'こむぎは 島を おさんぽしているよ。地図の 黄色い点が こむぎだよ。'],
  [/図鑑|ずかん|ランク|マーク/, null, `B キーか 右上の 📖 で 図鑑が見られるよ。全${DEX_TOTAL()}種類を うめるほど ランクが上がるよ。`],
  [/ポカ|お金|おかね|稼|かせ/, 'shop', '木をゆらして ポカぶくろを ひろったり、つった魚や 虫を よろず屋で 売ると ポカが たまるよ。'],
  [/引き継ぎ|ひきつぎ|コード|別の端末/, null, '「？」の画面に 引き継ぎコードが 出ているよ。別の端末の はじめの画面で 入れると 続きから遊べるよ。'],
  [/色|いろ|カラー/, null, 'MOMO の色は カラーパスを買うと 10色から 選べるよ。はじめの画面から 買えるよ。'],
  [/ひろば|広場|けいじばん|掲示板/, 'plaza', 'ひろばは 島のまんなか。大きな木と けいじばんが あるよ。'],
];
export function offlineAnswer(q) {
  const s = String(q || '');
  for (const [re, place, answer] of RULES) if (re.test(s)) return { answer, place };
  return { answer: 'ごめんね、いまは くわしく わからないんだ。「お店はどこ？」「宝石はどこでほれる？」みたいに 聞いてみてね。', place: null };
}
