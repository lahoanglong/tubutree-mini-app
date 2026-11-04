// Đo độ trễ điều hướng thật (bấm → thấy nội dung màn mới) + INP thô của thao tác chỉ đọc. Production build, 4G chậm, CPU x4, persona returning.
//   node nav-probe.mjs <mini|web375> [runs] [--out file]
import fs from 'node:fs';
import path from 'node:path';
const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs';
const P = path.join(WT, 'docs/2026-10-28-review/tools/perf/');
const L5 = await import(P + 'lib.mjs');
const { MINI_375, MINI_URL, WEB_URL, PORTS, MINI_WWW, ensureServer, laneEnvVal, playwright, throttle, lib, LANE_N, sleep, VITALS_INIT, MOTO_G4, API } = L5;
const a = process.argv.slice(2);
const app = a[0];
const runs = Number(a[1] && !a[1].startsWith('--') ? a[1] : 2);
const o = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const APP_ID = '2070857098114207963';
const BLOCK_HOST = /(^|\.)(api\.tubutree\.com|zalo\.me|zaloapp\.com|zdn\.vn|zadn\.vn|zalopay\.vn|sentry\.io|ingest\.sentry\.io)$/i;
const h = await lib();
const L = h.lane(LANE_N);
const node = process.execPath;
const srv = app === 'mini'
  ? await ensureServer('mini', PORTS.mini, node, [P + 'mini-static.mjs', MINI_WWW, String(PORTS.mini)], { cwd: WT })
  : await ensureServer('web', PORTS.web, node, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(PORTS.web)], { cwd: path.join(WT, 'apps/web'), env: { ...process.env, NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3251/api', API_BASE_URL: 'http://localhost:3251/api', THROTTLE_BYPASS_TOKEN: laneEnvVal('THROTTLE_BYPASS_TOKEN'), NEXT_TELEMETRY_DISABLED: '1' } });
const browser = await playwright().chromium.launch();
const bypass = laneEnvVal('THROTTLE_BYPASS_TOKEN');
const names = ((await (await fetch(`${API}/products?limit=8`)).json()).data ?? []).map((p) => p.name);
const SLUG = 'mat-ong-rung-bhnong';
const results = [];
for (let i = 0; i < runs; i++) {
  const vp = app === 'mini' ? MINI_375 : { ...MOTO_G4, viewport: { width: 375, height: 812 } };
  const ctx = await browser.newContext({ ...vp, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  await ctx.route((u) => BLOCK_HOST.test(u.hostname), (rt) => rt.abort('blockedbyclient'));
  await ctx.route((u) => u.pathname.startsWith('/api/') && (app !== 'mini' || u.port === '3251'), (rt) => rt.fallback({ headers: { ...rt.request().headers(), 'x-throttle-bypass': bypass } }));
  const user = await h.findUser(L, 'returning');
  const rt = await h.mintRefresh(L, user.id);
  if (app === 'mini') {
    const val = Buffer.from(encodeURIComponent(JSON.stringify(rt))).toString('base64');
    await ctx.addInitScript((v) => { try { localStorage.setItem('2070857098114207963_tubu_refresh_token', v); } catch {} }, val);
  } else {
    await ctx.addCookies([{ name: 'tubu_rt', value: rt, domain: 'localhost', path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Lax' }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('tubu_web_session', '1'); } catch {} });
  }
  await ctx.addInitScript((id) => { window.APP_ID = id; }, APP_ID);
  await ctx.addInitScript(VITALS_INIT);
  const page = await ctx.newPage();
  const errs = [];
  const calls = [];
  page.on('requestfinished', (rq) => { if (rq.url().startsWith(API)) calls.push(rq.method() + ' ' + rq.url().slice(API.length).split('?')[0]); });
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
  const cdp = await throttle(page, { cpu: 4 });
  const base = app === 'mini' ? `${MINI_URL}/zapps/${APP_ID}` : WEB_URL;
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await sleep(2500);
  const steps = [];
  // 1. bấm thẻ SP ở Trang chủ → PDP
  const nameRe = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
  const tile = app === 'mini' ? page.getByRole('button', { name: nameRe }).first() : page.getByRole('link', { name: nameRe }).first();
  await measure('home→PDP (bấm thẻ SP)', async () => { await tile.scrollIntoViewIfNeeded().catch(() => {}); await tile.click({ timeout: 8000 }); },
    () => /Thêm vào giỏ|Mua ngay|Chọn mua/.test(document.body.innerText) && /product|san-pham/.test(location.pathname));
  // Thanh đáy ẩn ở trang con (PDP): quay lại Trang chủ trước khi đo các tab.
  await page.goBack({ timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => /Bạn đang tìm gì|Tìm sản phẩm/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  // 2. tab dưới: Danh mục, Vườn Xanh, Ưu đãi, Cá nhân, Trang chủ (thanh đáy)
  for (const [label, ready] of [
    ['Danh mục', () => /\/browse|\/san-pham($|\?)/.test(location.pathname) && /Sắp xếp|Tất cả|Bộ lọc/i.test(document.body.innerText)],
    ['Vườn Xanh', () => /game|vuon-xanh/.test(location.pathname) && /Điểm danh|Vườn|Tưới|Nhiệm vụ/i.test(document.body.innerText)],
    ['Ưu đãi', () => /offers|uu-dai/.test(location.pathname) && /Ưu đãi|Mã giảm|Giờ vàng/i.test(document.body.innerText)],
    ['Cá nhân', () => /profile|tai-khoan/.test(location.pathname) && /Đơn hàng|Điểm Xanh/.test(document.body.innerText)],
    ['Trang chủ', () => !/(browse|product|san-pham|game|vuon-xanh|offers|uu-dai|profile|tai-khoan)/.test(location.pathname.replace(APP_ID, '')) && /Bạn đang tìm gì|Tìm sản phẩm/.test(document.body.innerText)],
  ]) {
    const nav = page.getByRole('navigation').getByRole('link', { name: new RegExp('^' + label) }).or(page.getByRole('navigation').getByRole('button', { name: new RegExp('^' + label) })).first();
    await measure(`tab ${label}`, async () => { await nav.click({ timeout: 8000 }); }, ready);
  }
  async function measure(name, act, ready) {
    const t0 = await page.evaluate(() => performance.now());
    const c0 = calls.length;
    let ok = true;
    let spinnerSeen = false;
    const watch = setInterval(async () => { try { const s = await page.evaluate(() => !!document.querySelector('[role=progressbar], .zaui-spinner, [aria-busy=true], [data-skeleton], .animate-pulse')); if (s) spinnerSeen = true; } catch {} }, 120);
    try { await act(); } catch (e) { ok = false; }
    let tReady = null;
    try { await page.waitForFunction(ready, null, { timeout: 12000, polling: 50 }); tReady = (await page.evaluate(() => performance.now())) - t0; } catch { ok = false; }
    clearInterval(watch);
    await sleep(1200);
    const ev = await page.evaluate((t) => window.__perf.events.filter((e) => e[1] >= t).map((e) => e[2]), t0);
    steps.push({ name, ok, api: calls.slice(c0).length, apiList: calls.slice(c0).join(','), readyMs: tReady && Math.round(tReady), inpMs: ev.length ? Math.max(...ev) : null, skeletonOrSpinnerSeen: spinnerSeen, path: await page.evaluate(() => location.pathname) });
  }
  const cls = await page.evaluate(() => window.__perf.cls);
  results.push({ run: i + 1, steps, cls: +cls.toFixed(3), pageErrors: errs });
  console.log(`run ${i + 1}`, JSON.stringify(steps.map((s) => `${s.name}: ${s.ok ? s.readyMs + 'ms' : 'FAIL'} inp ${s.inpMs} ${s.skeletonOrSpinnerSeen ? '[loading UI]' : ''} api ${s.api}`)), 'cls', cls.toFixed(3), errs.length ? 'ERR ' + errs[0] : '');
  await cdp.detach().catch(() => undefined);
  await ctx.close();
}
await browser.close();
await h.closePrisma?.();
srv.stop();
if (o('--out')) fs.writeFileSync(o('--out'), JSON.stringify({ app, date: new Date().toISOString(), load: L5.loadSnapshot(), results }, null, 1));
process.exit(0);
