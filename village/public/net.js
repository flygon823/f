// 通信のつなぎ方は3通り。どれでも、アプリには同じ形のメッセージが届く。
//  1. server : server.js の WebSocket（ネットで誰でも入れる）
//  2. room   : claude.ai の Artifact として開いたとき、同じページを開いている人どうし
//  3. solo   : どちらもつながらないときは、ひとりで遊べる

import { gemPlan, gemDay, GEM_HITS, GEM_SPOTS, BUG_SPOTS, bugFor, fishFor, critterCat, FISH_SPOTS, SHADOW_MAX, fishSize } from './world.js';

const FRUIT_PER_TREE = 3;
const GEM_REGROW_MS = 10 * 60 * 1000;
const FRUIT_REGROW_MS = 3 * 60 * 1000;

const isShore = (i) => ['shore', 'pool'].includes(BUG_SPOTS[i].hab);
const LAND_SPOTS = BUG_SPOTS.map((_, i) => i).filter((i) => !isShore(i));
const SHORE_SPOTS = BUG_SPOTS.map((_, i) => i).filter(isShore);

// サーバーがいないときに、木の実と落とし物を手元で管理する
class LocalWorld {
  constructor() { this.trees = new Map(); this.drops = new Map(); this.gems = new Map(); this.bugs = new Map(); this.nextBug = 1; this.shadows = new Map(); this.nextShadow = 1; }
  // ---- 虫（この端末だけで出す） ----
  bugList() { return [...this.bugs.values()].map((b) => [b.id, b.key, b.spot]); }
  // 陸の虫（10ぴき）と、砂浜の潮だまり（5ひき）は べつに数える。サーバーと同じ
  spawnBug(shore = false) {
    const list = shore ? SHORE_SPOTS : LAND_SPOTS;
    const spot = list[Math.floor(Math.random() * list.length)];
    if ([...this.bugs.values()].some((b) => b.spot === spot)) return false;
    const key = bugFor(BUG_SPOTS[spot].hab, new Date().getHours(), Math.random());
    if (!key) return false;
    const id = 'b' + this.nextBug++;
    this.bugs.set(id, { id, key, spot, shore, until: Date.now() + (180 + Math.random() * 180) * 1000 });
    return true;
  }
  count(shore) { return [...this.bugs.values()].filter((b) => b.shore === shore).length; }
  bugTick() {
    let changed = false;
    for (const b of this.bugs.values()) if (b.until < Date.now()) { this.bugs.delete(b.id); changed = true; }
    if (this.count(false) < 10 && Math.random() < 0.6 && this.spawnBug(false)) changed = true;
    if (this.count(true) < 5 && Math.random() < 0.5 && this.spawnBug(true)) changed = true;
    return changed;
  }
  flee(x, z) {
    const fled = [];
    for (const b of this.bugs.values()) {
      if (critterCat(b.key) === 'iso') continue; // 磯の生きものは にげない
      const sp = BUG_SPOTS[b.spot];
      if (Math.hypot(sp.x - x, sp.z - z) < 3.2) { this.bugs.delete(b.id); fled.push(b.id); }
    }
    return fled;
  }
  // 虫・魚を つかまえる（はんていは、サーバーと同じ）
  catchBug(id, x, z) {
    const b = this.bugs.get(id);
    if (!b) return null;
    const sp = BUG_SPOTS[b.spot];
    if (Math.hypot(sp.x - x, sp.z - z) > 3.4) return null;
    this.bugs.delete(id);
    return b.key;
  }
  // ---- 魚の影（サーバーと同じ決まり） ----
  shadowList() { return [...this.shadows.values()].map((f) => [f.id, fishSize(f.key), f.spot]); }
  countShadows(where) { return [...this.shadows.values()].filter((f) => FISH_SPOTS[f.spot].where === where).length; }
  spawnShadow(where) {
    const list = FISH_SPOTS.map((_, i) => i).filter((i) => FISH_SPOTS[i].where === where);
    const spot = list[Math.floor(Math.random() * list.length)];
    if (spot === undefined || [...this.shadows.values()].some((f) => f.spot === spot)) return false;
    const key = fishFor(where, new Date().getHours(), Math.random());
    if (!key) return false;
    const id = 'f' + this.nextShadow++;
    this.shadows.set(id, { id, key, spot, until: Date.now() + (240 + Math.random() * 240) * 1000 });
    return true;
  }
  shadowTick() {
    let changed = false;
    for (const f of this.shadows.values()) if (f.until < Date.now()) { this.shadows.delete(f.id); changed = true; }
    for (const [where, max] of Object.entries(SHADOW_MAX)) if (this.countShadows(where) < max && Math.random() < 0.5 && this.spawnShadow(where)) changed = true;
    return changed;
  }
  scareShadows(x, z) {
    const gone = [];
    for (const f of this.shadows.values()) { const sp = FISH_SPOTS[f.spot]; if (Math.hypot(sp.x - x, sp.z - z) < 3.5) { this.shadows.delete(f.id); gone.push(f.id); } }
    return gone;
  }
  // 影を つりあげる／にがす（近くにいるときだけ）
  takeShadow(id, x, z) {
    const f = this.shadows.get(id);
    if (!f) return null;
    const sp = FISH_SPOTS[f.spot];
    if (Math.hypot(sp.x - x, sp.z - z) > 9) return null;
    this.shadows.delete(id);
    return f.key;
  }
  // 宝石の岩をたたく：{ n: たたいた回数, kind: 掘れたら宝石の種類 }
  hitGem(i) {
    const now = Date.now();
    if (!Number.isInteger(i) || i < 0 || i >= GEM_SPOTS.length) return null;
    const plan = gemPlan(i, gemDay(now));
    let g = this.gems.get(i);
    if (!g) { g = { minedUntil: 0, hits: 0, lastHit: 0 }; this.gems.set(i, g); }
    if (!plan.active || g.minedUntil > now) return { n: 0 };
    if (now - g.lastHit > 20000) g.hits = 0;
    g.hits++; g.lastHit = now;
    if (g.hits < GEM_HITS) return { n: g.hits };
    g.hits = 0;
    g.minedUntil = now + GEM_REGROW_MS;
    return { n: GEM_HITS, kind: plan.kind };
  }
  markMined(i) {
    this.gems.set(i, { minedUntil: Date.now() + GEM_REGROW_MS, hits: 0, lastHit: 0 });
  }
  fruitOf(i) {
    const t = this.trees.get(i);
    if (!t) return FRUIT_PER_TREE;
    if (t.fruit === 0 && Date.now() >= t.regrowAt) { this.trees.delete(i); return FRUIT_PER_TREE; }
    return t.fruit;
  }
  snapshot() {
    const trees = [];
    for (const [i] of this.trees) { const f = this.fruitOf(i); if (f < FRUIT_PER_TREE) trees.push([i, f]); }
    const now = Date.now();
    const gems = [];
    for (const [i, g] of this.gems) if (g.minedUntil > now) gems.push([i, g.minedUntil - now]);
    return { trees, drops: [...this.drops.values()], gems };
  }
  planShake(i, fruitTree, tag) {
    const drops = [];
    if (fruitTree && this.fruitOf(i) > 0) {
      for (let s = 0; s < this.fruitOf(i); s++) drops.push({ id: `${tag}-${s}`, tree: i, slot: s, kind: 'fruit' });
    }
    if (Math.random() < 0.12) drops.push({ id: `${tag}-b`, tree: i, slot: 3, kind: 'coin' });
    return drops;
  }
  applyShake(i, drops) {
    if (drops.some((d) => d.kind === 'fruit')) this.trees.set(i, { fruit: 0, regrowAt: Date.now() + FRUIT_REGROW_MS });
    for (const d of drops) this.drops.set(d.id, d);
    return this.fruitOf(i);
  }
}

function serverUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q.replace(/\/$/, '') + (q.endsWith('/ws') ? '' : '/ws');
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

// ひとりモード・room で、虫・磯の生きもの・魚の影を手元で動かす
function localCreatures(local, onMessage) {
  for (let k = 0; k < 20 && local.count(false) < 8; k++) local.spawnBug(false);
  for (let k = 0; k < 10 && local.count(true) < 4; k++) local.spawnBug(true);
  for (const [where, max] of Object.entries(SHADOW_MAX)) for (let k = 0; k < max * 3 && local.countShadows(where) < max; k++) local.spawnShadow(where);
  setInterval(() => { if (local.bugTick()) onMessage({ t: 'bugs', list: local.bugList() }); }, 4000);
  setInterval(() => { if (local.shadowTick()) onMessage({ t: 'shadows', list: local.shadowList() }); }, 5000);
  let lastFish = 0;
  return (msg) => {
    switch (msg.t) {
      case 'join': onMessage({ t: 'bugs', list: local.bugList() }); onMessage({ t: 'shadows', list: local.shadowList() }); return true;
      case 'move':
        if (msg.m === 2) {
          const fled = local.flee(msg.x, msg.z);
          if (fled.length) onMessage({ t: 'bugs', list: local.bugList(), fled });
          const gone = local.scareShadows(msg.x, msg.z);
          if (gone.length) onMessage({ t: 'shadows', list: local.shadowList(), fled: gone });
        }
        return false;
      case 'catch': {
        const b = local.bugs.get(String(msg.id));
        if (!b) return true;
        const kind = critterCat(b.key);
        const key = local.catchBug(b.id, msg.x, msg.z);
        onMessage({ t: 'bugs', list: local.bugList() });
        onMessage({ t: 'caught', kind, key });
        return true;
      }
      case 'fish': {
        if (Date.now() - lastFish < 2500) return true;
        lastFish = Date.now();
        const key = local.takeShadow(String(msg.id), msg.x, msg.z);
        onMessage({ t: 'shadows', list: local.shadowList() });
        onMessage({ t: 'caught', kind: 'fish', key });
        return true;
      }
      case 'spook': {
        if (local.takeShadow(String(msg.id), msg.x, msg.z)) onMessage({ t: 'shadows', list: local.shadowList(), fled: [String(msg.id)] });
        return true;
      }
    }
    return false;
  };
}

