import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shelf } from './merch/shelves';
import { liveRoute } from './merch/route-fallback';
import {
  memberCardAriaLabel, offersPointsAriaLabel, clearHomeHints, customerKind, dropForeignHomeHints, HOME_KIND_KEY, HOME_SHORTCUTS, TODO_ROWS_KEY, OFFERS_SEEN_KEY, readLastTodoRows, readTodoRows, writeTodoRows, readSeenCoupons, writeSeenCoupons, homeBlockOrder, isCouponExpiring, memberCardView, mergeSeenCouponIds, resolveHomeKind, mergeSuggestions, NAV_TAB_SPECS, offersDotReason, ORDER_STATUS_ROW,
  visibleHomeShortcuts, homeRenderOrder, homeKeptOrder, homeSettling, homeShortcutSlots, HOME_HEADER_HEIGHT, HOME_SHORTCUT_SLOTS, HOME_HERO_HEIGHT, HOME_GIFT_HEIGHT,
  HOME_ECOSYSTEM_PILLARS, HOME_QUICK_SHORTCUT_IDS, HOME_MAX_BLOCKS, HOME_CONTEXT_HEIGHT, HOME_INTERLEAVE_AFTER, homeContextVariant, homeContextBlockName, homeInterleaveCard, homePromoPick, homeTodoCount, homeTodoLead, resolveHomeEcosystemPillars, splitHomeEcosystemPillars,
  readPurchasedHint, writePurchasedHint, PURCHASED_HINT_KEY, purchasedSkeletonHeight, todoSkeletonHeight,
  readFlashHint, readFlashSlotHint, writeFlashHint, FLASH_HINT_KEY, FLASH_NEXT_SLOT_HEIGHT,
  HOME_SETTLING_HEIGHTS, categoriesBlockHeight, categorySkeletonCells, homeCategoryEntries, CATEGORY_CELL_HEIGHT, CATEGORY_GRID_COLUMNS, CATEGORY_GRID_MAX_CELLS,
  BANNER_HINT_KEY, OFFERS_BANNER_HINT_KEY, readBannerHint, writeBannerHint,
  COLLECT_HINT_KEY, COLLECT_HINT_MAX, collectSkeletonHeight, readCollectHint, writeCollectHint, HOME_BEST_SELLER_LIMIT,
} from './home-layout';
import { homeCopy } from './home-copy';
import { rememberActiveOrder } from './home-todo-rows';
import type { LoyaltyOverview } from './api/loyalty';

