// Kịch bản đo tải. Chạy: node scenarios.cjs <browse|auth|cart|checkout|flash|throttle|all> [--short]
// Mỗi kịch bản: 3 lần chạy cố định (concurrency C) lấy trung vị, rồi ramp tăng dần tới khi p95>1s hoặc lỗi>1%.
// Chỉ nhắm API cổng 3301 + DB tubutree_perf. Kết quả JSON ghi vào results/<kịch bản>.json.
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('pg');
const { tokenFor, pgConf } = require('./lib.cjs');
const { runStage, median, BASE } = require('./loadlib.cjs');

const SHORT = process.argv.includes('--short');
const FIX_C = Number(process.env.FIX_C || 16);
const FIX_SEC = SHORT ? 6 : Number(process.env.FIX_SEC || 15);
const RAMP = (process.env.RAMP || '4,8,16,32,64,128').split(',').map(Number);
const RAMP_SEC = SHORT ? 6 : Number(process.env.RAMP_SEC || 12);
const OUT = process.env.OUT_DIR || __dirname + '/results';

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const skew = (n) => Math.floor(n * Math.pow(Math.random(), 2)); // dồn về chỉ số nhỏ (hàng bán chạy)

async function db() {
  const c = new Client(pgConf());
  await c.connect();
  return c;
}

const SEARCH_TERMS = ['chậu cây', 'chau cay', 'sản phẩm', 'tag12', 'cây', 'phân bón', 'hạt giống', 'xịt', 'đất', 'thông minh', 'organic', 'bình tưới'];

async function loadCatalogSample(c) {
  const slugs = (await c.query(`SELECT slug FROM products WHERE "isActive" AND "approvalStatus"='APPROVED' AND id LIKE 'perf_p_%' ORDER BY "soldApp" DESC LIMIT 1500`)).rows.map((r) => r.slug);
  const vars = (await c.query(`SELECT v.id FROM variations v JOIN products p ON p.id=v."productId" WHERE v.stock>=1000 AND v."isActive" AND p."isActive" AND p."approvalStatus"='APPROVED' AND NOT p."isCombo" AND v.id LIKE 'perf_v_%' ORDER BY v.id LIMIT 800`)).rows.map((r) => r.id);
  return { slugs, vars };
}

// ───────────────────────────── kịch bản ─────────────────────────────
const S = {};

S.browse = async (c) => {
  const { slugs } = await loadCatalogSample(c);
  const sorts = ['', 'newest', 'price_asc', 'price_desc', 'best_seller', 'rating'];
  return {
    iter: async (x) => {
      const r = Math.random();
      if (r < 0.34) {
        const sort = pick(sorts);
        await x.req('GET', `/products?page=${1 + rnd(25)}&limit=20${sort ? '&sort=' + sort : ''}`, { label: 'GET /products (list)' });
      } else if (r < 0.50) {
        await x.req('GET', `/products?q=${encodeURIComponent(pick(SEARCH_TERMS))}&limit=20`, { label: 'GET /products?q (search)' });
      } else if (r < 0.60) {
        await x.req('GET', `/search/suggest?q=${encodeURIComponent(pick(SEARCH_TERMS).slice(0, 4))}`, { label: 'GET /search/suggest' });
      } else if (r < 0.85) {
        const slug = slugs[skew(slugs.length)];
        await x.req('GET', `/products/${slug}`, { label: 'GET /products/:slug (PDP)' });
        if (Math.random() < 0.5) await x.req('GET', `/products/${slug}/related`, { label: 'GET /products/:slug/related' });
      } else if (r < 0.93) {
        await x.req('GET', '/categories', { label: 'GET /categories' });
        await x.req('GET', '/brands', { label: 'GET /brands' });
      } else {
        await x.req('GET', '/flash-sales/active', { label: 'GET /flash-sales/active' });
      }
    },
  };
};

S.auth = async () => ({
  iter: async (x) => {
    const g = await x.req('POST', '/auth/guest', { body: { deviceId: 'perf-' + crypto.randomUUID() }, label: 'POST /auth/guest' });
    if (!g.json || !g.json.accessToken) return;
    await x.req('GET', '/auth/me', { token: g.json.accessToken, label: 'GET /auth/me' });
    await x.req('POST', '/auth/refresh', { body: { refreshToken: g.json.refreshToken }, label: 'POST /auth/refresh' });
  },
});

// User chưa có giỏ (chỉ số 20001+) để ép đường tạo giỏ mới; mỗi VU một user cố định.
S.cart = async (c) => {
  const { vars } = await loadCatalogSample(c);
  return {
    vuInit: (vu) => ({ token: tokenFor('perf_u_' + (20001 + vu)), mine: Array.from({ length: 6 }, (_, k) => vars[(vu * 6 + k) % vars.length]) }),
    iter: async (x) => {
      const t = x.state.token;
      await x.req('GET', '/cart', { token: t, label: 'GET /cart' });
      await x.req('POST', '/cart/items', { token: t, body: { variationId: pick(x.state.mine), quantity: 1 }, label: 'POST /cart/items' });
      await x.req('GET', '/cart', { token: t, label: 'GET /cart (có hàng)' });
    },
  };
};

