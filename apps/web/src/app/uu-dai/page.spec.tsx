// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { couponsQuery } from '@tubutree/app-core/queries/loyalty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';
import { homeCopy } from '@tubutree/app-core/home-copy';

// Chép ý pages/offers.spec của Mini App cho trung tâm Ưu đãi ba tab (?tab=deals|wallet|rewards): mỗi tab hiện đúng khối của nó, đổi tab bằng replace,
// link cũ ?section=coupons mở ví, tab Đổi quà chỉ nạp khi chọn, khách chưa đăng nhập ở từng tab.
const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  search: '' as string,
  listeners: new Set<() => void>(),
  loyalty: null as Record<string, unknown> | null,
  coupons: [] as Record<string, unknown>[],
  checkIn: null as Record<string, unknown> | null,
  config: { waste: { enabled: true } } as Record<string, unknown>,
  fail: new Set<string>(),
  calls: [] as string[],
  posts: [] as string[],
  campaigns: [] as Record<string, unknown>[],
  campaignQueries: [] as unknown[],
  collectable: [] as Record<string, unknown>[],
  flash: [] as Record<string, unknown>[],
  use: vi.fn(),
  usingCode: null as string | null,
  getHold: new Map<string, Promise<unknown>>(),
  postHold: null as Promise<unknown> | null,
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: state.phase === 'authenticated' ? { id: 'u1', pointsBalance: 120, pointsConvertedBalance: 0 } : null, retrySession: vi.fn() }),
}));
vi.mock('@/lib/use-coupon-use', () => ({ useCouponUse: () => ({ copy: vi.fn(), use: state.use, notice: null, cancel: vi.fn(), usingCode: state.usingCode }) }));
// useSearchParams theo dõi `state.search` qua một kho nhỏ để router.replace giả đổi được URL và trang vẽ lại như trong Next.
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (l: () => void) => {
    state.listeners.add(l);
    return () => state.listeners.delete(l);
  };
  return {
    useRouter: () => ({ push: state.push, replace: state.replace, back: state.back }),
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => state.search, () => state.search)),
    usePathname: () => '/uu-dai',
  };
});
// Thân Kho quà có spec riêng (app/kho-qua, redeem-*): ở đây chỉ cần biết tab Đổi quà vẽ nó. Việc nạp lười kiểm ở page-rewards-lazy.spec.tsx.
vi.mock('@/components/rewards/rewards-view', async () => {
  const { createElement } = await import('react');
  return { RewardsView: () => createElement('div', { 'data-testid': 'rewards-view' }, 'Kho quà') };
});
vi.mock('@/lib/core-http', () => {
  const table: Record<string, () => unknown> = {
    '/me/loyalty': () => state.loyalty,
    '/me/coupons': () => state.coupons,
    '/me/daily-check-in': () => state.checkIn,
    '/config/public': () => state.config,
    '/campaigns': () => state.campaigns,
    '/coupons/collectable': () => state.collectable,
    '/coupons/collectable/mine': () => ({ claimed: [], newCustomerOnly: [] }),
    '/flash-sales/active': () => state.flash,
  };
  return {
    coreHttp: {
      get: async (path: string, opts?: unknown) => {
        state.calls.push(path);
        if (path === '/campaigns') state.campaignQueries.push(opts);
        if (state.fail.has(path)) throw new Error('Máy chủ đang bận');
        await state.getHold.get(path);
        const h = table[path];
        if (!h) throw new Error(`đường dẫn lạ ${path}`);
        return h();
      },
      post: async (path: string) => {
        state.posts.push(path);
        await state.postHold;
        return {};
      },
    },
  };
});

import { coreHttp } from '@/lib/core-http';
import { resetFlashSales } from '@/lib/use-flash-sales';
import OffersPage from './page';

const TIERS = [
  { id: 't1', name: 'Mầm Xanh', minPoints: 0, minSpending: 0, multiplier: 1 },
  { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: 4_000_000, multiplier: 1.2 },
];
const REWARDS = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, points: day, claimed: day < 3, isToday: day === 3 }));
const COUPON = { id: 'c1', code: 'WELCOME20', type: 'AMOUNT', value: 20000, minOrder: 150000, endAt: '2026-12-31T00:00:00.000Z' };

