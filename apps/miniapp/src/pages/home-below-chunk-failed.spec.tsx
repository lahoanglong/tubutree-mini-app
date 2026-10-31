import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lỗi tải chunk thật (mạng/CDN): dựng lại không cứu được, nên "Thử lại" phải tải lại cả app.
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => vi.fn(),
}));
vi.mock('../services/shop-api', () => ({
  fetchProducts: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 6, total: 0 } }),
  fetchCategories: vi.fn().mockResolvedValue([]),
  fetchPurchasedItems: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  fetchUpcomingFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getNotifications: vi.fn().mockResolvedValue([]) }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: { id: string } | null }) => unknown) => sel({ status: 'authenticated', user: { id: 'u1' } }),
}));
vi.mock('../components/reorder/purchased-rail', () => ({ PURCHASED_RAIL_LIMIT: 10, PurchasedRail: () => null }));
vi.mock('../components/home/member-card', () => ({ MemberCard: () => null, MemberCardSkeleton: () => null }));
vi.mock('../components/home/todo-strip', () => ({ TodoStrip: () => null, useHomeTodoQueries: () => ({ loading: false }) }));
vi.mock('../components/home/shortcut-grid', () => ({ ShortcutGrid: () => null }));
vi.mock('../components/home/new-customer-gift', () => ({ NewCustomerGift: () => null }));
vi.mock('../components/cart-button', () => ({ CartButton: () => null }));
vi.mock('../components/pull-to-refresh', () => ({
  PullToRefresh: ({ onRefresh }: { onRefresh: () => void }) => <button type="button" data-testid="pull" onClick={() => void onRefresh()} />,
}));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
// Vitest bọc lỗi của factory nên message gốc mất; nhận diện lỗi chunk (có test riêng ở chunk-error) được giả ở đây.
const chunkError = vi.hoisted(() => ({ isChunkError: vi.fn((e: unknown) => e instanceof Error) }));
vi.mock('../utils/chunk-error', () => chunkError);
vi.mock('../components/home/home-below', () => {
  throw new Error('Failed to fetch dynamically imported module: /assets/home-below.js');
});

import HomePage from './home';

const reload = vi.fn();
const original = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
});
afterEach(() => Object.defineProperty(window, 'location', { configurable: true, value: original }));

describe('HomePage — chunk khối dưới màn đầu hỏng kiểu lỗi mạng', () => {
  it('bấm "Thử lại" tải lại cả app thay vì import lại', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <HomePage />
      </QueryClientProvider>,
    );
    const error = await screen.findByTestId('home-page-error');
    expect(error).toBeInTheDocument();
    await act(async () => {
      screen.getByRole('button', { name: /Thử lại/ }).click();
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(chunkError.isChunkError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('kéo để làm mới khi chunk hỏng cũng tải lại cả app', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <HomePage />
      </QueryClientProvider>,
    );
    await screen.findByTestId('home-page-error');
    await act(async () => {
      screen.getByTestId('pull').click();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
