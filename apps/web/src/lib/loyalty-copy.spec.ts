import { describe, expect, it } from 'vitest';
import {
  checkInView,
  earnRuleLine,
  expiringPointsNote,
  memberCardHint,
  moneyShort,
  pointExpiryPolicyNote,
  redeemRuleLine,
  tierProgressPercent,
  tierThresholdLabel,
  type LoyaltyRates,
} from './loyalty-copy';

const RATES: LoyaltyRates = { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1000, maxRedeemPct: 0.5 };

describe('moneyShort', () => {
  it('từ 1 triệu nói "triệu" bỏ ",0"; nhỏ hơn thì ghi đồng có dấu nghìn', () => {
    expect(moneyShort(5_000_000)).toBe('5 triệu');
    expect(moneyShort(12_500_000)).toBe('12,5 triệu');
    expect(moneyShort(750_000)).toBe('750.000đ');
  });
});

describe('earnRuleLine / redeemRuleLine', () => {
  it('tích theo % cấu hình, kèm hệ số hạng khi lớn hơn 1', () => {
    expect(earnRuleLine(RATES)).toBe('Tích 2% tiền hàng thành Điểm Xanh');
    expect(earnRuleLine(RATES, 1.2)).toBe('Tích 2% tiền hàng thành Điểm Xanh (hạng ×1,2 = 2,4%)');
  });
  it('API cũ chỉ có vndPerPoint thì quy ngược; không có số nào dùng được thì câu chung', () => {
    expect(earnRuleLine({ vndPerPoint: 50, vndPerPointRedeem: 1000, maxRedeemPct: 0 })).toBe('Tích 2% tiền hàng thành Điểm Xanh');
    expect(earnRuleLine({ vndPerPoint: 0, vndPerPointRedeem: 1000, maxRedeemPct: 0 })).toBe('Mỗi đơn đã giao được tích Điểm Xanh');
  });
  it('giá trị 1 điểm; trần % chỉ nói khi còn cho dùng điểm ở thanh toán', () => {
    expect(redeemRuleLine(RATES)).toBe('1 điểm = 1.000đ khi dùng ở bước thanh toán (tối đa 50% giá trị đơn)');
    expect(redeemRuleLine({ ...RATES, maxRedeemPct: 0 })).toBe('1 điểm = 1.000đ khi đổi mã giảm giá');
  });
});

describe('tierThresholdLabel', () => {
  it('hạng khởi đầu, mốc tiền 12 tháng, và cách nói theo điểm khi API cũ chưa trả rates', () => {
    expect(tierThresholdLabel({ minPoints: 0 }, RATES)).toBe('hạng khởi đầu');
    expect(tierThresholdLabel({ minPoints: 100, minSpending: 5_000_000 }, RATES)).toBe('từ 5 triệu mua hàng trong 12 tháng');
    expect(tierThresholdLabel({ minPoints: 100 }, RATES)).toBe('từ 5.000đ mua hàng trong 12 tháng');
    expect(tierThresholdLabel({ minPoints: 1500 })).toBe('từ 1.500 điểm tích luỹ');
  });
});

describe('tierProgressPercent', () => {
  const tiers = [
    { id: 'a', name: 'A', minPoints: 0, minSpending: 0, multiplier: 1 },
    { id: 'b', name: 'B', minPoints: 100, minSpending: 1_000_000, multiplier: 1.1 },
  ];
  const base = { pointsBalance: 900, tier: { id: 'a', name: 'A', multiplier: 1, perks: [] }, tiers };
  it('hạng cao nhất là 100', () => {
    expect(tierProgressPercent({ ...base, nextTier: null })).toBe(100);
  });
  it('đo theo tiền mua 12 tháng khi hạng kế có mốc chi tiêu, không theo số dư', () => {
    const next = { id: 'b', name: 'B', minPoints: 100, minSpending: 1_000_000, pointsToGo: 50 };
    expect(tierProgressPercent({ ...base, spent12m: 250_000, nextTier: next })).toBe(25);
  });
  it('không có spent12m thì đo theo điểm xét hạng, kẹp 0..100', () => {
    const next = { id: 'b', name: 'B', minPoints: 100, minSpending: null, pointsToGo: 50 };
    expect(tierProgressPercent({ ...base, tierPoints: 40, nextTier: next })).toBe(40);
    expect(tierProgressPercent({ ...base, tierPoints: 400, nextTier: next })).toBe(100);
  });
});

describe('checkInView', () => {
  const rewards = [{ day: 1, points: 3, claimed: false, isToday: true }];
  it('đã điểm danh: tắt nút', () => {
    expect(checkInView({ checkedInToday: true, streakDays: 1, currentCycleDay: 1, rewards })).toEqual({ canCheckIn: false, buttonLabel: 'Đã điểm danh' });
  });
  it('chưa: nút kèm điểm của ô hôm nay, thiếu todayPoints thì lấy từ ô isToday', () => {
    expect(checkInView({ checkedInToday: false, streakDays: 0, currentCycleDay: 1, todayPoints: 5, rewards }).buttonLabel).toBe('Điểm danh +5');
    expect(checkInView({ checkedInToday: false, streakDays: 0, currentCycleDay: 1, rewards }).buttonLabel).toBe('Điểm danh +3');
    expect(checkInView({ checkedInToday: false, streakDays: 0, currentCycleDay: 1, rewards: [] }).buttonLabel).toBe('Điểm danh');
  });
});

describe('memberCardHint', () => {
  it('chỉ hứa tích điểm tại quầy khi backend bật', () => {
    expect(memberCardHint({ posCreditEnabled: true })).toContain('Đưa mã QR này cho thu ngân');
    expect(memberCardHint({ posCreditEnabled: false })).toContain('chưa được áp dụng');
  });
});

describe('expiringPointsNote / pointExpiryPolicyNote', () => {
  const now = new Date('2026-10-19T00:00:00Z');
  it('trong 30 ngày thì kèm số ngày còn lại và urgent; xa hơn thì chỉ nói ngày', () => {
    expect(expiringPointsNote({ amount: 70, expiresAt: '2026-10-29T00:00:00Z' }, now)).toEqual({
      text: '70 Điểm Xanh sẽ hết hạn ngày 29/10/2026 (còn 10 ngày)',
      urgent: true,
    });
    expect(expiringPointsNote({ amount: 1000, expiresAt: '2027-01-01T00:00:00Z' }, now)).toEqual({
      text: '1.000 Điểm Xanh sẽ hết hạn ngày 01/01/2027',
      urgent: false,
    });
  });
  it('thiếu dữ liệu, 0 điểm hay ngày hỏng thì null', () => {
    expect(expiringPointsNote(null, now)).toBeNull();
    expect(expiringPointsNote({ amount: 0, expiresAt: '2026-10-29T00:00:00Z' }, now)).toBeNull();
    expect(expiringPointsNote({ amount: 5, expiresAt: 'xx' }, now)).toBeNull();
  });
  it('chính sách hạn điểm theo tháng cấu hình, không bịa số khi thiếu', () => {
    expect(pointExpiryPolicyNote(12)).toBe('Điểm Xanh thường có hạn 12 tháng kể từ ngày nhận, điểm cũ được dùng trước.');
    expect(pointExpiryPolicyNote(undefined)).toBeNull();
  });
});
