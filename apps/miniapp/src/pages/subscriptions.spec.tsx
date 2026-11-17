import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  goSmart: vi.fn(),
  phase: 'guest' as 'guest' | 'authenticated' | 'loading',
  hasSubscription: false,
  subscribeDiscountPct: 0.12 as unknown,
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
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ subscribeDiscountPct: mocks.subscribeDiscountPct }) }));
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
    mocks.subscribeDiscountPct = 0.12;
  });

  it('khách chưa đăng nhập vẫn xem rõ quyền lợi Mua xoay vòng và danh sách sản phẩm đủ điều kiện (không bị chặn đăng nhập)', async () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Mua xoay vòng' })).toBeInTheDocument();
    expect(screen.getByTestId('subscription-hero').textContent).toContain('Đặt định kỳ · Tiết kiệm 12%');
    expect(screen.getByTestId('subscription-hero').textContent).toContain('4 · 6 · 8 · 10 tuần');
    expect(await screen.findByText('Nước rửa chén sinh học')).toBeInTheDocument();
    expect(screen.queryByTestId('subscriptions-panel-mock')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả sản phẩm' }));
    expect(mocks.goSmart).toHaveBeenCalledWith('/browse?all=1');
  });

  it('phần trăm đọc đúng cấu hình (0.12 → 12%), không sàn 10%, không còn "17%" gõ cứng', async () => {
    mount();
    const hero = screen.getByTestId('subscription-hero');
    expect(hero.textContent).toContain('Giảm 12% cho mỗi kỳ giao.');
    expect(hero.textContent).not.toContain('17%');
    await screen.findByText('Nước rửa chén sinh học');
  });

  it('cấu hình 0.05: ghi 5% (không tự nâng lên 10%)', async () => {
    mocks.subscribeDiscountPct = 0.05;
    mount();
    const hero = screen.getByTestId('subscription-hero');
    expect(hero.textContent).toContain('Tiết kiệm 5%');
    expect(hero.textContent).toContain('Giảm 5% cho mỗi kỳ giao.');
    await screen.findByText('Nước rửa chén sinh học');
  });

  it('cấu hình thiếu hoặc sai: không nêu con số', async () => {
    mocks.subscribeDiscountPct = undefined;
    mount();
    const hero = screen.getByTestId('subscription-hero');
    expect(hero.textContent).toContain('Đặt định kỳ · Tiết kiệm mỗi kỳ');
    expect(hero.textContent).toContain('Giảm giá cho mỗi kỳ giao.');
    expect(hero.textContent).not.toMatch(/\d+%/);
    await screen.findByText('Nước rửa chén sinh học');
  });

  it('khách đã đăng nhập và đang có gói thấy ngay lịch định kỳ đang chạy trên kệ sản phẩm', async () => {
    mocks.phase = 'authenticated';
    mocks.hasSubscription = true;
    mount();
    expect(screen.getByTestId('subscriptions-panel-mock')).toBeInTheDocument();
    expect(await screen.findByText('Nước rửa chén sinh học')).toBeInTheDocument();
  });

  it('loại bỏ sản phẩm đối tác tự gửi (MERCHANT / UNAVAILABLE) khỏi kệ Mua xoay vòng để mọi món đều hỗ trợ Đặt định kỳ', async () => {
    const prev = mocks.bestSellers;
    mocks.bestSellers = {
      data: [
        { id: 'p1', slug: 'nuoc-rua-chen', name: 'Nước rửa chén sinh học', price: 89000, thumbnail: null, rating: 4.9, reviewCount: 12, soldCount: 50, fulfiller: { kind: 'TUBU' } } as never,
        { id: 'p2', slug: 'mat-ong-doi-tac', name: 'Mật ong Đối tác tự gửi', price: 150000, thumbnail: null, rating: 4.8, reviewCount: 4, soldCount: 10, fulfiller: { kind: 'MERCHANT', partnerName: 'Shop A' } } as never,
        { id: 'p3', slug: 'tam-ngung', name: 'Hàng tạm ngưng đối tác', price: 99000, thumbnail: null, rating: 4.5, reviewCount: 2, soldCount: 3, fulfiller: { kind: 'UNAVAILABLE' } } as never,
      ],
      meta: { page: 1, limit: 20, total: 3 },
    };
    try {
      mount();
      expect(await screen.findByText('Nước rửa chén sinh học')).toBeInTheDocument();
      expect(screen.queryByText('Mật ong Đối tác tự gửi')).toBeNull();
      expect(screen.queryByText('Hàng tạm ngưng đối tác')).toBeNull();
    } finally {
      mocks.bestSellers = prev;
    }
  });
});
