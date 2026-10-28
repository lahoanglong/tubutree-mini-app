// Đo Mini App (bản build tĩnh phục vụ bằng vite preview 3603, API lane 5) 375x812, 4G chậm, CPU x4. Mỗi ô 3 lần, trung vị.
// Bản build www của repo trỏ api.tubutree.com nên đo bản build riêng (VITE_API_BASE_URL=lane 5, --mode perf) ở state/perf-mini-www.
// Zalo SDK không có ngoài Zalo: guest = app tự /auth/guest; returning = nhét refresh token thật vào localStorage (khoá của ZMP storage).
// Dùng: node mini.mjs [--runs 3] [--out file.json]
import fs from 'node:fs';
import path from 'node:path';
import { API, MINI_375, MINI_URL, VITALS_INIT, laneEnvVal, loadSnapshot, playwright, summarize, tbt, throttle, lib, sleep, LANE_N } from './lib.mjs';

const BLOCK_HOST = /(^|\.)(api\.tubutree\.com|zalo\.me|zaloapp\.com|zdn\.vn|zadn\.vn|zalopay\.vn|sentry\.io|ingest\.sentry\.io)$/i;

const APP_ID = '2070857098114207963'; // apps/miniapp/app-config.json; Zalo gán window.APP_ID, ZMPRouter dùng làm basename
export const MINI_PAGES = [
  { key: 'home', path: '/' },
  { key: 'browse', path: '/browse' },
  { key: 'product', path: '/product/mat-ong-rung-bhnong', ready: ['Mật ong rừng nguyên chất BH.Nong'] },
];
export const MINI_PERSONAS = ['returning', 'guest'];

const READY_INIT = (names) => `(() => {
  const names = ${JSON.stringify(names)};
  const tick = () => {
    const p = window.__perf; if (!p || p.firstMatch != null) return;
    const t = document.body ? document.body.innerText : '';
    if (names.some((n) => t.includes(n))) p.firstMatch = performance.now(); else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

export async function measureMini(browser, L, h, names, pg, persona, { cpu = 4 } = {}) {
  const context = await browser.newContext({ ...MINI_375, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const bypass = laneEnvVal('THROTTLE_BYPASS_TOKEN');
  await context.route((u) => BLOCK_HOST.test(u.hostname), (r) => r.abort('blockedbyclient'));
  await context.route((u) => u.pathname.startsWith('/api/') && u.port === '3251', (r) => r.fallback({ headers: { ...r.request().headers(), 'x-throttle-bypass': bypass } }));
  if (persona !== 'guest') {
    const user = await h.findUser(L, persona);
    const rt = await h.mintRefresh(L, user.id);
    const val = Buffer.from(encodeURIComponent(JSON.stringify(rt))).toString('base64');
    await context.addInitScript((v) => { try { localStorage.setItem('2070857098114207963_tubu_refresh_token', v); } catch {} }, val);
  }
  await context.addInitScript((id) => { window.APP_ID = id; }, APP_ID);
  await context.addInitScript(VITALS_INIT);
  await context.addInitScript(READY_INIT(pg.ready ?? names));
  const page = await context.newPage();
  const cdp = await throttle(page, { cpu });
  const apiCalls = [];
  page.on('requestfinished', (rq) => { if (rq.url().startsWith(API)) apiCalls.push(rq.url().slice(API.length)); });
  await page.goto(`${MINI_URL}/zapps/${APP_ID}${pg.path}`, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await sleep(2500);
  const s = await page.evaluate((api) => {
    const p = window.__perf;
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const sum = (f) => res.filter(f).reduce((a, r) => a + (r.transferSize || 0), 0);
    const end = (frag) => { const r = res.find((x) => x.name.startsWith(api + frag)); return r ? r.responseEnd : null; };
    return {
      fcp: p.fcp, lcp: p.lcp, lcpEl: p.lcpEl, cls: p.cls, firstMatch: p.firstMatch, longTasks: p.longTasks, now: performance.now(),
      load: nav?.loadEventEnd, requests: res.length + 1, jsKB: sum((r) => r.initiatorType === 'script') / 1024, totalKB: (sum(() => true) + (nav?.transferSize || 0)) / 1024,
      authEnd: end('/auth/'), homeEnd: end('/home'), homeMeEnd: end('/home/me'), configEnd: end('/config/public'),
      jsCount: res.filter((r) => r.initiatorType === 'script' || /\\.js(\\?|$)/.test(r.name)).length,
      bodyHead: document.body.innerText.slice(0, 120),
    };
  }, API);
  await cdp.detach().catch(() => undefined);
  await context.close();
  return {
    run: { fcp: s.fcp, lcp: s.lcp, firstProductCard: s.firstMatch, cls: s.cls, tbt: tbt(s.longTasks, s.fcp, s.now), loadEvent: s.load, requests: s.requests, apiRequests: apiCalls.length, jsRequests: s.jsCount, jsKB: s.jsKB, totalKB: s.totalKB, authEnd: s.authEnd, homeApiEnd: s.homeEnd, homeMeApiEnd: s.homeMeEnd, longTaskCount: s.longTasks.length },
    lcpEl: s.lcpEl, bodyHead: s.bodyHead, apiCalls: [...new Set(apiCalls.map((c) => c.split('?')[0]))],
  };
}

export async function runMini({ runs = 3, cpu = 4 } = {}) {
  const h = await lib();
  const L = h.lane(LANE_N);
  h.laneEnv?.(L);
  const names = ((await (await fetch(`${API}/products?limit=8`)).json()).data ?? []).map((p) => p.name);
  const browser = await playwright().chromium.launch();
  const out = {};
  try {
    for (const pg of MINI_PAGES) {
      for (const persona of MINI_PERSONAS) {
        const rs = [];
        const loads = [];
        let extra = {};
        for (let i = 0; i < runs; i++) {
          loads.push(loadSnapshot());
          const m = await measureMini(browser, L, h, names, pg, persona, { cpu });
          rs.push(m.run);
          extra = { lcpEl: m.lcpEl, bodyHead: m.bodyHead, apiCalls: m.apiCalls };
        }
        out[`${pg.key}:${persona}`] = { path: pg.path, persona, medians: summarize(rs), ...extra, loadBefore: loads };
      }
    }
  } finally {
    await browser.close();
    await h.closePrisma?.();
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const a = process.argv.slice(2);
  const o = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  const res = await runMini({ runs: Number(o('--runs', 3)) });
  const txt = JSON.stringify(res, null, 2);
  if (o('--out')) fs.writeFileSync(o('--out'), txt);
  else console.log(txt);
}
