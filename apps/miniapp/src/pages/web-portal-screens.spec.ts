import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import routeMap from '@tubutree/app-core/route-map.json';
import { describe, expect, it } from 'vitest';
import { WEB_PORTAL_BASE_URL, WEB_PORTAL_SCREENS, webPortalUrl, type WebPortalScreenKey } from './web-portal-screens';

const KEYS = Object.keys(WEB_PORTAL_SCREENS) as WebPortalScreenKey[];
const APP_TSX = readFileSync(resolve(__dirname, '../components/app.tsx'), 'utf8');
const ROUTES = (routeMap as { routes: { items: { miniapp: string; web?: string }[] }[] }).routes.flatMap((g) => g.items);

describe('8 màn rời gói Mini App sang cổng web (W177)', () => {
  it('đúng 8 đường dẫn, không thừa không thiếu', () => {
    expect([...KEYS].sort()).toEqual(
      ['/admin', '/admin/community', '/brand-owner', '/dealer', '/my-payroll', '/recycle/desk', '/staff', '/storefront'].sort(),
    );
  });

  it.each(KEYS)('%s: webPath trùng dòng route-map.json (đổi route web thì spec này đỏ)', (key) => {
    const row = ROUTES.find((r) => r.miniapp === key);
    expect(row, `route-map.json thiếu dòng ${key}`).toBeDefined();
    expect(WEB_PORTAL_SCREENS[key].webPath).toBe(row?.web);
  });

  it.each(KEYS.filter((key) => key !== '/staff'))('%s: <Route> trong app.tsx dùng đúng thẻ chuyển web với screen cùng đường dẫn', (key) => {
    const route = new RegExp(`<Route path="${key}" element=\\{<RouteShell><WebPortalRedirectPage screen="${key}" /></RouteShell>\\} />`);
    expect(APP_TSX).toMatch(route);
  });

  it('/staff: <Route> dùng StaffPortalPage, trang đó vẫn là thẻ chuyển web của /staff kèm chấm công', () => {
    expect(APP_TSX).toMatch(/<Route path="\/staff" element=\{<RouteShell><StaffPortalPage \/><\/RouteShell>\} \/>/);
    const staffPortal = readFileSync(resolve(__dirname, 'staff-portal.tsx'), 'utf8');
    expect(staffPortal).toContain('<WebPortalRedirectPage screen="/staff">');
    expect(staffPortal).toContain('<StaffAttendanceCard />');
  });

  it.each(KEYS)('%s: có tiêu đề, nhóm dùng và link https://tubutree.com/…', (key) => {
    const { title, audience, webPath } = WEB_PORTAL_SCREENS[key];
    expect(title.trim()).not.toBe('');
    expect(audience.trim()).not.toBe('');
    expect(webPath.startsWith('/')).toBe(true);
    expect(webPortalUrl(key)).toBe(`https://tubutree.com${webPath}`);
  });

  it('cổng web là https://tubutree.com, không có dấu / ở cuối', () => {
    expect(WEB_PORTAL_BASE_URL).toBe('https://tubutree.com');
  });

  it('app.tsx không còn import trang nặng của 8 màn này', () => {
    for (const page of ['admin', 'community-moderation', 'storefront-builder', 'dealer', 'recycle-desk', 'staff', 'brand-owner', 'my-payroll']) {
      expect(APP_TSX).not.toContain(`pages/${page}'`);
    }
  });
});
