import { describe, expect, it } from 'vitest';
import { liveRoute } from './route-fallback';

describe('liveRoute (nhận route Mini như SHELVES khai)', () => {
  it('Mini: route của gói sau (chưa có trang) trỏ về trang đang có', () => {
    expect(liveRoute('/flash-sale', 'mini')).toBe('/offers');
    expect(liveRoute('/best-sellers', 'mini')).toBe('/browse?sort=best_seller');
    expect(liveRoute('/vouchers', 'mini')).toBe('/offers?section=coupons');
  });
  it('web: cùng ý, route web', () => {
    expect(liveRoute('/flash-sale', 'web')).toBe('/uu-dai');
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
