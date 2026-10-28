import { describe, expect, it } from 'vitest';
import type { LoyaltyOverview } from './api/loyalty';
import { checkInView, earnPctOf, earnRuleLine, memberCardHint, percentLabel, pointsToSpend, tierProgressPercent } from './loyalty-copy';
import { tierGraceLine, tierRank } from './loyalty-tier-copy';

const RATES = { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1000, maxRedeemPct: 0.5 };

describe('quy tắc chữ Điểm Xanh dùng chung', () => {
  it('earnPctOf ưu tiên earnPct, quy ngược từ vndPerPoint, null khi không dùng được', () => {
    expect(earnPctOf({ earnPct: 2.4, vndPerPoint: 50 })).toBe(2.4);
    expect(earnPctOf({ vndPerPoint: 50 })).toBe(2);
    expect(earnPctOf({ earnPct: 0, vndPerPoint: 0 })).toBeNull();
  });

  it('percentLabel bỏ ",0" và dùng dấu phẩy', () => {
    expect(percentLabel(2)).toBe('2%');
    expect(percentLabel(2.4)).toBe('2,4%');
  });

  it('earnRuleLine nói hệ số hạng khi > 1, API cũ không có số thì câu chung', () => {
    expect(earnRuleLine(RATES)).toBe('Tích 2% tiền hàng thành Điểm Xanh');
    expect(earnRuleLine(RATES, 1.2)).toBe('Tích 2% tiền hàng thành Điểm Xanh (hạng ×1,2 = 2,4%)');
    expect(earnRuleLine({ vndPerPoint: 0, vndPerPointRedeem: 1, maxRedeemPct: 0 })).toBe('Mỗi đơn đã giao được tích Điểm Xanh');
  });

  it('pointsToSpend nhân điểm với vndPerPoint', () => {
    expect(pointsToSpend(100, RATES)).toBe(5000);
  });

  it('checkInView: nhãn nút không kèm số, đã điểm danh thì khoá nút', () => {
    const base = { checkedInToday: false, streak: 0, rewards: [{ day: 1, points: 5, isToday: true }] };
    expect(checkInView(base as never)).toEqual({ canCheckIn: true, buttonLabel: 'Điểm danh' });
    expect(checkInView({ ...base, pointsDone: true, waterDone: false } as never)).toEqual({ canCheckIn: true, buttonLabel: 'Điểm danh' });
    expect(checkInView({ ...base, checkedInToday: true } as never)).toEqual({ canCheckIn: false, buttonLabel: 'Đã điểm danh' });
  });

  it('memberCardHint chỉ hứa tích điểm tại quầy khi posCreditEnabled', () => {
    expect(memberCardHint({ posCreditEnabled: true })).toContain('Đưa mã QR này cho thu ngân');
    expect(memberCardHint({ posCreditEnabled: false })).toContain('chưa được áp dụng');
  });

  it('tierProgressPercent đo theo tiền 12 tháng khi hạng có mốc chi tiêu, không thì theo điểm xét hạng', () => {
    const tiers = [
      { id: 'a', name: 'A', minPoints: 0, minSpending: 0, multiplier: 1 },
      { id: 'b', name: 'B', minPoints: 1000, minSpending: 2_000_000, multiplier: 1.2 },
    ];
    const ov = { pointsBalance: 900, tierPoints: 250, tier: tiers[0], nextTier: tiers[1], tiers, spent12m: 500_000 } as unknown as LoyaltyOverview;
    expect(tierProgressPercent(ov)).toBe(25);
    expect(tierProgressPercent({ ...ov, spent12m: undefined } as LoyaltyOverview)).toBe(25);
    expect(tierProgressPercent({ ...ov, nextTier: null } as LoyaltyOverview)).toBe(100);
  });
});

describe('tierRank', () => {
  const tiers = [{ id: 'a', name: 'Mầm Xanh' }, { id: 'b', name: 'Lộc Biếc' }, { id: 'c', name: 'Đại Thụ' }];
  it('tra theo id, không phụ thuộc tên đã đổi trong admin', () => {
    expect(tierRank(tiers, { id: 'c' })).toBe(2);
    expect(tierRank([{ id: 'a', name: 'Tên mới' }, { id: 'b', name: 'Tên mới 2' }], { id: 'b' })).toBe(1);
  });
  it('chỉ có tên (hộp chúc mừng): tra theo tên; không thấy thì về hạng đầu', () => {
    expect(tierRank(tiers, { name: 'Lộc Biếc' })).toBe(1);
    expect(tierRank(tiers, { name: 'Không có' })).toBe(0);
    expect(tierRank(tiers, {})).toBe(0);
  });
});

describe('tierGraceLine', () => {
  const fmt = { money: (n: number) => `${n / 1000}k`, points: (n: number) => String(n), date: (iso: string) => iso.slice(0, 10) };
  it('có mốc chi tiêu: nói số tiền mua còn thiếu và ngày hết hạn', () => {
    expect(tierGraceLine({ until: '2026-11-07T00:00:00.000Z', spendingToKeep: 400_000, pointsToKeep: 30_000 }, 'Lộc Biếc', fmt)).toBe('Giữ hạng Lộc Biếc: mua thêm 400k trước 2026-11-07');
  });
  it('hạng không có mốc chi tiêu: nói số điểm', () => {
    expect(tierGraceLine({ until: '2026-11-07T00:00:00.000Z', spendingToKeep: null, pointsToKeep: 120 }, 'Lộc Biếc', fmt)).toBe('Giữ hạng Lộc Biếc: tích thêm 120 điểm từ mua hàng trước 2026-11-07');
  });
  it('đã đủ điều kiện hoặc không có hạn thì không ghi số', () => {
    expect(tierGraceLine({ until: '2026-11-07T00:00:00.000Z', spendingToKeep: 0, pointsToKeep: 0 }, 'Lộc Biếc', fmt)).toBe('Bạn đang đủ điều kiện giữ hạng Lộc Biếc');
    expect(tierGraceLine(null, 'Lộc Biếc', fmt)).toBeNull();
    expect(tierGraceLine(undefined, 'Lộc Biếc', fmt)).toBeNull();
  });
});
