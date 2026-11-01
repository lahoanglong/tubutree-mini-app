// R-24: đếm pageerror + lỗi console hydrate trên next start (lane 3). Dùng: node r24.mjs [--api-delay 5000]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028e-do';
const req = createRequire(WT + '/apps/e2e/package.json');
const { chromium } = req('@playwright/test');
const h = await import(WT + '/docs/2026-10-20-uat/tools/uat-harness/lib.mjs');
const L = h.lane(3);
const WEB = 'http://localhost:3232';
const bypass = fs.readFileSync(WT + '/docs/2026-10-20-uat/tools/uat-harness/state/lane-3/lane.env', 'utf8').match(/^THROTTLE_BYPASS_TOKEN=(.*)$/m)[1];
const delay = Number(process.argv.includes('--api-delay') ? process.argv[process.argv.indexOf('--api-delay') + 1] : 0);
const pages0 = [
  ['product-slug', '/san-pham/mat-ong-rung-bhnong', 'guest'],
  ['product-slug', '/san-pham/mat-ong-rung-bhnong', 'returning'],
  ['loyalty', '/tai-khoan/diem-xanh', 'returning'],
  ['loyalty', '/tai-khoan/diem-xanh', 'guest'],
];
const pages = Array.from({length: 10}, () => pages0[0]);
const HYD = /(Minified React error #(418|423|425)|Hydration failed|hydrat|did not match|There was an error while hydrating)/i;
const browser = await chromium.launch();
const out = [];
for (const delayMs of [0, delay].filter((v, i, a) => i === 0 || v)) for (const vp of [375, 1280]) for (const [key, path, persona] of pages) for (const run of [1]) {
  const ctx = await browser.newContext({ viewport: { width: vp, height: vp === 375 ? 812 : 800 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  await ctx.route((u) => u.pathname.startsWith('/api/') && u.port === '3231', async (r) => {
    if (delayMs) await new Promise((x) => setTimeout(x, delayMs));
    await r.fallback({ headers: { ...r.request().headers(), 'x-throttle-bypass': bypass } });
  });
  if (persona !== 'guest') {
    const u = await h.findUser(L, persona);
    const rt = await h.mintRefresh(L, u.id);
    await ctx.addCookies([{ name: 'tubu_rt', value: rt, domain: 'localhost', path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Lax' }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('tubu_web_session', '1'); } catch {} });
  }
  const page = await ctx.newPage();
  const pageErrors = [], consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.text().slice(0, 200)); });
  await page.goto(WEB + path, { waitUntil: 'load', timeout: 120000 }).catch((e) => pageErrors.push('goto ' + e.message));
  await page.waitForTimeout(delayMs ? delayMs + 3000 : 3500);
  const hyd = [...pageErrors, ...consoleErrors].filter((t) => HYD.test(t));
  out.push({ key, path, persona, vp, apiDelayMs: delayMs, run, finalUrl: page.url().replace(WEB, ''), pageErrors, consoleErrors, hydrate: hyd.length });
  console.log(key, persona, vp, 'delay', delayMs, 'run', run, '->', page.url().replace(WEB, ''), 'pageErrors', pageErrors.length, 'console', consoleErrors.length, 'hydrate', hyd.length);
  await ctx.close();
}
await browser.close();
fs.writeFileSync(new URL('./r24-guest-repeat.json', import.meta.url), JSON.stringify(out, null, 1));