// Mỗi vòng: thêm 1 món → quote → place-order COD (Idempotency-Key). Người dùng khác nhau mỗi VU (chỉ số 30001+).
S.checkout = async (c) => {
  const { vars } = await loadCatalogSample(c);
  return {
    vuInit: (vu) => ({ uid: 30001 + vu, token: tokenFor('perf_u_' + (30001 + vu)) }),
    iter: async (x) => {
      const t = x.state.token;
      const addressId = 'perf_a_' + x.state.uid;
      const add = await x.req('POST', '/cart/items', { token: t, body: { variationId: pick(vars), quantity: 1 + rnd(2) }, label: 'POST /cart/items' });
      if (add.status >= 300) return;
      await x.req('POST', '/checkout/quote', { token: t, body: { addressId }, label: 'POST /checkout/quote' });
      await x.req('POST', '/checkout/place-order', {
        token: t, body: { addressId, paymentMethod: 'COD' }, headers: { 'Idempotency-Key': crypto.randomUUID() }, label: 'POST /checkout/place-order (COD)',
      });
    },
  };
};

// Mở Home miniapp = 15 request API chạy song song (đo bằng page-weight.cjs): 3 danh sách SP, for-you, giỏ, đơn, ví...
S.home = async () => ({
  vuInit: (vu) => ({ token: tokenFor('perf_u_' + (10001 + vu)) }),
  iter: async (x) => {
    const t = x.state.token;
    const g = (p, label) => x.req('GET', p, { token: t, label: 'GET ' + (label || p.split('?')[0]) });
    await Promise.all([
      g('/products?limit=6&sort=best_seller', '/products (best_seller)'), g('/products?limit=12', '/products (featured)'), g('/products?limit=6&sort=newest', '/products (newest)'),
      g('/products/for-you'), g('/cart'), g('/orders/active-count'), g('/flash-sales/upcoming'), g('/flash-sales/active'), g('/me'), g('/me/notifications'),
      g('/me/purchased-items'), g('/brands'), g('/me/subscriptions'), g('/categories'), g('/me/wishlist/ids'), g('/orders?page=1&limit=1'),
    ]);
  },
});

// Ghi sự kiện analytics theo lô 10 (miniapp gửi mỗi 10s hoặc khi đủ 50). Mỗi sự kiện = 1 INSERT tuần tự phía server.
S.events = async () => ({
  vuInit: (vu) => ({ token: tokenFor('perf_u_' + (10001 + vu)) }),
  iter: async (x) => {
    const events = Array.from({ length: 10 }, () => ({
      eventId: crypto.randomUUID(), eventName: pick(['screen_viewed', 'product_viewed', 'search_performed', 'filter_applied']), occurredAt: new Date().toISOString(),
      platform: 'miniapp', sessionId: 's' + x.vu, props: { screen: 'home', n: x.i },
    }));
    await x.req('POST', '/events', { token: x.state.token, body: { events }, label: 'POST /events (10 sự kiện)', headers: { 'X-Device-Id': 'perf-dev-' + x.vu + '-' + x.i } });
  },
});

// ───────────────────────────── chạy / báo cáo ─────────────────────────────
function summarizeRuns(runs) {
  const m = (k) => +median(runs.map((r) => r[k])).toFixed(1);
  return {
    runs: runs.length, concurrency: runs[0].concurrency, rps: m('rps'), p50: m('p50'), p95: m('p95'), p99: m('p99'),
    errPct: m('errPct'), throttledPct: m('throttledPct'), flowP95: m('flowP95'), apiCpuCores: m('apiCpuCores'), apiRssMB: m('apiRssMB'), apiCpuMsPerReq: +median(runs.map((r) => r.apiCpuMsPerReq)).toFixed(3),
  };
}

async function runScenario(name) {
  const c = await db();
  const setup = await S[name](c);
  const mk = (concurrency, seconds) => runStage({ name, concurrency, seconds, ...setup, expected: name === 'checkout' ? [400] : [] });
  const result = { scenario: name, base: BASE, startedAt: new Date().toISOString(), fixed: [], ramp: [] };
  console.log(`\n=== ${name}: ${3} lần x ${FIX_C} VU x ${FIX_SEC}s ===`);
  for (let i = 0; i < 3; i++) {
    const r = await mk(FIX_C, FIX_SEC);
    result.fixed.push(r);
    console.log(` run${i + 1}: rps=${r.rps} p50=${r.p50} p95=${r.p95} p99=${r.p99} err=${r.errPct}% 429=${r.throttledPct}% cpu=${r.apiCpuCores} rss=${r.apiRssMB}MB`, r.errSamples.length ? JSON.stringify(r.errSamples) : '');
  }
  result.median = summarizeRuns(result.fixed);
  console.log(' median:', JSON.stringify(result.median));
  console.log(`--- ramp ${RAMP.join(',')} (${RAMP_SEC}s/bậc) ---`);
  for (const cc of RAMP) {
    const r = await mk(cc, RAMP_SEC);
    result.ramp.push(r);
    console.log(` C=${cc}: rps=${r.rps} p50=${r.p50} p95=${r.p95} p99=${r.p99} err=${r.errPct}% 429=${r.throttledPct}% cpu=${r.apiCpuCores} rss=${r.apiRssMB}MB | ${r.docker}`);
    if (r.p95 > 1000 || (r.errPct > 1 && !process.env.IGNORE_ERR_BREAK)) { result.breakAt = cc; console.log(' >> ngưỡng gãy tại C=' + cc); break; }
  }
  fs.writeFileSync(`${OUT}/${name}.json`, JSON.stringify(result, null, 1));
  await c.end();
  return result;
}

(async () => {
  const which = process.argv[2] || 'all';
  const list = which === 'all' ? ['browse', 'auth', 'cart', 'checkout'] : [which];
  for (const n of list) {
    if (!S[n]) throw new Error('kịch bản không có: ' + n);
    await runScenario(n);
  }
})().catch((e) => { console.error(e); process.exit(1); });
