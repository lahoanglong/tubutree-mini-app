import { describe, expect, it } from 'vitest';
import { couponShortcut } from './loyalty-tier-copy';

describe('couponShortcut — dòng mã giảm giá ở trang Hạng', () => {
  it('có mã: "Ví mã (n)" tới mục mã ở Ưu đãi', () => {
    expect(couponShortcut(3)).toMatchObject({ title: 'Ví mã (3)', to: 'coupons' });
  });

  it('chưa có mã: "Đổi quà" tới Kho quà', () => {
    expect(couponShortcut(0)).toMatchObject({ title: 'Đổi quà', to: 'rewards' });
  });

  it('chưa biết số mã (tải lỗi): "Ví mã" không kèm số, vẫn tới mục mã', () => {
    expect(couponShortcut(null)).toMatchObject({ title: 'Ví mã', to: 'coupons' });
  });
});
