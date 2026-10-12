// Thử nhanh 1 route: node scripts/uiux/probe.mjs <miniapp|web> <path> [persona] [state] [vp]
import fs from 'node:fs';
import path from 'node:path';
import { chromium, VIEWPORTS, ROOT, pageMetrics, runAxe } from './lib/pw.mjs';
import { ApiRouter, loadEndpoints } from './lib/api-router.mjs';
import { makeSession, makeCurated } from './lib/sessions.mjs';
import { artUri } from './lib/art.mjs';

const [, , app = 'miniapp', route = '/', persona = 'customer', state = 'normal', vp = '390'] = process.argv;
const base = app === 'web' ? 'http://localhost:3112' : (process.env.MINIAPP_BASE ?? 'http://127.0.0.1:3123');
const out = path.join(ROOT, 'scripts/uiux/.probe');
fs.mkdirSync(out, { recursive: true });

const realProducts = (await (await fetch('http://localhost:3001/api/products?limit=8')).json()).data.map((p) => ({ ...p, thumbnail: p.thumbnail ?? artUri(p.name) }));
const session = makeSession(persona);
const router = new ApiRouter({
  state,
  session,
  endpoints: loadEndpoints(`${app}-endpoints.json`),
  curated: makeCurated({ persona, products: realProducts }),
  web: app === 'web',
});
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...VIEWPORTS[vp], locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', reducedMotion: 'reduce' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
await router.install(page);
if (app === 'web') await page.addInitScript(() => localStorage.setItem('tubu_web_session', '1'));
const t0 = Date.now();
await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(state === 'loading' ? 1200 : 700);
const m = await page.evaluate(pageMetrics);
console.log('load ms', Date.now() - t0);
console.log(JSON.stringify({ ...m, bodyText: m.bodyText.slice(0, 500), tapSmallList: m.tapSmallList.slice(0, 5), tapSmallEffList: undefined }, null, 1));
const ax = await runAxe(page).catch((e) => 'axe error ' + e);
console.log('axe', typeof ax === 'string' ? ax : ax.map((v) => `${v.id}(${v.count})`).join(', '));
await page.screenshot({ path: path.join(out, `${app}-${route.replace(/\W+/g, '_')}-${state}-${vp}.png`), fullPage: true });
console.log('errors', errors.slice(0, 6));
console.log('calls', router.calls.length, 'unmocked', [...router.unmocked]);
router.dispose();
await browser.close();
