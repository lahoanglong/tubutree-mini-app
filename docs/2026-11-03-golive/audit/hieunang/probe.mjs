// Dò từng màn: số lời gọi API (kể cả trùng), lỗi console/pageError, CLS + nguồn, LCP, byte JS. Bản build production (Mini 3603, web 3601) + API lane 5.
//   node probe.mjs <mini|web375|web1280> <persona> <key,key,...|all> [--delay ms] [--cpu 4] [--out file.json]
import fs from 'node:fs';
import path from 'node:path';
const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs';
const P = path.join(WT, 'docs/2026-10-28-review/tools/perf/');
const L5 = await import(P + 'lib.mjs');
const { MINI_375, MINI_URL, WEB_URL, PORTS, MINI_WWW, ensureServer, laneEnvVal, playwright, throttle, lib, LANE_N, sleep, VITALS_INIT, MOTO_G4, API } = L5;
const a = process.argv.slice(2);
const [app, persona, keysArg] = a;
const o = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const delay = Number(o('--delay', 0));
const cpu = Number(o('--cpu', app === 'web1280' ? 1 : 4));
const outFile = o('--out');
const APP_ID = '2070857098114207963';
const BLOCK_HOST = /(^|\.)(api\.tubutree\.com|zalo\.me|zaloapp\.com|zdn\.vn|zadn\.vn|zalopay\.vn|sentry\.io|ingest\.sentry\.io)$/i;
const R = JSON.parse(fs.readFileSync(path.join(WT, 'docs/2026-10-28-review/tools/routes.json'), 'utf8'));
let routes = R.routes.filter((r) => (app === 'mini' ? r.mini : r.web));
if (keysArg !== 'all') routes = routes.filter((r) => keysArg.split(',').includes(r.key));
const h = await lib();
const L = h.lane(LANE_N);
const node = process.execPath;
const srv = app === 'mini'
  ? await ensureServer('mini', PORTS.mini, node, [P + 'mini-static.mjs', MINI_WWW, String(PORTS.mini)], { cwd: WT })
  : await ensureServer('web', PORTS.web, node, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(PORTS.web)], { cwd: path.join(WT, 'apps/web'), env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3251/api', API_BASE_URL: 'http://localhost:3251/api', THROTTLE_BYPASS_TOKEN: laneEnvVal('THROTTLE_BYPASS_TOKEN'), NEXT_TELEMETRY_DISABLED: '1' } });
const browser = await playwright().chromium.launch();
const bypass = laneEnvVal('THROTTLE_BYPASS_TOKEN');
const SHIFTS = () => {
  window.__shifts = []; window.__lcp = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { const el = e.element; window.__lcp.push({ t: Math.round(e.startTime), size: e.size, url: e.url, el: el ? el.nodeName + '.' + String(el.className).split(' ').slice(0, 3).join('.') + ' "' + (el.textContent || '').trim().slice(0, 50) + '"' : '?' }); } }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__shifts.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), s: (e.sources || []).map((x) => { const n = x.node; if (!n) return '?'; const el = n.nodeType === 1 ? n : n.parentElement; const cls = (el?.className && typeof el.className === 'string') ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''; return `${el?.nodeName}${cls} "${(el?.textContent || '').trim().slice(0, 30)}" y${Math.round(x.previousRect.y)}→${Math.round(x.currentRect.y)} h${Math.round(x.currentRect.height)}`; }) });
    }
  }).observe({ type: 'layout-shift', buffered: true });
};
const out = [];
for (const r of routes) {
  const pers = persona;
  const p = app === 'mini' ? r.mini : r.web;
  if (!(app === 'mini' ? r.miniPersonas : r.webPersonas).includes(pers) && pers !== 'returning') { continue; }
  const vp = app === 'mini' ? MINI_375 : app === 'web375' ? { ...MOTO_G4, viewport: { width: 375, height: 812 } } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
  const ctx = await browser.newContext({ ...vp, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  await ctx.route((u) => BLOCK_HOST.test(u.hostname), (rt) => rt.abort('blockedbyclient'));
  await ctx.route((u) => u.pathname.startsWith('/api/') && (app !== 'mini' || u.port === '3251'), async (rt) => {
    if (delay && !/\/auth\//.test(rt.request().url())) await sleep(delay);
    return rt.fallback({ headers: { ...rt.request().headers(), 'x-throttle-bypass': bypass } });
  });
  if (pers !== 'guest') {
    const user = await h.findUser(L, pers);
    const rt = await h.mintRefresh(L, user.id);
    if (app === 'mini') {
      const val = Buffer.from(encodeURIComponent(JSON.stringify(rt))).toString('base64');
      await ctx.addInitScript((v) => { try { localStorage.setItem('2070857098114207963_tubu_refresh_token', v); } catch {} }, val);
    } else {
      await ctx.addCookies([{ name: 'tubu_rt', value: rt, domain: 'localhost', path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Lax' }]);
      await ctx.addInitScript(() => { try { localStorage.setItem('tubu_web_session', '1'); } catch {} });
    }
  }
  await ctx.addInitScript((id) => { window.APP_ID = id; }, APP_ID);
  await ctx.addInitScript(VITALS_INIT);
  await ctx.addInitScript(SHIFTS);
  const page = await ctx.newPage();
  const consoleErrors = []; const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
  const calls = [];
  page.on('requestfinished', async (rq) => { if (rq.url().startsWith(API)) { const rs = await rq.response().catch(() => null); calls.push({ p: rq.method() + ' ' + rq.url().slice(API.length).split('?')[0], s: rs?.status() ?? 0 }); } });
  page.on('requestfailed', (rq) => { if (rq.url().startsWith(API)) calls.push({ p: rq.method() + ' ' + rq.url().slice(API.length).split('?')[0], s: 0 }); });
  const cdp = cpu > 1 ? await throttle(page, { cpu }) : null;
  const url = app === 'mini' ? `${MINI_URL}/zapps/${APP_ID}${p}` : `${WEB_URL}${p}`;
  const t0 = Date.now();
  let err = null;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await sleep(2500);
  } catch (e) { err = String(e.message).slice(0, 120); }
  let snap = {};
  try {
    snap = await page.evaluate(() => {
      const pf = window.__perf; const res = performance.getEntriesByType('resource'); const nav = performance.getEntriesByType('navigation')[0];
      const sum = (f) => res.filter(f).reduce((s, x) => s + (x.transferSize || 0), 0);
      return { fcp: pf?.fcp, lcp: pf?.lcp, lcpEl: pf?.lcpEl, shifts: window.__shifts, longTasks: (pf?.longTasks || []).length, requests: res.length + 1, jsKB: Math.round(sum((x) => x.initiatorType === 'script') / 1024), totalKB: Math.round((sum(() => true) + (nav?.transferSize || 0)) / 1024), body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 100), finalPath: location.pathname + location.search };
    });
  } catch (e) { err = err || String(e.message).slice(0, 120); }
  const cls = (snap.shifts || []).reduce((s, x) => s + x.v, 0);
  const counts = {};
  for (const c of calls) { const k = `${c.p} ${c.s >= 400 || c.s === 0 ? '[' + c.s + ']' : ''}`.trim(); counts[k] = (counts[k] || 0) + 1; }
  const dup = Object.entries(counts).filter(([, n]) => n > 1);
  const bad = calls.filter((c) => c.s >= 400 || c.s === 0);
  const row = { app, key: r.key, path: p, persona: pers, ms: Date.now() - t0, apiCalls: calls.length, distinct: Object.keys(counts).length, dup, bad, cls: +cls.toFixed(3), shifts: (snap.shifts || []).filter((x) => x.v >= 0.005).slice(0, 6), fcp: snap.fcp && Math.round(snap.fcp), lcp: snap.lcp && Math.round(snap.lcp), lcpEl: snap.lcpEl, longTasks: snap.longTasks, requests: snap.requests, jsKB: snap.jsKB, totalKB: snap.totalKB, consoleErrors: consoleErrors.slice(0, 4), pageErrors, finalPath: snap.finalPath, body: snap.body, err, calls: counts };
  out.push(row);
  console.log(`${app} ${pers} ${r.key.padEnd(18)} api ${String(row.apiCalls).padStart(2)} (${row.distinct} distinct${dup.length ? ', dup ' + dup.map(([k, n]) => k + 'x' + n).join(',') : ''}${bad.length ? ', BAD ' + bad.map((b) => b.p + ':' + b.s).join(',') : ''}) cls ${row.cls} lcp ${row.lcp} fcp ${row.fcp} js ${row.jsKB}KB tot ${row.totalKB}KB req ${row.requests}${consoleErrors.length ? ' CONSOLE:' + consoleErrors[0].slice(0, 80) : ''}${pageErrors.length ? ' PAGEERR:' + pageErrors[0].slice(0, 80) : ''}${err ? ' ERR:' + err : ''}`);
  if (cdp) await cdp.detach().catch(() => undefined);
  await ctx.close();
}
await browser.close();
await h.closePrisma?.();
srv.stop();
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ meta: { date: new Date().toISOString(), app, persona, delay, cpu, load: L5.loadSnapshot() }, rows: out }, null, 1));
process.exit(0);
