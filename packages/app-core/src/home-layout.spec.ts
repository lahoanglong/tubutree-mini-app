import { describe, expect, it } from 'vitest';
import {
  customerKind, HOME_SHORTCUTS, homeBlockOrder, isCouponExpiring, memberCardView, mergeSeenCouponIds, resolveHomeKind, mergeSuggestions, NAV_TAB_SPECS, offersDotReason, ORDER_STATUS_ROW,
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
  const at = (code: string, days: number) => ({ code, endAt: new Date(now + days * day).toISOString() });
  it('chưa điểm danh hôm nay thì chấm, kể cả khi đã xem mã sắp hết hạn', () => {
    expect(offersDotReason({ checkIn: { checkedInToday: false }, coupons: [at('A', 1)], seenExpiringIds: ['A'] }, now)).toBe('check-in');
  });
  it('đã điểm danh, mã còn xa thì không chấm', () => {
    expect(offersDotReason({ checkIn: { checkedInToday: true }, coupons: [at('A', 10)] }, now)).toBeNull();
  });
  it('mã hết hạn trong 3 ngày mà khách chưa xem thì chấm', () => {
    expect(offersDotReason({ checkIn: { checkedInToday: true }, coupons: [at('A', 2)] }, now)).toBe('coupon-expiring');
  });
  it('khách đã mở Ưu đãi với mã đó thì tắt, có mã mới sắp hết hạn thì bật lại', () => {
    const input = { checkIn: { checkedInToday: true }, seenExpiringIds: ['A'] };
    expect(offersDotReason({ ...input, coupons: [at('A', 2)] }, now)).toBeNull();
    expect(offersDotReason({ ...input, coupons: [at('A', 2), at('B', 1)] }, now)).toBe('coupon-expiring');
  });
  it('mã đã quá hạn không tính; dữ liệu chưa về thì không chấm', () => {
    expect(offersDotReason({ coupons: [at('A', -1)] }, now)).toBeNull();
    expect(offersDotReason({}, now)).toBeNull();
  });
});

describe('mã sắp hết hạn và danh sách đã xem', () => {
  const now = Date.parse('2026-10-25T05:00:00Z');
  const day = 24 * 3_600_000;
  it('isCouponExpiring: trong 3 ngày tới, không tính mã đã hết hạn hay ngày không hợp lệ', () => {
    expect(isCouponExpiring({ endAt: new Date(now + 3 * day).toISOString() }, now)).toBe(true);
    expect(isCouponExpiring({ endAt: new Date(now + 4 * day).toISOString() }, now)).toBe(false);
    expect(isCouponExpiring({ endAt: new Date(now - 1).toISOString() }, now)).toBe(false);
    expect(isCouponExpiring({ endAt: 'không phải ngày' }, now)).toBe(false);
  });
  it('mergeSeenCouponIds: bỏ trùng, giữ thứ tự, nhớ tối đa 50', () => {
    expect(mergeSeenCouponIds(['A', 'B'], ['B', 'C'])).toEqual(['A', 'B', 'C']);
    const many = Array.from({ length: 60 }, (_, i) => `M${i}`);
    expect(mergeSeenCouponIds([], many)).toHaveLength(50);
    expect(mergeSeenCouponIds([], many).at(-1)).toBe('M59');
  });
});

describe('resolveHomeKind', () => {
  const base = { authed: true, stored: null, purchasedCount: undefined, pending: true } as const;
  it('khách chưa đăng nhập luôn là mới', () => {
    expect(resolveHomeKind({ ...base, authed: false, stored: 'returning' })).toBe('new');
  });
  it('có số liệu thì theo số liệu, kể cả khi loại đã nhớ khác', () => {
    expect(resolveHomeKind({ ...base, purchasedCount: 2, stored: 'new', pending: false })).toBe('returning');
    expect(resolveHomeKind({ ...base, purchasedCount: 0, stored: 'returning', pending: false })).toBe('new');
  });
  it('chưa có số liệu: theo loại đã nhớ, cả khi đang tải lẫn khi tải lỗi', () => {
    expect(resolveHomeKind({ ...base, stored: 'returning' })).toBe('returning');
    expect(resolveHomeKind({ ...base, stored: 'returning', pending: false })).toBe('returning');
  });
  it('chưa nhớ gì: đang tải là chưa biết, lỗi là khách mới', () => {
    expect(resolveHomeKind(base)).toBe('unknown');
    expect(resolveHomeKind({ ...base, pending: false })).toBe('new');
  });
  it('thứ tự khối của "chưa biết" giữ chỗ thẻ thành viên và không có khối riêng của một loại', () => {
    const order = homeBlockOrder('unknown');
    expect(order).toContain('member');
    for (const id of ['purchased', 'welcome', 'bestSellers'] as const) expect(order).not.toContain(id);
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
  it('chưa có tổng quan: không đoán hạng, không hứa số', () => {
    const v = memberCardView({ overview: undefined, pointsTotal: 0, vndPerPointRedeem: undefined });
    expect(v).toMatchObject({ tierName: null, valueLabel: null, toGoLine: null, progressPct: 0 });
  });
});

describe('mergeSuggestions', () => {
  it('đặt gợi ý cá nhân lên đầu và bỏ trùng', () => {
    expect(mergeSuggestions([{ id: 'a' }, { id: 'b' }], [[{ id: 'b' }, { id: 'c' }], [{ id: 'a' }, { id: 'd' }]]).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
