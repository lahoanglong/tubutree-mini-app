import { render, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_SETTLE_MAX_MS, homeRenderOrder } from '@tubutree/app-core/home-layout';

// Khung chờ chung của Trang chủ ở cấp trang: Giờ vàng thật (khối hiện lỗi + "Thử lại"), giờ giả, StrictMode. home.spec.tsx mock Giờ vàng nên không thấy được.
const chunk = vi.hoisted(() => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return { gate, release };
});
const mocks = vi.hoisted(() => ({
  fetchProducts: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPurchasedItems: vi.fn(),
  fetchActiveFlashSales: vi.fn(),
  getNotifications: vi.fn(),
  auth: { status: 'authenticated' as 'authenticated' | 'guest' | 'loading' | 'error', user: { id: 'u1' } as { id: string } | null },
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => vi.fn(),
}));
vi.mock('../services/shop-api', () => ({
  fetchProducts: mocks.fetchProducts,
  fetchCategories: mocks.fetchCategories,
  fetchPurchasedItems: mocks.fetchPurchasedItems,
  fetchActiveFlashSales: mocks.fetchActiveFlashSales,
  fetchUpcomingFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getNotifications: mocks.getNotifications }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: { id: string } | null }) => unknown) => sel({ status: mocks.auth.status, user: mocks.auth.user }),
}));
vi.mock('../components/reorder/purchased-rail', () => ({ PURCHASED_RAIL_LIMIT: 10, PurchasedRail: () => null }));
vi.mock('../components/home/member-card', () => ({ MemberCard: () => null, MemberCardSkeleton: () => <div data-testid="member-card-loading" /> }));
vi.mock('../components/home/todo-strip', () => ({ TodoStrip: () => null, useHomeTodoQueries: () => ({ loading: false }) }));
vi.mock('../components/home/shortcut-grid', () => ({ ShortcutGrid: () => null }));
vi.mock('../components/home/brand-journey', () => ({ BrandJourney: () => null }));
vi.mock('../components/home/community-preview', () => ({ CommunityPreview: () => null }));
vi.mock('../components/home/suggest-feed', () => ({ SuggestFeed: () => null }));
vi.mock('../components/home/new-customer-gift', () => ({ NewCustomerGift: () => null }));
vi.mock('../components/cart-button', () => ({ CartButton: () => null }));
vi.mock('../components/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

vi.mock('../components/home/home-below', async () => {
  await chunk.gate;
  return { FlashSale: () => null, UpcomingFlashSales: () => null, PurchasedRail: () => null, BestSellerRail: () => null, BrandJourney: () => null, CommunityPreview: () => null, NewCustomerGift: () => null, SuggestFeed: () => null };
});

import HomePage from './home';

const never = () => new Promise<never>(() => undefined);
const blockOrder = () => Array.from(document.querySelectorAll<HTMLElement>('[data-home-block]')).map((el) => el.dataset.homeBlock);
// React Query báo kết quả qua setTimeout(0) rồi React mới vẽ lại: sau khi tiến giờ, chạy thêm vài vòng không tốn giờ để mọi cập nhật nối đuôi nhau xong.
const settle = async (ms = 0) => {
  await act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  for (let i = 0; i < 4; i++) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <HomePage />
      </QueryClientProvider>
    </StrictMode>,
  );
  return view;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.clearAllMocks();
  localStorage.clear();
  mocks.auth.status = 'authenticated';
  mocks.auth.user = { id: 'u1' };
  mocks.fetchProducts.mockResolvedValue({ data: [], meta: { page: 1, limit: 6, total: 0 } });
  mocks.fetchCategories.mockResolvedValue([]);
  mocks.getNotifications.mockResolvedValue([]);
  mocks.fetchPurchasedItems.mockReturnValue(never());
  mocks.fetchActiveFlashSales.mockReturnValue(never());
});
afterEach(() => vi.useRealTimers());

describe('HomePage — chunk khối dưới màn đầu chưa về', () => {
  it('dữ liệu đã về hết mà chunk chưa về: vẫn giữ khung chờ chung (không nhả sớm), chunk về thì nhả thành bố cục thật', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    renderHome();
    await settle(HOME_SETTLE_MAX_MS - 500);
    expect(blockOrder()).toEqual([...homeRenderOrder('new', true)]);
    await act(async () => chunk.release());
    await settle();
    expect(blockOrder()).not.toContain('settling');
  });
});
