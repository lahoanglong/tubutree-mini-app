import { describe, expect, it } from 'vitest';
import {
  clearHomeHints, customerKind, dropForeignHomeHints, HOME_KIND_KEY, HOME_SHORTCUTS, TODO_ROWS_KEY, OFFERS_SEEN_KEY, readLastTodoRows, readSeenCoupons, writeSeenCoupons, homeBlockOrder, isCouponExpiring, memberCardView, mergeSeenCouponIds, resolveHomeKind, mergeSuggestions, NAV_TAB_SPECS, offersDotReason, ORDER_STATUS_ROW,
  visibleHomeShortcuts, homeRenderOrder, homeKeptOrder, homeSettling, homeShortcutSlots, HOME_HEADER_HEIGHT, HOME_SHORTCUT_SLOTS,
  readPurchasedHint, writePurchasedHint, PURCHASED_HINT_KEY, purchasedSkeletonHeight, todoSkeletonHeight,
  readFlashHint, readFlashSlotHint, writeFlashHint, FLASH_HINT_KEY, FLASH_NEXT_SLOT_HEIGHT,
} from './home-layout';
import type { LoyaltyOverview } from './api/loyalty';

describe('homeBlockOrder', () => {
  it('khách cũ: header, thẻ thành viên, việc cần làm, banner, lối tắt, Giờ vàng trước Mua lại, Danh mục, Bán chạy nhất, combos, rồi một lưới gợi ý', () => {
    expect(homeBlockOrder('returning')).toEqual([
      'search', 'member', 'todo', 'banner', 'shortcuts', 'flash', 'purchased', 'categories', 'bestSellers', 'combos', 'journey', 'community', 'suggest',
    ]);
  });
  it('khách mới: Quà khách mới thay thẻ thành viên, không Mua lại, Danh mục đứng trước Bán chạy nhất', () => {
    expect(homeBlockOrder('new')).toEqual([
      'search', 'welcome', 'todo', 'banner', 'shortcuts', 'flash', 'categories', 'bestSellers', 'combos', 'journey', 'community', 'suggest',
    ]);
  });
  it('chưa biết loại khách: giữ chỗ thẻ thành viên, không có khối riêng của khách cũ (Mua lại) hay khách mới (Quà)', () => {
    const order = homeBlockOrder('unknown');
    expect(order[1]).toBe('member');
    expect(order).not.toContain('purchased');
    expect(order).not.toContain('welcome');
    expect(order).toContain('bestSellers');
  });
  it('Bán chạy nhất có ở cả hai loại khách; mỗi thứ tự có đúng một lưới gợi ý, ở cuối', () => {
    for (const k of ['returning', 'new'] as const) {
      expect(homeBlockOrder(k)).toContain('bestSellers');
      expect(homeBlockOrder(k).filter((b) => b === 'suggest')).toHaveLength(1);
      expect(homeBlockOrder(k).at(-1)).toBe('suggest');
    }
  });
  it('tối đa 4 khối hàng (Giờ vàng, Mua lại, Bán chạy nhất, combos) cộng lưới gợi ý (luật shelves.spec)', () => {
    const rows = ['flash', 'purchased', 'bestSellers', 'combos'];
    for (const k of ['returning', 'new'] as const) expect(homeBlockOrder(k).filter((b) => rows.includes(b)).length).toBeLessThanOrEqual(4);
  });
  it('customerKind', () => {
    expect(customerKind(0)).toBe('new');
    expect(customerKind(undefined)).toBe('new');
    expect(customerKind(2)).toBe('returning');
  });
});

