// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';

// Chép ý pages/offers.spec của Mini App: thẻ Điểm Xanh, Điểm danh, lối tắt theo cờ, Mã giảm giá (rỗng, lỗi, cuộn), khách chưa đăng nhập.
const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  push: vi.fn(),
  search: '' as string,
  loyalty: null as Record<string, unknown> | null,
  coupons: [] as Record<string, unknown>[],
  checkIn: null as Record<string, unknown> | null,
  config: { waste: { enabled: true } } as Record<string, unknown>,
  fail: new Set<string>(),
  calls: [] as string[],
  posts: [] as string[],
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: state.phase === 'authenticated' ? { id: 'u1', pointsBalance: 120, pointsConvertedBalance: 0 } : null, retrySession: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
  useSearchParams: () => new URLSearchParams(state.search),
  usePathname: () => '/uu-dai',
}));
vi.mock('@/lib/core-http', () => {
  const table: Record<string, () => unknown> = {
    '/me/loyalty': () => state.loyalty,
    '/me/coupons': () => state.coupons,
    '/me/daily-check-in': () => state.checkIn,
    '/config/public': () => state.config,
  };
  return {
    coreHttp: {
      get: async (path: string) => {
        state.calls.push(path);
        if (state.fail.has(path)) throw new Error('Máy chủ đang bận');
        const h = table[path];
        if (!h) throw new Error(`đường dẫn lạ ${path}`);
        return h();
      },
      post: async (path: string) => {
        state.posts.push(path);
        return {
          points: { success: true, cycleDay: 3, streakDays: 3, pointsEarned: 3, totalPoints: 30, message: '' },
          water: { seedsEarned: 10, streakDays: 1, totalSeeds: 10, streakFrozeUsed: false, bonusNote: '' },
          alreadyDone: false,
          pending: [],
        };
      },
    },
  };
});

import OffersPage from './page';

const TIERS = [
  { id: 't1', name: 'Mầm Xanh', minPoints: 0, minSpending: 0, multiplier: 1 },
  { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: 4_000_000, multiplier: 1.2 },
];
const REWARDS = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, points: day, claimed: day < 3, isToday: day === 3 }));
const COUPON = { id: 'c1', code: 'WELCOME20', type: 'AMOUNT', value: 20000, minOrder: 150000, endAt: '2026-12-31T00:00:00.000Z' };

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OffersPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const region = (c: HTMLElement, name: string) => c.querySelector<HTMLElement>(`section[aria-label="${name}"]`);