describe('homeBlockOrder', () => {
  const KINDS = ['returning', 'new', 'unknown'] as const;
  const PROMOS = [
    { flashItems: 3, bannerSlides: 0, combos: 0 },
    { flashItems: 0, bannerSlides: 2, combos: 0 },
    { flashItems: 0, bannerSlides: 0, combos: 2 },
    { flashItems: 3, bannerSlides: 2, combos: 2 },
    { flashItems: 0, bannerSlides: 0, combos: 0 },
  ];
  const visible = (kind: (typeof KINDS)[number], promo: (typeof PROMOS)[number]) => {
    const pick = homePromoPick({ ...promo, flashPending: false, flashRemembered: false, bannerPending: false, bannerRemembered: false });
    return homeBlockOrder(kind).filter((id) => id !== 'promo' || pick !== null);
  };

  it('khách cũ: header, dải ngữ cảnh, Danh mục, Bán chạy nhất, Mua lại, lối vào, dải Story, ô khuyến mãi, rồi một lưới Gợi ý', () => {
    expect(homeBlockOrder('returning')).toEqual(['search', 'context', 'categories', 'bestSellers', 'purchased', 'shortcuts', 'stories', 'promo', 'suggest']);
  });
  it('khách mới và chưa biết loại khách: cùng thứ tự, không Mua lại', () => {
    expect(homeBlockOrder('new')).toEqual(['search', 'context', 'categories', 'bestSellers', 'shortcuts', 'stories', 'promo', 'suggest']);
    expect(homeBlockOrder('unknown')).toEqual(homeBlockOrder('new'));
  });
  it('mọi tổ hợp loại khách × có/không Giờ vàng, banner, combo: tối đa 9 khối, kệ Bán chạy nhất là khối hàng đầu tiên', () => {
    for (const kind of KINDS) {
      for (const promo of PROMOS) {
        const order = visible(kind, promo);
        expect(order.length, `${kind} ${JSON.stringify(promo)}`).toBeLessThanOrEqual(HOME_MAX_BLOCKS);
        expect(order.slice(0, 4)).toEqual(['search', 'context', 'categories', 'bestSellers']);
        expect(new Set(order).size).toBe(order.length);
        expect(order.at(-1)).toBe('suggest');
      }
    }
  });
  it('ô khuyến mãi (về muộn nhất) đứng ngay trên lưới Gợi ý, dưới mọi khối của màn đầu: lúc hiện ra chỉ đẩy lưới Gợi ý', () => {
    for (const kind of KINDS) {
      const order = homeBlockOrder(kind);
      expect(order.indexOf('promo')).toBe(order.indexOf('suggest') - 1);
      expect(order.indexOf('promo')).toBeGreaterThan(order.indexOf('stories'));
    }
  });
  it('không còn khối riêng cho Hành trình, Chẩn đoán tổ ấm, Cộng đồng, combo hay Giờ vàng: Chẩn đoán và Cộng đồng là thẻ chen trong Gợi ý', () => {
    for (const kind of KINDS) {
      for (const gone of ['journey', 'quiz', 'community', 'combos', 'flash', 'banner', 'member', 'welcome', 'todo']) expect(homeBlockOrder(kind) as readonly string[]).not.toContain(gone);
    }
  });
  it('dải Story ngay dưới lối vào, giữ chỗ đúng chiều cao khi chờ', () => {
    for (const k of KINDS) {
      const order = homeBlockOrder(k);
      expect(order[order.indexOf('shortcuts') + 1]).toBe('stories');
    }
    expect(HOME_SETTLING_HEIGHTS.stories).toBe(144);
  });
  it('dải ngữ cảnh luôn cao 64px ở mọi biến thể (quà, việc cần làm, thẻ thành viên, khung chờ)', () => {
    expect(HOME_CONTEXT_HEIGHT).toBe(64);
    expect(HOME_GIFT_HEIGHT).toBe(HOME_CONTEXT_HEIGHT);
    expect(HOME_HERO_HEIGHT).toBe(HOME_CONTEXT_HEIGHT);
  });
});

describe('homeContextVariant', () => {
  const base = { todoCount: 0, todoPending: false, todoRemembered: false };
  it('chưa biết loại khách: khung chờ', () => {
    expect(homeContextVariant({ ...base, kind: 'unknown', todoCount: 2 })).toBe('skeleton');
  });
  it('có việc thì Việc cần làm, kể cả khách mới (đơn chờ chuyển khoản gấp hơn quà)', () => {
    expect(homeContextVariant({ ...base, kind: 'new', todoCount: 1 })).toBe('todo');
    expect(homeContextVariant({ ...base, kind: 'returning', todoCount: 3 })).toBe('todo');
  });
  it('việc đang tải mà lần trước có việc: khung chờ; lần trước không có: vẽ ngay quà hoặc thẻ', () => {
    expect(homeContextVariant({ ...base, kind: 'returning', todoPending: true, todoRemembered: true })).toBe('skeleton');
    expect(homeContextVariant({ ...base, kind: 'returning', todoPending: true })).toBe('member');
    expect(homeContextVariant({ ...base, kind: 'new', todoPending: true })).toBe('gift');
  });
  it('tên khối giữ tên cũ để số đo trước/sau so được', () => {
    expect(homeContextBlockName('gift')).toBe('welcome');
    expect(homeContextBlockName('todo')).toBe('todo');
    expect(homeContextBlockName('member')).toBe('member');
    expect(homeContextBlockName('skeleton')).toBe('member');
  });
});

