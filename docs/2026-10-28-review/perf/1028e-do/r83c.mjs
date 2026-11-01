// R-83: từ lúc bấm thẻ SP tới lúc khung chờ hiện (next start lane 3), 375, CPU x4. Mạng chậm sau khi trang đã tải.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028e-do';
const { chromium } = createRequire(WT + '/apps/e2e/package.json')('@playwright/test');
const h = await import(WT + '/docs/2026-10-20-uat/tools/uat-harness/lib.mjs');
const L = h.lane(3);
const WEB = 'http://localhost:3232';
const bypass = fs.readFileSync(WT + '/docs/2026-10-20-uat/tools/uat-harness/state/lane-3/lane.env', 'utf8').match(/^THROTTLE_BYPASS_TOKEN=(.*)$/m)[1];
const browser = await chromium.launch();
const out = [];
for (let run = 1; run <= 5; run++) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'vi-VN' });
  await ctx.route((u) => u.pathname.startsWith('/api/') && u.port === '3231', (r) => r.fallback({ headers: { ...r.request().headers(), 'x-throttle-bypass': bypass } }));
  await ctx.addInitScript(() => {
    window.__m = { click: null, shown: null };
    document.addEventListener('click', () => { window.__m.click = performance.now(); }, true);
    new MutationObserver(() => {
      if (window.__m.click != null && window.__m.shown == null && document.querySelector('[data-testid="pdp-nav-skeleton"]')) window.__m.shown = performance.now();
    }).observe(document, { childList: true, subtree: true });
  });
  const page = await ctx.newPage();
  await page.goto(WEB + '/san-pham', { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const inp = page.locator('input[type=search]').first();
  await inp.click(); await inp.pressSequentially('mat', { delay: 80 });
  const row = page.getByText('Mật ong rừng nguyên chất').first();
  await row.waitFor({ timeout: 15000 }).catch(() => {});
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 50 * 1024 });
  if (!(await row.count())) { console.log(run, 'KHÔNG CÓ GỢI Ý'); await ctx.close(); continue; }
  await page.evaluate(() => { window.__m.click = null; window.__m.shown = null; });
  await row.tap({ timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => window.__m.shown != null, null, { timeout: 8000 }).catch(() => {});
  const m = await page.evaluate(() => window.__m);
  const ms = m.shown != null && m.click != null ? Math.round((m.shown - m.click) * 10) / 10 : null;
  out.push({ case: 'router.push (gợi ý tìm kiếm, khách)', run, ms });
  console.log(run, ms == null ? 'KHÔNG HIỆN' : ms + ' ms');
  await ctx.close();
}
await browser.close();
fs.writeFileSync(new URL('./r83c-result.json', import.meta.url), JSON.stringify(out, null, 1));
