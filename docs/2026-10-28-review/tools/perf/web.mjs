// Đo web (next start 3601, API lane 5) giả lập Moto G, 4G chậm, CPU x4. Mỗi trang 3 lần, trung vị.
// Dùng: node web.mjs [--runs 3] [--out file.json]   (cần web 3601 đang chạy; run-all.mjs tự bật)
import fs from 'node:fs';
import { API, MOTO_G4, VITALS_INIT, WEB_URL, H, LANE_N, laneEnvVal, loadSnapshot, median, playwright, round, summarize, tbt, throttle, lib, sleep } from './lib.mjs';
import path from 'node:path';

const BLOCK_HOST = /(^|\.)(api\.tubutree\.com|zalo\.me|zaloapp\.com|zdn\.vn|zadn\.vn|zalopay\.vn|sentry\.io|ingest\.sentry\.io)$/i;

// persona + thao tác bấm thật cho INP. Thao tác không đổi dữ liệu, trừ "detail" (thêm giỏ, được dọn sau mỗi lần).
export const WEB_PAGES = [
  { key: 'home', path: '/', persona: 'returning', click: { text: /^Mã của tôi/ } },
  { key: 'list', path: '/san-pham', persona: 'returning', click: { text: /^Bán chạy$/ } },
  { key: 'detail', path: '/san-pham/mat-ong-rung-bhnong', persona: 'new', click: { text: /^Thêm vào giỏ$/ }, mutatesCart: true },
  { key: 'checkout', path: '/thanh-toan', persona: 'returning', click: { text: /^Mã giảm giá/ } },
];

export async function measureWebPage(browser, L, h, pg, { cpu = 4 } = {}) {
  const user = await h.findUser(L, pg.persona);
  const keep = pg.mutatesCart ? ((await h.apiOk(L, 'GET', '/cart', { user: user.id })).items ?? []).map((i) => i.id) : [];
  const context = await browser.newContext({ ...MOTO_G4, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const bypass = laneEnvVal('THROTTLE_BYPASS_TOKEN');
  await context.route((u) => BLOCK_HOST.test(u.hostname), (r) => r.abort('blockedbyclient'));
  await context.route((u) => u.pathname.startsWith('/api/'), (r) => r.fallback({ headers: { ...r.request().headers(), 'x-throttle-bypass': bypass } }));
  if (user) {
    const rt = await h.mintRefresh(L, user.id);
    await context.addCookies([{ name: 'tubu_rt', value: rt, domain: 'localhost', path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Lax' }]);
    await context.addInitScript(() => { try { localStorage.setItem('tubu_web_session', '1'); } catch {} });
  }
  await context.addInitScript(VITALS_INIT);
  const page = await context.newPage();
  const cdp = await throttle(page, { cpu });
  const apiCalls = [];
  page.on('requestfinished', (rq) => { if (rq.url().startsWith(API)) apiCalls.push(rq.url().slice(API.length)); });
  const t0 = Date.now();
  await page.goto(`${WEB_URL}${pg.path}`, { waitUntil: 'load', timeout: 120_000 });
  const loadMs = Date.now() - t0;
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await sleep(2500);
  const snap = await page.evaluate(() => {
    const p = window.__perf;
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const sum = (f) => res.filter(f).reduce((s, r) => s + (r.transferSize || 0), 0);
    return {
      fcp: p.fcp, lcp: p.lcp, lcpEl: p.lcpEl, cls: p.cls, clsSession: p.clsSession, longTasks: p.longTasks, now: performance.now(),
      ttfb: nav?.responseStart, domContentLoaded: nav?.domContentLoadedEventEnd, load: nav?.loadEventEnd,
      requests: res.length + 1, jsKB: sum((r) => r.initiatorType === 'script') / 1024, imgKB: sum((r) => r.initiatorType === 'img') / 1024,
      totalKB: (sum(() => true) + (nav?.transferSize || 0)) / 1024,
    };
  });
  // thao tác bấm thật
  let inp = null;
  let clickLabel = null;
  const loc = page.getByRole('button', { name: pg.click.text }).first();
  if (await loc.count()) {
    clickLabel = (await loc.innerText().catch(() => '')).split('\n')[0];
    await loc.scrollIntoViewIfNeeded().catch(() => undefined);
    await sleep(300);
    const t1 = await page.evaluate(() => performance.now());
    await loc.click({ timeout: 10_000 }).catch(() => undefined);
    await sleep(1500);
    const ev = await page.evaluate((t) => window.__perf.events.filter((e) => e[1] >= t), t1);
    if (ev.length) inp = Math.max(...ev.map((e) => e[2]));
  }
  if (pg.mutatesCart && user) await cleanCart(h, L, user, keep);
  await cdp.detach().catch(() => undefined);
  await context.close();
  return {
    run: { fcp: snap.fcp, lcp: snap.lcp, cls: snap.cls, clsSession: snap.clsSession, tbt: tbt(snap.longTasks, snap.fcp, snap.now), inp, ttfb: snap.ttfb, loadEvent: snap.load, requests: snap.requests, apiRequests: apiCalls.length, jsKB: snap.jsKB, imgKB: snap.imgKB, totalKB: snap.totalKB, longTaskCount: snap.longTasks.length },
    lcpEl: snap.lcpEl, clickLabel, apiCalls: [...new Set(apiCalls.map((c) => c.split('?')[0]))],
  };
}

export async function runWeb({ runs = 3, cpu = 4 } = {}) {
  const h = await lib();
  const L = h.lane(LANE_N);
  h.laneEnv?.(L);
  const browser = await playwright().chromium.launch();
  const out = {};
  try {
    for (const pg of WEB_PAGES) {
      const rs = [];
      const loads = [];
      let extra = {};
      for (let i = 0; i < runs; i++) {
        loads.push(loadSnapshot());
        const m = await measureWebPage(browser, L, h, pg, { cpu });
        rs.push(m.run);
        extra = { lcpEl: m.lcpEl, clickLabel: m.clickLabel, apiCalls: m.apiCalls };
      }
      out[pg.key] = { path: pg.path, persona: pg.persona, medians: summarize(rs), ...extra, loadBefore: loads };
    }
  } finally {
    await browser.close();
    await h.closePrisma?.();
  }
  return out;
}

/** Xoá các dòng giỏ không có trong ảnh chụp trước phép đo (thêm giỏ để đo INP không để lại dấu vết trong DB lane). */
async function cleanCart(h, L, user, keepIds) {
  const cart = await h.apiOk(L, 'GET', '/cart', { user: user.id });
  for (const it of cart.items ?? []) if (!keepIds.includes(it.id)) await h.api(L, 'DELETE', `/cart/items/${it.id}`, { user: user.id });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const a = process.argv.slice(2);
  const o = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  const res = await runWeb({ runs: Number(o('--runs', 3)) });
  const txt = JSON.stringify(res, null, 2);
  if (o('--out')) fs.writeFileSync(o('--out'), txt);
  else console.log(txt);
}
