import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_SETTLE_MAX_MS, homeBlockOrder, homeRenderOrder } from '@tubutree/app-core/home-layout';

// Khung chờ chung của Trang chủ ở cấp trang: Giờ vàng thật (khối hiện lỗi + "Thử lại"), giờ giả, StrictMode. home.spec.tsx mock Giờ vàng nên không thấy được.
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

import HomePage from './home';

const never = () => new Promise<never>(() => undefined);
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const blockOrder = () => Array.from(document.querySelectorAll<HTMLElement>('[data-home-block]')).map((el) => el.dataset.homeBlock);
// React Query báo kết quả qua setTimeout(0) rồi React mới vẽ lại: sau khi tiến giờ, chạy thêm vài vòng không tốn giờ để mọi cập nhật nối đuôi nhau xong.
const settle = async (ms = 0) => {
  await act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  for (let i = 0; i < 4; i++) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};

const clients = new WeakMap<object, QueryClient>();
const qcOf = (view: object) => clients.get(view)!;
function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <HomePage />
      </QueryClientProvider>
    </StrictMode>,
  );
  clients.set(view, qc);
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

describe('HomePage — khung chờ chung (cấp trang)', () => {
  it('Giờ vàng (truy vấn quyết định) lỗi lúc đang giữ khung chờ: thả khung chờ, khối Giờ vàng hiện lỗi kèm "Thử lại", bấm Thử lại tải lại đúng khối đó', async () => {
    const purchased = deferred<{ items: object[]; nextCursor: null }>();
    const flash = deferred<unknown[]>();
    mocks.fetchPurchasedItems.mockReturnValue(purchased.promise);
    mocks.fetchActiveFlashSales.mockReturnValue(flash.promise);
    renderHome();
    await settle();
    expect(blockOrder()).toEqual([...homeRenderOrder('unknown', true)]);

    // Biết là khách cũ nhưng Giờ vàng chưa về: vẫn giữ.
    await act(async () => purchased.resolve({ items: [{ variationId: 'v1' }], nextCursor: null }));
    await settle();
    expect(blockOrder()).toEqual([...homeRenderOrder('returning', true)]);

    await act(async () => flash.reject(new Error('mất mạng')));
    await settle();
    expect(blockOrder()).toEqual([...homeBlockOrder('returning')]);
    expect(screen.getByTestId('home-block-error')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /Thử lại/ });
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
    const before = mocks.fetchActiveFlashSales.mock.calls.length;
    await act(async () => {
      retry.click();
    });
    await settle();
    expect(mocks.fetchActiveFlashSales.mock.calls.length).toBe(before + 1);
    expect(screen.queryByTestId('home-block-error')).toBeNull();
  });

  it('hẹn giờ 4,5 giây (StrictMode, giờ giả): mạng chậm, chưa biết loại khách và dữ liệu chưa về thì nhả đúng lúc, không sớm hơn', async () => {
    renderHome();
    await settle();
    expect(blockOrder()).toEqual([...homeRenderOrder('unknown', true)]);
    await settle(HOME_SETTLE_MAX_MS - 100);
    expect(blockOrder()).toEqual([...homeRenderOrder('unknown', true)]);
    await settle(200);
    expect(blockOrder()).toEqual([...homeBlockOrder('unknown')]);
  });

  it('đang khôi phục phiên (giữ khung chờ chung) rồi phiên lỗi (status error): nhả ngay, không chờ 4,5 giây hay dữ liệu', async () => {
    mocks.auth.status = 'loading';
    mocks.auth.user = null;
    const view = renderHome();
    await settle(1000);
    expect(blockOrder()).toEqual([...homeRenderOrder('unknown', true)]);
    mocks.auth.status = 'error';
    view.rerender(
      <StrictMode>
        <QueryClientProvider client={qcOf(view)}>
          <HomePage />
        </QueryClientProvider>
      </StrictMode>,
    );
    await settle();
    expect(blockOrder()).toEqual([...homeBlockOrder('new')]);
  });

  it('khôi phục phiên (status loading) chưa nhớ gì: giữ khung chờ chung, chưa tới hạn thì chưa nhả', async () => {
    mocks.auth.status = 'loading';
    mocks.auth.user = null;
    renderHome();
    await settle(HOME_SETTLE_MAX_MS - 100);
    expect(blockOrder()).toEqual([...homeRenderOrder('unknown', true)]);
  });
});