// ---------- 1. WebSocket サーバー ----------
function connectServer(onMessage, onStatus) {
  const url = serverUrl();
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    let ws, joinMsg = null, opened = false, stopped = false;
    const api = {
      mode: 'server',
      // 同じアカウントで ほかの画面から入られたときは、つなぎなおさない
      stop() { stopped = true; if (ws) ws.close(); },
      send(msg) {
        if (msg.t === 'join') joinMsg = msg;
        if (msg.t === 'move' && joinMsg) joinMsg = { ...joinMsg, x: msg.x, z: msg.z, r: msg.r };
        if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
      },
    };
    const open = () => {
      try { ws = new WebSocket(url); } catch { resolve(null); return; }
      ws.onopen = () => {
        if (!opened) { opened = true; resolve(api); }
        else { onStatus('online'); if (joinMsg) ws.send(JSON.stringify(joinMsg)); }
      };
      ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
      ws.onclose = () => {
        if (!opened) { resolve(null); return; }
        if (stopped) return;
        onStatus('offline');
        setTimeout(open, 2500);
      };
    };
    open();
  });
}

// ---------- 2. claude.ai の room ----------
async function connectRoom(onMessage) {
  if (!window.claude || typeof window.claude.use !== 'function') return null;
  let room;
  try { room = await window.claude.use('room'); } catch { return null; }
  if (!room) return null;

  const local = new LocalWorld();
  const known = new Map(); // peer -> { say, emo }
  let joined = false, seq = 0, sayK = 0, emoK = 0;
  const tag = Math.random().toString(36).slice(2, 8);

  const fromPresence = (p) => {
    const pr = p.presence || {};
    const lk = pr.lk && typeof pr.lk === 'object' ? pr.lk : {};
    return {
      id: p.peer,
      name: String(pr.n || 'たびびと').slice(0, 12),
      look: { s: String(lk.s || 'cat'), f: Number(lk.f) || 0, c: Number(lk.c) || 0 },
      x: Number(pr.x) || 0, z: Number(pr.z) || 0, r: Number(pr.r) || 0, m: Number(pr.m) || 0,
      rank: Number(pr.rk) || 0,
    };
  };

  const handlePeers = (change) => {
    if (!joined) return;
    for (const p of [...change.joined, ...change.updated]) {
      if (p.sameTab || p.kind !== 'viewer' || !p.presence || !p.presence.n) continue;
      const info = fromPresence(p);
      let k = known.get(p.peer);
      if (!k) {
        k = { say: p.presence.say?.k, emo: p.presence.emo?.k, rk: info.rank };
        known.set(p.peer, k);
        onMessage({ t: 'join', p: info });
        continue;
      }
      onMessage({ t: 'state', ps: [[info.id, info.x, info.z, info.r, info.m]] });
      const say = p.presence.say, emo = p.presence.emo;
      if (say && say.k !== k.say) { k.say = say.k; onMessage({ t: 'chat', id: p.peer, text: String(say.t || '').slice(0, 80) }); }
      if (emo && emo.k !== k.emo) { k.emo = emo.k; onMessage({ t: 'emote', id: p.peer, e: String(emo.e || '') }); }
      if (info.rank !== k.rk) { k.rk = info.rank; onMessage({ t: 'rank', id: p.peer, rank: info.rank }); }
    }
    for (const p of change.left) {
      if (known.delete(p.peer)) onMessage({ t: 'leave', id: p.peer });
    }
  };
  room.onPeers(handlePeers);
  room.on('shake', (m) => {
    if (m.sameTab || !m.data || !Array.isArray(m.data.drops)) return;
    const i = Number(m.data.i);
    const drops = m.data.drops.slice(0, 4).map((d) => ({ id: String(d.id), tree: i, slot: Number(d.slot) || 0, kind: d.kind === 'coin' ? 'coin' : 'fruit' }));
    const fruit = local.applyShake(i, drops);
    onMessage({ t: 'shake', id: m.peer, i, fruit, drops });
  });
  room.on('hit', (m) => {
    if (m.sameTab || !m.data) return;
    onMessage({ t: 'hit', id: m.peer, i: Number(m.data.i), n: Number(m.data.n) || 0 });
  });
  room.on('gem', (m) => {
    if (m.sameTab || !m.data) return;
    const i = Number(m.data.i);
    if (!Number.isInteger(i) || i < 0 || i >= GEM_SPOTS.length) return;
    local.markMined(i);
    onMessage({ t: 'gem', id: m.peer, i, kind: gemPlan(i, gemDay()).kind, regrow: GEM_REGROW_MS });
  });
  room.on('pick', (m) => {
    if (m.sameTab || !m.data) return;
    const id = String(m.data.id);
    if (local.drops.delete(id)) onMessage({ t: 'picked', id, by: m.peer });
  });

  const quiet = (p) => p.catch(() => {});
  const creatures = localCreatures(local, onMessage);
  return {
    mode: 'room',
    send(msg) {
      if (msg.t === 'rank') { quiet(room.presence({ rk: msg.rank })); return; }
      if (creatures(msg) && msg.t !== 'join') return;
      switch (msg.t) {
        case 'join': {
          joined = true;
          quiet(room.presence({ n: msg.name, lk: msg.look, x: msg.x, z: msg.z, r: msg.r, m: 0 }));
          onMessage({ t: 'welcome', id: 'me', players: [], world: local.snapshot() });
          handlePeers({ joined: room.peers(), updated: [], left: [] });
          break;
        }
        case 'move': quiet(room.presence({ x: msg.x, z: msg.z, r: msg.r, m: msg.m })); break;
        case 'chat':
          quiet(room.presence({ say: { t: msg.text, k: ++sayK } }));
          onMessage({ t: 'chat', id: 'me', text: msg.text });
          break;
        case 'emote':
          quiet(room.presence({ emo: { e: msg.e, k: ++emoK } }));
          onMessage({ t: 'emote', id: 'me', e: msg.e });
          break;
        case 'shake': {
          const drops = local.planShake(msg.i, msg.fruit, `${tag}${++seq}`);
          const fruit = local.applyShake(msg.i, drops);
          onMessage({ t: 'shake', id: 'me', i: msg.i, fruit, drops });
          quiet(room.emit('shake', { i: msg.i, drops }));
          break;
        }
        case 'pick': {
          const d = local.drops.get(msg.id);
          if (!d) return;
          local.drops.delete(msg.id);
          onMessage({ t: 'got', id: d.id, kind: d.kind, tree: d.tree });
          onMessage({ t: 'picked', id: d.id, by: 'me' });
          quiet(room.emit('pick', { id: d.id }));
          break;
        }
        case 'hit': {
          const r = local.hitGem(msg.i);
          if (!r) return;
          if (r.kind) {
            onMessage({ t: 'gem', id: 'me', i: msg.i, kind: r.kind, regrow: GEM_REGROW_MS });
            quiet(room.emit('gem', { i: msg.i }));
          } else {
            onMessage({ t: 'hit', id: 'me', i: msg.i, n: r.n });
            quiet(room.emit('hit', { i: msg.i, n: r.n }));
          }
          break;
        }
      }
    },
  };
}

