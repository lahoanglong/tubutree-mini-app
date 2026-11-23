import { describe, expect, it } from 'vitest';
import { expiringRedeemCta, loyaltyOffersRow, memberCardOfflineHint } from './loyalty-page';

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

describe('expiringRedeemCta (tubu-w21-02) — đổi điểm trước khi hết hạn', () => {
  const urgent = { urgent: true };

  it('lô điểm thường còn ≤ 30 ngày: một lối sang tab Đổi quà trên từng nền', () => {
    expect(expiringRedeemCta('/offers', urgent, { redeemable: 5000, total: 5000 })).toEqual({
      label: 'Đổi điểm ngay trước khi hết hạn →',
      href: '/offers?tab=rewards',
      note: null,
    });
    expect(expiringRedeemCta('/uu-dai', urgent, { redeemable: 5000, total: 5000 })?.href).toBe('/uu-dai?tab=rewards');
  });

  it('tổng có lô quy đổi không hết hạn (hay phần còn khoá): nói rõ lô sắp hết hạn là điểm thường và số dùng được ngay', () => {
    expect(expiringRedeemCta('/offers', urgent, { redeemable: 12500, total: 15000 })?.note).toBe(
      'Điểm sắp hết hạn là điểm thường: đổi quà dùng được ngay 12.500 điểm',
    );
  });

  it('chưa gấp, không có điểm sắp hết hạn, hay không còn điểm nào đổi được ngay: không mời', () => {
    expect(expiringRedeemCta('/offers', { urgent: false }, { redeemable: 5000, total: 5000 })).toBeNull();
    expect(expiringRedeemCta('/offers', null, { redeemable: 5000, total: 5000 })).toBeNull();
    expect(expiringRedeemCta('/offers', urgent, { redeemable: 0, total: 9000 })).toBeNull();
  });

  it('API cũ chưa trả redeemablePoints: vẫn mời, không đoán số dùng được', () => {
    expect(expiringRedeemCta('/offers', urgent, { total: 9000 })).toMatchObject({ href: '/offers?tab=rewards', note: null });
  });
});

describe('memberCardOfflineHint (tubu-w21-02)', () => {
  it('quầy tích điểm được: dặn chụp màn hình để quét khi mất mạng', () => {
    expect(memberCardOfflineHint({ posCreditEnabled: true })).toBe('Mất mạng ở quầy? Chụp màn hình thẻ này trước: mã không đổi nên vẫn quét được.');
  });

  it('quầy chưa tích điểm hay chưa tải thẻ: không dặn', () => {
    expect(memberCardOfflineHint({ posCreditEnabled: false })).toBeNull();
    expect(memberCardOfflineHint(undefined)).toBeNull();
  });
});
