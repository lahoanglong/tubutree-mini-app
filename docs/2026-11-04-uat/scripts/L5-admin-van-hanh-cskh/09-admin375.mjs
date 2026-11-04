// Admin web khổ 375: các tab dùng hằng ngày (routes.json adminDaily) cho ADMIN, và tab chính của từng vai nhân viên.
// Kiểm: không tràn ngang cả trang, không request 4xx/5xx, không lỗi console, có nội dung, nút bấm không nhỏ hơn 32px; chụp ảnh.
// Dùng: node 09-admin375.mjs [vai trò,vai trò]
import fs from 'node:fs';
import { L, SHOTS, ENV, check, rec, save, short } from './_lib.mjs';

const WT = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104';
const { openWeb } = await import(`${WT}/docs/2026-10-20-uat/tools/uat-harness/web-session.mjs`);
const routes = JSON.parse(fs.readFileSync(`${WT}/docs/2026-10-28-review/tools/routes.json`, 'utf8'));
const daily = routes.adminDaily.map((k) => k.replace('tab-', ''));
const PLAN = {
  admin: daily,
  cskh: ['inbox', 'orders', 'returns', 'supportChat'],
  ketoan: ['inbox', 'orders', 'customerRefunds', 'payouts'],
  kho: ['inbox', 'orders', 'returns'],
  marketing: ['inbox', 'coupons', 'notificationTemplates'],
  staff: ['inbox'],
};
const ROLES = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'admin,cskh,ketoan,kho,marketing').split(',');
const IGNORE = (r) => r.status === 401 && /^\/me\//.test(r.path);

async function settle(s) {
  await s.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
  await s.page.waitForTimeout(800);
}
async function bypassApi(ctx) {
  await ctx.route((u) => u.href.startsWith(L.apiUrl), (route) => route.continue({ headers: { ...route.request().headers(), 'x-throttle-bypass': ENV.THROTTLE_BYPASS_TOKEN } }));
}

for (const role of ROLES) {
  const s = await openWeb(5, role, { viewport: { width: 375, height: 800 }, path: '/admin?tab=inbox' });
  await bypassApi(s.context);
  await settle(s);
  for (const k of PLAN[role]) {
    const from = s.requests.length;
    const e0 = s.consoleErrors.length;
    await s.page.goto(`${L.webUrl}/admin?tab=${k}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await settle(s);
    await s.page.waitForTimeout(600);
    const reqs = s.requests.slice(from).filter((r) => !IGNORE(r));
    const bad = reqs.filter((r) => r.status >= 400);
    const errs = s.consoleErrors.slice(e0).filter((x) => !/status of 401/.test(String(x)));
    const m = await s.page.evaluate(() => {
      const de = document.documentElement;
      const vw = window.innerWidth;
      const wide = [...document.querySelectorAll('body *')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('[class*="overflow-x"],[style*="overflow-x"],table'); })
        .slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().slice(0, 40)} right=${Math.round(e.getBoundingClientRect().right)}`);
      const small = [...document.querySelectorAll('button, a[href], [role="button"]')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 32 && r.top >= 0 && r.top < 800; }).length;
      const main = document.querySelector('main') ?? document.body;
      return { overflow: de.scrollWidth - vw, wide, small, text: main.innerText.trim().length, title: (main.querySelector('h1,h2')?.textContent ?? '').trim().slice(0, 60), shown: [...document.querySelectorAll('[aria-current="page"]')].map((e) => (e.textContent || '').trim().slice(0, 30)).slice(0, 2) };
    });
    await s.page.screenshot({ path: `${SHOTS}/ui375-${role}-${k}.png`, fullPage: false });
    const problems = [];
    if (m.overflow > 1) problems.push(`tràn ngang ${m.overflow}px (${m.wide.join('; ')})`);
    if (bad.length) problems.push(`request lỗi: ${bad.slice(0, 3).map((r) => `${r.method} ${r.path} ${r.status}`).join('; ')}`);
    if (errs.length) problems.push(`lỗi console: ${short(errs[0], 120)}`);
    if (m.text < 20) problems.push('nội dung trống');
    rec(`L5-A375-${role}-${k}`, role, 'web375', 'Admin trên điện thoại', `mở /admin?tab=${k} ở 375px`, 'không tràn ngang, không request lỗi, không lỗi console, có nội dung',
      `${problems.join(' | ') || 'ổn'}; tiêu đề "${m.title}"; ${reqs.length} request; ${m.small} nút thấp hơn 32px trong màn hình đầu`, { ...m, bad: bad.slice(0, 3), errs: errs.slice(0, 2) }, problems.length ? 'FAIL' : 'PASS');
  }
  await s.close();
}
save(`09-admin375-${ROLES.join('_')}`);
process.exit(0);
