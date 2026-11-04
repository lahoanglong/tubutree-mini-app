// Phim chụp liên tục + dòng thời gian bố cục (footer, thanh đáy, chiều cao trang) để tìm nguồn CLS trên web 375.
//   node film.mjs <web375|web1280> <persona> <path> <outDir> [frames] [intervalMs]
import fs from 'node:fs';
import path from 'node:path';
const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs';
const P = path.join(WT, 'docs/2026-10-28-review/tools/perf/');
const L5 = await import(P + 'lib.mjs');
const { WEB_URL, PORTS, ensureServer, laneEnvVal, playwright, throttle, lib, LANE_N, sleep, MOTO_G4 } = L5;
const [phase, persona, urlPath, outDir, framesArg, intArg] = process.argv.slice(2);
const frames = Number(framesArg || 14), interval = Number(intArg || 500);
fs.mkdirSync(outDir, { recursive: true });
const BLOCK_HOST = /(^|\.)(api\.tubutree\.com|zalo\.me|zaloapp\.com|zdn\.vn|zadn\.vn|zalopay\.vn|sentry\.io|ingest\.sentry\.io)$/i;
const h = await lib();
const L = h.lane(LANE_N);
const srv = await ensureServer('web', PORTS.web, process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(PORTS.web)], { cwd: path.join(WT, 'apps/web'), env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3251/api', API_BASE_URL: 'http://localhost:3251/api', THROTTLE_BYPASS_TOKEN: laneEnvVal('THROTTLE_BYPASS_TOKEN'), NEXT_TELEMETRY_DISABLED: '1' } });
const browser = await playwright().chromium.launch();
const bypass = laneEnvVal('THROTTLE_BYPASS_TOKEN');
const vp = phase === 'web375' ? { ...MOTO_G4, viewport: { width: 375, height: 812 } } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const ctx = await browser.newContext({ ...vp, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
await ctx.route((u) => BLOCK_HOST.test(u.hostname), (rt) => rt.abort('blockedbyclient'));
await ctx.route((u) => u.pathname.startsWith('/api/'), (rt) => rt.fallback({ headers: { ...rt.request().headers(), 'x-throttle-bypass': bypass } }));
if (persona !== 'guest') {
  const user = await h.findUser(L, persona);
  const rt = await h.mintRefresh(L, user.id);
  await ctx.addCookies([{ name: 'tubu_rt', value: rt, domain: 'localhost', path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('tubu_web_session', '1'); } catch {} });
}
await ctx.addInitScript(() => {
  window.__shifts = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.hadRecentInput) continue; window.__shifts.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime) }); } }).observe({ type: 'layout-shift', buffered: true });
});
const page = await ctx.newPage();
const cdp = await throttle(page, { cpu: 4 });
const t0 = Date.now();
page.goto(`${WEB_URL}${urlPath}`, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
const tl = [];
for (let i = 0; i < frames; i++) {
  const t = Date.now() - t0;
  const info = await page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return `${Math.round(b.top)}+${Math.round(b.height)}${cs.display === 'none' ? ' none' : ''}`; };
    const nav = [...document.querySelectorAll('div,nav')].find((d) => /Trang chủ.*Danh mục.*Vườn Xanh/.test(d.textContent || '') && d.children.length <= 6 && d.className?.toString().includes('md:hidden'));
    return { footer: r(document.querySelector('footer')), nav: r(nav), docH: document.documentElement.scrollHeight, main: r(document.querySelector('main')), h1: (document.querySelector('h1')?.textContent || '').slice(0, 30), loading: /Đang tải/.test(document.body.innerText), shifts: window.__shifts?.length ?? 0, cls: +(window.__shifts || []).reduce((s, x) => s + x.v, 0).toFixed(3) };
  }).catch(() => null);
  tl.push({ t, ...info });
  await page.screenshot({ path: path.join(outDir, `f${String(i).padStart(2, '0')}_${t}ms.jpg`), type: 'jpeg', quality: 55 }).catch(() => {});
  await sleep(interval);
}
const shifts = await page.evaluate(() => window.__shifts).catch(() => []);
for (const r of tl) console.log(JSON.stringify(r));
console.log('shifts', JSON.stringify(shifts));
await cdp.detach().catch(() => {});
await browser.close();
await h.closePrisma?.();
srv.stop();
process.exit(0);
