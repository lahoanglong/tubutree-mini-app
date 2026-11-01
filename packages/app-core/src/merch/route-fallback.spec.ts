import { describe, expect, it } from 'vitest';
import { liveRoute, routeUsable } from './route-fallback';

describe('routeUsable', () => {
  it('Giờ vàng chờ P12: trang thay thế (Ưu đãi) không có Giờ vàng hay "Nhắc tôi" nên lối vào không dùng được', () => {
    expect(routeUsable('/flash-sale')).toBe(false);
  });
  it('Mã giảm giá đang chờ nhưng trang thay thế đúng nội dung; Bán chạy nhất đã có trang thật; route thật và route lạ dùng được', () => {
    for (const r of ['/best-sellers', '/vouchers', '/orders', '/browse', '/somewhere']) expect(routeUsable(r)).toBe(true);
  });
});

describe('liveRoute (nhận route Mini như SHELVES khai)', () => {
  it('Mini: route của gói sau (chưa có trang) trỏ về trang đang có', () => {
    expect(liveRoute('/flash-sale', 'mini')).toBe('/offers');
    expect(liveRoute('/vouchers', 'mini')).toBe('/offers?section=coupons');
  });
  it('web: cùng ý, route web', () => {
    expect(liveRoute('/flash-sale', 'web')).toBe('/uu-dai');
    expect(liveRoute('/vouchers', 'web')).toBe('/uu-dai');
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