// ---------- 3. ひとり ----------
function soloNet(onMessage) {
  const local = new LocalWorld();
  // サーバーに切りかわったら、手元の虫はもう配らない
  let active = true;
  const creatures = localCreatures(local, (m) => { if (active) onMessage(m); });
  let seq = 0;
  return {
    mode: 'solo',
    deactivate() { active = false; },
    send(msg) {
      if (creatures(msg) && msg.t !== 'join') return;
      switch (msg.t) {
        case 'join': onMessage({ t: 'welcome', id: 'me', players: [], world: local.snapshot() }); break;
        case 'chat': onMessage({ t: 'chat', id: 'me', text: msg.text }); break;
        case 'emote': onMessage({ t: 'emote', id: 'me', e: msg.e }); break;
        case 'shake': {
          const drops = local.planShake(msg.i, msg.fruit, `s${++seq}`);
          onMessage({ t: 'shake', id: 'me', i: msg.i, fruit: local.applyShake(msg.i, drops), drops });
          break;
        }
        case 'pick': {
          const d = local.drops.get(msg.id);
          if (!d) return;
          local.drops.delete(msg.id);
          onMessage({ t: 'got', id: d.id, kind: d.kind, tree: d.tree });
          onMessage({ t: 'picked', id: d.id, by: 'me' });
          break;
        }
        case 'hit': {
          const r = local.hitGem(msg.i);
          if (!r) return;
          onMessage(r.kind ? { t: 'gem', id: 'me', i: msg.i, kind: r.kind, regrow: GEM_REGROW_MS } : { t: 'hit', id: 'me', i: msg.i, n: r.n });
          break;
        }
      }
    },
  };
}

