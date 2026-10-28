// Dò Trang chủ: in từng lần dịch chuyển bố cục (giá trị, mốc, phần tử, vị trí trước → sau) và các ứng viên LCP, cùng điều kiện với run-all (4G chậm, CPU x4, API lane 5).
//   node docs/2026-10-28-review/tools/perf/home-probe.mjs <worktree> <mini|web> <guest|returning> [số lần] [warm]
// warm: mở một lần rồi tải lại và đo (máy đã nhớ loại khách). Tự bật máy chủ Mini 3603 hoặc next start 3601 nếu chưa có và tắt lại khi đo xong.
import path from 'node:path';
const [WT, app = 'mini', persona = 'returning', runs = '2', warm = ''] = process.argv.slice(2);
const P = path.join(WT, 'docs/2026-10-28-review/tools/perf/');
const L5 = await import(P + 'lib.mjs');
const { MINI_375, MINI_URL, WEB_URL, PORTS, MINI_WWW, ensureServer, laneEnvVal, playwright, throttle, lib, LANE_N, sleep } = L5;
const APP_ID = '2070857098114207963';
const BLOCK_HOST = /(^|\.)(api\.tubutree\.com|zalo\.me|zaloapp\.com|zdn\.vn|zadn\.vn|zalopay\.vn|sentry\.io|ingest\.sentry\.io)$/i;
const SHIFTS = () => {
  window.__shifts = []; window.__lcp = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { const el = e.element; window.__lcp.push({ t: Math.round(e.startTime), size: e.size, url: e.url, el: el ? el.nodeName + '.' + String(el.className).split(' ').slice(0, 3).join('.') + ' "' + (el.textContent || '').trim().slice(0, 60) + '" parent:' + (el.parentElement?.className || '').toString().slice(0, 60) : '?' }); } }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__shifts.push({
        v: +e.value.toFixed(4), t: Math.round(e.startTime),
        s: (e.sources || []).map((x) => {
          const n = x.node; if (!n) return '?';
          const el = n.nodeType === 1 ? n : n.parentElement;
          const cls = (el?.className && typeof el.className === 'string') ? '.' + el.className.split(' ').slice(0, 2).join('.') : '';
          return `${el?.nodeName}${cls} "${(el?.textContent || '').trim().slice(0, 30)}" y${Math.round(x.previousRect.y)}→${Math.round(x.currentRect.y)} h${Math.round(x.currentRect.height)}`;
        }),
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });
};
const h = await lib();
const L = h.lane(LANE_N);
const node = process.execPath;
const srv = app === 'mini' ? await ensureServer('mini', PORTS.mini, node, [P + 'mini-static.mjs', MINI_WWW, String(PORTS.mini)], { cwd: WT })
  : await ensureServer('web', PORTS.web, node, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(PORTS.web)], { cwd: path.join(WT, 'apps/web'), env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3251/api', API_BASE_URL: 'http://localhost:3251/api', THROTTLE_BYPASS_TOKEN: laneEnvVal('THROTTLE_BYPASS_TOKEN'), NEXT_TELEMETRY_DISABLED: '1' } });
const browser = await playwright().chromium.launch();
for (let i = 0; i < Number(runs); i++) {
  const ctx = await browser.newContext(app === 'mini' ? { ...MINI_375, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' } : { ...L5.MOTO_G4, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const bypass = laneEnvVal('THROTTLE_BYPASS_TOKEN');
  await ctx.route((u) => BLOCK_HOST.test(u.hostname), (r) => r.abort('blockedbyclient'));
  await ctx.route((u) => u.pathname.startsWith('/api/') && (app === 'web' || u.port === '3251'), (r) => r.fallback({ headers: { ...r.request().headers(), 'x-throttle-bypass': bypass } }));
  if (persona !== 'guest') {
    const user = await h.findUser(L, persona);
    if (app === 'mini') {
      const rt = await h.mintRefresh(L, user.id);
      const val = Buffer.from(encodeURIComponent(JSON.stringify(rt))).toString('base64');
      await ctx.addInitScript((v) => { try { localStorage.setItem('2070857098114207963_tubu_refresh_token', v); } catch {} }, val);
    } else {
      const rt = await h.mintRefresh(L, user.id);
      await ctx.addCookies([{ name: 'tubu_rt', value: rt, domain: 'localhost', path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Lax' }]);
      await ctx.addInitScript(() => { try { localStorage.setItem('tubu_web_session', '1'); } catch {} });
    }
  }
  await ctx.addInitScript((id) => { window.APP_ID = id; }, APP_ID);
  await ctx.addInitScript(SHIFTS);
  const page = await ctx.newPage();
  const cdp = await throttle(page, { cpu: 4 });
  await page.goto(app === 'mini' ? `${MINI_URL}/zapps/${APP_ID}/` : `${WEB_URL}/`, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await sleep(2500);
  if (warm) {
    await page.reload({ waitUntil: 'load', timeout: 120_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await sleep(2500);
  }
  const lcp = await page.evaluate(() => window.__lcp); for (const x of lcp) console.log('  LCP', x.t + 'ms', 'size', x.size, x.url ? 'img ' + x.url.slice(-60) : '', x.el);
  const sh = await page.evaluate(() => window.__shifts);
  const total = sh.reduce((a, x) => a + x.v, 0);
  console.log(`run ${i + 1}: CLS ${total.toFixed(3)}`);
  for (const x of sh) console.log(`  ${x.v} @${x.t}ms`, x.s.join(' | '));
  await cdp.detach().catch(() => undefined);
  await ctx.close();
}
await browser.close();
await h.closePrisma?.();
srv.stop();
process.exit(0);
