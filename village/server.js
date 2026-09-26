// ぽかぽか島 — 静的ファイルの配信と、みんなの位置・おしゃべり・木の実を中継する小さなサーバー。
// 起動: npm install && npm start  →  http://localhost:3000/

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const payments = require('./payments');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PLAYERS = 60;
const TICK_MS = 100;               // 位置のまとめ送り間隔
const FRUIT_PER_TREE = 3;
const FRUIT_REGROW_MS = 3 * 60 * 1000;
const DROP_TTL_MS = 5 * 60 * 1000;

const MAX_X = 3200;                // 家の中の部屋は x=1000 から、地下通路は x=3000 あたりにある
// 地下の宝石（public/world.js の GEM_KINDS・gemPlan と同じ計算。変えるときは両方そろえる）
const GEM_KINDS = [['amethyst', 30], ['topaz', 25], ['emerald', 18], ['sapphire', 15], ['ruby', 9], ['diamond', 3]];
const GEM_SPOT_COUNT = 19;
const GEM_HITS = 3;
const GEM_REGROW_MS = 10 * 60 * 1000;
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function gemPlan(i, day) {
  const h = hashStr(`gem:${day}:${i}`);
  let r = (h >>> 8) % 100, kind = GEM_KINDS[0][0];
  for (const [k, w] of GEM_KINDS) { if (r < w) { kind = k; break; } r -= w; }
  return { active: h % 100 < 60, kind };
}
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
const checkoutHits = new Map(); // IP ごとの回数（支払いページの作りすぎを防ぐ）
function tooMany(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const list = (checkoutHits.get(ip) || []).filter((t) => now - t < 10 * 60e3);
  list.push(now);
  checkoutHits.set(ip, list);
  return list.length > 10;
}
async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST' });
    return res.end();
  }
  if (url.pathname === '/api/config') {
    return json(res, 200, { payments: payments.enabled(), price: payments.PRICE });
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
const publicPlayer = (p) => ({ id: p.id, name: p.name, look: p.look, x: p.x, z: p.z, r: p.r, m: p.m });

// ---------- 入力の検査 ----------
const cleanText = (s, max) => String(s ?? '')
  .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, '')
  .trim()
  .slice(0, max);
const num = (v, lo, hi, d = 0) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const idx = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : 0);

// 有料プラン（カラーパスを買った人）かどうか。join のときに送られてくる購入の番号を Stripe で確かめる
const isPremium = (msg) => payments.verify(msg && msg.pass);

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

wss.on('connection', (ws) => {
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
      const premium = await isPremium(msg);
      joining = false;
      if (ws.readyState !== 1) return;
      me = {
        id: String(nextId++),
        ws,
        name: cleanText(msg.name, 12) || 'たびびと',
        look: cleanLook(msg.look, premium),
        premium,
        x: num(msg.x, -70, MAX_X), z: num(msg.z, -70, 70), r: num(msg.r, -10, 10), m: 0,
        dirty: false, lastChat: 0, lastEmote: 0, lastShake: 0,
      };
      players.set(me.id, me);
      send(ws, {
        t: 'welcome', id: me.id, premium,
        players: [...players.values()].filter((p) => p !== me).map(publicPlayer),
        world: worldSnapshot(),
      });
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
        if (!Number.isInteger(i) || i < 0 || i >= GEM_SPOT_COUNT || now - (me.lastHit || 0) < 350) return;
        me.lastHit = now;
        const plan = gemPlan(i, Math.floor(now / 86400000));
        let g = gems.get(i);
        if (!g) { g = { minedUntil: 0, hits: 0, lastHit: 0 }; gems.set(i, g); }
        if (!plan.active || g.minedUntil > now) { broadcast({ t: 'hit', id: me.id, i, n: 0 }); return; }
        if (now - g.lastHit > 20000) g.hits = 0;
        g.hits++; g.lastHit = now;
        if (g.hits < GEM_HITS) { broadcast({ t: 'hit', id: me.id, i, n: g.hits }); return; }
        g.hits = 0;
        g.minedUntil = now + GEM_REGROW_MS;
        broadcast({ t: 'gem', id: me.id, i, kind: plan.kind, regrow: GEM_REGROW_MS });
        break;
      }
      case 'pick': {
        const d = drops.get(String(msg.id));
        if (!d) return;
        drops.delete(d.id);
        send(ws, { t: 'got', id: d.id, kind: d.kind, tree: d.tree });
        broadcast({ t: 'picked', id: d.id, by: me.id });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!me) return;
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

server.listen(PORT, () => {
  console.log(`ぽかぽか島がひらきました → http://localhost:${PORT}/`);
});
