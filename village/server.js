// ぽかぽか島 — 静的ファイルの配信と、みんなの位置・おしゃべり・木の実を中継する小さなサーバー。
// 起動: npm install && npm start  →  http://localhost:3000/

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const payments = require('./payments');
const { createStore } = require('./store');
const { Economy, formatCode } = require('./economy');

let W = null;        // public/world.js（島の形・宝石・土地。画面と同じものを使う）
let economy = null;  // アカウント・ポケット・土地
let G = null;        // public/guide.js（島ナビの知識）

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PLAYERS = 60;
const TICK_MS = 100;               // 位置のまとめ送り間隔
const FRUIT_PER_TREE = 3;
const FRUIT_REGROW_MS = 3 * 60 * 1000;
const DROP_TTL_MS = 5 * 60 * 1000;

const MAX_X = 3200;                // 家の中の部屋は x=1000 から、地下通路は x=3000 あたりにある
const GEM_REGROW_MS = 10 * 60 * 1000;
const EMOTES = ['wave', 'happy', 'sad', 'angry', 'wow', 'sleepy', 'love', 'music'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------- 静的ファイル ----------
// ---------- カラーパスの支払い API ----------
function json(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(data));
}
function readBody(req, max = 4096) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > max) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
const hits = new Map(); // IP ごとの回数（支払いページやアカウントの作りすぎを防ぐ）
const ipOf = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
function tooMany(req, what = 'checkout', max = 10) {
  const key = what + ':' + ipOf(req);
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < 10 * 60e3);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}
async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST' });
    return res.end();
  }
  if (url.pathname === '/api/account') {
    // 引き継ぎコードが本物かどうかだけ答える（入力を試しすぎないよう回数をしぼる）
    if (tooMany(req, 'acct', 30)) return json(res, 429, { error: 'too_many' });
    return json(res, 200, { ok: !!economy.find(url.searchParams.get('code')) });
  }
  if (url.pathname === '/api/config') {
    return json(res, 200, { payments: payments.enabled(), price: payments.PRICE, ai: aiEnabled() });
  }
  if (url.pathname === '/api/premium') {
    return json(res, 200, { premium: await payments.verify(url.searchParams.get('code')) });
  }
  if (url.pathname === '/api/checkout' && req.method === 'POST') {
    if (!payments.enabled()) return json(res, 503, { error: 'not_configured' });
    if (tooMany(req)) return json(res, 429, { error: 'too_many' });
    const body = await readBody(req);
    // もどり先は、この島のページ（呼び出し元と同じ場所）だけにする
    let back = `https://${req.headers.host}/`;
    try {
      const u = new URL(String(body.returnUrl || ''));
      const origin = req.headers.origin;
      if ((u.protocol === 'https:' || u.protocol === 'http:') && (u.origin === origin || u.host === req.headers.host)) back = u.origin + u.pathname;
    } catch { /* 決まったもどり先を使う */ }
    try {
      return json(res, 200, { url: await payments.createCheckout(back) });
    } catch (e) {
      console.error('[checkout]', e.message);
      return json(res, 502, { error: 'stripe_error' });
    }
  }
  return json(res, 404, { error: 'not_found' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`ok ${players.size}`);
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => { console.error(e); json(res, 500, { error: 'server_error' }); });
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403); res.end(); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------- 島の状態 ----------
const players = new Map();   // id -> player
const trees = new Map();     // treeIndex -> { fruit, regrowAt }
const drops = new Map();     // dropId -> { id, tree, slot, kind, at }
const gems = new Map();      // spot -> { minedUntil, hits, lastHit }
let nextId = 1;
let nextDrop = 1;

function treeState(i) {
  let t = trees.get(i);
  if (!t) { t = { fruit: FRUIT_PER_TREE, regrowAt: 0 }; trees.set(i, t); }
  if (t.fruit === 0 && t.regrowAt && Date.now() >= t.regrowAt) { t.fruit = FRUIT_PER_TREE; t.regrowAt = 0; }
  return t;
}

