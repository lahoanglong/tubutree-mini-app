import { describe, expect, it } from 'vitest';
import { liveRoute, routeUsable } from './route-fallback';

describe('routeUsable', () => {
  it('Giờ vàng đã có trang riêng (P12): lối vào dùng được, không còn là route chờ', () => {
    expect(routeUsable('/flash-sale')).toBe(true);
  });
  it('Bán chạy nhất và Mã giảm giá đang chờ nhưng trang thay thế đúng nội dung; route thật và route lạ dùng được', () => {
    for (const r of ['/best-sellers', '/vouchers', '/orders', '/browse', '/somewhere']) expect(routeUsable(r)).toBe(true);
  });
});

describe('liveRoute (nhận route Mini như SHELVES khai)', () => {
  it('Mini: Giờ vàng đi thẳng tới trang của nó; route của gói sau (chưa có trang) trỏ về trang đang có', () => {
    expect(liveRoute('/flash-sale', 'mini')).toBe('/flash-sale');
    expect(liveRoute('/best-sellers', 'mini')).toBe('/browse?sort=best_seller');
    expect(liveRoute('/vouchers', 'mini')).toBe('/offers?section=coupons');
  });
  it('web: cùng ý, route web', () => {
    expect(liveRoute('/flash-sale', 'web')).toBe('/gio-vang');
    expect(liveRoute('/best-sellers', 'web')).toBe('/san-pham?sort=best_seller');
    expect(liveRoute('/vouchers', 'web')).toBe('/uu-dai');
  });
  it('route đã có thật đổi sang route web tương ứng', () => {
    expect(liveRoute('/orders', 'mini')).toBe('/orders');
    expect(liveRoute('/orders', 'web')).toBe('/tai-khoan/don-hang');
    expect(liveRoute('/browse', 'web')).toBe('/san-pham');
  });
  it('route lạ trả nguyên', () => {
    expect(liveRoute('/somewhere', 'mini')).toBe('/somewhere');
    expect(liveRoute('/somewhere', 'web')).toBe('/somewhere');
  });
});
