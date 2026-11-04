// Ma trận vai trò x tab admin trên WEB 1280 (và admin 375 cho tab dùng hằng ngày). Mỗi vai trò mở từng tab bằng URL ?tab=k:
//  - tab được phép (STAFF_TABS trong apps/web/src/app/admin/page.tsx, khớp @AllowStaff): URL giữ tab, có nội dung, không request 4xx/5xx;
//  - tab bị cấm: web đẩy về tab đầu được phép (page.tsx dòng ~496) và KHÔNG gọi API bị cấm (request 403 là lỗi giao diện).
// Dùng: node 03-matrix-ui.mjs [vai trò,vai trò] [--shots]
import fs from 'node:fs';
import { L, SHOTS, ENV, check, rec, save, short, harness } from './_lib.mjs';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const { openWeb } = await import(`${WT}/docs/2026-10-20-uat/tools/uat-harness/web-session.mjs`);
const routes = JSON.parse(fs.readFileSync(`${WT}/docs/2026-10-28-review/tools/routes.json`, 'utf8'));
const pageSrc = fs.readFileSync(`${WT}/apps/web/src/app/admin/page.tsx`, 'utf8');
const m = /const STAFF_TABS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(pageSrc);
const STAFF_TABS = {};
for (const row of m[1].matchAll(/(BASE|CSKH|KHO|MARKETING|KE_TOAN):\s*\[([^\]]*)\]/g)) STAFF_TABS[row[1]] = [...row[2].matchAll(/'([A-Za-z]+)'/g)].map((x) => x[1]);
const PERMS = { staff: [], kho: ['KHO'], ketoan: ['KE_TOAN'], marketing: ['MARKETING'], cskh: ['CSKH'] };
const tabsOf = (role) => {
  if (role === 'admin') return null; // tất cả
  const s = new Set(STAFF_TABS.BASE);
  for (const p of PERMS[role]) for (const t of STAFF_TABS[p]) s.add(t);
  return s;
};
const navSrc = pageSrc.slice(pageSrc.indexOf('const NAV_GROUPS'), pageSrc.indexOf('const TABS = NAV_GROUPS'));
const LABEL2KEY = new Map();
const TABS = [];
for (const it of navSrc.matchAll(/\{ k: '([A-Za-z]+)', label: '([^']+)'/g)) { if (!LABEL2KEY.has(it[2])) LABEL2KEY.set(it[2], it[1]); if (!TABS.includes(it[1])) TABS.push(it[1]); }
// 'cashback' chỉ vào thanh bên khi CASHBACK_ENABLED (packages/app-core/src/features.ts = false) nên không phải tab thật; không kiểm.
const ROLES = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'admin,staff,kho,ketoan,marketing,cskh').split(',');
const SHOTS_ON = process.argv.includes('--shots');
const ONLY = process.env.ONLY_TABS ? process.env.ONLY_TABS.split(',') : null;
const daily = new Set(routes.adminDaily.map((k) => k.replace('tab-', '')));
const IGNORE = (r) => r.status === 401 && /^\/me\//.test(r.path);

async function settle(s) {
  await s.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
  await s.page.waitForTimeout(700);
}
const tabOfUrl = (u) => new URL(u).searchParams.get('tab') ?? 'inbox';
async function shownTab(s) {
  const label = await s.page.evaluate(() => [...document.querySelectorAll('nav [aria-current="page"]')].map((e) => (e.textContent || '').replace(/\d+\s*việc.*$/, '').trim())[0] ?? null);
  if (!label) return null;
  const clean = label.split(',')[0].replace(/\s*\d+$/, '').trim();
  return LABEL2KEY.get(clean) ?? LABEL2KEY.get(label) ?? `?${label}`;
}
async function bypassApi(ctx) {
  await ctx.route((u) => u.href.startsWith(L.apiUrl), (route) => route.continue({ headers: { ...route.request().headers(), 'x-throttle-bypass': ENV.THROTTLE_BYPASS_TOKEN } }));
}