function worldSnapshot() {
  const emptyTrees = [];
  for (const [i] of trees) {
    const t = treeState(i);
    if (t.fruit < FRUIT_PER_TREE) emptyTrees.push([i, t.fruit]);
  }
  const now = Date.now();
  const mined = [];
  for (const [i, g] of gems) if (g.minedUntil > now) mined.push([i, g.minedUntil - now]);
  return { trees: emptyTrees, drops: [...drops.values()].map(publicDrop), gems: mined };
}

const publicDrop = (d) => ({ id: d.id, tree: d.tree, slot: d.slot, kind: d.kind });
const publicPlayer = (p) => ({ id: p.id, name: p.name, look: p.look, x: p.x, z: p.z, r: p.r, m: p.m, rank: p.rank || 0 });

// ---------- 虫（島のみんなで同じ虫を見る） ----------
// 陸の虫と、砂浜の潮だまり（カニ・ヤドカリ・磯の生きもの）は、べつべつの数だけ出す
const MAX_BUGS = 10;
const MAX_SHORE = 5;
const bugs = new Map(); // id -> { id, key, spot, shore, until }
let nextBug = 1;
const jstHour = () => new Date(Date.now() + 9 * 3600e3).getUTCHours();
const bugList = () => [...bugs.values()].map((b) => [b.id, b.key, b.spot]);
const isShore = (spot) => ['shore', 'pool'].includes(W.BUG_SPOTS[spot].hab);
let SPOTS = null; // { land: [...], shore: [...] } 虫が出る場所の番号
const countBugs = (shore) => [...bugs.values()].filter((b) => b.shore === shore).length;
function spawnBug(shore = false) {
  SPOTS ||= { land: W.BUG_SPOTS.map((_, i) => i).filter((i) => !isShore(i)), shore: W.BUG_SPOTS.map((_, i) => i).filter(isShore) };
  const list = shore ? SPOTS.shore : SPOTS.land;
  const spot = list[Math.floor(Math.random() * list.length)];
  if ([...bugs.values()].some((b) => b.spot === spot)) return false;
  const key = W.bugFor(W.BUG_SPOTS[spot].hab, jstHour(), Math.random());
  if (!key) return false;
  const id = String(nextBug++);
  bugs.set(id, { id, key, spot, shore, until: Date.now() + (180 + Math.random() * 180) * 1000 });
  return true;
}
function bugTick() {
  const now = Date.now();
  let changed = false;
  for (const b of bugs.values()) if (b.until < now) { bugs.delete(b.id); changed = true; }
  if (countBugs(false) < MAX_BUGS && Math.random() < 0.6 && spawnBug(false)) changed = true;
  if (countBugs(true) < MAX_SHORE && Math.random() < 0.5 && spawnBug(true)) changed = true;
  if (changed) broadcast({ t: 'bugs', list: bugList() });
}
// ---------- 魚の影（どの魚かはサーバーだけが知っている。画面には大きさだけ送る） ----------
const shadows = new Map(); // id -> { id, key, spot, until }
let nextShadow = 1;
const shadowList = () => [...shadows.values()].map((f) => [f.id, W.fishSize(f.key), f.spot]);
function spawnShadow(where) {
  const list = W.FISH_SPOTS.map((_, i) => i).filter((i) => W.FISH_SPOTS[i].where === where);
  const spot = list[Math.floor(Math.random() * list.length)];
  if (spot === undefined || [...shadows.values()].some((f) => f.spot === spot)) return false;
  const key = W.fishFor(where, jstHour(), Math.random());
  if (!key) return false;
  const id = 'f' + nextShadow++;
  shadows.set(id, { id, key, spot, until: Date.now() + (240 + Math.random() * 240) * 1000 });
  return true;
}
const countShadows = (where) => [...shadows.values()].filter((f) => W.FISH_SPOTS[f.spot].where === where).length;
function shadowTick() {
  const now = Date.now();
  let changed = false;
  for (const f of shadows.values()) if (f.until < now) { shadows.delete(f.id); changed = true; }
  for (const [where, max] of Object.entries(W.SHADOW_MAX)) {
    if (countShadows(where) < max && Math.random() < 0.5 && spawnShadow(where)) changed = true;
  }
  if (changed) broadcast({ t: 'shadows', list: shadowList() });
}
// 影に手がとどく（つりざおの先 + 泳いでいるぶん）くらい近くにいるか
const nearShadow = (me, f) => { const sp = W.FISH_SPOTS[f.spot]; return Math.hypot(sp.x - me.x, sp.z - me.z) < 9; };

