// カラーパス（買い切り）の支払い。Stripe Checkout で払ってもらい、
// 購入の番号（Checkout Session の ID）を Stripe に問い合わせて、本当に支払われたかを確かめる。
// 購入の記録は Stripe にあるので、こちらでデータベースは持たない。
//
// 環境変数
//   STRIPE_SECRET_KEY  … Stripe のシークレットキー（sk_test_… / sk_live_…）。ないときは支払いを出さない
//   PREMIUM_PRICE_JPY  … カラーパスの値段（円）。ないときは 300

const API = process.env.STRIPE_API_BASE || 'https://api.stripe.com';
const KEY = process.env.STRIPE_SECRET_KEY || '';
const PRICE = Math.max(50, Math.round(Number(process.env.PREMIUM_PRICE_JPY) || 300));
const PRODUCT = 'momo_color_pass';
const PRODUCT_NAME = 'MOMO カラーパス（色えらび放題・買い切り）';

const enabled = () => !!KEY;

async function stripe(method, pathname, form) {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `stripe ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// 支払いページを作って、その URL を返す
async function createCheckout(returnUrl) {
  const back = new URL(returnUrl);
  const ok = new URL(back); ok.searchParams.set('paid', '{CHECKOUT_SESSION_ID}');
  const ng = new URL(back); ng.searchParams.set('canceled', '1');
  const session = await stripe('POST', '/v1/checkout/sessions', {
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'jpy',
    'line_items[0][price_data][unit_amount]': String(PRICE),
    'line_items[0][price_data][product_data][name]': PRODUCT_NAME,
    'metadata[product]': PRODUCT,
    // {CHECKOUT_SESSION_ID} は Stripe が本物の ID に置きかえる
    success_url: ok.toString().replace(encodeURIComponent('{CHECKOUT_SESSION_ID}'), '{CHECKOUT_SESSION_ID}'),
    cancel_url: ng.toString(),
    locale: 'ja',
  });
  return session.url;
}

// 購入の番号が、支払い済みのカラーパスかどうか（結果はしばらく覚えておく）
const cache = new Map(); // code -> { ok, until }
async function verify(code) {
  if (!enabled() || typeof code !== 'string' || !/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(code)) return false;
  const hit = cache.get(code);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = false;
  try {
    const s = await stripe('GET', `/v1/checkout/sessions/${encodeURIComponent(code)}`);
    ok = s.payment_status === 'paid' && s.metadata?.product === PRODUCT;
  } catch (e) {
    // 見つからない番号は「買っていない」。Stripe に届かないときは、覚えている結果があればそれを使う
    if (e.status !== 404 && hit) return hit.ok;
  }
  cache.set(code, { ok, until: Date.now() + (ok ? 24 * 3600e3 : 60e3) });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return ok;
}

module.exports = { enabled, createCheckout, verify, PRICE };