export async function connect(onMessage, onStatus = () => {}) {
  const inClaude = !!(window.claude && typeof window.claude.use === 'function');
  if (inClaude) {
    const room = await connectRoom(onMessage);
    if (room) return room;
  }
  // claude.ai の中では、?server= で指定しない限りサーバーは探さない
  if (!serverUrl() || (inClaude && !new URLSearchParams(location.search).get('server'))) return soloNet(onMessage);

  // サーバーの返事が遅いとき（無料サーバーの起動待ちなど）は、まずひとりで遊び始めて、
  // つながった時点でみんなの島へ切り替える。
  const solo = soloNet(onMessage);
  const net = {
    mode: 'solo', inner: solo, joinMsg: null,
    send(msg) { if (msg.t === 'join') this.joinMsg = msg; this.inner.send(msg); },
    stop() { this.inner.stop?.(); },
  };
  return new Promise((resolve) => {
    const giveUp = setTimeout(() => resolve(net), 6000);
    const attempt = () => connectServer(onMessage, onStatus).then((server) => {
      if (!server) { clearTimeout(giveUp); resolve(net); setTimeout(attempt, 5000); return; }
      clearTimeout(giveUp);
      solo.deactivate();
      net.inner = server;
      net.mode = 'server';
      if (net.joinMsg) onStatus('upgraded'); // アプリが今の位置で join し直す
      resolve(net);
    });
    attempt();
  });
}