beforeEach(() => {
  state.phase = 'authenticated';
  state.push.mockReset();
  state.search = '';
  state.loyalty = { tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0, tiers: TIERS, nextTier: { ...TIERS[1], pointsToGo: 80, spendingToGo: null }, totalSpent: 0 };
  state.coupons = [COUPON];
  state.checkIn = { checkedInToday: false, streakDays: 2, currentCycleDay: 3, rewards: REWARDS };
  state.config = { waste: { enabled: true } };
  state.fail = new Set();
  state.calls = [];
  state.posts = [];
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/uu-dai — trang Ưu đãi', () => {
  it('Tích điểm đơn sàn: cờ bật thì có dòng sau Đổi rác, bấm mở thông báo chỉ Mini App, không điều hướng; cờ tắt thì không có', async () => {
    state.config = { waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } };
    const c = await mount();
    const shortcuts = region(c, 'Đổi quà')!;
    const titles = Array.from(shortcuts.querySelectorAll('[role="button"], button')).map((b) => b.textContent ?? '');
    const claim = titles.findIndex((t) => t.includes('Tích điểm đơn sàn'));
    expect(claim).toBeGreaterThan(titles.findIndex((t) => t.includes('Đổi rác lấy quà')));
    expect(claim).toBeLessThan(titles.findIndex((t) => t.includes('Mua chung nhóm')));
    expect(shortcuts.textContent).toContain('Quét mã trên phiếu giao hàng');
    expect(shortcuts.textContent).not.toContain('cần mở Tubu Tree trên Zalo');
    click(byText(shortcuts, '[role="button"], button', 'Tích điểm đơn sàn'));
    await flush(2);
    expect(shortcuts.textContent).toContain('cần mở Tubu Tree trên Zalo');
    expect(state.push).not.toHaveBeenCalled();
  });

  it('Tích điểm đơn sàn: cờ tắt thì không có dòng', async () => {
    state.config = { waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: false } };
    const c = await mount();
    expect(region(c, 'Đổi quà')!.textContent).not.toContain('Tích điểm đơn sàn');
  });

  it('khách đã đăng nhập: thẻ Điểm Xanh, Điểm danh, Đổi quà và tiện ích, Mã giảm giá của tôi; đúng một h1', async () => {
    const c = await mount();
    expect(region(c, 'Điểm Xanh của bạn')).not.toBeNull();
    expect(region(c, 'Điểm danh mỗi ngày')).not.toBeNull();
    expect(region(c, 'Đổi quà')).not.toBeNull();
    expect(region(c, 'Mã giảm giá của tôi')).not.toBeNull();
    expect(c.querySelector('h1')!.textContent).toBe('Ưu đãi');
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });

  it('thẻ Điểm Xanh mở trang hạng và lịch sử điểm', async () => {
    const c = await mount();
    await flush(6);
    click(c.querySelector('button[aria-label$="Hạng và lịch sử điểm"]'));
    expect(state.push).toHaveBeenCalledWith('/tai-khoan/diem-xanh');
  });

  it('Điểm danh: chuỗi ngày, bảy ô thưởng; bấm nút gọi POST điểm danh một lần và báo kết quả', async () => {
    const c = await mount();
    const card = region(c, 'Điểm danh mỗi ngày')!;
    expect(card.textContent).toContain('Ngày 3/7');
    expect(card.textContent).toContain('N7');
    click(card.querySelector('button:not([disabled])'));
    click(card.querySelector('button'));
    await flush(6);
    expect(state.posts.filter((p) => p === '/me/daily-check-in')).toHaveLength(1);
    expect(card.textContent).toContain('+3 Điểm Xanh · +10 giọt nước');
  });

  it('đã điểm danh hôm nay: nút khoá', async () => {
    state.checkIn = { checkedInToday: true, streakDays: 3, currentCycleDay: 3, rewards: REWARDS };
    const c = await mount();
    const btn = region(c, 'Điểm danh mỗi ngày')!.querySelector('button')!;
    expect(btn.disabled || btn.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('lịch điểm danh lỗi: dòng báo + Thử lại, các khối khác vẫn hiện', async () => {
    state.fail.add('/me/daily-check-in');
    const c = await mount();
    expect(region(c, 'Điểm danh mỗi ngày')!.textContent).toContain('Chưa tải được lịch điểm danh');
    expect(region(c, 'Mã giảm giá của tôi')!.textContent).toContain('Giảm');
  });

  it('lối tắt dẫn đúng route web; Đổi rác theo cờ; không có "Tích điểm đơn sàn" vì web chưa có trang', async () => {
    const c = await mount();
    const rows = region(c, 'Đổi quà')!;
    for (const [label, to] of [['Đổi quà', '/kho-qua'], ['Quà của tôi', '/kho-qua/cua-toi'], ['Đổi rác lấy quà', '/doi-rac'], ['Mua chung nhóm', '/mua-chung'], ['Vườn Xanh', '/vuon-xanh']] as const) {
      const row = Array.from(rows.querySelectorAll<HTMLElement>('[role="button"]')).find((r) => r.textContent?.includes(label))!;
      expect(row, label).toBeTruthy();
      click(row);
      expect(state.push).toHaveBeenLastCalledWith(to);
    }
    expect(rows.textContent).not.toContain('Tích điểm đơn sàn');
  });

  it('cờ Đổi rác tắt: ẩn dòng Đổi rác', async () => {
    state.config = { waste: { enabled: false } };
    const c = await mount();
    expect(region(c, 'Đổi quà')!.textContent).not.toContain('Đổi rác lấy quà');
  });

  it('Mã giảm giá: có mã thì hiện nhãn, đơn tối thiểu, hạn dùng và số mã; rỗng thì có câu hướng dẫn', async () => {
    let c = await mount();
    const coupons = region(c, 'Mã giảm giá của tôi')!;
    expect(coupons.textContent).toContain('Giảm 20.000đ');
    expect(coupons.textContent).toContain('1 mã');
    expect(coupons.textContent).toContain('đơn từ 150.000đ');
    mounted.pop()!.unmount();
    state.coupons = [];
    c = await mount();
    expect(region(c, 'Mã giảm giá của tôi')!.textContent).toContain('Chưa có mã giảm giá khả dụng');
  });

  it('Mã giảm giá lỗi: thông báo có lý do và nút Thử lại', async () => {
    state.fail.add('/me/coupons');
    const c = await mount();
    expect(region(c, 'Mã giảm giá của tôi')!.textContent).toContain('Chưa tải được mã giảm giáMáy chủ đang bận');
    expect(byText(region(c, 'Mã giảm giá của tôi')!, 'button', 'Thử lại')).not.toBeNull();
  });

  it('?section=coupons cuộn tới danh sách mã sau khi tải xong', async () => {
    state.search = 'section=coupons';
    await mount();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('khách chưa đăng nhập: lời mời đăng nhập, không gọi API riêng tư', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.textContent).toContain('Đăng nhập để xem ưu đãi');
    expect(c.querySelector('a[href^="/dang-nhap"]')).not.toBeNull();
    expect(state.calls.filter((p) => p !== '/config/public')).toEqual([]);
  });
});
