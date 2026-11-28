import { describe, expect, it } from 'vitest';
import { CTV_SHARE_CARD_COPY, ctvReferralPath, ctvReferralUrl, ctvShareMetrics, ctvShareOfferLine } from './ctv-share-card';
import { FORBIDDEN_TERMS } from '../shop-copy';

describe('ctvReferralPath / ctvReferralUrl (tubu-w56-01)', () => {
  it('Trang chủ kèm mã giới thiệu', () => {
    expect(ctvReferralPath('TUBU123')).toBe('/?ref=TUBU123');
    expect(ctvReferralUrl('https://tubutree.com', 'TUBU123')).toBe('https://tubutree.com/?ref=TUBU123');
  });

  it('bỏ dấu gạch chéo cuối của base, cắt khoảng trắng quanh mã, mã lạ được mã hoá URL', () => {
    expect(ctvReferralUrl('https://zalo.me/s/app///', '  AB12 ')).toBe('https://zalo.me/s/app/?ref=AB12');
    expect(ctvReferralPath('a b&c')).toBe('/?ref=a%20b%26c');
  });

  it('chưa có mã thì không có link: không chia sẻ link thiếu mã (khách mua không tính hoa hồng)', () => {
    expect(ctvReferralPath('')).toBeNull();
    expect(ctvReferralPath('   ')).toBeNull();
    expect(ctvReferralPath(undefined)).toBeNull();
    expect(ctvReferralPath(null)).toBeNull();
    expect(ctvReferralUrl('https://tubutree.com', '')).toBeNull();
  });
});

describe('ctvShareMetrics', () => {
  it('ba số theo thứ tự: lượt bấm, đơn thành công, hoa hồng chờ rút (đang chờ + chờ chuyển)', () => {
    const m = ctvShareMetrics({ totalClicks: 1240, totalConversions: 31, pendingCommission: 150_000, withdrawableCommission: 50_000 });
    expect(m.map((x) => x.key)).toEqual(['clicks', 'orders', 'pending']);
    expect(m.map((x) => x.label)).toEqual(['Lượt bấm', 'Đơn thành công', 'Hoa hồng chờ rút']);
    expect(m.map((x) => x.value)).toEqual(['1.240', '31', '200.000đ']);
  });

  it('thiếu số (API cũ) hay số rác thì 0, không NaN, không âm', () => {
    expect(ctvShareMetrics(undefined).map((x) => x.value)).toEqual(['0', '0', '0đ']);
    const m = ctvShareMetrics({ totalClicks: -5, totalConversions: Number.NaN, pendingCommission: -100, withdrawableCommission: Number.POSITIVE_INFINITY });
    expect(m.map((x) => x.value)).toEqual(['0', '0', '0đ']);
  });
});

describe('ctvShareOfferLine / CTV_SHARE_CARD_COPY', () => {
  it('dùng số mã chào mừng thật, không có số thì câu không số', () => {
    expect(ctvShareOfferLine({ amount: 30_000, minOrder: 199_000 })).toContain('30.000đ');
    expect(ctvShareOfferLine(null)).not.toMatch(/\d/);
  });

  it('chữ thẻ không chứa từ cấm của bảng thuật ngữ', () => {
    for (const text of Object.values(CTV_SHARE_CARD_COPY)) {
      expect(FORBIDDEN_TERMS.filter((t) => t.pattern.test(text)).map((t) => t.use)).toEqual([]);
    }
  });
});
