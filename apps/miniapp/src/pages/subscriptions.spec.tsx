import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  goSmart: vi.fn(),
  phase: 'guest' as 'guest' | 'authenticated' | 'loading',
  hasSubscription: false,
  bestSellers: {
    data: [
      { id: 'p1', slug: 'nuoc-rua-chen', name: 'Nước rửa chén sinh học', price: 89000, thumbnail: null, rating: 4.9, reviewCount: 12, soldCount: 50 },
    ],
    meta: { page: 1, limit: 20, total: 1 },
  },
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>,
}));
vi.mock('../lib/smart-nav', () => ({ useSmartNavigate: () => mocks.goSmart }));
vi.mock('../hooks/use-auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('../hooks/use-has-subscription', () => ({
  useHasSubscription: () => ({ hasSubscription: mocks.hasSubscription, isLoading: false }),
}));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ subscribeDiscountPct: 0.12 }) }));
vi.mock('../components/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('../components/subscriptions-panel', () => ({
  SubscriptionsPanel: () => <div data-testid="subscriptions-panel-mock">Gói đang chạy của tôi</div>,
}));
vi.mock('../components/ui/product-grid', () => ({
  ProductGrid: ({ items }: { items: { id: string; name: string }[] }) => (
    <div data-testid="product-grid-mock">
      {items.map((it) => (
        <span key={it.id}>{it.name}</span>
      ))}
    </div>
  ),
}));
vi.mock('@tubutree/app-core/queries/browse', () => ({
  bestSellersListQuery: () => ({
    queryKey: ['best-sellers', 'subscription-spec'],
    initialPageParam: 1,
    queryFn: async () => mocks.bestSellers,
    getNextPageParam: () => undefined,
  }),
}));

import SubscriptionsPage from './subscriptions';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SubscriptionsPage />
    </QueryClientProvider>,
  );
}

describe('SubscriptionsPage (/subscriptions — W171)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phase = 'guest';
    mocks.hasSubscription = false;
  });

  it('khách chưa đăng nhập vẫn xem rõ quyền lợi Mua xoay vòng và danh sách sản phẩm đủ điều kiện (không bị chặn đăng nhập)', async () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Mua xoay vòng' })).toBeInTheDocument();
    expect(screen.getByTestId('subscription-hero').textContent).toContain('Tiết kiệm tới 17%');
    expect(screen.getByTestId('subscription-hero').textContent).toContain('4 · 6 · 8 · 10 tuần');
    expect(await screen.findByText('Nước rửa chén sinh học')).toBeInTheDocument();
    expect(screen.queryByTestId('subscriptions-panel-mock')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả sản phẩm' }));
    expect(mocks.goSmart).toHaveBeenCalledWith('/browse?all=1');
  });

  it('khách đã đăng nhập và đang có gói thấy ngay lịch định kỳ đang chạy trên kệ sản phẩm', async () => {
    mocks.phase = 'authenticated';
    mocks.hasSubscription = true;
    mount();
    expect(screen.getByTestId('subscriptions-panel-mock')).toBeInTheDocument();
    expect(await screen.findByText('Nước rửa chén sinh học')).toBeInTheDocument();
  });
});
