// アカウント・ポケット・土地。お金まわりは全部サーバーで決める（端末では書きかえられない）。
//
// アカウントは「引き継ぎコード」だけで識別する。コードそのものは保存せず、ハッシュだけを保存する。
const crypto = require('crypto');

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // まぎらわしい 0/O/1/I はつかわない
const DAY = 86400e3;
const INACTIVE_DAYS = 30;                          // これだけ来ないと土地が空き地にもどる
const COIN_BAG = [100, 200, 300, 500, 1000];
const CHEST = [300, 500, 800, 1000];

const newToken = () => [...crypto.randomBytes(20)].map((b) => ALPHA[b % 32]).join('');
const normToken = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);
const tokenId = (t) => crypto.createHash('sha256').update('pokapoka:' + t).digest('hex').slice(0, 24);
const formatCode = (t) => t.match(/.{1,5}/g).join('-');
const jstDay = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

class Economy {
  constructor(store, W) {
    this.store = store;
    this.W = W;
    this.accounts = new Map(); // id -> account
    this.plots = W.PLOTS.map(() => null); // i -> { owner: accountId, since }
    this.dirty = new Set();
    this.plotsDirty = new Set();
  }

  async init() {
    const data = await this.store.load();
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('acct:')) this.accounts.set(k.slice(5), v);
      else if (k.startsWith('plot:')) { const i = Number(k.slice(5)); if (this.plots[i] !== undefined) this.plots[i] = v; }
    }
    this.releaseInactive();
    setInterval(() => this.flush().catch((e) => console.error('[store]', e.message)), 2000).unref();
    setInterval(() => this.releaseInactive(), 3600e3).unref();
    console.log(`[store] ${this.store.kind}: アカウント ${this.accounts.size}件、持ち主のいる土地 ${this.plots.filter(Boolean).length}区画`);
  }

  async flush() {
    const ids = [...this.dirty]; this.dirty.clear();
    for (const id of ids) { const a = this.accounts.get(id); if (a) await this.store.put('acct:' + id, a); }
    const plots = [...this.plotsDirty]; this.plotsDirty.clear();
    for (const i of plots) {
      if (this.plots[i]) await this.store.put('plot:' + i, this.plots[i]);
      else await this.store.del('plot:' + i);
    }
  }
  save(a) { this.dirty.add(a.id); }

  // ---------- アカウント ----------
  find(token) {
    const t = normToken(token);
    return t.length >= 16 ? this.accounts.get(tokenId(t)) || null : null;
  }
  create(name) {
    const token = newToken();
    const now = Date.now();
    const a = { id: tokenId(token), name, color: 0, coins: 0, fruit: {}, gems: {}, chestDay: '', plot: null, pass: null, created: now, lastSeen: now };
    this.accounts.set(a.id, a);
    this.save(a);
    return { token, account: a };
  }
  touch(a, name, color) {
    a.lastSeen = Date.now();
    if (name) a.name = name;
    if (Number.isInteger(color)) a.color = color;
    this.save(a);
  }
  view(a) {
    return { coins: a.coins, fruit: a.fruit, gems: a.gems, plot: a.plot, price: this.W.PLOT_PRICE };
  }

  // ---------- ひろう・ほる・売る ----------
  gotCoins(a) { const n = pick(COIN_BAG); a.coins += n; this.save(a); return n; }
  gotFruit(a, kind) { a.fruit[kind] = (a.fruit[kind] || 0) + 1; this.save(a); }
  gotGem(a, kind) { a.gems[kind] = (a.gems[kind] || 0) + 1; this.save(a); }
  // 持っているぶんを ぜんぶ売る。もらえたポカを返す
  sell(a, what, key) {
    const price = this.W.SELL_PRICES[what]?.[key];
    const bag = what === 'fruit' ? a.fruit : what === 'gem' ? a.gems : null;
    if (!price || !bag || !bag[key]) return 0;
    const gained = bag[key] * price;
    delete bag[key];
    a.coins += gained;
    this.save(a);
    return gained;
  }
  // 地下の宝箱：1日（日本時間）1回
  chest(a) {
    const today = jstDay();
    if (a.chestDay === today) return 0;
    const n = pick(CHEST);
    a.chestDay = today;
    a.coins += n;
    this.save(a);
    return n;
  }

  // ---------- 土地 ----------
  buyPlot(a, i) {
    if (!Number.isInteger(i) || !(i in this.plots)) return 'no_plot';
    if (a.plot !== null && a.plot !== undefined) return 'already_own';
    if (this.plots[i]) return 'taken';
    if (a.coins < this.W.PLOT_PRICE) return 'not_enough';
    a.coins -= this.W.PLOT_PRICE;
    a.plot = i;
    this.plots[i] = { owner: a.id, since: Date.now() };
    this.save(a); this.plotsDirty.add(i);
    return null;
  }
  releasePlot(a) {
    const i = a.plot;
    if (i === null || i === undefined || this.plots[i]?.owner !== a.id) return 0;
    const refund = Math.floor(this.W.PLOT_PRICE * this.W.PLOT_REFUND);
    this.plots[i] = null;
    a.plot = null;
    a.coins += refund;
    this.save(a); this.plotsDirty.add(i);
    return refund;
  }
  // しばらく来ていない人の土地は空き地にもどす（お金はもどさない）
  releaseInactive() {
    const limit = Date.now() - INACTIVE_DAYS * DAY;
    let freed = 0;
    this.plots.forEach((p, i) => {
      if (!p) return;
      const a = this.accounts.get(p.owner);
      if (a && a.lastSeen >= limit) return;
      this.plots[i] = null;
      this.plotsDirty.add(i);
      if (a) { a.plot = null; this.save(a); }
      freed++;
    });
    if (freed) console.log(`[plots] ${freed}区画を空き地にもどしました`);
    return freed;
  }
  plotsView() {
    return this.plots.map((p, i) => {
      if (!p) return [i, null, 0];
      const a = this.accounts.get(p.owner);
      return [i, a ? a.name : '？', a ? a.color : 0];
    });
  }
}

module.exports = { Economy, formatCode, normToken, jstDay };
