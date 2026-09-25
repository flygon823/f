// ぽかぽか島 — 静的ファイルの配信と、みんなの位置・おしゃべり・木の実を中継する小さなサーバー。
// 起動: npm install && npm start  →  http://localhost:3000/

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PLAYERS = 60;
const TICK_MS = 100;               // 位置のまとめ送り間隔
const FRUIT_PER_TREE = 3;
const FRUIT_REGROW_MS = 3 * 60 * 1000;
const DROP_TTL_MS = 5 * 60 * 1000;

const MAX_X = 1400;                // 家の中の部屋は x=1000 より先に並んでいる
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
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`ok ${players.size}`);
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
  return { trees: emptyTrees, drops: [...drops.values()].map(publicDrop) };
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

// 島にくる人は みんなロボットの MOMO。選べるのはアクセントの色だけ
function cleanLook(l) {
  l = l && typeof l === 'object' ? l : {};
  return { s: 'momo', f: idx(l.f, 10), c: 0 };
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

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const now = Date.now();

    if (msg.t === 'join') {
      if (me) return;
      if (players.size >= MAX_PLAYERS) { send(ws, { t: 'full' }); ws.close(); return; }
      me = {
        id: String(nextId++),
        ws,
        name: cleanText(msg.name, 12) || 'たびびと',
        look: cleanLook(msg.look),
        x: num(msg.x, -70, MAX_X), z: num(msg.z, -70, 70), r: num(msg.r, -10, 10), m: 0,
        dirty: false, lastChat: 0, lastEmote: 0, lastShake: 0,
      };
      players.set(me.id, me);
      send(ws, {
        t: 'welcome', id: me.id,
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