describe('visibleHomeShortcuts', () => {
  it('có đúng 9 lối tắt khi mọi cờ bật, mở đầu bằng Giờ vàng, Mã giảm giá và không có Vườn Xanh (đã là tab giữa)', () => {
    expect(HOME_SHORTCUTS).toHaveLength(9);
    const ids = visibleHomeShortcuts({ wasteEnabled: true, claimEnabled: true }).map((s) => s.id);
    expect(ids).toEqual(['flash', 'coupons', 'recycle', 'groupBuy', 'rewards', 'orders', 'claim', 'earn', 'community']);
    expect(ids).not.toContain('garden');
  });
  it('nhãn mọi lối tắt vừa MỘT dòng ở ô 5 cột (≤11 ký tự): nhãn xuống dòng làm hàng cao hơn khung chờ và đẩy cả trang (R-184); nhãn đầy đủ nằm ở ariaLabel', () => {
    for (const s of HOME_SHORTCUTS) expect(s.label.length, s.label).toBeLessThanOrEqual(11);
  });
  it('mọi tổ hợp cờ và trạng thái: nhãn hiển thị (kể cả nhãn thay thế của Đổi rác) tối đa 11 ký tự và có câu đọc đầy đủ chứa nhãn', () => {
    const bools = [false, true];
    for (const wasteEnabled of bools) for (const claimEnabled of bools) for (const recycleOpenRequests of [undefined, false, true]) {
      for (const s of visibleHomeShortcuts({ wasteEnabled, claimEnabled, recycleOpenRequests })) {
        expect(s.label.length, `${s.label} (${wasteEnabled}/${claimEnabled}/${recycleOpenRequests})`).toBeLessThanOrEqual(11);
        expect(s.ariaLabel.toLowerCase()).toContain(s.label.toLowerCase());
      }
    }
  });
  it('lối tắt đơn sàn ghi "Đơn sàn", câu đọc vẫn nói đầy đủ; Đổi rác tạm dừng mà còn yêu cầu mở ghi "Yêu cầu"', () => {
    const on = visibleHomeShortcuts({ wasteEnabled: true, claimEnabled: true });
    expect(on.find((s) => s.id === 'claim')).toMatchObject({ label: 'Đơn sàn', ariaLabel: expect.stringContaining('Tích điểm đơn sàn') });
    const paused = visibleHomeShortcuts({ wasteEnabled: false, claimEnabled: true, recycleOpenRequests: true }).find((s) => s.id === 'recycle');
    expect(paused).toMatchObject({ label: 'Yêu cầu', ariaLabel: expect.stringContaining('Yêu cầu của tôi') });
  });
  it('cờ tắt thì ẩn mục, các mục còn lại giữ thứ tự', () => {
    const ids = visibleHomeShortcuts({ wasteEnabled: false, claimEnabled: false }).map((s) => s.id);
    expect(ids).toEqual(['flash', 'coupons', 'groupBuy', 'rewards', 'orders', 'earn', 'community']);
  });
  it('Giờ vàng đi tới /flash-sale, Mã giảm giá ghi đúng chữ chốt', () => {
    expect(HOME_SHORTCUTS.find((s) => s.id === 'flash')).toMatchObject({ label: 'Giờ vàng' });
    expect(HOME_SHORTCUTS.find((s) => s.id === 'coupons')).toMatchObject({ label: 'Mã giảm giá' });
  });
});

describe('homeShortcutSlots (Q7: 4 ô cố định + "Tất cả")', () => {
  it('4 ô cố định là Giờ vàng, Mã giảm giá, Đổi rác, Mua chung; "Tất cả" liệt kê đủ mục còn hiển thị', () => {
    expect(HOME_SHORTCUT_SLOTS).toBe(4);
    const { pinned, all } = homeShortcutSlots({ wasteEnabled: true, claimEnabled: true });
    expect(pinned.map((s) => s.id)).toEqual(['flash', 'coupons', 'recycle', 'groupBuy']);
    expect(all.map((s) => s.id)).toEqual(expect.arrayContaining(['earn', 'community', 'orders', 'rewards', 'claim']));
    expect(all).toHaveLength(9);
  });
  it('Đổi rác tắt thì ô trống được mục kế lấp, vẫn đủ 4 ô', () => {
    const { pinned } = homeShortcutSlots({ wasteEnabled: false, claimEnabled: false });
    expect(pinned.map((s) => s.id)).toEqual(['flash', 'coupons', 'groupBuy', 'rewards']);
  });
});

describe('số đo khối Trang chủ mới', () => {
  it('header dính 56px; Việc cần làm mỗi dòng 64px', () => {
    expect(HOME_HEADER_HEIGHT).toBe(56);
    expect(todoSkeletonHeight(1)).toBe(64);
    expect(todoSkeletonHeight(2)).toBe(128);
    expect(todoSkeletonHeight(0)).toBe(0);
  });
});