// ---------- 島ナビ（AI に島のことを聞く） ----------
// ANTHROPIC_API_KEY があるときだけ Claude に聞く。ないとき・エラーのときは キーワードで答える。
const AI_MODEL = process.env.AI_MODEL || 'claude-opus-5';
const ASK_PER_HOUR = Number(process.env.AI_ASK_PER_HOUR) || 30;     // ひとりあたり
const ASK_ALL_PER_HOUR = Number(process.env.AI_ASK_ALL_PER_HOUR) || 600; // 島ぜんぶで（お金のつかいすぎ防止）
const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;
let anthropic = null;
const askLog = new Map(); // accountId -> [時刻…]
let askAll = [];
async function askClaude(q, ctx) {
  if (!anthropic) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ maxRetries: 1, timeout: 45000 });
  }
  const res = await anthropic.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: G.GUIDE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: G.guideUser(q, ctx) }],
  });
  if (res.stop_reason === 'refusal') return { answer: 'ごめんね、それには こたえられないみたい。', place: null };
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return G.parseAnswer(text);
}
function askAllowed(me, now) {
  const hourAgo = now - 3600e3;
  askAll = askAll.filter((t) => t > hourAgo);
  const mine = (askLog.get(me.account.id) || []).filter((t) => t > hourAgo);
  askLog.set(me.account.id, mine);
  if (mine.length >= ASK_PER_HOUR || askAll.length >= ASK_ALL_PER_HOUR) return false;
  mine.push(now); askAll.push(now);
  return true;
}

// 虫をつかまえた・魚をつった・磯の生きものをひろった：ポケットと図鑑に入れて、ランクが上がったらみんなに知らせる
function caught(me, kind, key) {
  const before = me.rank;
  const first = kind === 'fish' ? economy.gotFish(me.account, key) : kind === 'iso' ? economy.gotIso(me.account, key) : economy.gotBug(me.account, key);
  send(me.ws, { t: 'caught', kind, key, first });
  send(me.ws, { t: 'me', me: economy.view(me.account) });
  me.rank = economy.rank(me.account);
  if (me.rank !== before) broadcast({ t: 'rank', id: me.id, rank: me.rank });
}

// ---------- 入力の検査 ----------
const cleanText = (s, max) => String(s ?? '')
  .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, '')
  .trim()
  .slice(0, max);
const num = (v, lo, hi, d = 0) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const idx = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : 0);

// 有料プラン（カラーパスを買った人）かどうか。送られてきた購入の番号か、アカウントに覚えてある番号を Stripe で確かめる
async function isPremium(msg, account) {
  if (msg && msg.pass && await payments.verify(msg.pass)) { account.pass = msg.pass; economy.save(account); return true; }
  return !!(account.pass && await payments.verify(account.pass));
}

// 島にくる人は みんなロボットの MOMO。アクセントの色を選べるのは有料プランの人だけ（無料はミント = 0）
function cleanLook(l, premium) {
  l = l && typeof l === 'object' ? l : {};
  return { s: 'momo', f: premium ? idx(l.f, 10) : 0, c: 0 };
}

// ---------- 送信 ----------
function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(data);
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

