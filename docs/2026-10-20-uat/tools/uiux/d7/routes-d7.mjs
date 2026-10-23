// Bảng route cho nhánh D7 (admin 1440 + web khách 1440). Tab admin và ma trận tab nhân viên đọc thẳng từ
// apps/web/src/app/admin/page.tsx (NAV_GROUPS, STAFF_TABS) để bảng chụp không lệch mã khi thêm tab.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/pw.mjs';

const PAGE = path.join(ROOT, 'apps/web/src/app/admin/page.tsx');

export function readAdminNav() {
  const src = fs.readFileSync(PAGE, 'utf8');
  const navBlock = src.slice(src.indexOf('const NAV_GROUPS'), src.indexOf('const TABS ='));
  const groups = [];
  const groupRe = /label: '([^']+)',\s*items: \[([\s\S]*?)\]/g;
  let g;
  while ((g = groupRe.exec(navBlock))) {
    const items = [...g[2].matchAll(/\{ k: '(\w+)', label: '([^']+)' \}/g)].map((m) => ({ k: m[1], label: m[2] }));
    groups.push({ label: g[1], items });
  }
  const staffBlock = src.slice(src.indexOf('const STAFF_TABS'), src.indexOf('type WasteInboxKey'));
  const staff = {};
  for (const m of staffBlock.matchAll(/(\w+): \[([^\]]*)\]/g)) staff[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]);
  return { groups, tabs: groups.flatMap((x) => x.items), staff };
}

/** Persona nhân viên -> nhóm quyền (khớp lib/sessions.mjs STAFF_PERMS). */
export const STAFF_PERSONAS = { 'staff-cskh': 'CSKH', 'staff-ketoan': 'KE_TOAN', 'staff-marketing': 'MARKETING', 'staff-kho': 'KHO' };

/** Tab có bảng dài: chụp thêm trạng thái long để xem lọc/tìm/phân trang. */
const LONG_TABS = new Set(['orders', 'users', 'payouts', 'customerRefunds', 'dealers', 'externalOrders', 'externalClaims', 'reviews', 'community', 'returns', 'coupons', 'dealerAccounts', 'cashback', 'posCredits', 'merchantProducts', 'storefronts', 'subscriptions', 'waste']);

export function adminRoutes() {
  const { tabs, staff } = readAdminNav();
  const r = (id, p, persona, states, extra = {}) => ({ app: 'web', id, path: p, persona, states, ...extra });
  const out = [];
  for (const t of tabs) {
    const states = ['normal', 'empty', 'error', ...(LONG_TABS.has(t.k) ? ['long'] : [])];
    out.push(r(`admin-${t.k}`, `/admin?tab=${t.k}`, 'admin', states, { tab: t.k, label: t.label, group: 'admin' }));
  }
  out.push(r('admin-pos', '/admin/pos', 'admin', ['normal', 'empty', 'error'], { group: 'admin' }));
  for (const [persona, perm] of Object.entries(STAFF_PERSONAS)) {
    const allowed = new Set([...(staff.BASE ?? []), ...(staff[perm] ?? [])]);
    out.push(r(`${persona}-landing`, '/admin', persona, ['normal'], { group: 'staff', expectTabs: [...allowed] }));
    for (const k of allowed) out.push(r(`${persona}-${k}`, `/admin?tab=${k}`, persona, ['normal'], { tab: k, group: 'staff', expectTabs: [...allowed] }));
    // Tab ngoài quyền: phải rơi về tab đầu được phép, không render nội dung tab bị cấm.
    const forbidden = tabs.map((t) => t.k).find((k) => !allowed.has(k) && ['payouts', 'config', 'users', 'staffRoster'].includes(k));
    if (forbidden) out.push(r(`${persona}-forbidden-${forbidden}`, `/admin?tab=${forbidden}`, persona, ['normal'], { tab: forbidden, group: 'staff', expectTabs: [...allowed], forbidden: true }));
  }
  out.push(r('staff-none-landing', '/admin', 'staff-none', ['normal'], { group: 'staff', expectTabs: [...(staff.BASE ?? [])] }));
  out.push(r('customer-admin-denied', '/admin', 'customer', ['normal'], { group: 'staff' }));
  out.push(r('guest-admin', '/admin', 'guest', ['normal'], { group: 'staff' }));
  return out;
}

export function customerRoutes({ product, brand, storefront = 'tubu-demo' }) {
  const r = (id, p, persona = 'customer') => ({ app: 'web', id: `web-${id}`, path: p, persona, states: ['normal'], group: 'customer' });
  return [
    r('home', '/'),
    r('danh-muc', '/san-pham'),
    r('san-pham', `/san-pham/${product}`),
    r('gio-hang', '/gio-hang'),
    r('thanh-toan', '/thanh-toan'),
    r('don-hang', '/tai-khoan/don-hang'),
    r('tai-khoan', '/tai-khoan'),
    r('gian-hang', `/s/${storefront}`),
    r('brand', `/brand/${brand}`),
    r('cong-dong', '/cong-dong'),
  ];
}