for (const role of ROLES) {
  const allowed = tabsOf(role);
  const s = await openWeb(5, role, { viewport: { width: 1280, height: 800 }, path: '/admin?tab=inbox' });
  await bypassApi(s.context);
  await settle(s);
  const first = allowed ? [...allowed][0] : 'inbox';
  const summary = { ok: 0, bad: [] };
  for (const k of TABS) {
    if (ONLY && !ONLY.includes(k)) continue;
    const should = allowed === null || allowed.has(k);
    const from = s.requests.length;
    const errsFrom = s.consoleErrors.length;
    await s.page.goto(`${L.webUrl}/admin?tab=${k}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await settle(s);
    await s.page.waitForSelector('nav [aria-current="page"]', { timeout: 15000 }).catch(() => undefined);
    await s.page.waitForTimeout(900);
    const got = (await shownTab(s)) ?? tabOfUrl(s.page.url());
    const urlTab = tabOfUrl(s.page.url());
    const reqs = s.requests.slice(from).filter((r) => !IGNORE(r));
    const bad = reqs.filter((r) => r.status >= 400);
    const text = await s.page.evaluate(() => (document.querySelector('main') ?? document.body).innerText.trim());
    const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const errTxt = /Đã có lỗi xảy ra|Không có quyền|Application error/i.test(text);
    let verdict = 'PASS';
    const notes = [];
    if (should) {
      if (got !== k) { verdict = 'FAIL'; notes.push(`được phép nhưng bị đẩy sang tab ${got}`); }
      if (bad.length) { verdict = 'FAIL'; notes.push(`request lỗi: ${bad.map((r) => `${r.method} ${r.path} ${r.status}`).slice(0, 4).join('; ')}`); }
      if (text.length < 20) { verdict = 'FAIL'; notes.push('nội dung trống'); }
      if (errTxt) { verdict = 'FAIL'; notes.push(`chữ lỗi trên màn: ${short(text.match(/Đã có lỗi xảy ra[^\n]*|Không có quyền[^\n]*|Application error[^\n]*/i)?.[0] ?? '', 100)}`); }
    } else {
      if (got === k) { verdict = 'FAIL'; notes.push('bị cấm nhưng vẫn hiển thị tab đó'); }
      else if (!allowed.has(got)) { verdict = 'FAIL'; notes.push(`bị cấm nên rơi về ${got} nhưng tab đó cũng không được phép`); }
      if (urlTab === k) notes.push('URL vẫn giữ ?tab bị cấm (chưa sửa)');
      const forb = reqs.filter((r) => r.status === 403);
      if (forb.length) { verdict = 'FAIL'; notes.push(`giao diện gọi API bị cấm: ${forb.map((r) => `${r.method} ${r.path}`).slice(0, 4).join('; ')}`); }
    }
    if (overflow > 1) notes.push(`tràn ngang ${overflow}px`);
    if (SHOTS_ON && (daily.has(k) || verdict === 'FAIL') && (role === 'admin' || verdict === 'FAIL')) {
      await s.page.screenshot({ path: `${SHOTS}/ui1280-${role}-${k}.png` });
    }
    if (verdict === 'PASS') summary.ok++;
    else summary.bad.push(`${k}: ${notes.join(' | ')}`);
    rec(`L5-UX-${role}-${k}`, role, 'web1280', 'Ma trận vai trò x tab', `mở /admin?tab=${k} (${should ? 'được phép' : 'bị cấm'})`,
      should ? 'mở đúng tab, có nội dung, không request lỗi' : `đẩy về tab ${first}, không gọi API bị cấm`, `tab hiển thị=${got}, URL=${urlTab}; ${reqs.length} request, ${bad.length} lỗi; ${notes.join('; ') || 'ổn'}`,
      { shown: got, urlTab, nContent: text.length, bad: bad.slice(0, 5) }, verdict);
  }
  rec(`L5-UX-${role}-sum`, role, 'web1280', 'Ma trận vai trò x tab', `tổng ${TABS.length} tab`, 'mọi tab đúng quyền', `${summary.ok}/${TABS.length} đúng`, summary.bad.slice(0, 20), summary.bad.length ? 'FAIL' : 'PASS');
  await s.close();
}
save(`03-matrix-ui-${ROLES.join('_')}`);
