// R-83: từ lúc bấm thẻ SP tới lúc khung chờ hiện (next start lane 3), 375, CPU x4. Mạng chậm sau khi trang đã tải.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028e-do';
const { chromium } = createRequire(WT + '/apps/e2e/package.json')('@playwright/test');
const h = await import(WT + '/docs/2026-10-20-uat/tools/uat-harness/lib.mjs');
const L = h.lane(3);
const WEB = 'http://localhost:3232';
const bypass = fs.readFileSync(WT + '/docs/2026-10-20-uat/tools/uat-harness/state/lane-3/lane.env', 'utf8').match(/^THROTTLE_BYPASS_TOKEN=(.*)$/m)[1];
const cases = [
  { name: 'a-the-a (lưới /san-pham, khách)', path: '/san-pham', persona: 'guest', sel: 'a[href^="/san-pham/"]' },
  { name: 'a-the-a (Trang chủ, khách)', path: '/', persona: 'guest', sel: 'a[href^="/san-pham/"]' },
  { name: 'router.push (kệ Mua lại, returning)', path: '/', persona: 'returning', sel: 'button[aria-label][class*="tubu-press"]', rail: true },
];
const browser = await chromium.launch();
const out = [];
for (const c of cases) for (let run = 1; run <= 5; run++) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'vi-VN' });
  await ctx.route((u) => u.pathname.startsWith('/api/') && u.port === '3231', (r) => r.fallback({ headers: { ...r.request().headers(), 'x-throttle-bypass': bypass } }));
  if (c.persona !== 'guest') {
    const u = await h.findUser(L, c.persona);
    await ctx.addCookies([{ name: 'tubu_rt', value: await h.mintRefresh(L, u.id), domain: 'localhost', path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Lax' }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('tubu_web_session', '1'); } catch {} });
  }
  await ctx.addInitScript(() => {
    window.__m = { click: null, shown: null };
    document.addEventListener('pointerdown', () => { window.__m.click = performance.now(); }, true);
    new MutationObserver(() => {
      if (window.__m.click != null && window.__m.shown == null && document.querySelector('[data-testid="pdp-nav-skeleton"]')) window.__m.shown = performance.now();
    }).observe(document, { childList: true, subtree: true });
  });
  const page = await ctx.newPage();
  await page.goto(WEB + c.path, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 50 * 1024 });
  let loc = page.locator(c.sel).first();
  if (!(await loc.count())) { out.push({ ...c, run, error: 'không có thẻ' }); console.log(c.name, run, 'KHÔNG CÓ THẺ'); await ctx.close(); continue; }
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const t0 = Date.now();
  await page.evaluate(() => { window.__m.click = null; window.__m.shown = null; });
  await loc.tap({ timeout: 10000 }).catch(() => loc.click({ timeout: 10000 }).catch(() => {}));
  await page.waitForFunction(() => window.__m.shown != null, null, { timeout: 8000 }).catch(() => {});
  const m = await page.evaluate(() => window.__m);
  const ms = m.shown != null && m.click != null ? Math.round((m.shown - m.click) * 10) / 10 : null;
  out.push({ case: c.name, run, ms });
  console.log(c.name, run, ms == null ? 'KHÔNG HIỆN' : ms + ' ms');
  await ctx.close();
}
// 404
const r404 = await fetch(WEB + '/san-pham/khong-ton-tai-xyz');
console.log('404 check:', r404.status);
out.push({ case: '404 trang SP không tồn tại', status: r404.status });
await browser.close();
fs.writeFileSync(new URL('./r83-result.json', import.meta.url), JSON.stringify(out, null, 1));