const sockets = new Map(); // accountId -> ws（同じアカウントで2か所から入ったら古いほうを切る）
wss.on('connection', (ws, req) => {
  let me = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let joining = false;
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const now = Date.now();

    if (msg.t === 'join') {
      if (me || joining) return;
      if (players.size >= MAX_PLAYERS) { send(ws, { t: 'full' }); ws.close(); return; }
      joining = true;
      const name = cleanText(msg.name, 12) || 'たびびと';
      // アカウント：引き継ぎコード（token）があればそれで、なければ新しく作る
      let account = economy.find(msg.token), newToken = null;
      if (!account) {
        if (tooMany(req, 'newacct', 20)) { joining = false; send(ws, { t: 'full' }); ws.close(); return; }
        const made = economy.create(name);
        account = made.account; newToken = made.token;
      }
      const premium = await isPremium(msg, account);
      joining = false;
      if (ws.readyState !== 1) return;
      const old = sockets.get(account.id);
      if (old && old !== ws) { send(old, { t: 'dup' }); old.close(); }
      sockets.set(account.id, ws);
      const look = cleanLook(msg.look, premium);
      economy.touch(account, name, look.f);
      me = {
        id: String(nextId++),
        ws,
        account,
        name,
        look,
        premium,
        rank: economy.rank(account),
        x: num(msg.x, -70, MAX_X), z: num(msg.z, -70, 70), r: num(msg.r, -10, 10), m: 0,
        dirty: false, lastChat: 0, lastEmote: 0, lastShake: 0,
      };
      players.set(me.id, me);
      send(ws, {
        t: 'welcome', id: me.id, premium, pass: account.pass || undefined,
        token: newToken || undefined,
        me: economy.view(account),
        plots: economy.plotsView(),
        players: [...players.values()].filter((p) => p !== me).map(publicPlayer),
        world: worldSnapshot(),
        bugs: bugList(),
        shadows: shadowList(),
      });
      broadcast({ t: 'plots', plots: economy.plotsView() }, me.id); // 看板の名前が変わったかもしれない
      broadcast({ t: 'join', p: publicPlayer(me) }, me.id);
      console.log(`[join] ${me.name} (${players.size}人)`);
      return;
    }
    if (!me) return;

    switch (msg.t) {
      case 'move':
        me.x = num(msg.x, -70, MAX_X, me.x);
        me.z = num(msg.z, -70, 70, me.z);
        me.r = num(msg.r, -10, 10, me.r);
        me.m = idx(msg.m, 5); // 0 たつ 1 あるく 2 はしる 3 すわる 4 ねころぶ
        me.dirty = true;
        if (me.m === 2 && bugs.size) {
          // 走って近づくと、虫はにげる（磯の生きものは にげない）
          const fled = [];
          for (const b of bugs.values()) {
            if (W.critterCat(b.key) === 'iso') continue;
            const sp = W.BUG_SPOTS[b.spot];
            if (Math.hypot(sp.x - me.x, sp.z - me.z) < 3.2) { bugs.delete(b.id); fled.push(b.id); }
          }
          if (fled.length) broadcast({ t: 'bugs', list: bugList(), fled });
          // 岸を走ると、魚の影も にげる
          const gone = [];
          for (const f of shadows.values()) {
            const sp = W.FISH_SPOTS[f.spot];
            if (Math.hypot(sp.x - me.x, sp.z - me.z) < 3.5) { shadows.delete(f.id); gone.push(f.id); }
          }
          if (gone.length) broadcast({ t: 'shadows', list: shadowList(), fled: gone });
        }
        break;
      case 'chat': {
        const text = cleanText(msg.text, 80);
        if (!text || now - me.lastChat < 600) return;
        me.lastChat = now;
        broadcast({ t: 'chat', id: me.id, text });
        break;
      }
      case 'emote': {
        if (!EMOTES.includes(msg.e) || now - me.lastEmote < 400) return;
        me.lastEmote = now;
        broadcast({ t: 'emote', id: me.id, e: msg.e });
        break;
      }
      case 'shake': {
        const i = msg.i;
        if (!Number.isInteger(i) || i < 0 || i >= 1000 || now - me.lastShake < 700) return;
        me.lastShake = now;
        const t = treeState(i);
        const fresh = [];
        if (msg.fruit === true && t.fruit > 0) {
          for (let s = 0; s < t.fruit; s++) fresh.push({ id: String(nextDrop++), tree: i, slot: s, kind: 'fruit', at: now });
          t.fruit = 0;
          t.regrowAt = now + FRUIT_REGROW_MS;
        }
        if (Math.random() < 0.12) fresh.push({ id: String(nextDrop++), tree: i, slot: 3, kind: 'coin', at: now });
        for (const d of fresh) drops.set(d.id, d);
        broadcast({ t: 'shake', id: me.id, i, fruit: t.fruit, drops: fresh.map(publicDrop) });
        break;
      }
      case 'hit': {
        // ピッケルで宝石の岩をたたく。GEM_HITS 回目で掘れる
        const i = msg.i;
        if (!Number.isInteger(i) || i < 0 || i >= W.GEM_SPOTS.length || now - (me.lastHit || 0) < 350) return;
        me.lastHit = now;
        const plan = W.gemPlan(i, W.gemDay(now));
        let g = gems.get(i);
        if (!g) { g = { minedUntil: 0, hits: 0, lastHit: 0 }; gems.set(i, g); }
        if (!plan.active || g.minedUntil > now) { broadcast({ t: 'hit', id: me.id, i, n: 0 }); return; }
        if (now - g.lastHit > 20000) g.hits = 0;
        g.hits++; g.lastHit = now;
        if (g.hits < W.GEM_HITS) { broadcast({ t: 'hit', id: me.id, i, n: g.hits }); return; }
        g.hits = 0;
        g.minedUntil = now + GEM_REGROW_MS;
        const firstGem = economy.gotGem(me.account, plan.kind);
        broadcast({ t: 'gem', id: me.id, i, kind: plan.kind, regrow: GEM_REGROW_MS, first: firstGem });
        send(ws, { t: 'me', me: economy.view(me.account) });
        { const r = economy.rank(me.account); if (r !== me.rank) { me.rank = r; broadcast({ t: 'rank', id: me.id, rank: r }); } }
        break;
      }
      case 'pick': {
        const d = drops.get(String(msg.id));
        if (!d) return;
        drops.delete(d.id);
        if (d.kind === 'coin') {
          const amount = economy.gotCoins(me.account);
          send(ws, { t: 'got', id: d.id, kind: 'coin', tree: d.tree, amount });
        } else {
          economy.gotFruit(me.account, W.PLACE.trees[d.tree]?.fruit || 'peach');
          send(ws, { t: 'got', id: d.id, kind: 'fruit', tree: d.tree });
        }
        send(ws, { t: 'me', me: economy.view(me.account) });
        broadcast({ t: 'picked', id: d.id, by: me.id });
        break;
      }
      case 'catch': {
        // 虫とりあみで つかまえる／磯の生きものを ひろう（近くにいるときだけ）
        const b = bugs.get(String(msg.id));
        if (!b || now - (me.lastCatch || 0) < 400) return;
        me.lastCatch = now;
        const sp = W.BUG_SPOTS[b.spot];
        const cat = W.critterCat(b.key);
        if (Math.hypot(sp.x - me.x, sp.z - me.z) > 3.4) { send(ws, { t: 'caught', kind: cat, key: null }); return; }
        bugs.delete(b.id);
        broadcast({ t: 'bugs', list: bugList() });
        caught(me, cat, b.key);
        break;
      }
      case 'fish': {
        // 魚の影を つりあげた。どの魚かは、影が出たときにサーバーが決めてある
        if (now - (me.lastFish || 0) < 2500) return;
        me.lastFish = now;
        const f = shadows.get(String(msg.id));
        if (!f || !nearShadow(me, f)) { send(ws, { t: 'caught', kind: 'fish', key: null }); return; }
        shadows.delete(f.id);
        broadcast({ t: 'shadows', list: shadowList() });
        caught(me, 'fish', f.key);
        break;
      }
      case 'ask': {
        const q = cleanText(msg.q, 120);
        const id = String(msg.id || '').slice(0, 20);
        if (!q) return;
        if (now - (me.lastAsk || 0) < 3000) { send(ws, { t: 'answer', id, answer: 'ちょっと まってね。つぎの質問は 少しあけてね。', place: null }); return; }
        me.lastAsk = now;
        if (!aiEnabled() || !askAllowed(me, now)) { send(ws, { t: 'answer', id, ...G.offlineAnswer(q), offline: true }); return; }
        const ctx = { where: cleanText(msg.where, 30), x: me.x, z: me.z, hour: jstHour() };
        askClaude(q, ctx)
          .then((r) => send(ws, { t: 'answer', id, ...r }))
          .catch((e) => {
            console.error('[ask]', e.status || '', e.message);
            send(ws, { t: 'answer', id, ...G.offlineAnswer(q), offline: true });
          });
        break;
      }
      case 'spook': {
        // はやく引きすぎた・おそすぎた：その影は にげていく
        const f = shadows.get(String(msg.id));
        if (!f || !nearShadow(me, f)) return;
        shadows.delete(f.id);
        broadcast({ t: 'shadows', list: shadowList(), fled: [f.id] });
        break;
      }
      case 'chest': {
        send(ws, { t: 'chest', amount: economy.chest(me.account) });
        send(ws, { t: 'me', me: economy.view(me.account) });
        break;
      }
      case 'sell': {
        const gained = economy.sell(me.account, String(msg.what), String(msg.key));
        send(ws, { t: 'sold', what: msg.what, key: msg.key, gained });
        send(ws, { t: 'me', me: economy.view(me.account) });
        break;
      }
      case 'buyPlot': {
        const error = economy.buyPlot(me.account, msg.i);
        send(ws, { t: 'plotResult', action: 'buy', i: msg.i, error });
        send(ws, { t: 'me', me: economy.view(me.account) });
        if (!error) { broadcast({ t: 'plots', plots: economy.plotsView() }); console.log(`[plot] ${me.name} が ${msg.i}番の土地を買いました`); }
        break;
      }
      case 'releasePlot': {
        const refund = economy.releasePlot(me.account);
        send(ws, { t: 'plotResult', action: 'release', refund });
        send(ws, { t: 'me', me: economy.view(me.account) });
        if (refund) broadcast({ t: 'plots', plots: economy.plotsView() });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!me) return;
    if (sockets.get(me.account.id) === ws) sockets.delete(me.account.id);
    economy.touch(me.account);
    players.delete(me.id);
    broadcast({ t: 'leave', id: me.id });
    console.log(`[leave] ${me.name} (${players.size}人)`);
  });
});

