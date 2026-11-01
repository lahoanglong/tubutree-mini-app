// R-16: đếm request Trang chủ web (next start 3232) và Mini (Vite 3233), lane 3. Khách vãng lai/mới/cũ, mở lạnh và mở lại.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028f-donhang';
const { chromium } = createRequire(WT + '/apps/e2e/package.json')('@playwright/test');
const H = WT + '/docs/2026-10-20-uat/tools/uat-harness/';
const h = await import(H + 'lib.mjs');
const ms = await import(H + 'miniapp-session.mjs');
const L = h.lane(3);
const bypass = fs.readFileSync(H + 'state/lane-3/lane.env', 'utf8').match(/^THROTTLE_BYPASS_TOKEN=(.*)$/m)[1];
const sleep = (t) => new Promise((r) => setTimeout(r, t));
const out = [];
const OUT = process.argv[2] || 'r16-after.json';
const summarize = (reqs, sts = new Map()) => {
  const api = reqs.filter((u) => u.port === '3231' && u.pathname.startsWith('/api/'));
  const byPath = {};
  for (const u of api) { const k = u.pathname.replace(/^\/api/, ''); byPath[k] = (byPath[k] || 0) + 1; }
  const orders = api.filter((u) => /^\/api\/orders/.test(u.pathname)).map((u) => `${u.pathname.replace(/^\/api/, '')}${u.search} -> ${sts.get(u.href) ?? '?'}`);
  return { total: reqs.length, api: api.length, orders, dup: Object.entries(byPath).filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`), paths: Object.keys(byPath) };
};
const browser = await chromium.launch();
for (const persona of ['guest', 'new', 'returning']) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'vi-VN' });
  await ctx.route((u) => u.pathname.startsWith('/api/') && u.port === '3231', (r) => r.fallback({ headers: { ...r.request().headers(), 'x-throttle-bypass': bypass } }));
  if (persona !== 'guest') {
    const u = await h.findUser(L, persona);
    await ctx.addCookies([{ name: 'tubu_rt', value: await h.mintRefresh(L, u.id), domain: 'localhost', path: '/api/auth', httpOnly: true, secure: false, sameSite: 'Lax' }]);
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('__seen')) { localStorage.setItem('tubu_web_session', '1'); sessionStorage.setItem('__seen', '1'); } } catch {} });
  }
  const page = await ctx.newPage();
  let reqs = [];
  const sts = new Map();
  page.on('request', (r) => reqs.push(new URL(r.url())));
  page.on('response', (r) => sts.set(r.url(), r.status()));
  for (const phase of ['cold', 'reopen']) {
    reqs = [];
    if (phase === 'cold') await page.goto('http://localhost:3232/', { waitUntil: 'load', timeout: 120000 });
    else await page.reload({ waitUntil: 'load', timeout: 120000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await sleep(2500);
    const s = summarize(reqs, sts);
    out.push({ app: 'web', persona, phase, ...s });
    console.log('web', persona, phase, 'total', s.total, 'api', s.api, 'trùng', s.dup.join(',') || '-');
  }
  await ctx.close();
}
await browser.close();
for (const persona of ['guest', 'new', 'returning']) {
  for (const phase of ['cold', 'reopen']) {
    const s = await ms.open(3, persona, { headless: true, path: '/' });
    let reqs = [];
    if (phase === 'reopen') { await sleep(6000); s.requests.length = 0; await s.page.reload({ waitUntil: 'load' }); }
    await s.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await sleep(phase === 'cold' ? 5000 : 3500);
    reqs = s.requests.map((r) => new URL('http://localhost:3231' + (r.path.startsWith('/') ? r.path : '/' + r.path)));
    const mst = new Map(s.requests.map((r) => [new URL('http://localhost:3231/api' + (r.path.startsWith('/') ? r.path : '/' + r.path)).href, r.status]));
    const sm = summarize(reqs.map((u) => (u.pathname.startsWith('/api/') ? u : new URL('http://localhost:3231/api' + u.pathname + u.search))), mst);
    out.push({ app: 'mini', persona, phase, api: sm.api, orders: sm.orders, dup: sm.dup, paths: sm.paths });
    console.log('mini', persona, phase, 'api', sm.api, 'trùng', sm.dup.join(',') || '-');
    await s.close();
  }
}
fs.writeFileSync('/Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/perf-1028f-donhang/' + OUT, JSON.stringify(out, null, 1));
await h.closePrisma?.();
