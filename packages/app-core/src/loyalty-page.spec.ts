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

  it('lô điểm thường còn ≤ 30 ngày: mời đổi ngay', () => {
    expect(expiringRedeemCta(urgent, { redeemable: 5000, total: 5000 })).toEqual({ label: 'Đổi điểm ngay trước khi hết hạn →', note: null });
  });

  it('tổng có lô quy đổi không hết hạn (hay phần còn khoá): nói rõ lô sắp hết hạn là điểm thường và số dùng được ngay', () => {
    expect(expiringRedeemCta(urgent, { redeemable: 12500, total: 15000 })?.note).toBe('Điểm sắp hết hạn là điểm thường: đổi quà dùng được ngay 12.500 điểm');
  });

  it('chưa gấp, không có điểm sắp hết hạn, hay không còn điểm nào đổi được ngay: không mời', () => {
    expect(expiringRedeemCta({ urgent: false }, { redeemable: 5000, total: 5000 })).toBeNull();
    expect(expiringRedeemCta(null, { redeemable: 5000, total: 5000 })).toBeNull();
    expect(expiringRedeemCta(urgent, { redeemable: 0, total: 9000 })).toBeNull();
  });

  it('API cũ chưa trả redeemablePoints: vẫn mời, không đoán số dùng được', () => {
    expect(expiringRedeemCta(urgent, { total: 9000 })).toEqual({ label: 'Đổi điểm ngay trước khi hết hạn →', note: null });
  });

  it('gộp vào dòng Đổi quà: vẫn một lối, cùng đích trên từng nền, nhãn và dòng phụ là lời mời', () => {
    const cta = expiringRedeemCta(urgent, { redeemable: 12500, total: 15000 });
    expect(loyaltyOffersRow('/offers', 3, cta)).toEqual({
      title: 'Đổi điểm ngay trước khi hết hạn →',
      sub: 'Điểm sắp hết hạn là điểm thường: đổi quà dùng được ngay 12.500 điểm',
      href: '/offers?tab=rewards',
      urgent: true,
    });
    expect(loyaltyOffersRow('/uu-dai', 0, cta).href).toBe('/uu-dai?tab=rewards');
  });

  it('lời mời không có dòng phụ riêng: giữ dòng phụ số mã', () => {
    const cta = expiringRedeemCta(urgent, { redeemable: 5000, total: 5000 });
    expect(loyaltyOffersRow('/offers', 3, cta)).toMatchObject({ title: 'Đổi điểm ngay trước khi hết hạn →', sub: 'Bạn đang có 3 mã giảm giá', urgent: true });
  });

  it('không gấp: dòng như cũ', () => {
    expect(loyaltyOffersRow('/offers', 3, null)).toEqual(loyaltyOffersRow('/offers', 3));
    expect(loyaltyOffersRow('/offers', 3).urgent).toBe(false);
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
