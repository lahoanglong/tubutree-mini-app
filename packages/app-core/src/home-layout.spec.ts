import { describe, expect, it } from 'vitest';
import {
  customerKind, HOME_SHORTCUTS, homeBlockOrder, memberCardView, mergeSuggestions, NAV_TAB_SPECS, offersDotReason, ORDER_STATUS_ROW,
  visibleHomeShortcuts,
} from './home-layout';
import type { LoyaltyOverview } from './api/loyalty';

describe('homeBlockOrder', () => {
  it('khách cũ: thẻ thành viên, việc cần làm, lối tắt, mua lại, rồi một lưới gợi ý ở cuối', () => {
    expect(homeBlockOrder('returning')).toEqual([
      'search', 'member', 'todo', 'shortcuts', 'purchased', 'flash', 'categories', 'journey', 'community', 'suggest',
    ]);
  });
  it('khách mới: Quà khách mới thay thẻ thành viên, không có Mua lại', () => {
    const order = homeBlockOrder('new');
    expect(order).toContain('welcome');
    expect(order).not.toContain('member');
    expect(order).not.toContain('purchased');
    expect(order.at(-1)).toBe('suggest');
  });
  it('mỗi thứ tự có đúng một lưới gợi ý, không còn các lưới riêng', () => {
    for (const k of ['returning', 'new'] as const) expect(homeBlockOrder(k).filter((b) => b === 'suggest')).toHaveLength(1);
  });
  it('customerKind', () => {
    expect(customerKind(0)).toBe('new');
    expect(customerKind(undefined)).toBe('new');
    expect(customerKind(2)).toBe('returning');
  });
});

describe('visibleHomeShortcuts', () => {
  it('có đúng 8 lối tắt khi mọi cờ bật', () => {
    expect(HOME_SHORTCUTS).toHaveLength(8);
    expect(visibleHomeShortcuts({ wasteEnabled: true, claimEnabled: true })).toHaveLength(8);
  });
  it('cờ tắt thì ẩn mục, các mục còn lại giữ thứ tự', () => {
    const ids = visibleHomeShortcuts({ wasteEnabled: false, claimEnabled: false }).map((s) => s.id);
    expect(ids).toEqual(['rewards', 'garden', 'groupBuy', 'coupons', 'earn', 'community']);
  });
});

describe('thanh đáy', () => {
  it('Trang chủ, Danh mục, Vườn Xanh ở giữa, Ưu đãi, Cá nhân', () => {
    expect(NAV_TAB_SPECS.map((t) => t.label)).toEqual(['Trang chủ', 'Danh mục', 'Vườn Xanh', 'Ưu đãi', 'Cá nhân']);
    expect(NAV_TAB_SPECS.find((t) => t.center)?.id).toBe('garden');
  });
  it('số đơn đang xử lý nằm ở tab Cá nhân, chấm đỏ ở tab Ưu đãi', () => {
    expect(NAV_TAB_SPECS.find((t) => t.id === 'profile')?.badge).toBe('active-orders');
    expect(NAV_TAB_SPECS.find((t) => t.id === 'offers')?.badge).toBe('offers-dot');
  });
});

describe('offersDotReason', () => {
  const now = Date.parse('2026-10-25T05:00:00Z');
  const day = 24 * 3_600_000;
  it('chưa điểm danh hôm nay thì chấm', () => {
    expect(offersDotReason({ checkIn: { checkedInToday: false } }, now)).toBe('check-in');
  });
  it('đã điểm danh, mã còn xa thì không chấm', () => {
    expect(offersDotReason({ checkIn: { checkedInToday: true }, coupons: [{ endAt: new Date(now + 10 * day).toISOString() }] }, now)).toBeNull();
  });
  it('mã hết hạn trong 3 ngày thì chấm', () => {
    expect(offersDotReason({ checkIn: { checkedInToday: true }, coupons: [{ endAt: new Date(now + 2 * day).toISOString() }] }, now)).toBe('coupon-expiring');
  });
  it('mã đã quá hạn không tính; dữ liệu chưa về thì không chấm', () => {
    expect(offersDotReason({ coupons: [{ endAt: new Date(now - day).toISOString() }] }, now)).toBeNull();
    expect(offersDotReason({}, now)).toBeNull();
  });
});

describe('ORDER_STATUS_ROW', () => {
  it('5 trạng thái, "Đã giao" không có số đếm', () => {
    expect(ORDER_STATUS_ROW.map((s) => s.label)).toEqual(['Chờ thanh toán', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Định kỳ']);
    expect(ORDER_STATUS_ROW.find((s) => s.key === 'delivered')?.counted).toBe(false);
  });
});

describe('memberCardView', () => {
  const overview = {
    pointsBalance: 45_400, tier: { id: 't1', name: 'Lộc Biếc', multiplier: 1.2, perks: [] },
    nextTier: { id: 't2', name: 'Đại Thụ', minPoints: 100_000, minSpending: 20_000_000, pointsToGo: 54_600, spendingToGo: 18_300_000 },
    tiers: [{ id: 't1', name: 'Lộc Biếc', minPoints: 0, minSpending: 0, multiplier: 1.2 }, { id: 't2', name: 'Đại Thụ', minPoints: 100_000, minSpending: 20_000_000, multiplier: 1.5 }],
    spent12m: 1_700_000,
  } as unknown as LoyaltyOverview;
  it('điểm, giá trị quy đổi và dòng còn thiếu', () => {
    const v = memberCardView({ overview, pointsTotal: 45_400, vndPerPointRedeem: 1 });
    expect(v.tierName).toBe('Lộc Biếc');
    expect(v.pointsLabel).toBe('45.400 điểm');
    expect(v.valueLabel).toBe('≈ 45.400đ');
    expect(v.toGoLine).toBe('Còn 18,3 triệu mua hàng lên Đại Thụ');
    expect(v.progressPct).toBe(9);
  });
  it('chưa có tổng quan: hạng thấp nhất, không hứa số', () => {
    const v = memberCardView({ overview: undefined, pointsTotal: 0, vndPerPointRedeem: undefined });
    expect(v).toMatchObject({ tierName: 'Mầm Xanh', valueLabel: null, toGoLine: null, progressPct: 0 });
  });
});

describe('mergeSuggestions', () => {
  it('đặt gợi ý cá nhân lên đầu và bỏ trùng', () => {
    expect(mergeSuggestions([{ id: 'a' }, { id: 'b' }], [[{ id: 'b' }, { id: 'c' }], [{ id: 'a' }, { id: 'd' }]]).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
