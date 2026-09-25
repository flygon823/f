// 通信のつなぎ方は3通り。どれでも、アプリには同じ形のメッセージが届く。
//  1. server : server.js の WebSocket（ネットで誰でも入れる）
//  2. room   : claude.ai の Artifact として開いたとき、同じページを開いている人どうし
//  3. solo   : どちらもつながらないときは、ひとりで遊べる

const FRUIT_PER_TREE = 3;
const FRUIT_REGROW_MS = 3 * 60 * 1000;

// サーバーがいないときに、木の実と落とし物を手元で管理する
class LocalWorld {
  constructor() { this.trees = new Map(); this.drops = new Map(); }
  fruitOf(i) {
    const t = this.trees.get(i);
    if (!t) return FRUIT_PER_TREE;
    if (t.fruit === 0 && Date.now() >= t.regrowAt) { this.trees.delete(i); return FRUIT_PER_TREE; }
    return t.fruit;
  }
  snapshot() {
    const trees = [];
    for (const [i] of this.trees) { const f = this.fruitOf(i); if (f < FRUIT_PER_TREE) trees.push([i, f]); }
    return { trees, drops: [...this.drops.values()] };
  }
  planShake(i, fruitTree, tag) {
    const drops = [];
    if (fruitTree && this.fruitOf(i) > 0) {
      for (let s = 0; s < this.fruitOf(i); s++) drops.push({ id: `${tag}-${s}`, tree: i, slot: s, kind: 'fruit' });
    }
    if (Math.random() < 0.12) drops.push({ id: `${tag}-b`, tree: i, slot: 3, kind: 'bell' });
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

// ---------- 1. WebSocket サーバー ----------
function connectServer(onMessage, onStatus) {
  const url = serverUrl();
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    let ws, joinMsg = null, opened = false;
    const api = {
      mode: 'server',
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
    };
  };

  const handlePeers = (change) => {
    if (!joined) return;
    for (const p of [...change.joined, ...change.updated]) {
      if (p.sameTab || p.kind !== 'viewer' || !p.presence || !p.presence.n) continue;
      const info = fromPresence(p);
      let k = known.get(p.peer);
      if (!k) {
        k = { say: p.presence.say?.k, emo: p.presence.emo?.k };
        known.set(p.peer, k);
        onMessage({ t: 'join', p: info });
        continue;
      }
      onMessage({ t: 'state', ps: [[info.id, info.x, info.z, info.r, info.m]] });
      const say = p.presence.say, emo = p.presence.emo;
      if (say && say.k !== k.say) { k.say = say.k; onMessage({ t: 'chat', id: p.peer, text: String(say.t || '').slice(0, 80) }); }
      if (emo && emo.k !== k.emo) { k.emo = emo.k; onMessage({ t: 'emote', id: p.peer, e: String(emo.e || '') }); }
    }
    for (const p of change.left) {
      if (known.delete(p.peer)) onMessage({ t: 'leave', id: p.peer });
    }
  };
  room.onPeers(handlePeers);
  room.on('shake', (m) => {
    if (m.sameTab || !m.data || !Array.isArray(m.data.drops)) return;
    const i = Number(m.data.i);
    const drops = m.data.drops.slice(0, 4).map((d) => ({ id: String(d.id), tree: i, slot: Number(d.slot) || 0, kind: d.kind === 'bell' ? 'bell' : 'fruit' }));
    const fruit = local.applyShake(i, drops);
    onMessage({ t: 'shake', id: m.peer, i, fruit, drops });
  });
  room.on('pick', (m) => {
    if (m.sameTab || !m.data) return;
    const id = String(m.data.id);
    if (local.drops.delete(id)) onMessage({ t: 'picked', id, by: m.peer });
  });

  const quiet = (p) => p.catch(() => {});
  return {
    mode: 'room',
    send(msg) {
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
      }
    },
  };
}

// ---------- 3. ひとり ----------
function soloNet(onMessage) {
  const local = new LocalWorld();
  let seq = 0;
  return {
    mode: 'solo',
    send(msg) {
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
  };
  return new Promise((resolve) => {
    const giveUp = setTimeout(() => resolve(net), 6000);
    const attempt = () => connectServer(onMessage, onStatus).then((server) => {
      if (!server) { clearTimeout(giveUp); resolve(net); setTimeout(attempt, 5000); return; }
      clearTimeout(giveUp);
      net.inner = server;
      net.mode = 'server';
      if (net.joinMsg) onStatus('upgraded'); // アプリが今の位置で join し直す
      resolve(net);
    });
    attempt();
  });
}
