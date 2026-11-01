import { render, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_KIND_KEY } from '@tubutree/app-core/home-layout';

// Dải Quà khách mới là hero trong màn đầu: hai query của nó phải chạy ngay lượt vẽ đầu như trước khi tách chunk, nên chunk khối dưới treo mãi
// cũng không được làm dải hiện muộn hay làm khung chờ biến mất muộn.
const mocks = vi.hoisted(() => ({
  fetchProducts: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPurchasedItems: vi.fn(),
  fetchActiveFlashSales: vi.fn(),
  getNotifications: vi.fn(),
  getPublicConfig: vi.fn(),
  getNewCustomerOffer: vi.fn(),
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
  getPublicConfig: mocks.getPublicConfig,
  fetchHasAnyOrder: vi.fn(),
  getCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getNotifications: mocks.getNotifications, getNewCustomerOffer: mocks.getNewCustomerOffer }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ status: 'authenticated', user: { id: 'u1', phone: '0901234567', zaloId: 'z1' }, ensurePhoneOrThrow: vi.fn() }),
}));
vi.mock('../components/flash-sale', () => ({ FlashSale: () => null, UpcomingFlashSales: () => null }));
vi.mock('../components/reorder/purchased-rail', () => ({ PURCHASED_RAIL_LIMIT: 10, PurchasedRail: () => null }));
vi.mock('../components/home/best-seller-rail', () => ({ BEST_SELLER_LIMIT: 6, BestSellerRail: () => null }));
vi.mock('../components/home/member-card', () => ({ MemberCard: () => null, MemberCardSkeleton: () => null }));
vi.mock('../components/home/todo-strip', () => ({ TodoStrip: () => null, useHomeTodoQueries: () => ({ loading: false }) }));
vi.mock('../components/home/shortcut-grid', () => ({ ShortcutGrid: () => null }));
vi.mock('../components/home/brand-journey', () => ({ BrandJourney: () => null }));
vi.mock('../components/home/community-preview', () => ({ CommunityPreview: () => null }));
vi.mock('../components/home/suggest-feed', () => ({ SuggestFeed: () => null }));
vi.mock('../components/cart-button', () => ({ CartButton: () => null }));
vi.mock('../components/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
// Chunk khối dưới không bao giờ về.
vi.mock('../components/home/home-below', () => new Promise(() => undefined));

import HomePage from './home';

const CONFIG = {
  freeshipThreshold: 350_000,
  subscribeDiscountPct: 0.17,
  affiliateWalletMultiplier: 1,
  cashbackHoldDays: 30,
  newCustomer: { welcomeVoucher: { amount: 25_000, minOrder: 150_000 }, firstOrderFreeShip: { enabled: false, minSubtotal: 0 } },
  loyalty: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1_000 },
};
const never = () => new Promise<never>(() => undefined);
const settle = async (ms = 0) => {
  await act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  for (let i = 0; i < 4; i++) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};
const welcome = () => document.querySelector<HTMLElement>('[data-home-block="welcome"]');

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <HomePage />
      </QueryClientProvider>
    </StrictMode>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.clearAllMocks();
  localStorage.clear();
  mocks.fetchProducts.mockResolvedValue({ data: [], meta: { page: 1, limit: 6, total: 0 } });
  mocks.fetchCategories.mockResolvedValue([]);
  mocks.getNotifications.mockResolvedValue([]);
  mocks.fetchPurchasedItems.mockReturnValue(never());
  mocks.fetchActiveFlashSales.mockReturnValue(never());
  mocks.getPublicConfig.mockResolvedValue(CONFIG);
  localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'new' }));
});
afterEach(() => vi.useRealTimers());

describe('HomePage — khách mới mở lại, chunk khối dưới treo mãi', () => {
  it('khách chưa có đơn: dải quà hiện chữ thật mà không đợi chunk', async () => {
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: true, welcomeVoucher: null });
    renderHome();
    await settle(100);
    expect(welcome()?.querySelector('[aria-label="Quà khách mới"]')).not.toBeNull();
    expect(welcome()?.querySelector('[data-testid="new-customer-gift-loading"]')).toBeNull();
  });

  it('khách đã đặt đơn đầu nhưng chưa giao (isNewCustomer=false): dải trả null mà không đợi chunk, không còn khung xám', async () => {
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: false, welcomeVoucher: null });
    renderHome();
    await settle(100);
    expect(welcome()).not.toBeNull();
    expect(welcome()?.innerHTML).toBe('');
  });
});
