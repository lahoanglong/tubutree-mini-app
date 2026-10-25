import { describe, it, expect } from 'vitest';
import { NAV_TABS, ROOT_PATHS, isRootPath } from './nav-config';

describe('nav-config — nguồn duy nhất cho tab bar + ROOTS (spec §3.5, 4a.1)', () => {
  it('5 tab, "Ưu đãi" thay "Đơn hàng", Vườn Xanh ở giữa', () => {
    expect(NAV_TABS.map((t) => t.path)).toEqual(['/', '/browse', '/game', '/offers', '/profile']);
    expect(NAV_TABS.map((t) => t.label)).toEqual(['Trang chủ', 'Danh mục', 'Vườn Xanh', 'Ưu đãi', 'Cá nhân']);
    expect(NAV_TABS[2]!.center).toBe(true);
    expect(NAV_TABS[3]!.badge).toBe('offers-dot');
    expect(NAV_TABS[4]!.badge).toBe('active-orders');
  });
  it('/offers là trang gốc; /orders và /wallet thành trang con', () => {
    expect(ROOT_PATHS).toContain('/offers');
    expect(isRootPath('/offers')).toBe(true);
    expect(isRootPath('/orders')).toBe(false);
    expect(isRootPath('/wallet')).toBe(false);
    expect(isRootPath('/order/TUBU1')).toBe(false);
  });
});
