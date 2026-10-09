// Đếm số request + bytes từng màn hình chính bằng Playwright (Chromium) trên BẢN BUILD PRODUCTION của worktree
// (miniapp: static server :3399 trỏ API 3301; web: next start :3398). Mỗi màn = context mới (cache lạnh).
// Miniapp: phiên đăng nhập được giả bằng route.fulfill (JWT ký bằng secret .env cho user perf_u_10004) vì Zalo SDK không có trên trình duyệt.
const path = require('path');
const zlib = require('zlib');
const fs = require('fs');
const { chromium } = require(path.resolve(__dirname, '../../apps/e2e/node_modules/@playwright/test'));
const { tokenFor } = require('./lib.cjs');

const API = 'http://localhost:3301/api';
const UID = 'perf_u_10004';
let ipn = 90000;
const xff = () => `10.88.${(++ipn >> 8) & 255}.${ipn & 255}`;

async function api(method, p, token, body) {
  const r = await fetch(API + p, { method, headers: { 'X-Forwarded-For': xff(), Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

async function measure(browser, { name, url, miniapp }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'X-Forwarded-For': xff() } });
  const page = await ctx.newPage();
  const rows = [];
  page.on('response', async (res) => {
    try {
      const req = res.request();
      const type = req.resourceType();
      let size = 0;
      let gz = 0;
      if (req.method() !== 'OPTIONS') {
        const body = await res.body().catch(() => Buffer.alloc(0));
        size = body.length;
        gz = /json|javascript|css|html|svg/.test(res.headers()['content-type'] || '') ? zlib.gzipSync(body).length : size;
      }
      rows.push({ url: res.url(), type, status: res.status(), size, gz, api: /\/api\//.test(res.url()) && /:(3001|3301)\//.test(res.url()), ms: 0 });
    } catch { /* trang đóng */ }
  });
  if (miniapp) {
    const token = tokenFor(UID);
    const me = await api('GET', '/auth/me', token);
    const login = { accessToken: token, refreshToken: 'perf-fake-refresh', user: me };
    await ctx.route('http://localhost:3001/api/**', (r) => r.continue({ url: r.request().url().replace(':3001/', ':3301/') }));
    await ctx.route('**/api/auth/guest', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(login) }));
    await ctx.route('**/api/auth/refresh', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(login) }));
    await ctx.addInitScript(() => { try { localStorage.setItem('tubu_device_id', 'perf-device'); } catch {} });
  }
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(3000); // bắt các request trễ (react-query, analytics)
  await ctx.close();
  const real = rows.filter((r) => r.size > 0 || r.type === 'xhr' || r.type === 'fetch');
  const by = (f) => { const r = real.filter(f); return { n: r.length, rawKB: +(r.reduce((s, x) => s + x.size, 0) / 1024).toFixed(0), gzKB: +(r.reduce((s, x) => s + x.gz, 0) / 1024).toFixed(0) }; };
  const apiCalls = real.filter((r) => r.api).map((r) => r.url.replace(/^http:\/\/localhost:\d+\/api/, '').split('?')[0]);
  const counts = {};
  for (const a of apiCalls) counts[a] = (counts[a] || 0) + 1;
  return {
    screen: name, url, networkIdleMs: loadMs,
    total: by(() => true), js: by((r) => r.type === 'script'), css: by((r) => r.type === 'stylesheet'), font: by((r) => r.type === 'font'), img: by((r) => r.type === 'image'),
    api: by((r) => r.api), apiNon2xx: real.filter((r) => r.api && r.status >= 400).map((r) => r.status + ' ' + r.url.replace(API, '')),
    apiCalls: counts,
  };
}

(async () => {
  const t = tokenFor(UID);
  // chuẩn bị giỏ cho user: 2 món (đủ tồn)
  const vs = (await require('pg').Client && (async () => { const { Client } = require('pg'); const { pgConf } = require('./lib.cjs'); const c = new Client(pgConf()); await c.connect(); const r = await c.query(`SELECT v.id FROM variations v JOIN products p ON p.id=v."productId" WHERE v.stock>=1000 AND v."isActive" AND p."isActive" AND p."approvalStatus"='APPROVED' AND NOT p."isCombo" AND v.id LIKE 'perf_v_%' ORDER BY v.id LIMIT 2`); await c.end(); return r.rows.map((x) => x.id); })());
  const ids = await vs;
  for (const v of ids) await api('POST', '/cart/items', t, { variationId: v, quantity: 1 });
  const browser = await chromium.launch();
  const M = process.env.M_URL || 'http://localhost:3113'; // mặc định DEV (Vite); đặt M_URL=http://localhost:3399 để đo BẢN BUILD PROD
  const W = 'http://localhost:3398';
  const only = process.env.ONLY_MINIAPP === '1';
  const targets = [
    { name: 'Miniapp Home', url: M + '/', miniapp: true },
    { name: 'Miniapp Browse', url: M + '/browse', miniapp: true },
    { name: 'Miniapp PDP', url: M + '/product/perf-san-pham-1712', miniapp: true },
    { name: 'Miniapp Cart', url: M + '/cart', miniapp: true },
    { name: 'Miniapp Checkout', url: M + '/checkout', miniapp: true },
    { name: 'Miniapp Orders', url: M + '/orders', miniapp: true },
    { name: 'Web Trang chủ', url: W + '/' },
    { name: 'Web PDP', url: W + '/san-pham/perf-san-pham-1712' },
  ];
  const out = [];
  for (const tg of targets.filter((t) => !only || t.miniapp)) {
    const r = await measure(browser, tg);
    out.push(r);
    console.log(`${r.screen.padEnd(18)} req=${r.total.n} raw=${r.total.rawKB}KB gz≈${r.total.gzKB}KB | js ${r.js.n}/${r.js.rawKB}KB(${r.js.gzKB}gz) css ${r.css.rawKB}KB font ${r.font.rawKB}KB img ${r.img.rawKB}KB | API ${r.api.n} req ${r.api.rawKB}KB(${r.api.gzKB}gz) idle ${r.networkIdleMs}ms ${r.apiNon2xx.length ? 'LỖI:' + r.apiNon2xx.join(',') : ''}`);
  }
  await browser.close();
  // dọn giỏ
  const { Client } = require('pg'); const { pgConf } = require('./lib.cjs'); const c = new Client(pgConf()); await c.connect();
  await c.query(`DELETE FROM cart_items WHERE "cartId" IN (SELECT id FROM carts WHERE "userId"=$1) AND id NOT LIKE 'perf\_%'`, [UID]); await c.end();
  fs.writeFileSync(__dirname + '/results/' + (process.env.OUT_FILE || 'page-weight.json'), JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
