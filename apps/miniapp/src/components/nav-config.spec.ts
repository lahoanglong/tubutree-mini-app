import { describe, it, expect } from 'vitest';
import { NAV_TABS, ROOT_PATHS, isRootPath } from './nav-config';

describe('nav-config — nguồn duy nhất cho tab bar + ROOTS (spec §3.5, 4a.1)', () => {
  it('5 tab, "Đơn hàng" thay "Ví & HH", Vườn Xanh ở giữa', () => {
    expect(NAV_TABS.map((t) => t.path)).toEqual(['/', '/browse', '/game', '/orders', '/profile']);
    expect(NAV_TABS.map((t) => t.label)).toEqual(['Trang chủ', 'Danh mục', 'Vườn Xanh', 'Đơn hàng', 'Cá nhân']);
    expect(NAV_TABS[2]!.center).toBe(true);
    expect(NAV_TABS[3]!.badge).toBe('active-orders');
  });
  it('/orders là trang gốc; /wallet thành trang con', () => {
    expect(ROOT_PATHS).toContain('/orders');
    expect(isRootPath('/orders')).toBe(true);
    expect(isRootPath('/wallet')).toBe(false);
    expect(isRootPath('/order/TUBU1')).toBe(false);
  });
});
