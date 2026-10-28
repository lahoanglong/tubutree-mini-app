// Đo CLS của Trang chủ lúc mở app với mọi lời gọi API bị làm chậm, in từng lần dịch chuyển (giá trị, mốc ms, phần tử).
//   node docs/2026-10-28-review/tools/perf/cls-probe.mjs <mini|web> <persona> [độ trễ API ms, mặc định 1200]
// Cần lane N=2 đang chạy từ worktree này (sửa số 2 ở dưới nếu dùng lane khác) và đã có persona; web khổ 375x812.
import { open } from '../../../2026-10-20-uat/tools/uat-harness/miniapp-session.mjs';
import { openWeb } from '../../../2026-10-20-uat/tools/uat-harness/web-session.mjs';
const [app, user, delay = '1200'] = process.argv.slice(2);
const s = app === 'mini'
  ? await open(2, user, { path: '/' })
  : await openWeb(2, user, { viewport: { width: 375, height: 812, isMobile: true } });
const page = s.page;
await page.waitForLoadState('networkidle').catch(() => {});
await page.route('**/api/**', async (route) => { await new Promise((r) => setTimeout(r, Number(delay))); route.continue().catch(() => {}); });
await page.addInitScript(() => {
  window.__cls = 0; window.__shifts = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), s: (e.sources || []).map((x) => (x.node?.nodeName || '') + ':' + ((x.node?.getAttribute?.('data-testid')) || (x.node?.textContent || '').slice(0, 20))) }); } }).observe({ type: 'layout-shift', buffered: true });
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(9000);
console.log(app, user, JSON.stringify(await page.evaluate(() => ({ cls: +window.__cls.toFixed(4), shifts: window.__shifts }))));
await s.close();