describe('homeTodoLead / homeTodoCount', () => {
  const o = { order: { id: 'x' } };
  it('chưa có dữ liệu hay không có việc: không có dòng', () => {
    expect(homeTodoLead(undefined)).toBeNull();
    expect(homeTodoLead({ pending: null, shipping: null, processing: null })).toBeNull();
    expect(homeTodoCount(null)).toBe(0);
  });
  it('chờ chuyển khoản trước, rồi đang giao, rồi đang chuẩn bị; "còn N việc" đếm loại khác và đơn thứ hai trở đi', () => {
    expect(homeTodoLead({ pending: o, shipping: { ...o, total: 2 }, processing: o })).toEqual({ kind: 'pending', more: 3 });
    expect(homeTodoLead({ pending: null, shipping: { ...o, total: 1 }, processing: { ...o, total: 3 } })).toEqual({ kind: 'shipping', more: 3 });
    expect(homeTodoLead({ pending: null, shipping: null, processing: { ...o, total: 1 } })).toEqual({ kind: 'processing', more: 0 });
    expect(homeTodoCount({ pending: o, shipping: null, processing: o })).toBe(2);
  });
});

describe('homePromoPick', () => {
  const none = { flashItems: 0, flashPending: false, flashRemembered: false, bannerSlides: 0, bannerPending: false, bannerRemembered: false, combos: 0 };
  it('Giờ vàng > banner > combo; không có gì thì ẩn ô (PROD hiện 0 combo, 0 suất)', () => {
    expect(homePromoPick({ ...none, flashItems: 2, bannerSlides: 1, combos: 1 })).toBe('flash');
    expect(homePromoPick({ ...none, bannerSlides: 1, combos: 1 })).toBe('banner');
    expect(homePromoPick({ ...none, combos: 1 })).toBe('combos');
    expect(homePromoPick(none)).toBeNull();
  });
  it('đang tải: chỉ giữ chỗ cho khối máy đã nhớ là có; không nhớ thì chờ im lặng', () => {
    expect(homePromoPick({ ...none, flashPending: true, flashRemembered: true })).toBe('flash');
    expect(homePromoPick({ ...none, bannerPending: true, bannerRemembered: true })).toBe('banner');
    expect(homePromoPick({ ...none, flashPending: true, bannerPending: true })).toBeNull();
  });
  it('nguồn ưu tiên cao hơn còn tải thì không chọn nguồn thấp hơn rồi đổi khối (banner rồi Giờ vàng, combo rồi banner)', () => {
    expect(homePromoPick({ ...none, flashPending: true, bannerSlides: 1, combos: 2 })).toBeNull();
    expect(homePromoPick({ ...none, flashPending: true, bannerPending: true, bannerRemembered: true })).toBeNull();
    expect(homePromoPick({ ...none, bannerPending: true, combos: 2 })).toBeNull();
    expect(homePromoPick({ ...none, bannerPending: true, bannerRemembered: true, combos: 2 })).toBe('banner');
  });
});

describe('homeInterleaveCard', () => {
  it('chen sau 8 thẻ Gợi ý; ngày chẵn Chẩn đoán tổ ấm, ngày lẻ Cộng đồng', () => {
    expect(HOME_INTERLEAVE_AFTER).toBe(8);
    expect(homeInterleaveCard('2026-11-16')).toBe('quiz');
    expect(homeInterleaveCard('2026-11-17')).toBe('community');
    expect(homeInterleaveCard('')).toBe('quiz');
  });
  it('customerKind', () => {
    expect(customerKind(0)).toBe('new');
    expect(customerKind(undefined)).toBe('new');
    expect(customerKind(2)).toBe('returning');
  });
});

