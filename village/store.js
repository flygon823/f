// 島のデータ（アカウント・土地）の保存場所。
//   DATABASE_URL があれば Postgres に、なければ data/island.json に保存する。
// Render の無料プランはファイルが再起動で消えるので、本番では DATABASE_URL（Neon など）を設定すること。
//
// どちらも「キーと値」の形で保存する：acct:<id> → アカウント、plot:<番号> → 土地
const fs = require('fs');
const path = require('path');

class FileStore {
  constructor(file) {
    this.file = file;
    this.kind = 'file';
    this.data = {};
    this.timer = null;
  }
  async load() {
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.data = {}; }
    return this.data;
  }
  async put(k, v) {
    this.data[k] = v;
    this.flushSoon();
  }
  async del(k) {
    delete this.data[k];
    this.flushSoon();
  }
  flushSoon() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    }, 500);
  }
}

class PgStore {
  constructor(url) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(url);
    this.pool = new Pool({ connectionString: url, max: 4, ssl: local ? false : { rejectUnauthorized: false } });
    this.kind = 'postgres';
  }
  async load() {
    await this.pool.query('CREATE TABLE IF NOT EXISTS island_kv (k text PRIMARY KEY, v jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await this.pool.query('SELECT k, v FROM island_kv');
    const data = {};
    for (const r of rows) data[r.k] = r.v;
    return data;
  }
  async put(k, v) {
    await this.pool.query(
      'INSERT INTO island_kv (k, v, updated_at) VALUES ($1, $2, now()) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()',
      [k, JSON.stringify(v)],
    );
  }
  async del(k) {
    await this.pool.query('DELETE FROM island_kv WHERE k = $1', [k]);
  }
}

function createStore() {
  if (process.env.DATABASE_URL) return new PgStore(process.env.DATABASE_URL);
  return new FileStore(process.env.DATA_FILE || path.join(__dirname, 'data', 'island.json'));
}

module.exports = { createStore };
