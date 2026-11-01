import { describe, expect, it } from 'vitest';
import { liveRoute, routeUsable } from './route-fallback';

describe('routeUsable', () => {
  it('mọi route đã khai đều có trang thật (Giờ vàng, Bán chạy nhất, Mã giảm giá, Đơn hàng, Duyệt); route lạ cũng dùng được', () => {
    for (const r of ['/flash-sale', '/best-sellers', '/vouchers', '/orders', '/browse', '/somewhere']) expect(routeUsable(r)).toBe(true);
  });
});

describe('liveRoute (nhận route Mini như SHELVES khai)', () => {
  it('Mini: Giờ vàng và Mã giảm giá đi thẳng tới trang của chúng', () => {
    expect(liveRoute('/flash-sale', 'mini')).toBe('/flash-sale');
    expect(liveRoute('/vouchers', 'mini')).toBe('/vouchers');
  });
  it('web: cùng ý, route web', () => {
    expect(liveRoute('/flash-sale', 'web')).toBe('/gio-vang');
    expect(liveRoute('/vouchers', 'web')).toBe('/ma-giam-gia');
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