describe('visibleHomeShortcuts', () => {
  it('khai 9 lối tắt; khi mọi cờ bật hiện đủ 9, mở đầu bằng Giờ vàng và không có Vườn Xanh (đã là tab giữa)', () => {
    expect(HOME_SHORTCUTS).toHaveLength(9);
    const ids = visibleHomeShortcuts({ wasteEnabled: true, claimEnabled: true }).map((s) => s.id);
    expect(ids).toEqual(['flash', 'coupons', 'recycle', 'groupBuy', 'rewards', 'orders', 'claim', 'earn', 'community']);
    expect(ids).not.toContain('garden');
  });
  it('ô Giờ vàng hiện khi chưa biết hay có suất, không phụ thuộc cờ nào; biết chắc không có suất nào thì bỏ', () => {
    for (const wasteEnabled of [false, true]) for (const claimEnabled of [false, true]) {
      expect(visibleHomeShortcuts({ wasteEnabled, claimEnabled })[0]!.id).toBe('flash');
      expect(visibleHomeShortcuts({ wasteEnabled, claimEnabled, flashLive: true })[0]!.id).toBe('flash');
      expect(visibleHomeShortcuts({ wasteEnabled, claimEnabled, flashLive: false }).map((x) => x.id)).not.toContain('flash');
    }
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
  it('4 ô cố định là Giờ vàng, Mã giảm giá, Đổi rác, Mua chung (Q7); "Tất cả" liệt kê đủ mục còn hiển thị', () => {
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

describe('HOME_ECOSYSTEM_PILLARS (W177: 2 thẻ chính + 4 ô phụ)', () => {
  it('đủ 6 lối vào theo thứ tự vẽ: hai thẻ chính (Mua lẻ · Giờ vàng, Đổi rác miễn ship đơn sau) rồi bốn ô phụ', () => {
    expect(HOME_ECOSYSTEM_PILLARS.map((p) => [p.id, p.tier])).toEqual([
      ['retail', 'hero'],
      ['recycle', 'hero'],
      ['groupBuy', 'chip'],
      ['subscription', 'chip'],
      ['garden', 'chip'],
      ['rewards', 'chip'],
    ]);
    expect(HOME_ECOSYSTEM_PILLARS.map((p) => p.title)).toEqual([
      'Mua lẻ · Giờ vàng',
      'Đổi rác — Miễn ship đơn sau',
      'Mua chung',
      'Mua xoay vòng',
      'Vườn Xanh',
      'Kho quà 0đ',
    ]);
    expect(HOME_ECOSYSTEM_PILLARS.map((p) => p.webHref)).toEqual([
      '/gio-vang',
      '/doi-rac',
      '/mua-chung',
      '/san-pham?filter=subscription',
      '/vuon-xanh',
      '/kho-qua',
    ]);
    expect(HOME_ECOSYSTEM_PILLARS.map((p) => p.miniRoute)).toEqual([
      '/flash-sale',
      '/recycle',
      '/group-buy',
      '/subscriptions',
      '/game',
      '/offers?tab=rewards',
    ]);
  });

  it('đích thẻ chính khớp bảng route-fallback: route nào chuyển sang chờ thì spec này đỏ để thẻ chính đi qua liveRoute như lối tắt', () => {
    for (const p of HOME_ECOSYSTEM_PILLARS) {
      expect(liveRoute(p.miniRoute, 'mini'), `${p.id} miniRoute`).toBe(p.miniRoute);
      // Route lạ (không có trong bảng) được trả nguyên; chỉ route có trong bảng mới phải khớp webHref.
      const web = liveRoute(p.miniRoute, 'web');
      if (web !== p.miniRoute) expect(web, `${p.id} webHref`).toBe(p.webHref);
    }
    expect(liveRoute('/flash-sale', 'web')).toBe(HOME_ECOSYSTEM_PILLARS[0]!.webHref);
  });

  it('Giờ vàng chỉ có một nút trên màn (thẻ chính), không lặp ở hàng lối tắt nhanh; Mã giảm giá và Cộng đồng còn ở hàng đó', () => {
    expect(HOME_QUICK_SHORTCUT_IDS).toEqual(['coupons', 'community']);
    expect(HOME_QUICK_SHORTCUT_IDS).not.toContain('flash');
    // Mọi lối tắt vẫn còn trong hộp thoại "Thêm".
    expect(visibleHomeShortcuts({ wasteEnabled: true, claimEnabled: true }).map((s) => s.id)).toContain('flash');
  });

  it('chiều cao khung chờ khối lối vào = hàng 1 (96) + khe 8 + hàng 2 (64) + khe 8 + hàng lối tắt nhanh (44)', () => {
    expect(HOME_SETTLING_HEIGHTS.shortcuts).toBe(96 + 8 + 64 + 8 + 44);
  });

  it('splitHomeEcosystemPillars: 2 thẻ chính và 4 ô phụ, giữ thứ tự', () => {
    const { heroes, chips } = splitHomeEcosystemPillars(HOME_ECOSYSTEM_PILLARS);
    expect(heroes.map((p) => p.id)).toEqual(['retail', 'recycle']);
    expect(chips.map((p) => p.id)).toEqual(['groupBuy', 'subscription', 'garden', 'rewards']);
  });

  it('Mua xoay vòng nói đúng % của cấu hình; chưa có cấu hình thì không nêu con số nào (không còn 17% viết cứng)', () => {
    const sub = (pct?: number | null) => resolveHomeEcosystemPillars({ subscribeDiscountPct: pct }).find((p) => p.id === 'subscription')!;
    expect(sub(0.12)).toMatchObject({ subtitle: 'Đặt định kỳ tiết kiệm tới 12%', badge: 'Định kỳ -12%' });
    expect(sub(0.15)).toMatchObject({ subtitle: 'Đặt định kỳ tiết kiệm tới 15%', badge: 'Định kỳ -15%' });
    for (const missing of [undefined, null, 0]) {
      const p = sub(missing);
      expect(`${p.subtitle} ${p.badge}`).not.toMatch(/\d/);
    }
    expect(JSON.stringify(HOME_ECOSYSTEM_PILLARS)).not.toContain('17%');
  });

  it('biết chắc không có suất Giờ vàng: bỏ thẻ "Mua lẻ · Giờ vàng", còn một thẻ chính (Đổi rác giãn hết hàng); chưa biết thì giữ', () => {
    const off = splitHomeEcosystemPillars(resolveHomeEcosystemPillars({ flashLive: false }));
    expect(off.heroes.map((p) => p.id)).toEqual(['recycle']);
    expect(off.chips).toHaveLength(4);
    expect(splitHomeEcosystemPillars(resolveHomeEcosystemPillars({})).heroes.map((p) => p.id)).toEqual(['retail', 'recycle']);
  });

  it('Đổi rác tạm dừng mà khách còn yêu cầu đang mở: giữ đủ 6 ô, thẻ chính thứ hai đổi sang Yêu cầu của tôi', () => {
    const paused = resolveHomeEcosystemPillars({ wastePausedWithOpenRequests: true });
    expect(paused).toHaveLength(6);
    expect(paused.filter((p) => p.tier === 'hero')).toHaveLength(2);
    expect(paused[1]).toMatchObject({
      id: 'recycle',
      title: 'Yêu cầu của tôi',
      badge: 'Yêu cầu',
      webHref: '/doi-rac/yeu-cau',
      miniRoute: '/recycle/requests',
    });
  });
});

describe('chiều cao khối Danh mục theo số ô', () => {
  it('ô danh mục cao 92 (56 + 4 + nhãn hai dòng 32)', () => {
    expect(CATEGORY_CELL_HEIGHT).toBe(92);
  });
  it('tới 5 ô một hàng (148), từ 6 ô hai hàng (248) là phép đo chung; Trang chủ chỉ có một hàng nên khung chờ chung dùng số một hàng (148)', () => {
    for (const n of [1, 4, 5]) expect(categoriesBlockHeight(n), `${n} ô`).toBe(148);
    for (const n of [6, 10, 14]) expect(categoriesBlockHeight(n), `${n} ô`).toBe(248);
    expect(HOME_SETTLING_HEIGHTS.categories).toBe(148);
  });
  it('số ô khung chờ = số danh mục nhớ + "Tất cả", không quá một hàng (5)', () => {
    expect(categorySkeletonCells(3)).toBe(4);
    expect(categorySkeletonCells(4)).toBe(5);
    expect(categorySkeletonCells(9)).toBe(5);
    expect(categorySkeletonCells(40)).toBe(5);
  });
  it('Trang chủ chỉ một hàng 5 ô: 4 danh mục đầu theo thứ tự có sẵn + "Tất cả"; không có ô thứ 6 để xếp hàng hai hay cuộn ngang', () => {
    expect(CATEGORY_GRID_MAX_CELLS).toBe(CATEGORY_GRID_COLUMNS);
    expect(CATEGORY_GRID_MAX_CELLS).toBe(5);
    const ten = Array.from({ length: 10 }, (_, i) => `c${i}`);
    expect(homeCategoryEntries(ten, true)).toEqual(['c0', 'c1', 'c2', 'c3']);
    expect(homeCategoryEntries(ten, false)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
    expect(homeCategoryEntries(['a', 'b'], true)).toEqual(['a', 'b']);
    expect(homeCategoryEntries([], true)).toEqual([]);
    // Số ô vẽ (kể cả "Tất cả") luôn vừa một hàng và cao đúng khung chờ chung: trang không nhảy khi danh mục về.
    for (const n of [0, 1, 4, 5, 10, 40]) {
      const cells = homeCategoryEntries(Array.from({ length: n }, (_, i) => i), true).length + 1;
      expect(categoriesBlockHeight(cells), `${n} danh mục`).toBe(HOME_SETTLING_HEIGHTS.categories);
    }
  });
});

describe('hai ô cuối của Trang chủ phân biệt được', () => {
  it('ô cuối lối tắt ("Thêm", mở sheet) khác ô cuối Danh mục ("Tất cả", đi tab Danh mục) cả nhãn lẫn tên đọc; nhãn lối tắt ≤ 6 ký tự', () => {
    expect(homeCopy.shortcuts.more).toBe('Thêm');
    expect(homeCopy.shortcuts.more.length).toBeLessThanOrEqual(6);
    expect(homeCopy.shortcuts.more).not.toBe(homeCopy.categories.all);
    expect(homeCopy.shortcuts.moreAria).not.toBe(homeCopy.categories.allAria);
  });
  it('tên đọc ô "Thêm" bắt đầu bằng chữ nhìn thấy (WCAG 2.5.3); hộp thoại nó mở vẫn tên "Tất cả lối tắt"', () => {
    expect(homeCopy.shortcuts.moreAria.startsWith(homeCopy.shortcuts.more)).toBe(true);
    expect(homeCopy.shortcuts.allAria).toBe('Tất cả lối tắt');
  });
});

describe('số đo khối Trang chủ mới', () => {
  it('thẻ thành viên (và khung chờ) cao bằng dải Quà khách mới: đổi loại khách không làm các khối dưới nhảy', () => {
    expect(HOME_HERO_HEIGHT).toBe(HOME_GIFT_HEIGHT);
  });

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

describe('gợi ý nhớ banner chiến dịch', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('khứ hồi: có banner → true, không → false; chưa nhớ hoặc không có kho → false (chờ im lặng)', () => {
    const st = mem();
    expect(readBannerHint(st)).toBe(false);
    expect(readBannerHint(null)).toBe(false);
    writeBannerHint(st, true);
    expect(st.m.get(BANNER_HINT_KEY)).toBe('1');
    expect(readBannerHint(st)).toBe(true);
    writeBannerHint(st, false);
    expect(st.m.get(BANNER_HINT_KEY)).toBe('0');
    expect(readBannerHint(st)).toBe(false);
  });
  it('giá trị lạ → false; kho ném lỗi thì đọc và ghi đều không văng', () => {
    const st = mem();
    st.setItem(BANNER_HINT_KEY, 'yes');
    expect(readBannerHint(st)).toBe(false);
    const boom = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readBannerHint(boom)).toBe(false);
    expect(() => writeBannerHint(boom, true)).not.toThrow();
  });
  it('mỗi vị trí banner có gợi ý riêng: ghi khoá Ưu đãi không đổi khoá Trang chủ và ngược lại', () => {
    const st = mem();
    expect(OFFERS_BANNER_HINT_KEY).toBe('tubu_offers_banner');
    expect(OFFERS_BANNER_HINT_KEY).not.toBe(BANNER_HINT_KEY);
    writeBannerHint(st, true, OFFERS_BANNER_HINT_KEY);
    expect(st.m.get(OFFERS_BANNER_HINT_KEY)).toBe('1');
    expect(readBannerHint(st, OFFERS_BANNER_HINT_KEY)).toBe(true);
    expect(readBannerHint(st)).toBe(false);
    writeBannerHint(st, true);
    writeBannerHint(st, false, OFFERS_BANNER_HINT_KEY);
    expect(readBannerHint(st)).toBe(true);
    expect(readBannerHint(st, OFFERS_BANNER_HINT_KEY)).toBe(false);
  });
  it('khung chờ banner cao đúng tỉ lệ 5:2 ở bề rộng 375 trừ đệm 16 hai bên', () => {
    expect(HOME_SETTLING_HEIGHTS.banner).toBe(Math.round((375 - 32) / 2.5));
    expect(HOME_SETTLING_HEIGHTS.banner).toBe(137);
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
  it('thứ tự khối của "chưa biết" có dải ngữ cảnh (khung chờ) và không có Mua lại', () => {
    const order = homeBlockOrder('unknown');
    expect(order).toContain('context');
    expect(order).not.toContain('purchased');
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
  it('đang giữ chỗ: chỉ còn tìm kiếm, dải ngữ cảnh và một khung chờ chung, ở mọi loại khách', () => {
    for (const k of ['returning', 'new', 'unknown'] as const) expect(homeRenderOrder(k, true)).toEqual(['search', 'context', 'settling']);
  });
  it('giữ nội dung khách mới đã dựng: thứ tự khách mới, Bán chạy và Gợi ý còn nguyên', () => {
    const kept = homeKeptOrder('unknown');
    expect(kept).toEqual(homeBlockOrder('new'));
    expect(kept.at(-1)).toBe('suggest');
    expect(kept).not.toContain('purchased');
  });
  it('giữ nội dung đã dựng rồi biết là khách cũ: Mua lại chen ngay trên ô khuyến mãi và Gợi ý (dưới màn đầu), các khối đã vẽ không bị đẩy xuống', () => {
    const kept = homeKeptOrder('unknown');
    const at = kept.indexOf('promo');
    expect(homeKeptOrder('returning')).toEqual([...kept.slice(0, at), 'purchased', ...kept.slice(at)]);
    expect(homeKeptOrder('returning').length).toBeLessThanOrEqual(HOME_MAX_BLOCKS);
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

describe('gợi ý nhớ số mã ở khối Nhận mã của Ưu đãi', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('khứ hồi 0 đến tối đa; chưa nhớ, giá trị lạ hay không có kho → 0 (chờ im lặng)', () => {
    const st = mem();
    expect(COLLECT_HINT_KEY).toBe('tubu_offers_collect');
    expect(readCollectHint(st)).toBe(0);
    expect(readCollectHint(null)).toBe(0);
    writeCollectHint(st, 2);
    expect(readCollectHint(st)).toBe(2);
    st.setItem(COLLECT_HINT_KEY, 'abc');
    expect(readCollectHint(st)).toBe(0);
    st.setItem(COLLECT_HINT_KEY, '9');
    expect(readCollectHint(st)).toBe(COLLECT_HINT_MAX);
  });
  it('ghi kẹp trong 0..tối đa và làm tròn xuống; kho ném lỗi thì không văng', () => {
    const st = mem();
    writeCollectHint(st, 7);
    expect(st.m.get(COLLECT_HINT_KEY)).toBe(String(COLLECT_HINT_MAX));
    writeCollectHint(st, -3);
    expect(st.m.get(COLLECT_HINT_KEY)).toBe('0');
    writeCollectHint(st, 1.9);
    expect(st.m.get(COLLECT_HINT_KEY)).toBe('1');
    const boom = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readCollectHint(boom)).toBe(0);
    expect(() => writeCollectHint(boom, 2)).not.toThrow();
  });
  it('chiều cao khung chờ: 0 thẻ không giữ chỗ, mỗi thẻ 88px, cách nhau 12px', () => {
    expect(collectSkeletonHeight(0)).toBe(0);
    expect(collectSkeletonHeight(1)).toBe(88);
    expect(collectSkeletonHeight(2)).toBe(2 * 88 + 12);
    expect(collectSkeletonHeight(3)).toBe(3 * 88 + 2 * 12);
  });
});

describe('HOME_BEST_SELLER_LIMIT (F9 MINOR)', () => {
  it('đủ cho trần kệ + 2 món dư + tối đa số combo × 3 món, để Bán chạy nhất không tụt dưới 3 món khi có 3–4 combo', () => {
    expect(HOME_BEST_SELLER_LIMIT).toBeGreaterThanOrEqual(shelf('home.bestSellers').maxItems + 2 + shelf('home.combos').maxItems * 3);
  });

  it('bằng hằng cùng tên ở API (Mini chỉ dùng khối /home gộp khi `limit` trùng đúng; lệch thì mỗi lần mở thêm một request lẻ)', () => {
    const api = readFileSync(fileURLToPath(new URL('../../../apps/api/src/modules/catalog/home.service.ts', import.meta.url)), 'utf8');
    const serverLimit = /export const HOME_BEST_SELLER_LIMIT = (\d+)/.exec(api)?.[1];
    expect(serverLimit).toBeTruthy();
    expect(HOME_BEST_SELLER_LIMIT).toBe(Number(serverLimit));
  });
});

describe('rememberActiveOrder — đơn vừa đặt để Trang chủ lần sau giữ chỗ Việc cần làm', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('chưa nhớ dòng nào thì ghi 1 dòng cho tài khoản này', () => {
    const s = store();
    rememberActiveOrder(s, 'u1');
    expect(readTodoRows(s, 'u1')).toBe(1);
  });
  it('đã nhớ 2 dòng thì giữ nguyên, không hạ xuống 1', () => {
    const s = store();
    writeTodoRows(s, 'u1', 2);
    rememberActiveOrder(s, 'u1');
    expect(readTodoRows(s, 'u1')).toBe(2);
  });
  it('không có kho hoặc không có tài khoản thì không làm gì', () => {
    expect(() => rememberActiveOrder(null, 'u1')).not.toThrow();
    const s = store();
    rememberActiveOrder(s, undefined);
    expect(readLastTodoRows(s)).toBe(0);
  });
});

describe('tên đọc của thẻ Điểm Xanh', () => {
  const card = { tierName: 'Mầm Xanh', pointsLabel: '120 điểm', valueLabel: '≈ 12.000đ' };
  it('memberCardAriaLabel: giữ dấu phẩy giữa các phần (nhịp ngắt cho trình đọc), hành động ở cuối', () => {
    expect(memberCardAriaLabel(card, 'Xem ưu đãi', 'Chào An')).toBe('Chào An · Mầm Xanh, 120 điểm, ≈ 12.000đ. Xem ưu đãi');
  });
  it('memberCardAriaLabel khi tổng quan lỗi: nói câu báo lỗi đang hiển thị, không đọc số điểm không thấy', () => {
    // Ở trạng thái lỗi ứng dụng không có hạng (overview chưa về).
    const failed = { ...card, tierName: null };
    expect(memberCardAriaLabel(failed, 'Xem ưu đãi', 'Chào An', 'Chưa tải được hạng và điểm')).toBe('Chào An, Chưa tải được hạng và điểm. Xem ưu đãi');
    expect(memberCardAriaLabel(failed, 'Xem ưu đãi', 'Chào An', 'Chưa tải được hạng và điểm')).not.toContain('120');
  });
  it('offersPointsAriaLabel: đúng thứ tự chữ nhìn thấy (hạng, chi tiết, điểm, giá trị); thiếu hạng thì bỏ', () => {
    expect(offersPointsAriaLabel(card, 'Hạng và lịch sử điểm')).toBe('Mầm Xanh, Hạng và lịch sử điểm, 120 điểm, ≈ 12.000đ');
    expect(offersPointsAriaLabel({ ...card, tierName: null as unknown as string, valueLabel: '' }, 'Chi tiết')).toBe('Chi tiết, 120 điểm');
  });
});
