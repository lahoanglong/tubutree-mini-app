// Mở một trang qua ApiRouter (như capture.mjs) và in toàn bộ lỗi console + request /api, để phân biệt lỗi thật với lỗi do mock.
//   UIUX_API=http://127.0.0.1:3221 UIUX_WEB_BASE=http://localhost:3222 node docs/2026-10-20-uat/tools/uiux/d7/debug-page.mjs <path> [persona] [state]
import { chromium, VIEWPORTS } from './lib/pw.mjs';
import { ApiRouter, loadEndpoints } from './lib/api-router.mjs';
import { makeSession, makeCurated } from './lib/sessions.mjs';
import { artUri } from './lib/art.mjs';

const [p = '/', persona = 'customer', state = 'normal'] = process.argv.slice(2);
const API = (process.env.UIUX_API ?? 'http://127.0.0.1:3221').replace(/\/+$/, '');
const base = (process.env.UIUX_WEB_BASE ?? 'http://localhost:3222').replace(/\/+$/, '');
const prodList = (await (await fetch(`${API}/api/products?limit=8`)).json()).data.map((x) => ({ ...x, thumbnail: x.thumbnail ?? artUri(x.name) }));
const guest = persona === 'guest';
const router = new ApiRouter({ state, session: guest ? { user: null, me: null } : makeSession(persona), endpoints: loadEndpoints('web-endpoints.json'), curated: makeCurated({ persona: guest ? 'customer' : persona, products: prodList }), web: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...VIEWPORTS['1440'], locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 1500)));
page.on('pageerror', (e) => console.log('PAGEERROR', String(e.stack ?? e).slice(0, 1500)));
await router.install(page);
// UIUX_FAIL=/a,/b: ép các GET này trả 404 (mô phỏng endpoint lỗi) để xem trang có sập cả trang không.
for (const fp of (process.env.UIUX_FAIL ?? '').split(',').filter(Boolean)) {
  await page.route((u) => u.pathname === '/api' + fp, (rt) => rt.fulfill({ status: Number(process.env.UIUX_FAIL_STATUS ?? 404), contentType: 'application/json', body: '{"statusCode":404,"message":"x"}' }));
}
if (!guest) await page.addInitScript(() => localStorage.setItem('tubu_web_session', '1'));
else await page.route((u) => u.pathname === '/api/auth/refresh', (rt) => rt.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
await page.goto(base + p, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(2500);
console.log('CALLS', router.calls.map((c) => `${c.method} ${c.path} ${c.status} ${c.source}`).join('\n'));
console.log('TEXT', (await page.evaluate(() => document.body.innerText)).slice(0, 400));
router.dispose();
await browser.close();
