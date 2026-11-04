// Chụp màn trên bản build production (Mini 3603, web 3601), API lane 5 trễ N ms: s1 ở 1,2 s, s2 sau khi API xong.
//   node shots.mjs <mini375|web375|web1280> <persona> <key,key> <delayMs> <outDir>
import fs from 'node:fs';
import path from 'node:path';
const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs';
const P = path.join(WT, 'docs/2026-10-28-review/tools/perf/');
const L5 = await import(P + 'lib.mjs');
const { MINI_375, MINI_URL, WEB_URL, PORTS, MINI_WWW, ensureServer, laneEnvVal, playwright, lib, LANE_N, sleep, MOTO_G4 } = L5;
const [phase, persona, keysArg, delayArg, outDir] = process.argv.slice(2);
const delay = Number(delayArg);
const APP_ID = '2070857098114207963';
const BLOCK_HOST = /(^|\.)(api\.tubutree\.com|zalo\.me|zaloapp\.com|zdn\.vn|zadn\.vn|zalopay\.vn|sentry\.io|ingest\.sentry\.io)$/i;
const R = JSON.parse(fs.readFileSync(path.join(WT, 'docs/2026-10-28-review/tools/routes.json'), 'utf8'));
const mini = phase === 'mini375';
const routes = R.routes.filter((r) => keysArg.split(',').includes(r.key));
fs.mkdirSync(outDir, { recursive: true });
const h = await lib();
const L = h.lane(LANE_N);
const node = process.execPath;
const srv = mini
  ? await ensureServer('mini', PORTS.mini, node, [P + 'mini-static.mjs', MINI_WWW, String(PORTS.mini)], { cwd: WT })
  : await ensureServer('web', PORTS.web, node, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(PORTS.web)], { cwd: path.join(WT, 'apps/web'), env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3251/api', API_BASE_URL: 'http://localhost:3251/api', THROTTLE_BYPASS_TOKEN: laneEnvVal('THROTTLE_BYPASS_TOKEN'), NEXT_TELEMETRY_DISABLED: '1' } });
const browser = await playwright().chromium.launch();
const bypass = laneEnvVal('THROTTLE_BYPASS_TOKEN');
const vp = mini ? { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : phase === 'web375' ? { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
for (const r of routes) {
  const p = mini ? r.mini : r.web;
  const ctx = await browser.newContext({ ...vp, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  await ctx.route((u) => BLOCK_HOST.test(u.hostname), (rt) => rt.abort('blockedbyclient'));
  let armed = false;
  await ctx.route((u) => u.pathname.startsWith('/api/') && (!mini || u.port === '3251'), async (rt) => {
    if (armed && delay && !/\/auth\//.test(rt.request().url())) await sleep(delay);
    return rt.fallback({ headers: { ...rt.request().headers(), 'x-throttle-bypass': bypass } });
  });
  if (persona !== 'guest') {
    const user = await h.findUser(L, persona);
    const rt = await h.mintRefresh(L, user.id);
    if (mini) {
      const val = Buffer.from(encodeURIComponent(JSON.stringify(rt))).toString('base64');
      await ctx.addInitScript((v) => { try { localStorage.setItem('2070857098114207963_tubu_refresh_token', v); } catch {} }, val);
    } else {
      await ctx.addCookies([{ name: 'tubu_rt', value: rt, domain: 'localhost', path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Lax' }]);
      await ctx.addInitScript(() => { try { localStorage.setItem('tubu_web_session', '1'); } catch {} });
    }
  }
  await ctx.addInitScript((id) => { window.APP_ID = id; }, APP_ID);
  const page = await ctx.newPage();
  armed = true;
  const url = mini ? `${MINI_URL}/zapps/${APP_ID}${p}` : `${WEB_URL}${p}`;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
  await sleep(1200 - (Date.now() - t0) > 0 ? 1200 - (Date.now() - t0) : 0);
  await page.screenshot({ path: path.join(outDir, `${r.key}__${persona}__${phase}__d${delay}__s1.png`) }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 40000 }).catch(() => {});
  await sleep(1500);
  await page.screenshot({ path: path.join(outDir, `${r.key}__${persona}__${phase}__d${delay}__s2.png`) }).catch(() => {});
  console.log(`${phase} ${persona} ${r.key} ok (${Math.round((Date.now() - t0) / 1000)}s)`);
  await ctx.close();
}
await browser.close();
await h.closePrisma?.();
srv.stop();
process.exit(0);
