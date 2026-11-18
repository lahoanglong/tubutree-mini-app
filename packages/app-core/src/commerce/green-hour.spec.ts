import { describe, expect, it } from 'vitest';
import { flashBlockLook, greenHourCanQuickAdd } from './green-hour';

describe('flashBlockLook', () => {
  it('cờ tắt hoặc API cũ: khối Giờ vàng như cũ, không nút thêm nhanh', () => {
    expect(flashBlockLook(undefined, 'home')).toEqual({ title: 'Giờ vàng', icon: 'zap', tone: 'promo', soldTone: 'flash', quickAdd: false });
    expect(flashBlockLook(false, 'offers').title).toBe('Giờ vàng hôm nay');
  });

  it('cờ bật: Giờ Xanh Ưu Đãi tông xanh, thanh đã bán xanh, có nút thêm nhanh ở cả Trang chủ và Ưu đãi', () => {
    for (const where of ['home', 'offers'] as const) {
      expect(flashBlockLook(true, where)).toEqual({ title: 'Giờ Xanh Ưu Đãi', icon: 'leaf', tone: 'default', soldTone: 'green', quickAdd: true });
    }
  });
});

describe('greenHourCanQuickAdd', () => {
  it('suất bán hết hoặc thẻ hết hàng thì không có nút ＋', () => {
    expect(greenHourCanQuickAdd({ quota: 10, soldCount: 3 }, 'in')).toBe(true);
    expect(greenHourCanQuickAdd({ quota: 0, soldCount: 99 }, 'in')).toBe(true);
    expect(greenHourCanQuickAdd({ quota: 10, soldCount: 10 }, 'in')).toBe(false);
    expect(greenHourCanQuickAdd({ quota: 10, soldCount: 3 }, 'out')).toBe(false);
  });
});
