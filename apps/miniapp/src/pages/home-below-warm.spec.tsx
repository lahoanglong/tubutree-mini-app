import { render, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_KIND_KEY, FLASH_HINT_KEY } from '@tubutree/app-core/home-layout';

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
vi.mock('../components/flash-sale', () => ({ FlashSale: () => <div data-testid="flash-sale-real" />, UpcomingFlashSales: () => null }));
vi.mock('../components/reorder/purchased-rail', () => ({ PURCHASED_RAIL_LIMIT: 10, PurchasedRail: () => <div data-testid="purchased-rail-real" /> }));
vi.mock('../components/home/best-seller-rail', () => ({ BEST_SELLER_LIMIT: 6, BestSellerRail: () => <div data-testid="best-seller-rail-real" /> }));
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
  return { BrandJourney: () => null, CommunityPreview: () => null, SuggestFeed: () => null };
});

import HomePage from './home';

const never = () => new Promise<never>(() => undefined);
const settle = async (ms = 0) => {
  await act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  for (let i = 0; i < 4; i++) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};
const blockEl = (id: string) => document.querySelector<HTMLElement>(`[data-home-block="${id}"]`);
// Khối chỉ chứa đúng các phần tử thật nêu tên (không có ô giữ chỗ thừa nào của chunk).
const testIdsIn = (id: string) => Array.from(blockEl(id)?.querySelectorAll('*') ?? []).map((el) => el.getAttribute('data-testid') ?? el.tagName);

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
  mocks.auth.status = 'authenticated';
  mocks.auth.user = { id: 'u1' };
  mocks.fetchProducts.mockResolvedValue({ data: [], meta: { page: 1, limit: 6, total: 0 } });
  mocks.fetchCategories.mockResolvedValue([]);
  mocks.getNotifications.mockResolvedValue([]);
  mocks.fetchPurchasedItems.mockReturnValue(never());
  mocks.fetchActiveFlashSales.mockReturnValue(never());
  localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
});
afterEach(() => vi.useRealTimers());

// Máy đã nhớ loại khách: không giữ khung chờ chung, nên khối chưa có chunk chỉ được giữ chỗ đúng bằng hình lúc đang tải của nó (không thì null),
// để chunk về không làm khối bên dưới nhảy.
describe('HomePage — mở lại khi máy đã nhớ loại khách, chunk khối dưới chưa về', () => {
  it('không có khung chờ chung; Giờ vàng chỉ có FlashSale thật và Cộng đồng không có phần tử nào; Mua lại chỉ có kệ thật', async () => {
    renderHome();
    await settle(100);
    expect(document.querySelector('[data-testid="home-settling"]')).toBeNull();
    expect(testIdsIn('flash')).toEqual(['flash-sale-real']);
    expect(blockEl('community')?.innerHTML ?? '').toBe('');
    expect(testIdsIn('purchased')).toEqual(['purchased-rail-real']);
  });

  it('kệ Mua lại nằm trong gói đầu nên hiện ngay, không có ô giữ chỗ', async () => {
    renderHome();
    await settle(100);
    expect(testIdsIn('purchased')).toEqual(['purchased-rail-real']);
  });

  it('lần trước có Giờ vàng thì Giờ vàng vẫn nằm trong gói đầu: không có ô giữ chỗ của chunk, khung chờ là của chính FlashSale', async () => {
    localStorage.setItem(FLASH_HINT_KEY, '1');
    renderHome();
    await settle(100);
    expect(testIdsIn('flash')).toEqual(['flash-sale-real']);
  });
});

describe('HomePage — khách mới và khách vãng lai mở lại, chunk khối dưới chưa về', () => {
  it.each([
    ['khách mới đã nhớ', () => localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'new' }))],
    [
      'khách vãng lai',
      () => {
        localStorage.clear();
        mocks.auth.status = 'guest';
        mocks.auth.user = null;
      },
    ],
  ])('%s: kệ Bán chạy hiện ngay, không có ô xám giữ chỗ', async (_name, setup) => {
    setup();
    renderHome();
    await settle(100);
    expect(testIdsIn('bestSellers')).toEqual(['best-seller-rail-real']);
    expect(document.querySelector('[data-testid="purchased-rail-real"]')).toBeNull();
  });
});