describe('gợi ý nhớ Giờ vàng (có suất, có dòng suất kế)', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('khứ hồi: có Giờ vàng, có thêm dòng suất kế, không có; chưa nhớ → không giữ chỗ', () => {
    const st = mem();
    expect([readFlashHint(st), readFlashSlotHint(st)]).toEqual([false, false]);
    writeFlashHint(st, true);
    expect([readFlashHint(st), readFlashSlotHint(st)]).toEqual([true, false]);
    writeFlashHint(st, true, true);
    expect([readFlashHint(st), readFlashSlotHint(st)]).toEqual([true, true]);
    writeFlashHint(st, false, true);
    expect([readFlashHint(st), readFlashSlotHint(st)]).toEqual([false, false]);
    expect(st.m.get(FLASH_HINT_KEY)).toBe('0');
  });
  it('giá trị "1" của bản cũ vẫn đọc là có Giờ vàng, kho ném lỗi thì không văng', () => {
    const st = mem();
    st.setItem(FLASH_HINT_KEY, '1');
    expect(readFlashHint(st)).toBe(true);
    const boom = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readFlashSlotHint(boom)).toBe(false);
    expect(() => writeFlashHint(boom, true, true)).not.toThrow();
    expect(FLASH_NEXT_SLOT_HEIGHT).toBe(44);
  });
});

describe('gợi ý nhớ số món Mua lại', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('khứ hồi: 0 → none, 1 → one, 3 → many; chưa nhớ → none', () => {
    const st = mem();
    expect(readPurchasedHint(st)).toBe('none');
    writePurchasedHint(st, 1);
    expect(readPurchasedHint(st)).toBe('one');
    writePurchasedHint(st, 3);
    expect(readPurchasedHint(st)).toBe('many');
    writePurchasedHint(st, 0);
    expect(readPurchasedHint(st)).toBe('none');
    expect(st.m.has(PURCHASED_HINT_KEY)).toBe(true);
  });
  it('kho ném lỗi hay không có kho: không văng, trả none', () => {
    const boom = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readPurchasedHint(boom)).toBe('none');
    expect(() => writePurchasedHint(boom, 2)).not.toThrow();
    expect(readPurchasedHint(null)).toBe('none');
  });
  it('khung chờ: 1 món là tiêu đề + dòng 88; nhiều món cao hơn; none không giữ chỗ', () => {
    expect(purchasedSkeletonHeight('none')).toBe(0);
    expect(purchasedSkeletonHeight('one')).toBe(44 + 88);
    expect(purchasedSkeletonHeight('many')).toBeGreaterThan(purchasedSkeletonHeight('one'));
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
  const key = (code: string, days: number) => `${code}@${at(code, days).endAt}`;
  it('chưa điểm danh hôm nay thì chấm, kể cả khi đã xem mã sắp hết hạn', () => {
    expect(offersDotReason({ checkIn: { checkedInToday: false }, coupons: [at('A', 1)], seenExpiringIds: [key('A', 1)] }, now)).toBe('check-in');
  });
  it('đã điểm danh, mã còn xa thì không chấm', () => {
    expect(offersDotReason({ checkIn: { checkedInToday: true }, coupons: [at('A', 10)] }, now)).toBeNull();
  });
  it('mã hết hạn trong 3 ngày mà khách chưa xem thì chấm', () => {
    expect(offersDotReason({ checkIn: { checkedInToday: true }, coupons: [at('A', 2)] }, now)).toBe('coupon-expiring');
  });
  it('khách đã mở Ưu đãi với mã đó thì tắt, có mã mới sắp hết hạn thì bật lại', () => {
    const input = { checkIn: { checkedInToday: true }, seenExpiringIds: [key('A', 2)] };
    expect(offersDotReason({ ...input, coupons: [at('A', 2)] }, now)).toBeNull();
    expect(offersDotReason({ ...input, coupons: [at('A', 2), at('B', 1)] }, now)).toBe('coupon-expiring');
  });
  it('gia hạn mã (endAt đổi) thì chấm bật lại khi mã sắp hết hạn', () => {
    const input = { checkIn: { checkedInToday: true }, seenExpiringIds: [key('A', 2)] };
    expect(offersDotReason({ ...input, coupons: [at('A', 2.5)] }, now)).toBe('coupon-expiring');
  });
  it('mã đã quá hạn không tính; dữ liệu chưa về thì không chấm', () => {
    expect(offersDotReason({ coupons: [at('A', -1)] }, now)).toBeNull();
    expect(offersDotReason({}, now)).toBeNull();
  });
});

