// In lỗi trang đầy đủ (message + stack) của một route Mini App dưới mock ApiRouter, để phân biệt lỗi thật với lỗi do bộ chụp.
//   node docs/2026-10-20-uat/tools/uiux/probe-errors.mjs /path [persona] [state]
import { chromium, VIEWPORTS } from './lib/pw.mjs';
import { ApiRouter, loadEndpoints } from './lib/api-router.mjs';
import { makeSession, makeCurated } from './lib/sessions.mjs';
const [p = '/', persona = 'customer', state = 'normal'] = process.argv.slice(2);
const API = (process.env.UIUX_API ?? 'http://127.0.0.1:3221') + '/api';
const prodList = (await (await fetch(API + '/products?limit=8')).json()).data;
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...VIEWPORTS[390], locale: 'vi-VN' });
const page = await ctx.newPage();
const router = new ApiRouter({ state, session: makeSession(persona), endpoints: loadEndpoints('miniapp-endpoints.json'), curated: makeCurated({ persona, products: prodList }) });
await router.install(page);
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, String(e.stack).slice(0, 600)));
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 400)));
await page.goto((process.env.MINIAPP_BASE ?? 'http://localhost:3223') + p, { waitUntil: 'networkidle' });
await page.waitForTimeout(Number(process.env.WAIT ?? 1500));
console.log('calls', router.calls.map((c) => `${c.method} ${c.path} ${c.status} ${c.source}`).join('\n'));
router.dispose();
await browser.close();
