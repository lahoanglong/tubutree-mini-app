import { describe, expect, it } from 'vitest';
import type { LoyaltyOverview } from './api/loyalty';
import { memberCardView } from './home-layout';
import { offersMemberCard } from './member-card-grace';

const overview = {
  pointsBalance: 45_400, tier: { id: 't1', name: 'Lộc Biếc', multiplier: 1.2, perks: [] },
  nextTier: { id: 't2', name: 'Đại Thụ', minPoints: 100_000, minSpending: 20_000_000, pointsToGo: 54_600, spendingToGo: 18_300_000 },
  tiers: [{ id: 't1', name: 'Lộc Biếc', minPoints: 0, minSpending: 0, multiplier: 1.2 }, { id: 't2', name: 'Đại Thụ', minPoints: 100_000, minSpending: 20_000_000, multiplier: 1.5 }],
  spent12m: 1_700_000,
} as unknown as LoyaltyOverview;
const base = { pointsTotal: 45_400, vndPerPointRedeem: 1 };

describe('offersMemberCard', () => {
  it('đang trong hạn giữ hạng: dòng giữ hạng thay dòng lên hạng', () => {
    const v = offersMemberCard({
      ...base,
      overview: { ...overview, tierGrace: { until: '2026-11-07T00:00:00.000Z', spendingToKeep: 400_000, pointsToKeep: 30_000 } } as LoyaltyOverview,
    });
    expect(v.toGoLine).toBe('Giữ hạng Lộc Biếc: đơn giao thành công thêm 400.000đ trước 07/11/2026');
    expect(v.inGrace).toBe(true);
  });
  it('giờ Việt Nam: 17:30 UTC đã sang ngày hôm sau', () => {
    const v = offersMemberCard({
      ...base,
      overview: { ...overview, tierGrace: { until: '2026-11-06T17:30:00.000Z', spendingToKeep: 400_000, pointsToKeep: 0 } } as LoyaltyOverview,
    });
    expect(v.toGoLine).toContain('trước 07/11/2026');
  });
  it('giữ hạng tính theo điểm khi hạng không xét tiền mua', () => {
    const v = offersMemberCard({
      ...base,
      overview: { ...overview, tierGrace: { until: '2026-11-07T00:00:00.000Z', spendingToKeep: null, pointsToKeep: 120 } } as LoyaltyOverview,
    });
    expect(v.toGoLine).toBe('Giữ hạng Lộc Biếc: tích thêm 120 điểm từ đơn giao thành công trước 07/11/2026');
  });
  it('không có hạn giữ hạng: vẫn là dòng lên hạng', () => {
    const v = offersMemberCard({ ...base, overview: { ...overview, tierGrace: null } as LoyaltyOverview });
    expect(v.toGoLine).toBe('Còn 18,3 triệu mua hàng lên Đại Thụ');
    expect(v.inGrace).toBe(false);
  });
  it('chưa có tổng quan thì không ở trong hạn giữ hạng', () => {
    const v = offersMemberCard({ overview: undefined, pointsTotal: 0, vndPerPointRedeem: undefined });
    expect(v.inGrace).toBe(false);
    expect(v.toGoLine).toBeNull();
  });
  it('các trường còn lại giống memberCardView', () => {
    const grace = { ...overview, tierGrace: { until: '2026-11-07T00:00:00.000Z', spendingToKeep: 400_000, pointsToKeep: 30_000 } } as LoyaltyOverview;
    const { toGoLine: _a, inGrace: _b, ...rest } = offersMemberCard({ ...base, overview: grace });
    const { toGoLine: _c, ...plain } = memberCardView({ ...base, overview: grace });
    expect(rest).toEqual(plain);
  });
});

describe('memberCardView (thẻ Trang chủ)', () => {
  it('không đọc hạn giữ hạng: thẻ Trang chủ không vẽ dòng này nên không phải trả chi phí gói đầu cho nó', () => {
    const grace = { ...overview, tierGrace: { until: '2026-11-07T00:00:00.000Z', spendingToKeep: 400_000, pointsToKeep: 30_000 } } as LoyaltyOverview;
    expect(memberCardView({ ...base, overview: grace }).toGoLine).toBe('Còn 18,3 triệu mua hàng lên Đại Thụ');
  });
});
