// r5: thêm persona newpending (khách mới có đơn chưa giao), mốc gift/giftLoadGone (r5b) (dải Quà khách mới hiện chữ), cờ MODE. 6 ca (guest/new/returning x lạnh/warm), before/after xen kẽ, lane 4. Dùng lib của worktree.
import { spawn, execFileSync } from 'node:child_process';
const W = process.env.W, S = process.env.S, REPS = Number(process.env.REPS || 3);
const P = W + '/docs/2026-10-28-review/tools/perf/';
const lib = await import(P + 'lib.mjs');
const { MINI_375, VITALS_INIT, laneEnvVal, loadSnapshot, playwright, throttle, sleep, median } = lib;
const h = await lib.lib();
const L = h.lane(4);
const API = 'http://localhost:3241/api';
const APP_ID = '2070857098114207963';
const BLOCK = /(^|\.)(api\.tubutree\.com|zalo\.me|zaloapp\.com|zdn\.vn|zadn\.vn|zalopay\.vn|sentry\.io|ingest\.sentry\.io)$/i;
const PORT = { before: 3975, after: 3976, prev: 3977 };
const VARIANTS = (process.env.VARIANTS || 'before,after').split(',');
const DELAY = Number(process.env.DELAY_BELOW || 0);
const kids = [];
for (const v of VARIANTS) kids.push(spawn(process.execPath, [P + 'mini-static.mjs', `${S}/www-${v}`, String(PORT[v])], { stdio: 'ignore' }));
await sleep(1500);
const names = ((await (await fetch(`${API}/products?limit=8`)).json()).data ?? []).map((p) => p.name);
const READY = `(() => { const names = ${JSON.stringify(names)}; const tick = () => { const p = window.__perf; if (!p || p.firstMatch != null) return; const t = document.body ? document.body.innerText : ''; if (names.some((n) => t.includes(n))) p.firstMatch = performance.now(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  window.__gift = { text: null, loadingSeen: null, gone: null };
  const g = () => { const G = window.__gift, now = performance.now(); const sec = document.querySelector('section[aria-label="Quà khách mới"]'); const load = document.querySelector('[data-testid="new-customer-gift-loading"]');
    if (G.text == null && sec) G.text = now; if (load && G.loadingSeen == null) G.loadingSeen = now; if (G.loadingSeen != null && !load && G.gone == null) G.gone = now;
    if (now < 9000) requestAnimationFrame(g); }; requestAnimationFrame(g); })();`;
const browser = await playwright().chromium.launch();
const bypass = laneEnvVal('THROTTLE_BYPASS_TOKEN', 4);
async function one(variant, persona, warm) {
  const ctx = await browser.newContext({ ...MINI_375, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  await ctx.route((u) => BLOCK.test(u.hostname), (r) => r.abort('blockedbyclient'));
  await ctx.route((u) => u.pathname.startsWith('/api/') && u.port === '3241', (r) => r.fallback({ headers: { ...r.request().headers(), 'x-throttle-bypass': bypass } }));
  if (persona !== 'guest') {
    const user = await h.findUser(L, persona);
    const rt = await h.mintRefresh(L, user.id);
    const val = Buffer.from(encodeURIComponent(JSON.stringify(rt))).toString('base64');
    await ctx.addInitScript((v) => { try { localStorage.setItem('2070857098114207963_tubu_refresh_token', v); } catch {} }, val);
  }
  if (DELAY) await ctx.route(/home-below[^/]*\.js/, async (r) => { await sleep(DELAY); await r.continue(); });
  await ctx.addInitScript((id) => { window.APP_ID = id; }, APP_ID);
  await ctx.addInitScript(VITALS_INIT);
  await ctx.addInitScript(READY);
  await ctx.addInitScript(SHIFTS);
  const page = await ctx.newPage();
  const cdp = await throttle(page, { cpu: 4 });
  const url = `http://localhost:${PORT[variant]}/zapps/${APP_ID}/`;
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await sleep(2500);
  if (warm) {
    await page.reload({ waitUntil: 'load', timeout: 120_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await sleep(2500);
  }
  const s = await page.evaluate(() => ({ fm: window.__perf.firstMatch, gift: window.__gift.text, giftLoadGone: window.__gift.gone, cls: window.__perf.cls, fcp: window.__perf.fcp, head: document.body.innerText.slice(0, 60), shifts: window.__shifts }));
  await cdp.detach().catch(() => undefined); await ctx.close();
  return s;
}
const SHIFTS = () => { window.__shifts = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.hadRecentInput) continue; window.__shifts.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), s: (e.sources || []).map((x) => { const n = x.node; if (!n) return '?'; const el = n.nodeType === 1 ? n : n.parentElement; return `${el?.nodeName}.${String(el?.className||'').split(' ').slice(0,2).join('.')} "${(el?.textContent || '').trim().slice(0, 30)}" y${Math.round(x.previousRect.y)}→${Math.round(x.currentRect.y)} h${Math.round(x.currentRect.height)}`; }) }); } }).observe({ type: 'layout-shift', buffered: true }); };
const res = {};
console.log(JSON.stringify(loadSnapshot()));
for (const persona of (process.env.PERSONAS || 'guest,new,returning').split(',')) for (const warm of (process.env.WARMS || 'false,true').split(',').map((x) => x === 'true')) {
  const key = `${persona}/${warm ? 'warm' : 'cold'}`;
  res[key] = Object.fromEntries(VARIANTS.map((v) => [v, []]));
  for (let i = 0; i < REPS; i++) for (const v of VARIANTS) {
    const r = await one(v, persona, warm);
    res[key][v].push(r);
    if (process.env.SHIFTS && i === 0) for (const x of r.shifts) console.log('   shift', v, x.v, '@' + x.t, x.s.join(' | '));
    console.log(key, v, i, 'firstCard', r.fm && Math.round(r.fm), 'gift', r.gift && Math.round(r.gift), 'loadGone', r.giftLoadGone && Math.round(r.giftLoadGone), 'cls', r.cls.toFixed(4));
  }
}
console.log(`| ca | ${VARIANTS[0]} thẻ đầu (ms) | ${VARIANTS[1]} thẻ đầu (ms) | chênh | CLS trước | CLS sau | dải quà hiện chữ trước | dải quà hiện chữ sau | khung xám dải quà tắt trước | sau | mẫu trước | mẫu sau |`);
for (const [k, o] of Object.entries(res)) {
  const m = (v, f) => median(o[v].map(f));
  const A = VARIANTS[0], B = VARIANTS[1];
  const bf = m(A, (r) => r.fm), af = m(B, (r) => r.fm);
  const fm = (v) => o[v].map((r) => r.fm && Math.round(r.fm)).join('/');
  console.log(`| ${k} | ${Math.round(bf)} | ${Math.round(af)} | ${Math.round(af - bf)} | ${m(A, (r) => r.cls).toFixed(4)} | ${m(B, (r) => r.cls).toFixed(4)} | ${Math.round(m(A, (r) => r.gift ?? NaN))} | ${Math.round(m(B, (r) => r.gift ?? NaN))} | ${Math.round(m(A, (r) => r.giftLoadGone ?? NaN))} | ${Math.round(m(B, (r) => r.giftLoadGone ?? NaN))} | ${fm(A)} | ${fm(B)} |`);
}
await browser.close(); await h.closePrisma?.();
for (const k of kids) k.kill('SIGTERM');
process.exit(0);