let mounted: Rendered[] = [];
/** Mở trang ở URL `?search` (bỏ trống = Săn mã mặc định). */
const mount = async (search = '') => {
  state.search = search;
  const r = render(<OffersPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
// Khối có tên: `aria-label` thẳng, hoặc `aria-labelledby` trỏ vào tiêu đề của khối.
const region = (c: HTMLElement, name: string) =>
  Array.from(c.querySelectorAll<HTMLElement>('section')).find((sec) => {
    const labelledBy = sec.getAttribute('aria-labelledby');
    const label = sec.getAttribute('aria-label') ?? (labelledBy ? sec.ownerDocument.getElementById(labelledBy)?.textContent : null);
    return label === name;
  }) ?? null;
const tabs = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="tab"]'));
const panel = (c: HTMLElement) => c.querySelector<HTMLElement>('[role="tabpanel"]')!;
const openTab = async (c: HTMLElement, label: string) => {
  click(tabs(c).find((t) => t.textContent === label)!);
  await flush(8);
};
const inOrder = (blocks: (Element | null)[]) => {
  blocks.forEach((b, i) => expect(b, `khối ${i}`).not.toBeNull());
  for (let i = 1; i < blocks.length; i++) {
    expect(blocks[i - 1]!.compareDocumentPosition(blocks[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `khối ${i}`).toBeTruthy();
  }
};

const FLASH_ITEM = {
  itemId: 'f1', variationId: 'v1', productSlug: 'nuoc-rua-chen', productName: 'Nước rửa chén', thumbnail: null,
  retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 2, endAt: new Date(Date.now() + 3_600_000).toISOString(),
};
const OPEN_CODE = {
  code: 'NHAN10', title: null, type: 'AMOUNT', value: 10000, minOrder: null, maxDiscount: null,
  startAt: '2026-10-01T00:00:00.000Z', endAt: '2099-12-31T00:00:00.000Z', newCustomerOnly: false, claimedCount: 0, usageLimit: null,
};

beforeEach(() => {
  state.phase = 'authenticated';
  state.push.mockReset();
  state.back.mockReset();
  state.replace.mockReset();
  state.replace.mockImplementation((href: string) => {
    state.search = href.split('?')[1] ?? '';
    state.listeners.forEach((l) => l());
  });
  state.search = '';
  state.loyalty = { tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0, tiers: TIERS, nextTier: { ...TIERS[1], pointsToGo: 80, spendingToGo: null }, totalSpent: 0 };
  state.coupons = [COUPON];
  state.checkIn = { checkedInToday: false, streakDays: 2, currentCycleDay: 3, rewards: REWARDS };
  state.config = { waste: { enabled: true } };
  state.fail = new Set();
  state.calls = [];
  state.posts = [];
  state.campaigns = [];
  state.campaignQueries = [];
  state.collectable = [];
  state.flash = [];
  state.use.mockReset();
  state.usingCode = null;
  state.getHold = new Map();
  state.postHold = null;
  resetFlashSales();
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/uu-dai — khung trang và thanh tab', () => {
  it('ba tab đúng nhãn và thứ tự, mặc định Săn mã; dải tab có tên, vùng nội dung mang tên tab đang mở; đúng một h1', async () => {
    const c = await mount();
    expect(c.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Các mục Ưu đãi');
    expect(tabs(c).map((t) => t.textContent)).toEqual(['Săn mã', 'Mã của tôi', 'Đổi quà']);
    expect(tabs(c).map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(panel(c).getAttribute('aria-label')).toBe('Săn mã');
    expect(c.querySelectorAll('h1')).toHaveLength(1);
    expect(c.querySelector('h1')!.textContent).toBe('Ưu đãi');
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });

  it('khung trang rộng (PAGE_WIDE, không khung hẹp Tài khoản); tiêu đề là con trực tiếp của main', async () => {
    const c = await mount();
    const main = c.querySelector('main')!;
    expect(main.className).toContain('max-w-frame');
    expect(main.className).not.toContain('max-w-3xl');
    expect(main.querySelector(':scope > header h1')!.textContent).toBe('Ưu đãi');
  });

  it('đổi tab ghi URL bằng replace (không scroll, không push); Săn mã là tab mặc định nên không kèm tham số; bấm tab đang mở thì không làm gì', async () => {
    const c = await mount();
    await openTab(c, 'Mã của tôi');
    expect(state.replace).toHaveBeenLastCalledWith('/uu-dai?tab=wallet', { scroll: false });
    expect(panel(c).getAttribute('aria-label')).toBe('Mã của tôi');
    expect(tabs(c).map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    await openTab(c, 'Đổi quà');
    expect(state.replace).toHaveBeenLastCalledWith('/uu-dai?tab=rewards', { scroll: false });
    await openTab(c, 'Săn mã');
    expect(state.replace).toHaveBeenLastCalledWith('/uu-dai', { scroll: false });
    expect(state.replace).toHaveBeenCalledTimes(3);
    await openTab(c, 'Săn mã');
    expect(state.replace).toHaveBeenCalledTimes(3);
    expect(state.push).not.toHaveBeenCalled();
    // Về đầu trang mỗi lần đổi tab: nội dung mới ngắn hơn có thể kẹp vị trí cuộn về giữa trang.
    expect(window.scrollTo).toHaveBeenCalledTimes(3);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  it('?tab= hợp lệ mở đúng tab; link cũ ?section=coupons mở Mã của tôi; tab lạ về Săn mã; ?tab thắng ?section', async () => {
    const selected = (c: HTMLElement) => tabs(c).find((t) => t.getAttribute('aria-selected') === 'true')!.textContent;
    const open = async (search: string) => {
      mounted.pop()?.unmount();
      return selected(await mount(search));
    };
    expect(await open('tab=wallet')).toBe('Mã của tôi');
    expect(await open('tab=rewards')).toBe('Đổi quà');
    expect(await open('section=coupons')).toBe('Mã của tôi');
    expect(await open('tab=khong-co')).toBe('Săn mã');
    expect(await open('tab=deals&section=coupons')).toBe('Săn mã');
  });

  it('mỗi tab chỉ hiện khối của nó', async () => {
    state.flash = [FLASH_ITEM];
    state.collectable = [OPEN_CODE];
    const c = await mount();
    expect(region(c, 'Giờ vàng hôm nay')).not.toBeNull();
    expect(region(c, 'Mã của tôi')).toBeNull();
    expect(c.querySelector('[data-testid="rewards-view"]')).toBeNull();
    await openTab(c, 'Mã của tôi');
    expect(region(c, 'Mã của tôi')).not.toBeNull();
    expect(region(c, 'Giờ vàng hôm nay')).toBeNull();
    expect(region(c, 'Nhận mã')).toBeNull();
    expect(c.querySelector('[data-testid="rewards-view"]')).toBeNull();
    await openTab(c, 'Đổi quà');
    expect(c.querySelector('[data-testid="rewards-view"]')).not.toBeNull();
    expect(region(c, 'Mã của tôi')).toBeNull();
    expect(region(c, 'Giờ vàng hôm nay')).toBeNull();
  });
});

describe('/uu-dai — tab Săn mã', () => {
  it('khách đã đăng nhập: thứ tự Banner, Giờ vàng, Nhận mã, Điểm Xanh, dải điểm danh, Tiện ích; không còn thẻ Điểm danh đầy đủ, không ví mã, không Kho quà', async () => {
    state.campaigns = [campaign('a')];
    state.flash = [FLASH_ITEM];
    state.collectable = [OPEN_CODE];
    const c = await mount();
    inOrder([
      c.querySelector('[data-offers-banner]'),
      region(c, 'Giờ vàng hôm nay'),
      region(c, 'Nhận mã'),
      region(c, 'Điểm Xanh của bạn'),
      region(c, 'Hôm nay bạn chưa điểm danh'),
      region(c, 'Tiện ích'),
    ]);
    expect(region(c, 'Điểm danh mỗi ngày')).toBeNull();
    expect(c.querySelector('[data-testid="daily-check-in"]')).toBeNull();
    expect(region(c, 'Mã của tôi')).toBeNull();
    expect(c.querySelector('[data-testid="rewards-view"]')).toBeNull();
    expect(state.posts).toEqual([]);
  });

  it('từ lg: hàng Điểm Xanh | dải điểm danh hai cột', async () => {
    const c = await mount();
    const row = c.querySelector('[data-testid="offers-points-row"]')!;
    expect(row.className).toContain('lg:grid-cols-2');
    expect(row.contains(region(c, 'Điểm Xanh của bạn'))).toBe(true);
    expect(row.contains(region(c, 'Hôm nay bạn chưa điểm danh'))).toBe(true);
  });

  it('đang trong hạn giữ hạng: dòng giữ hạng, không vẽ thanh tiến độ lên hạng kế', async () => {
    state.loyalty = { ...(state.loyalty as object), tierGrace: { until: '2026-11-07T00:00:00.000Z', spendingToKeep: 400_000, pointsToKeep: 30_000 } };
    const c = await mount();
    const card = region(c, 'Điểm Xanh của bạn')!;
    expect(card.textContent).toContain('Giữ hạng Mầm Xanh: đơn giao thành công thêm 400.000đ trước 07/11/2026');
    expect(card.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('không trong hạn giữ hạng: vẫn có thanh tiến độ lên hạng kế', async () => {
    const c = await mount();
    expect(region(c, 'Điểm Xanh của bạn')!.querySelector('[role="progressbar"][aria-label="Tiến độ lên hạng kế"]')).not.toBeNull();
  });

  it('thẻ Điểm Xanh mở trang hạng và lịch sử điểm', async () => {
    const c = await mount();
    await flush(6);
    click(c.querySelector('button[aria-label*="Hạng và lịch sử điểm"]'));
    expect(state.push).toHaveBeenCalledWith('/tai-khoan/diem-xanh');
  });

  it('dải điểm danh: chưa điểm danh thì báo "chưa", phụ đề mở tab Vườn Xanh; bấm sang /vuon-xanh bằng replace (tab gốc kế bên), không POST điểm danh', async () => {
    const c = await mount();
    const strip = region(c, 'Hôm nay bạn chưa điểm danh')!;
    expect(strip.textContent).toContain('Hôm nay bạn chưa điểm danh');
    expect(strip.textContent).toContain('Mở tab Vườn Xanh');
    click(byText(strip, '[role="button"]', /Hôm nay bạn chưa điểm danh/));
    expect(state.replace).toHaveBeenCalledWith('/vuon-xanh');
    expect(state.push).not.toHaveBeenCalled();
    expect(state.posts).toEqual([]);
  });

  it('dải điểm danh: đã điểm danh hôm nay thì báo "đã"', async () => {
    state.checkIn = { checkedInToday: true, streakDays: 3, currentCycleDay: 3, rewards: REWARDS };
    const c = await mount();
    expect(region(c, 'Hôm nay bạn đã điểm danh')!.textContent).toContain('Mở tab Vườn Xanh');
    expect(region(c, 'Hôm nay bạn chưa điểm danh')).toBeNull();
  });

  it('lịch điểm danh lỗi: không vẽ dải (không báo lỗi, không nhảy trang), các khối khác vẫn hiện', async () => {
    state.fail.add('/me/daily-check-in');
    const c = await mount();
    expect(region(c, 'Hôm nay bạn chưa điểm danh')).toBeNull();
    expect(region(c, 'Hôm nay bạn đã điểm danh')).toBeNull();
    expect(c.textContent).not.toContain('Máy chủ đang bận');
    expect(region(c, 'Điểm Xanh của bạn')).not.toBeNull();
    expect(region(c, 'Tiện ích')).not.toBeNull();
  });

  it('tiện ích: Mua chung nhóm mở /mua-chung; không còn Vườn Xanh, Đổi rác, Kho quà ở tab này', async () => {
    const c = await mount();
    const utilities = region(c, 'Tiện ích')!;
    click(byText(utilities, '[role="button"]', 'Mua chung nhóm'));
    expect(state.push).toHaveBeenLastCalledWith('/mua-chung');
    for (const label of ['Vườn Xanh', 'Đổi rác lấy quà', 'Kho quà', 'Quà của tôi', 'Tích điểm đơn sàn']) expect(utilities.textContent, label).not.toContain(label);
  });

  it('Tích điểm đơn sàn: cờ bật thì có dòng sau Mua chung, bấm mở thông báo chỉ Mini App, không điều hướng; cờ tắt thì không có', async () => {
    state.config = { waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } };
    const c = await mount();
    const utilities = region(c, 'Tiện ích')!;
    const titles = Array.from(utilities.querySelectorAll('[role="button"], button')).map((b) => b.textContent ?? '');
    const claim = titles.findIndex((t) => t.includes('Tích điểm đơn sàn'));
    expect(claim).toBeGreaterThan(titles.findIndex((t) => t.includes('Mua chung nhóm')));
    expect(utilities.textContent).toContain('Quét mã trên phiếu giao hàng');
    expect(utilities.textContent).not.toContain('cần mở Tubu Tree trên Zalo');
    click(byText(utilities, '[role="button"], button', 'Tích điểm đơn sàn'));
    await flush(2);
    expect(utilities.textContent).toContain('cần mở Tubu Tree trên Zalo');
    expect(state.push).not.toHaveBeenCalled();
    mounted.pop()!.unmount();
    state.config = { waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: false } };
    expect(region(await mount(), 'Tiện ích')!.textContent).not.toContain('Tích điểm đơn sàn');
  });

  it('Nhận mã: khách đã đăng nhập không thấy mã đã có trong ví', async () => {
    state.collectable = [{ ...OPEN_CODE, code: 'WELCOME20' }, OPEN_CODE];
    const c = await mount();
    const collect = region(c, 'Nhận mã')!;
    expect(collect.querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(collect.textContent).toContain('NHAN10');
  });

  it('khách chưa đăng nhập: Giờ vàng, Nhận mã, rồi MỘT thẻ mời "Đăng nhập"; không có ví mã, Kho quà, Tiện ích; không gọi API riêng của khách', async () => {
    state.phase = 'guest';
    state.flash = [FLASH_ITEM];
    state.collectable = [OPEN_CODE];
    state.config = { waste: { enabled: true } };
    const c = await mount();
    inOrder([region(c, 'Giờ vàng hôm nay'), region(c, 'Nhận mã'), region(c, 'Điểm Xanh và điểm danh')]);
    const logins = Array.from(c.querySelectorAll<HTMLAnchorElement>('a[href^="/dang-nhap"]'));
    expect(logins.map((a) => a.textContent)).toEqual(['Đăng nhập']);
    expect(logins[0]!.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fuu-dai');
    expect(region(c, 'Mã của tôi')).toBeNull();
    expect(c.querySelector('[data-testid="rewards-view"]')).toBeNull();
    expect(region(c, 'Hôm nay bạn chưa điểm danh')).toBeNull();
    expect(c.textContent).not.toContain('Đăng nhập để xem ưu đãi');
    expect(c.textContent).not.toContain('Đăng nhập với Zalo');
    expect(state.calls.filter((p) => !['/config/public', '/campaigns', '/flash-sales/active', '/coupons/collectable'].includes(p))).toEqual([]);
  });

  it('khách chưa đăng nhập: tiện ích Mua chung vẫn hiện', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(region(c, 'Tiện ích')!.textContent).toContain('Mua chung nhóm');
  });

  it('thẻ mời của khách: tiêu đề dưới 22px dùng Inter, không Fraunces (Q1)', async () => {
    state.phase = 'guest';
    const c = await mount();
    const h = region(c, 'Điểm Xanh và điểm danh')!.querySelector<HTMLElement>('h2')!;
    expect(h.style.fontFamily).toContain('--font-ui');
    expect(h.style.fontFamily).not.toContain('--font-display');
  });

  it('khách chưa đăng nhập bấm "Lưu mã": đi tới đăng nhập kèm returnTo=/uu-dai, không gọi POST claim', async () => {
    state.phase = 'guest';
    state.collectable = [OPEN_CODE];
    const c = await mount();
    click(byText(region(c, 'Nhận mã')!, 'button', 'Lưu mã'));
    await flush(2);
    expect(state.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fuu-dai');
    expect(state.posts).toEqual([]);
  });

  it('phiên chưa khôi phục: khối công khai vẫn vẽ, phần còn lại là khung chờ (không mời đăng nhập vội)', async () => {
    state.phase = 'loading';
    state.collectable = [OPEN_CODE];
    const c = await mount();
    expect(c.querySelector('a[href^="/dang-nhap"]')).toBeNull();
    expect(c.querySelector('[data-testid="offers-page-loading"]')).not.toBeNull();
    expect(region(c, 'Tiện ích')).toBeNull();
  });

  it('phiên mất mạng (unavailable): nói mất kết nối, không mời đăng nhập', async () => {
    state.phase = 'unavailable';
    const c = await mount();
    expect(c.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(c.querySelector('a[href^="/dang-nhap"]')).toBeNull();
  });
});

describe('/uu-dai — tab Mã của tôi', () => {
  it('ví mã: thẻ phiếu có nhãn, điều kiện, hạn dùng; một phiếu thì không có số mã thừa', async () => {
    const c = await mount('tab=wallet');
    const mine = region(c, 'Mã của tôi')!;
    expect(mine.textContent).toContain('Giảm 20k');
    expect(mine.textContent).not.toMatch(/\b1 mã/);
    expect(mine.querySelector('[data-testid="voucher-meta"]')!.textContent).toContain('Đơn từ 150k');
    expect(panel(c).getAttribute('aria-label')).toBe('Mã của tôi');
  });

  it('hiện ĐỦ mã trong ví, không giới hạn 3, không có nút "Tất cả"', async () => {
    state.coupons = Array.from({ length: 8 }, (_, i) => ({ ...COUPON, code: `MA-${i}`, value: 10_000 * (i + 1) }));
    const c = await mount('tab=wallet');
    const mine = region(c, 'Mã của tôi')!;
    expect(mine.querySelectorAll('[role="group"]')).toHaveLength(8);
    expect(mine.querySelector('button[aria-label*="ất cả"]')).toBeNull();
  });

  it('lưới từ md hai cột, từ lg ba cột', async () => {
    const c = await mount('tab=wallet');
    const grid = c.querySelector('[data-testid="offers-mine-grid"]')!;
    expect(grid.className).toContain('md:grid-cols-2');
    expect(grid.className).toContain('lg:grid-cols-3');
  });

  it('mỗi phiếu có nút "Dùng ngay" gọi use đúng mã', async () => {
    const c = await mount('tab=wallet');
    click(byText(region(c, 'Mã của tôi')!, 'button', 'Dùng ngay'));
    expect(state.use).toHaveBeenCalledWith('WELCOME20');
  });

  it('ví rỗng: câu hướng dẫn và nút "Nhận thêm mã" chuyển sang tab Săn mã', async () => {
    state.coupons = [];
    const c = await mount('tab=wallet');
    const mine = region(c, 'Mã của tôi')!;
    expect(mine.textContent).toContain('Chưa có mã giảm giá khả dụng');
    click(byText(mine, 'button', 'Nhận thêm mã'));
    await flush(8);
    expect(state.replace).toHaveBeenLastCalledWith('/uu-dai', { scroll: false });
    expect(panel(c).getAttribute('aria-label')).toBe('Săn mã');
  });

  it('cuối ví có hàng "Mã đã dùng, hết hạn" mở lịch sử ở trang Mã giảm giá', async () => {
    const c = await mount('tab=wallet');
    click(byText(panel(c), '[role="button"]', 'Mã đã dùng, hết hạn'));
    expect(state.push).toHaveBeenLastCalledWith('/ma-giam-gia?tab=history');
  });

  it('hàng lịch sử vẫn có khi ví rỗng', async () => {
    state.coupons = [];
    const c = await mount('tab=wallet');
    expect(byText(panel(c), '[role="button"]', 'Mã đã dùng, hết hạn')).not.toBeNull();
  });

  it('chấm đỏ: mở tab ví là thấy cả 4 mã sắp hết hạn nên cả 4 vào danh sách đã xem; mở tab Săn mã thì chưa ghi gì', async () => {
    state.coupons = [0, 1, 2, 3].map((i) => ({ ...COUPON, code: `SOON-${i}`, endAt: new Date(Date.now() + (i + 1) * 3_600_000).toISOString() }));
    const c = await mount();
    expect(localStorage.getItem('tubu_offers_seen_coupons')).toBeNull();
    await openTab(c, 'Mã của tôi');
    expect(region(c, 'Mã của tôi')!.querySelectorAll('[role="group"]')).toHaveLength(4);
    const seen = JSON.parse(localStorage.getItem('tubu_offers_seen_coupons')!) as { items: string[] };
    expect(seen.items.map((k) => k.split('@')[0]).sort()).toEqual(['SOON-0', 'SOON-1', 'SOON-2', 'SOON-3']);
  });

  it('Mã của tôi lỗi: thông báo có lý do và nút Thử lại', async () => {
    state.fail.add('/me/coupons');
    const c = await mount('tab=wallet');
    expect(region(c, 'Mã của tôi')!.textContent).toContain('Chưa tải được mã giảm giáMáy chủ đang bận');
    expect(byText(region(c, 'Mã của tôi')!, 'button', 'Thử lại')).not.toBeNull();
  });

  it('làm mới nền lỗi khi đã có mã: giữ nguyên các thẻ mã đang hiện, không thay bằng khối lỗi', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    state.search = 'tab=wallet';
    const r = render(<OffersPage />, client);
    mounted.push(r);
    await flush(8);
    const mine = () => region(r.container, 'Mã của tôi')!;
    expect(mine().querySelectorAll('[role="group"]')).toHaveLength(1);
    state.fail.add('/me/coupons');
    await act(async () => {
      await client.refetchQueries({ queryKey: couponsQuery(coreHttp).queryKey });
    });
    await flush(4);
    expect(client.getQueryState(couponsQuery(coreHttp).queryKey)?.status).toBe('error');
    expect(mine().querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(byText(mine(), 'button', 'Thử lại')).toBeNull();
    expect(mine().querySelector('[role="alert"]')).toBeNull();
  });

  it('khách chưa đăng nhập: một thẻ mời "Đăng nhập" ở chỗ ví mã, không gọi API ví', async () => {
    state.phase = 'guest';
    const c = await mount('tab=wallet');
    const card = region(c, 'Mã của tôi')!;
    expect(card.textContent).toContain('Đăng nhập để xem mã bạn đã lưu');
    const login = card.querySelector<HTMLAnchorElement>('a[href^="/dang-nhap"]')!;
    expect(login.textContent).toBe('Đăng nhập');
    expect(login.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fuu-dai');
    expect(state.calls).not.toContain('/me/coupons');
    expect(byText(panel(c), '[role="button"]', 'Mã đã dùng, hết hạn')).toBeNull();
  });

  it('phiên chưa khôi phục: khung chờ, không mời đăng nhập; phiên mất mạng: nói mất kết nối', async () => {
    state.phase = 'loading';
    let c = await mount('tab=wallet');
    expect(c.querySelector('[data-testid="offers-page-loading"]')).not.toBeNull();
    expect(c.querySelector('a[href^="/dang-nhap"]')).toBeNull();
    mounted.pop()!.unmount();
    state.phase = 'unavailable';
    c = await mount('tab=wallet');
    expect(c.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(region(c, 'Mã của tôi')).toBeNull();
  });
});

describe('/uu-dai — tab Đổi quà', () => {
  it('mở tab Đổi quà vẽ Kho quà trong vùng nội dung có tên "Đổi quà"; quay lại Săn mã thì Kho quà biến mất', async () => {
    const c = await mount();
    await openTab(c, 'Đổi quà');
    expect(panel(c).getAttribute('aria-label')).toBe('Đổi quà');
    expect(panel(c).querySelector('[data-testid="rewards-view"]')).not.toBeNull();
    await openTab(c, 'Săn mã');
    expect(c.querySelector('[data-testid="rewards-view"]')).toBeNull();
  });

  it('khách đã đăng nhập: Kho quà, rồi thẻ Điểm Xanh (hạng, lịch sử điểm) và Đổi rác lấy quà', async () => {
    const c = await mount('tab=rewards');
    const points = region(c, 'Điểm Xanh của bạn')!;
    inOrder([c.querySelector('[data-testid="rewards-view"]'), points]);
    expect(points.textContent).toContain(homeCopy.offers.pointsDetail);
    click(byText(points, '[role="button"]', homeCopy.offers.pointsTitle));
    expect(state.push).toHaveBeenLastCalledWith('/tai-khoan/diem-xanh');
    click(byText(points, '[role="button"]', 'Đổi rác lấy quà'));
    expect(state.push).toHaveBeenLastCalledWith('/doi-rac');
    expect(points.textContent).toContain(homeCopy.offers.recycleHint);
  });

  it('cờ Đổi rác tắt và không còn yêu cầu mở: ẩn dòng Đổi rác, thẻ Điểm Xanh vẫn có', async () => {
    state.config = { waste: { enabled: false } };
    const c = await mount('tab=rewards');
    const points = region(c, 'Điểm Xanh của bạn')!;
    expect(points.textContent).not.toContain('Đổi rác lấy quà');
    expect(byText(points, '[role="button"]', homeCopy.offers.pointsTitle)).not.toBeNull();
  });

  it('không còn lối tắt Mua chung, Vườn Xanh, Tích điểm đơn sàn ở tab này', async () => {
    state.config = { waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } };
    const c = await mount('tab=rewards');
    for (const label of ['Mua chung nhóm', 'Vườn Xanh', 'Tích điểm đơn sàn']) expect(panel(c).textContent, label).not.toContain(label);
  });

  it('khách chưa đăng nhập: vẫn xem được Kho quà (khối tự xử lý khách), không có thẻ Điểm Xanh và Đổi rác', async () => {
    state.phase = 'guest';
    const c = await mount('tab=rewards');
    expect(c.querySelector('[data-testid="rewards-view"]')).not.toBeNull();
    expect(region(c, 'Điểm Xanh của bạn')).toBeNull();
    expect(c.textContent).not.toContain('Đổi rác lấy quà');
  });
});

const campaign = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: `chien-dich-${id}`,
  title: `Chiến dịch ${id}`,
  image: `https://img.test/${id}.jpg`,
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  audience: 'ALL',
  startAt: '2020-01-01T00:00:00Z',
  endAt: '2099-01-01T00:00:00Z',
  ...over,
});

describe('/uu-dai — banner đầu tab Săn mã (OFFERS_TOP)', () => {
  const links = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLAnchorElement>('[data-offers-banner] a[href]')).map((a) => a.getAttribute('href'));

  it('có chiến dịch: một khối banner ngay dưới thanh tab, xin placement=OFFERS_TOP không đăng nhập, bấm sang /chien-dich/[slug]', async () => {
    state.campaigns = [campaign('a')];
    const c = await mount();
    expect(state.campaignQueries).toEqual([{ query: { placement: 'OFFERS_TOP' }, anonymous: true }]);
    expect(links(c)).toEqual(['/chien-dich/chien-dich-a']);
    const banner = c.querySelector('[data-offers-banner]')!;
    expect(c.querySelector('h1')!.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(c.querySelector('[role="tablist"]')!.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.compareDocumentPosition(region(c, 'Điểm Xanh của bạn')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('chỉ có ở tab Săn mã: sang tab khác thì banner biến mất', async () => {
    state.campaigns = [campaign('a')];
    const c = await mount();
    expect(c.querySelector('[data-offers-banner]')).not.toBeNull();
    await openTab(c, 'Mã của tôi');
    expect(c.querySelector('[data-offers-banner]')).toBeNull();
  });

  it('khách chưa đăng nhập cũng thấy banner (công khai), kèm lời mời đăng nhập bên dưới', async () => {
    state.phase = 'guest';
    state.campaigns = [campaign('a')];
    const c = await mount();
    expect(links(c)).toEqual(['/chien-dich/chien-dich-a']);
    expect(c.querySelector('a[href^="/dang-nhap"]')).not.toBeNull();
  });

  it('lần trước có banner Ưu đãi và đang tải: giữ chỗ bằng khung chờ, là khối đầu tiên của tab', async () => {
    localStorage.setItem('tubu_offers_banner', '1');
    state.campaigns = [campaign('a')];
    state.flash = [FLASH_ITEM];
    // Ngay lượt vẽ đầu (banner còn đang tải) khung chờ phải có mặt và là khối đầu tiên trong vùng nội dung; banner về thì khung biến mất mà Giờ vàng vẫn còn.
    state.search = '';
    const r = render(<OffersPage />);
    mounted.push(r);
    const frame = r.container.querySelector('[data-testid="offers-banner-loading"]');
    expect(frame).not.toBeNull();
    expect(frame!.parentElement!.firstElementChild).toBe(frame);
    await flush(8);
    expect(r.container.querySelector('[data-testid="offers-banner-loading"]')).toBeNull();
    expect(region(r.container, 'Giờ vàng hôm nay')).not.toBeNull();
  });

  it('không có chiến dịch: ẩn hẳn, không khối rỗng', async () => {
    const c = await mount();
    expect(c.querySelector('[data-offers-banner]')).toBeNull();
  });

  it('/campaigns lỗi: ẩn hẳn, không báo lỗi, phần còn lại của tab vẫn đủ', async () => {
    state.fail = new Set(['/campaigns']);
    const c = await mount();
    expect(c.querySelector('[data-offers-banner]')).toBeNull();
    expect(c.textContent).not.toContain('Máy chủ đang bận');
    expect(region(c, 'Điểm Xanh của bạn')).not.toBeNull();
  });

  it('theo loại khách đã nhớ trên máy: khách cũ thấy chiến dịch RETURNING, không thấy NEW; khách chưa nhớ loại chỉ thấy chiến dịch cho mọi người', async () => {
    state.campaigns = [campaign('all'), campaign('moi', { audience: 'NEW' }), campaign('cu', { audience: 'RETURNING' })];
    localStorage.setItem('tubu_home_kind', JSON.stringify({ userId: 'u1', kind: 'returning' }));
    expect(links(await mount())).toEqual(['/chien-dich/chien-dich-all', '/chien-dich/chien-dich-cu']);
    mounted.forEach((m) => m.unmount());
    mounted = [];
    localStorage.clear();
    expect(links(await mount())).toEqual(['/chien-dich/chien-dich-all']);
  });
});

describe('/uu-dai — khoá chạm đúp', () => {
  const gate = () => {
    let open!: () => void;
    const p = new Promise<void>((r) => (open = r));
    return { p, open };
  };
  const tapTogether = async (...els: HTMLElement[]) => {
    await act(async () => {
      for (const e of els) e.click();
    });
  };
  const gets = (path: string) => state.calls.filter((p) => p === path);

  it('"Lưu mã": hai cú chạm cùng khung hình chỉ POST claim một lần; nút của mã báo bận, mã khác chỉ aria-disabled, không nút nào disabled', async () => {
    state.collectable = [OPEN_CODE, { ...OPEN_CODE, code: 'NHAN20' }];
    const g = gate();
    state.postHold = g.p;
    const c = await mount();
    const saves = Array.from(region(c, 'Nhận mã')!.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === 'Lưu mã');
    expect(saves).toHaveLength(2);
    await tapTogether(saves[0]!, saves[0]!);
    await flush();
    expect(state.posts.filter((p) => p === '/coupons/claim')).toHaveLength(1);
    expect(saves[0]!.getAttribute('aria-busy')).toBe('true');
    expect(saves[0]!.getAttribute('aria-disabled')).toBe('true');
    expect(saves[1]!.getAttribute('aria-busy')).toBeNull();
    expect(saves[1]!.getAttribute('aria-disabled')).toBe('true');
    expect(saves.every((b) => !b.disabled)).toBe(true);
    // Mã khác chạm lúc một mã đang lưu bị bỏ qua (khoá chung của kho mã).
    await tapTogether(saves[1]!);
    expect(state.posts.filter((p) => p === '/coupons/claim')).toHaveLength(1);
    g.open();
    await flush(8);
    expect(state.posts.filter((p) => p === '/coupons/claim')).toHaveLength(1);
  });

  it('"Dùng ngay" đang chạy: nút của mã đó báo bận, nút mã khác aria-disabled, chạm không gọi use lần hai', async () => {
    state.coupons = [COUPON, { ...COUPON, id: 'c2', code: 'FREESHIP' }];
    state.usingCode = 'WELCOME20';
    const c = await mount('tab=wallet');
    const uses = Array.from(region(c, 'Mã của tôi')!.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === 'Dùng ngay');
    expect(uses).toHaveLength(2);
    expect(uses[0]!.getAttribute('aria-busy')).toBe('true');
    expect(uses[0]!.getAttribute('aria-disabled')).toBe('true');
    expect(uses[1]!.getAttribute('aria-busy')).toBeNull();
    expect(uses[1]!.getAttribute('aria-disabled')).toBe('true');
    expect(uses.every((b) => !b.disabled)).toBe(true);
    await tapTogether(uses[0]!, uses[1]!);
    expect(state.use).not.toHaveBeenCalled();
  });

  it('"Dùng ngay" rảnh: bấm gọi use đúng mã, nút không báo bận', async () => {
    const c = await mount('tab=wallet');
    const use = byText(region(c, 'Mã của tôi')!, 'button', 'Dùng ngay') as HTMLButtonElement;
    expect(use.getAttribute('aria-busy')).toBeNull();
    expect(use.getAttribute('aria-disabled')).toBeNull();
    click(use);
    expect(state.use).toHaveBeenCalledWith('WELCOME20');
  });

  it('Mã của tôi lỗi tải: role="alert", Thử lại chạm đúp cùng khung hình chỉ tải lại một lần', async () => {
    state.fail.add('/me/coupons');
    const c = await mount('tab=wallet');
    const mine = region(c, 'Mã của tôi')!;
    expect(mine.querySelector('[role="alert"]')).not.toBeNull();
    const before = gets('/me/coupons').length;
    state.fail.delete('/me/coupons');
    const g = gate();
    state.getHold.set('/me/coupons', g.p);
    const retry = byText(mine, 'button', 'Thử lại') as HTMLButtonElement;
    await tapTogether(retry, retry);
    await flush();
    expect(gets('/me/coupons')).toHaveLength(before + 1);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    expect(retry.disabled).toBe(false);
    g.open();
    await flush(8);
    expect(gets('/me/coupons')).toHaveLength(before + 1);
  });

  it('dải Điểm Xanh lỗi tải: Thử lại chạm đúp cùng khung hình chỉ tải lại một lần, báo bận không disabled', async () => {
    state.fail.add('/me/loyalty');
    const c = await mount();
    const strip = region(c, 'Điểm Xanh của bạn')!;
    const before = gets('/me/loyalty').length;
    state.fail.delete('/me/loyalty');
    const g = gate();
    state.getHold.set('/me/loyalty', g.p);
    const retry = byText(strip, 'button', homeCopy.member.retry) as HTMLButtonElement;
    await tapTogether(retry, retry);
    await flush();
    expect(gets('/me/loyalty')).toHaveLength(before + 1);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    expect(retry.disabled).toBe(false);
    g.open();
    await flush(8);
    expect(gets('/me/loyalty')).toHaveLength(before + 1);
  });
});
