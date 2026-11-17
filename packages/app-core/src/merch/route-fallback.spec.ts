import { describe, expect, it } from 'vitest';
import { legacyVouchersTarget, OFFERS_CODES_ALL, OFFERS_CODES_PARAM } from '../commerce/offers-hub';
import { liveRoute, routeUsable } from './route-fallback';

describe('routeUsable', () => {
  it('mọi route đã khai đều có trang thật (Giờ vàng, Bán chạy nhất, Mã giảm giá, Đơn hàng, Duyệt); route lạ cũng dùng được', () => {
    for (const r of ['/flash-sale', '/best-sellers', '/vouchers', '/orders', '/browse', '/somewhere']) expect(routeUsable(r)).toBe(true);
  });
});

describe('liveRoute (nhận route Mini như SHELVES khai)', () => {
  it('Mini: Giờ vàng đi thẳng tới trang của nó; Mã giảm giá đi thẳng tab Săn mã của Ưu đãi với kho mã mở sẵn (không qua chuyển hướng /vouchers)', () => {
    expect(liveRoute('/flash-sale', 'mini')).toBe('/flash-sale');
    expect(liveRoute('/vouchers', 'mini')).toBe(`/offers?${OFFERS_CODES_PARAM}=${OFFERS_CODES_ALL}`);
  });
  it('web: cùng ý, route web', () => {
    expect(liveRoute('/flash-sale', 'web')).toBe('/gio-vang');
    expect(liveRoute('/vouchers', 'web')).toBe(`/uu-dai?${OFFERS_CODES_PARAM}=${OFFERS_CODES_ALL}`);
  });
  it('đích Mã giảm giá mở cùng chỗ với chuyển hướng của /vouchers và /ma-giam-gia (cùng tab, cùng tham số mở kho)', () => {
    for (const [platform, base] of [['mini', '/offers'], ['web', '/uu-dai']] as const) {
      const direct = new URL(liveRoute('/vouchers', platform), 'https://x.vn');
      const redirected = new URL(legacyVouchersTarget(base, ''), 'https://x.vn');
      expect(direct.pathname).toBe(redirected.pathname);
      expect(direct.searchParams.get(OFFERS_CODES_PARAM)).toBe(redirected.searchParams.get(OFFERS_CODES_PARAM));
    }
  });
  it('route đã có thật đổi sang route web tương ứng', () => {
    expect(liveRoute('/orders', 'mini')).toBe('/orders');
    expect(liveRoute('/orders', 'web')).toBe('/tai-khoan/don-hang');
    expect(liveRoute('/browse', 'web')).toBe('/san-pham');
    expect(liveRoute('/best-sellers', 'mini')).toBe('/best-sellers');
    expect(liveRoute('/best-sellers', 'web')).toBe('/ban-chay');
  });
  it('route lạ trả nguyên', () => {
    expect(liveRoute('/somewhere', 'mini')).toBe('/somewhere');
    expect(liveRoute('/somewhere', 'web')).toBe('/somewhere');
  });
});
