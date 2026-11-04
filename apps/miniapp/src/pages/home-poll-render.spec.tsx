import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  fetchProducts: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPurchasedItems: vi.fn(),
  fetchFlash: vi.fn(),
  unreadCount: vi.fn(),
  coreGet: vi.fn(),
  auth: { status: 'authenticated' as 'authenticated' | 'guest' | 'loading' | 'error', user: { id: 'u1' } as { id: string } | null },
  onRefresh: undefined as undefined | (() => Promise<unknown> | void),
  restore: vi.fn(),
  scrollRestoration: vi.fn(),
  homeRenders: vi.fn(),
}));
// Khôi phục cuộn cần Router; spec này không dựng Router và không kiểm vị trí cuộn.
vi.mock('../hooks/use-scroll-restoration', () => ({ useScrollRestoration: (...a: unknown[]) => { mocks.scrollRestoration(...a); return { anchorRef: { current: null } }; } }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/shop-api', () => ({
  fetchProducts: mocks.fetchProducts,
  fetchCategories: mocks.fetchCategories,
  fetchPurchasedItems: mocks.fetchPurchasedItems,
  fetchActiveFlashSales: mocks.fetchFlash,
  fetchUpcomingFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn(),
}));
// Chuông chỉ đếm: một lời gọi /me/summary (chung với thanh đáy), không tải danh sách tin (/me/notifications).
vi.mock('../services/core-http', () => ({
  coreHttp: {
    get: (path: string) => {
      mocks.coreGet(path);
      if (path === '/me/summary') {
        return Promise.resolve(mocks.unreadCount()).then(({ count }: { count: number }) => ({
          orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0, active: 0 },
          unreadNotifications: count,
          activeSubscriptions: 0,
        }));
      }
      if (path === '/campaigns' || path === '/bundles/combos') return Promise.resolve([]);
      return Promise.reject(new Error(`không mock ${path}`));
    },
  },
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: { id: string } | null; restore: () => void }) => unknown) => sel({ status: mocks.auth.status, user: mocks.auth.user, restore: mocks.restore }),
}));
// Mỗi khối mới đã có test riêng; ở đây chỉ kiểm thứ tự, khối lỗi/khung chờ của Bán chạy và hành vi cấp trang.
vi.mock('../components/flash-sale', () => ({ FlashSale: () => null, UpcomingFlashSales: () => null }));
// Kệ Mua lại echo tập loại trừ Home truyền xuống (`data-excluded`) để test thấy Home có nối `flashVariationIds` vào kệ; phép lọc của kệ có test riêng.
vi.mock('../components/reorder/purchased-rail', () => ({
  PURCHASED_RAIL_LIMIT: 10,
  PurchasedRail: ({ excludeVariations }: { excludeVariations?: ReadonlySet<string> }) => <section aria-label="Mua lại" data-excluded={[...(excludeVariations ?? [])].sort().join(',')} />,
}));
vi.mock('../components/home/member-card', () => ({
  MemberCard: () => <section aria-label="Thẻ thành viên" />,
  MemberCardSkeleton: () => <div data-testid="member-card-loading" />,
  MemberCardUnavailable: ({ onRetry }: { onRetry: () => void }) => <button data-testid="member-card-unavailable" onClick={onRetry}>Thử lại</button>,
}));
vi.mock('../components/home/todo-strip', () => ({ TodoStrip: () => null, useHomeTodoQueries: () => ({ loading: false }) }));
vi.mock('../components/home/shortcut-grid', () => ({ ShortcutGrid: () => <section aria-label="Lối tắt" /> }));
vi.mock('../components/home/brand-journey', () => ({ BrandJourney: () => null }));
vi.mock('../components/home/community-preview', () => ({ CommunityPreview: () => null }));
vi.mock('../components/home/suggest-feed', () => ({ SuggestFeed: () => <section aria-label="Gợi ý cho bạn" /> }));
vi.mock('../components/home/new-customer-gift', () => ({ NewCustomerGift: () => <section aria-label="Quà khách mới" /> }));
vi.mock('../components/cart-button', () => ({ CartButton: () => null }));
vi.mock('../components/pull-to-refresh', () => ({
  PullToRefresh: ({ onRefresh }: { onRefresh: () => Promise<unknown> | void }) => {
    mocks.onRefresh = onRefresh;
    return null;
  },
}));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

// HomePage gọi useHomeFeed mỗi lần render: đếm ở đây là đếm số lần HomePage (không tính con) dựng lại.
vi.mock('../components/home/use-home-feed', () => ({ useHomeFeed: () => mocks.homeRenders() }));

import HomePage from './home';
import { TubuQueryClient } from '../services/query-client';
import { loadHomeBelow } from '../components/home/home-lazy';

beforeAll(() => loadHomeBelow());

const flashItem = (n: number) => ({ itemId: `i${n}`, variationId: `v${n}`, productSlug: `p${n}`, productName: `p${n}`, thumbnail: null, flashPrice: 1, retailPrice: 2, soldCount: 0, quota: 5, endAt: '2099-01-01T00:00:00.000Z' });
const card = (id: string) => ({ id, slug: id, brand: 'Tubu', name: id, thumbnail: null, basePrice: 50000, salePrice: null, isFeatured: true, inStock: true });

describe('HomePage — nhịp poll Giờ vàng không dựng lại cả trang (F3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth.status = 'authenticated';
    mocks.auth.user = { id: 'u1' };
    mocks.fetchProducts.mockResolvedValue({ data: [1, 2, 3, 4].map((n) => card(`bs${n}`)), meta: { page: 1, limit: 6, total: 4 } });
    mocks.fetchCategories.mockResolvedValue([]);
    mocks.unreadCount.mockResolvedValue({ count: 0 });
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    mocks.fetchFlash.mockImplementation(async () => [1, 2, 3].map(flashItem));
  });

  it('invalidate query Giờ vàng mà dữ liệu không đổi: HomePage không render thêm', async () => {
    const qc = new TubuQueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <HomePage />
      </QueryClientProvider>,
    );
    await screen.findByRole('region', { name: 'Bán chạy nhất' });
    await waitFor(() => expect(qc.getQueryState(['flash-sales', 'active'])?.status).toBe('success'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const before = mocks.homeRenders.mock.calls.length;
    const fetchesBefore = mocks.fetchFlash.mock.calls.length;
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['flash-sales', 'active'] });
    });
    expect(mocks.fetchFlash.mock.calls.length).toBe(fetchesBefore + 1);
    expect(mocks.homeRenders.mock.calls.length).toBe(before);
  });
});