describe('kho mã đã xem theo tài khoản', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('chỉ đọc lại của chính tài khoản đã ghi; khác tài khoản, định dạng cũ hay hỏng thì rỗng', () => {
    const st = mem();
    writeSeenCoupons(st, 'u1', ['A@x']);
    expect(readSeenCoupons(st, 'u1')).toEqual(['A@x']);
    expect(readSeenCoupons(st, 'u2')).toEqual([]);
    expect(readSeenCoupons(st, undefined)).toEqual([]);
    st.setItem(OFFERS_SEEN_KEY, JSON.stringify(['A']));
    expect(readSeenCoupons(st, 'u1')).toEqual([]);
    st.setItem(OFFERS_SEEN_KEY, '{hỏng');
    expect(readSeenCoupons(st, 'u1')).toEqual([]);
    expect(readSeenCoupons(null, 'u1')).toEqual([]);
  });
  it('readLastTodoRows: số dòng của tài khoản dùng gần nhất, bất kể là ai', () => {
    const st = mem();
    expect(readLastTodoRows(st)).toBe(0);
    st.setItem('tubu_home_todo_rows', JSON.stringify({ userId: 'u9', rows: 2 }));
    expect(readLastTodoRows(st)).toBe(2);
    expect(readLastTodoRows(null)).toBe(0);
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
  it('đang khôi phục phiên: theo loại của tài khoản dùng gần nhất, chưa nhớ thì chưa biết, không bao giờ là khách mới', () => {
    const pendingAuth = { ...base, authed: false, authPending: true } as const;
    expect(resolveHomeKind({ ...pendingAuth, stored: 'returning' })).toBe('returning');
    expect(resolveHomeKind({ ...pendingAuth, stored: 'new' })).toBe('new');
    expect(resolveHomeKind(pendingAuth)).toBe('new');
    expect(resolveHomeKind({ ...pendingAuth, unknownWhenUnremembered: true })).toBe('unknown');
    expect(resolveHomeKind({ ...pendingAuth, stored: 'returning', unknownWhenUnremembered: true })).toBe('returning');
  });
  it('thứ tự khối của "chưa biết" giữ chỗ thẻ thành viên và không có khối riêng của một loại', () => {
    const order = homeBlockOrder('unknown');
    expect(order).toContain('member');
    for (const id of ['purchased', 'welcome'] as const) expect(order).not.toContain(id);
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

describe('clearHomeHints', () => {
  it('bỏ cả hai khoá, kho null hoặc bị chặn thì không ném lỗi', () => {
    const removed: string[] = [];
    clearHomeHints({ getItem: () => null, setItem: () => {}, removeItem: (k: string) => void removed.push(k) });
    expect(removed.sort()).toEqual([HOME_KIND_KEY, TODO_ROWS_KEY].sort());
    expect(() => clearHomeHints(null)).not.toThrow();
    expect(() => clearHomeHints({ getItem: () => null, setItem: () => {}, removeItem: () => { throw new Error('blocked'); } })).not.toThrow();
  });
});

describe('dropForeignHomeHints', () => {
  const store = (init: Record<string, string> = {}) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), has: (k: string) => m.has(k) };
  };
  const kind = (userId: string) => JSON.stringify({ userId, kind: 'returning' });
  const rows = (userId: string) => JSON.stringify({ userId, rows: 2 });

  it('đăng nhập ra tài khoản khác: bỏ cả loại khách lẫn số dòng của người trước', () => {
    const s = store({ [HOME_KIND_KEY]: kind('A'), [TODO_ROWS_KEY]: rows('A') });
    expect(dropForeignHomeHints(s, 'B')).toBe(true);
    expect(s.has(HOME_KIND_KEY)).toBe(false);
    expect(s.has(TODO_ROWS_KEY)).toBe(false);
  });

  it('cùng tài khoản: giữ nguyên, không báo đã bỏ', () => {
    const s = store({ [HOME_KIND_KEY]: kind('A'), [TODO_ROWS_KEY]: rows('A') });
    expect(dropForeignHomeHints(s, 'A')).toBe(false);
    expect(s.has(HOME_KIND_KEY)).toBe(true);
    expect(s.has(TODO_ROWS_KEY)).toBe(true);
  });

  it('chỉ bỏ khoá của người khác, giữ khoá của chính tài khoản này', () => {
    const s = store({ [HOME_KIND_KEY]: kind('B'), [TODO_ROWS_KEY]: rows('A') });
    expect(dropForeignHomeHints(s, 'B')).toBe(true);
    expect(s.has(HOME_KIND_KEY)).toBe(true);
    expect(s.has(TODO_ROWS_KEY)).toBe(false);
  });

  it('giá trị hỏng hoặc không ghi chủ tài khoản thì bỏ; chưa có gì thì không làm gì', () => {
    expect(dropForeignHomeHints(store({ [HOME_KIND_KEY]: '{hỏng', [TODO_ROWS_KEY]: JSON.stringify({ rows: 1 }) }), 'A')).toBe(true);
    expect(dropForeignHomeHints(store(), 'A')).toBe(false);
  });

  it('không có kho hoặc chưa biết tài khoản: không làm gì', () => {
    expect(dropForeignHomeHints(null, 'A')).toBe(false);
    expect(dropForeignHomeHints(store({ [HOME_KIND_KEY]: kind('A') }), null)).toBe(false);
  });
});

describe('homeRenderOrder / homeSettling', () => {
  it('không giữ chỗ thì đúng thứ tự khối', () => {
    for (const k of ['returning', 'new', 'unknown'] as const) expect(homeRenderOrder(k, false)).toEqual(homeBlockOrder(k));
  });
  it('đang giữ chỗ: chỉ còn tìm kiếm, thẻ thành viên và một khung chờ chung', () => {
    expect(homeRenderOrder('unknown', true)).toEqual(['search', 'member', 'settling']);
    expect(homeRenderOrder('returning', true)).toEqual(['search', 'member', 'settling']);
  });
  it('khách mới đang giữ chỗ (dải quà thay thẻ thành viên) cũng gọn về một khung chờ', () => {
    expect(homeRenderOrder('new', true)).toEqual(['search', 'welcome', 'settling']);
  });
  it('giữ nội dung khách mới đã dựng: thứ tự khách mới, chỉ dải quà đổi thành khung giữ chỗ thẻ thành viên, Bán chạy và Gợi ý còn nguyên', () => {
    const kept = homeKeptOrder('unknown');
    expect(kept).toEqual(homeBlockOrder('new').map((id) => (id === 'welcome' ? 'member' : id)));
    expect(kept).toContain('bestSellers');
    expect(kept.at(-1)).toBe('suggest');
    expect(kept).not.toContain('purchased');
    expect(homeKeptOrder('returning')).toEqual(kept);
  });
  it('giữ nội dung đã dựng mà đã biết là khách mới: đúng bố cục khách mới, giữ dải quà', () => {
    expect(homeKeptOrder('new')).toEqual(homeBlockOrder('new'));
  });
  it('chỉ giữ khi lần mở đầu chưa biết loại khách, tới khi biết loại và dữ liệu đã về', () => {
    expect(homeSettling({ startedUnknown: true, kind: 'unknown', dataPending: false })).toBe(true);
    expect(homeSettling({ startedUnknown: true, kind: 'returning', dataPending: true })).toBe(true);
    expect(homeSettling({ startedUnknown: true, kind: 'new', dataPending: false })).toBe(false);
    expect(homeSettling({ startedUnknown: false, kind: 'returning', dataPending: true })).toBe(false);
    expect(homeSettling({ startedUnknown: false, kind: 'unknown', dataPending: true })).toBe(false);
  });
});
