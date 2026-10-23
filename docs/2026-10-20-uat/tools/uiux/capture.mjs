// Bản chép cho phiên UAT 2026-10-20 từ scripts/uiux/capture.mjs (bản gốc ghi đè ảnh đã commit + gọi cổng 3001/3112/3113).
// Chụp + đo từng (route x trạng thái x viewport [x engine]). Một trình duyệt, một context tại một thời điểm, tuần tự.
//
// Cách chạy (từ gốc worktree uat, PATH có node 22):
//   export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
//   (cd apps/miniapp && VITE_API_BASE_URL=http://127.0.0.1:3221/api npx vite --host 127.0.0.1 --port 3223)   # giữ chạy
//   node docs/2026-10-20-uat/tools/uiux/capture.mjs miniapp --vp 390                         # Chromium, mọi route x trạng thái
//   node docs/2026-10-20-uat/tools/uiux/capture.mjs miniapp --vp 390 --engine webkit --only '^(home|browse|product-detail|cart|checkout|bank-payment|orders|order-detail)$'
//   Cờ: --only <regex id> --states a,b --force (chụp lại cả key đã có).
// Biến môi trường:
//   UIUX_API      API thật cho GET công khai (catalog/config), mặc định http://127.0.0.1:3221 (API UAT). Không bao giờ gửi ghi.
//   MINIAPP_BASE  mặc định http://localhost:3223 (phải là host 'localhost': zmp-sdk ngoài Zalo chỉ giả lập getStorage/login trên
//                 localhost; với 127.0.0.1 phiên không bao giờ dựng được, mọi màn thành khách chưa đăng nhập) ; WEB_BASE mặc định http://localhost:3222
// Ghi: docs/2026-10-20-uat/screens/<app>/<id>__<state>__<vp>[__webkit].png và docs/2026-10-20-uat/screens/<app>.jsonl (resume được).
// Trạng thái: normal, empty, loading, error, long (như bản gốc) + offline (GET dữ liệu bị abort, navigator.onLine = false).
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit, VIEWPORTS, ROOT, pageMetrics, runAxe } from './lib/pw.mjs';
import { ApiRouter, loadEndpoints } from './lib/api-router.mjs';
import { makeSession, makeCurated } from './lib/sessions.mjs';
import { artUri } from './lib/art.mjs';
import { miniappRoutes, webRoutes } from './routes.mjs';

const args = process.argv.slice(2);
const app = args[0];
const opt = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt('--only') ? new RegExp(opt('--only')) : null;
const onlyVp = opt('--vp');
const onlyStates = opt('--states')?.split(',');
const force = args.includes('--force');
const engine = opt('--engine') ?? 'chromium';
const API = (process.env.UIUX_API ?? 'http://127.0.0.1:3221').replace(/\/+$/, '') + '/api';
const base = app === 'web' ? process.env.WEB_BASE ?? 'http://localhost:3222' : process.env.MINIAPP_BASE ?? 'http://localhost:3223';
const OUT = path.join(ROOT, 'docs/2026-10-20-uat/screens');
const shotDir = path.join(OUT, app);
const resFile = path.join(OUT, `${app}.jsonl`);
fs.mkdirSync(shotDir, { recursive: true });
fs.mkdirSync(path.dirname(resFile), { recursive: true });