// 動いた人の位置だけ、まとめて配る
setInterval(() => {
  const moved = [];
  for (const p of players.values()) {
    if (p.dirty) { moved.push([p.id, +p.x.toFixed(2), +p.z.toFixed(2), +p.r.toFixed(2), p.m]); p.dirty = false; }
  }
  if (moved.length) broadcast({ t: 'state', ps: moved });
}, TICK_MS);

// 落ちたまま拾われない木の実を片付ける／切れた接続を掃除する
setInterval(() => {
  const now = Date.now();
  const gone = [];
  for (const d of drops.values()) if (now - d.at > DROP_TTL_MS) { drops.delete(d.id); gone.push(d.id); }
  for (const id of gone) broadcast({ t: 'picked', id, by: null });
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

(async () => {
  W = await import('./public/world.js');
  G = await import('./public/guide.js');
  console.log(`[ai] 島ナビ: ${aiEnabled() ? `Claude（${AI_MODEL}）` : 'キーワードで答える（ANTHROPIC_API_KEY なし）'}`);
  economy = new Economy(createStore(), W);
  await economy.init();
  for (let k = 0; k < MAX_BUGS * 2 && countBugs(false) < MAX_BUGS - 2; k++) spawnBug(false);
  for (let k = 0; k < MAX_SHORE * 2 && countBugs(true) < MAX_SHORE - 1; k++) spawnBug(true);
  for (const [where, max] of Object.entries(W.SHADOW_MAX)) for (let k = 0; k < max * 3 && countShadows(where) < max; k++) spawnShadow(where);
  setInterval(bugTick, 4000);
  setInterval(shadowTick, 5000);
  server.listen(PORT, () => {
    console.log(`ぽかぽか島がひらきました → http://localhost:${PORT}/`);
  });
})().catch((e) => { console.error('起動できませんでした:', e); process.exit(1); });
