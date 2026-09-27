# ぽかぽか島 — 引き継ぎメモ（Claude Code 用）

このフォルダ（`village/`）は、ブラウザで誰でも入れる「どうぶつの森」風の小さなメタバース **ぽかぽか島** です。
リポジトリの一番上の `index.html`（月と潮の磯）は **別のプロジェクト**です。ここからは 生きものの形（`makeFish` など）を借りただけなので、さわらないでください。

## ユーザーとのやりとり
- 返事は **日本語**、やさしい言葉で。ユーザーはプログラマーではありません。専門用語には ひとこと説明をつける。
- 秘密の値（Stripe のキー、Neon の接続文字列、Anthropic の API キー）は **チャットに貼ってもらわない**。Render の Environment に直接入れてもらう。
- PR のマージは **ユーザーが自分でする**（Claude からマージしない）。
- コミットや PR にモデル名（claude-… など）を書かない。

## いまの状態（2026-09-26）
- 作業ブランチ：`claude/intelligent-heisenberg-8ncqi7` → **PR #2**（https://github.com/flygon823/f/pull/2 、ベースは `claude/kind-bohr-3qhz5d`、まだマージされていない・競合なし・CI なし）。
- 公開中：https://pokapoka-island.onrender.com/ （Render。PR #1 の内容。PR #2 はマージ後に自動で出る）。
- claude.ai のページ版（アーティファクト）：https://claude.ai/artifact/VULbgzLVVnLtUNjg1x8nY8
  （`public/*.js` と `index.html` の中身、`models/index.json` を files で出している。capabilities は `room`（topics shake/pick/hit/gem = interact）と `sample`）。

### ユーザーに お願いしていること（まだ）
1. **Neon の `DATABASE_URL` を Render に設定**してから PR #2 をマージ（設定しないと再起動でポカや図鑑が消える）。手順は README。
2. 島ナビを AI で答えさせたいなら **`ANTHROPIC_API_KEY` を Render に設定**（なければキーワードで答える）。本物のキーでの動作は まだ試していない。
3. **Meshy AI で住民3体を作る**（こむぎ＝ハムスター、もみじ＝レッサーパンダ、ちゃぷ＝カワウソ）。プロンプトは下。
   できた `.glb` は `village/models-src/` に GitHub の画面からアップロードしてもらう約束。

### 次にやること
- `village/models-src/` に `.glb` が来たら：
  ```bash
  cd village/tools && npm install
  node prep-model.mjs ../models-src/<ファイル>.glb komugi   # momiji / chapu も同じ
  ```
  → `public/models/<キー>.glb` と `public/models/index.json` ができる。ブラウザで見て、向きが逆なら
  `public/models.js` の `MODEL_SPECS` の `yaw`（例：`Math.PI`）、大きさは `height` を直す。
  元の `.glb`（models-src のもの）は島では使わないので、処理後に消してよい。
- 住民のモデルは骨なし。体ごと ゆらして歩いて見せている（`villager.js` の `attachModel`）。手に持つ道具（ちゃぷのつりざお）の位置は、モデルを見てから `attachModel` の `hand` の位置を調整する。

### Meshy のプロンプト（Text to 3D、ポーズなし・左右対称・ポリゴン少なめ・絵 2K・GLB）
無料プランは ひと月 100 クレジット、絵つき1体 ≒ 30 クレジット（形 20 + 絵 10）。API はクレジット購入が必要なので使っていない。
- こむぎ：`a cute chibi hamster girl villager, cream and light orange fur, round ears, white muzzle and chubby cheeks, wearing a light blue and white striped T-shirt, standing upright on two short legs, big round head, small body, simple smooth toy-like shapes, soft pastel colors, clean flat textures, full body, facing forward, no base`
- もみじ：`a cute chibi red panda shopkeeper villager, reddish-orange fur with white eyebrow marks and white cheeks, dark brown legs, big fluffy ringed tail, wearing a yellow apron over a cream shirt, standing upright on two short legs, big round head, small body, simple smooth toy-like shapes, soft pastel colors, clean flat textures, full body, facing forward, no base`
- ちゃぷ：`a cute chibi river otter fisherman villager, brown fur, pale beige muzzle and belly, small round ears, long thick tail, wearing a teal and white striped shirt and a small bucket hat, standing upright on two short legs, big round head, small body, simple smooth toy-like shapes, soft pastel colors, clean flat textures, full body, facing forward, no base`

## しくみ（ざっくり）
- `server.js`：Node。静的ファイル + WebSocket（`ws`）。島の状態（木の実・宝石・虫・魚の影）と、アカウント・お金はサーバーが持つ。起動時に `public/world.js`・`public/guide.js` を import（`public/package.json` で ESM）。
- `economy.js`：アカウント（引き継ぎコードは sha256 だけ保存）・ポケット・図鑑・売り買い・土地。`store.js`：`DATABASE_URL` があれば Postgres、なければ `data/island.json`。`payments.js`：Stripe（カラーパス 300円）。
- `public/world.js`：島の形・家・土地・宝石・魚/虫/磯の表・魚の影の場所・図鑑ランク。**サーバーと画面で同じもの**を使う（決まった乱数）。
- `public/app.js`：画面のほぼ全部（島づくり・操作・つり・図鑑・カード・島ナビ・会話・地図）。three.js 0.169（jsdelivr の importmap）。地面が曲がって見えるシェーダーは `gfx.js` の `curvify`。
- `public/net.js`：3つのつながり方（サーバー / claude.ai の room / ひとり）。ひとり・room では `LocalWorld` が虫と魚の影をサーバーと同じ決まりで出す。
- `public/villager.js`（MOMO と動物）、`resident.js`（歩く住民こむぎ）、`npcs.js`（もみじ・ちゃぷ）、`creatures.js`（魚・虫・磯の3D）、`guide.js`（島ナビの知識とキーワード答え）、`models.js`（Meshy モデル読みこみ）。
- 島ナビ：サーバーは `@anthropic-ai/sdk` で `claude-opus-5`（effort low、`fallbacks: "default"`）。1人1時間30回・全体600回まで。ページ版は `sample` capability。

## 動かしかた・確かめかた
```bash
cd village && npm install && npm start      # http://localhost:3000
DATA_FILE=/tmp/test.json npm start          # テスト用に保存先を分ける
```
- 画面の確認は Playwright（ヘッドレス Chromium）でやってきた。WebGL は `--use-angle=swiftshader --enable-unsafe-swiftshader` で動く。とても遅いので、テレポート後は数秒待つ（カメラが追いつくまで）。
- テストでは `window.__island`（people, me, npcs, resident, shadowObjs, bugObjs, fishing, guideMark など）から状態を見たり、`me.x/me.z` を書きかえて瞬間移動させている。
- サーバーを止めるときは `pkill -f "node server.js"` を使わない（自分のシェルごと落ちる）。`kill $(pgrep -f "^node server.js")` を使う。
- `node --check` で構文チェックしてからコミットする。

## 気をつけること
- サーバーとページ版の両方で動くように：`serverMode()` のときはサーバーが持ち主、そうでなければ端末（localStorage）。
- 魚の影・虫は「どの種類か」をサーバーだけが決める（画面には大きさだけ）。
- NPC の会話は `startTalk(npc, onEnd)`。パネル（`.modal.on`）が開いているあいだは島の操作を止めている。
- 新しいファイルを足したら、ページ版を出しなおすときの files にも入れる。