const done = new Set();
if (fs.existsSync(resFile) && !force) {
  for (const l of fs.readFileSync(resFile, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try {
      const j = JSON.parse(l);
      if (!j.fail) done.add(j.key);
    } catch {
      /* bỏ dòng hỏng */
    }
  }
}

const prodList = (await (await fetch(API + '/products?limit=8')).json()).data.map((p) => ({ ...p, thumbnail: p.thumbnail ?? artUri(p.name) }));
const brandRaw = await (await fetch(API + '/brands')).json().catch(() => []);
const brandList = Array.isArray(brandRaw) ? brandRaw : brandRaw.data ?? [];
const ctx0 = { product: prodList[0].slug, brand: brandList[0]?.slug ?? 'bh-nong' };
const routes = (app === 'web' ? webRoutes(ctx0) : miniappRoutes(ctx0)).filter((r) => !only || only.test(r.id));
const endpoints = loadEndpoints(`${app}-endpoints.json`);
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu'] });

async function shoot(route, state, vp) {
  const key = `${route.id}__${state}__${vp}` + (engine === 'webkit' ? '__webkit' : '');
  if (done.has(key)) return;
  const persona = route.persona;
  const guest = persona === 'guest';
  const session = guest ? { user: null, me: null } : makeSession(persona);
  const router = new ApiRouter({
    state,
    session,
    endpoints,
    curated: makeCurated({ persona: guest ? 'customer' : persona, products: prodList }),
    web: app === 'web',
    products: prodList,
  });
  const context = await browser.newContext({ ...VIEWPORTS[vp], locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 160)));
  const rec = { key, app, engine, id: route.id, path: route.path, persona, state, vp: Number(vp), at: new Date().toISOString() };
  try {
    await router.install(page);
    if (state === 'offline') {
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true });
      });
    }
    if (app === 'web' && !guest) await page.addInitScript(() => localStorage.setItem('tubu_web_session', '1'));
    if (guest) {
      await page.route((u) => u.pathname === '/api/auth/refresh', (rt) => rt.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"no session"}' }));
    }
    const t0 = Date.now();
    await page.goto(base + route.path, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(state === 'loading' ? 1200 : 700);
    if (state === 'offline') await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    if (state !== 'loading') {
      // Chờ nội dung ổn định (phiên giả -> truy vấn phụ thuộc đăng nhập chạy sau lượt đầu): innerText không đổi 2 lần liên tiếp.
      let prev = -1;
      let same = 0;
      for (let i = 0; i < 14 && same < 2; i++) {
        const len = await page.evaluate(() => (document.body.innerText || '').length + document.images.length * 1000);
        same = len === prev ? same + 1 : 0;
        prev = len;
        await page.waitForTimeout(350);
      }
    }
    if (route.clickTab) {
      await page.getByRole('button', { name: route.clickTab }).first().click({ timeout: 8000 }).catch(() => errors.push('clickTab fail ' + route.clickTab));
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    rec.loadMs = Date.now() - t0;
    rec.finalUrl = await page.evaluate(() => location.pathname + location.search);
    const m = await page.evaluate(pageMetrics);
    Object.assign(rec, {
      title: m.title,
      hOverflow: m.hOverflow,
      scrollH: m.scrollH,
      tapTotal: m.tapTotal,
      tapSmall: m.tapSmall,
      tapSmallList: m.tapSmallList.slice(0, 30).map((t) => `${t.tag}[${t.label}] ${t.w}x${t.h} @${t.x},${t.y}`),
      tapSmallEff: m.tapSmallEff,
      tinyText: m.tinyText,
      fontSizes: m.fontSizes,
      families: m.families,
      h1: m.h1,
      hasMain: m.hasMain,
      headings: m.headings.slice(0, 12),
      images: m.images,
      imagesNoAlt: m.imagesNoAlt,
      bodyText: m.bodyText.slice(0, state === 'normal' ? 3000 : 800),
    });
    if (state === 'normal' || state === 'long') {
      const ax = await runAxe(page).catch((e) => String(e));
      rec.axe = typeof ax === 'string' ? ax : ax.map((v) => ({ id: v.id, impact: v.impact, count: v.count, n: v.nodes.slice(0, 2).map((n) => ({ t: n.target, d: n.data })) }));
    }
    // Trang cuộn trong khung con (miniapp): mở rộng viewport để ảnh có cả nội dung dài.
    const cap = vp === '390' ? 3200 : 2400;
    const extra = await page.evaluate(() => {
      let best = 0;
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 40) best = Math.max(best, el.scrollHeight - el.clientHeight);
      }
      return best;
    });
    if (extra > 0 && app === 'miniapp') {
      const h = Math.min(VIEWPORTS[vp].viewport.height + extra, cap);
      await page.setViewportSize({ width: VIEWPORTS[vp].viewport.width, height: h });
      await page.waitForTimeout(350);
    }
    const file = path.join(shotDir, `${key}.png`);
    await page.screenshot({ path: file, fullPage: app === 'web' });
    rec.shot = path.relative(ROOT, file).replace(/\\/g, '/');
    rec.errors = errors.slice(0, 4);
    rec.unmocked = [...router.unmocked].slice(0, 6);
  } catch (e) {
    rec.fail = String(e).slice(0, 300);
  } finally {
    router.dispose();
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
  fs.appendFileSync(resFile, JSON.stringify(rec) + '\n');
  console.log(rec.fail ? 'FAIL' : 'ok  ', key, rec.fail ?? `${rec.loadMs}ms small=${rec.tapSmall}/${rec.tapTotal}`);
}

for (const route of routes) {
  const states = onlyStates ?? route.states;
  for (const state of states) {
    if (!route.states.includes(state)) continue;
    for (const vp of onlyVp ? [onlyVp] : ['390']) {
      if (vp === '390' && route.mobileStates && !route.mobileStates.includes(state)) continue;
      await shoot(route, state, vp);
    }
  }
}
await browser.close();
console.log('xong');
