import { describe, expect, it } from 'vitest';
import { loyaltyOffersRow } from './loyalty-page';

describe('loyaltyOffersRow — một dòng từ Điểm Xanh sang hub Ưu đãi', () => {
  it('đích là tab Đổi quà của hub trên từng nền', () => {
    expect(loyaltyOffersRow('/offers', 0).href).toBe('/offers?tab=rewards');
    expect(loyaltyOffersRow('/uu-dai', 0).href).toBe('/uu-dai?tab=rewards');
  });

  it('một tiêu đề cho mọi trạng thái', () => {
    for (const n of [null, undefined, 0, 3]) expect(loyaltyOffersRow('/offers', n).title).toBe('Đổi quà & mã giảm giá');
  });

  it('có mã: dòng phụ nêu số mã đang có', () => {
    expect(loyaltyOffersRow('/offers', 3).sub).toBe('Bạn đang có 3 mã giảm giá');
  });

  it('chưa có mã, chưa tải xong hay tải lỗi: dòng phụ nói chung, không giả vờ "0 mã"', () => {
    for (const n of [null, undefined, 0]) expect(loyaltyOffersRow('/offers', n).sub).toBe('Đổi Điểm Xanh lấy mã giảm giá và quà');
  });
});
