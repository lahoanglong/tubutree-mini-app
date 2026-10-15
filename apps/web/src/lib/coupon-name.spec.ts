import { describe, expect, it } from 'vitest';
import { autoCouponName } from './coupon-name';

describe('autoCouponName', () => {
  it('mã mốc chi tiêu kèm id khách → "Quà mốc chi tiêu 1 triệu", không lộ mã thô', () => {
    expect(autoCouponName('MILESTONE1000000-2026-10-CMV9MLSLB009KFKRUMVZQLRA7')).toBe('Quà mốc chi tiêu 1 triệu');
    expect(autoCouponName('MILESTONE2500000-2026-10-CMV9')).toBe('Quà mốc chi tiêu 2,5 triệu');
    expect(autoCouponName('MILESTONE500000-2026-10-CMV9')).toBe('Quà mốc chi tiêu 500 nghìn');
  });
  it('các mã tự cấp khác có tên theo loại', () => {
    expect(autoCouponName('BIRTHDAY-2026-06-CMV9')).toBe('Quà sinh nhật');
    expect(autoCouponName('WINBACK-2026-06-CMV9')).toBe('Quà chào mừng quay lại');
    expect(autoCouponName('SECOND-ORDER-CMV9')).toBe('Quà cho đơn thứ hai');
    expect(autoCouponName('WELCOME-CMV9')).toBe('Quà chào mừng thành viên mới');
  });
  it('mã thường (công khai, đổi điểm) → null để vẫn hiện mã', () => {
    expect(autoCouponName('WELCOME30')).toBeNull();
    expect(autoCouponName('TUBU-AB12CD')).toBeNull();
  });
});
