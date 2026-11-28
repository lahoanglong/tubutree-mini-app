import { act, render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  goSmart: vi.fn(),
  phase: 'guest' as 'guest' | 'authenticated' | 'loading',
  subscriptions: [] as { status: string }[],
  getSubscriptions: vi.fn(),
  getSuggestions: vi.fn(),
  trackEvent: vi.fn(),
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
vi.mock('../services/subscriptions-api', () => ({ getSubscriptions: mocks.getSubscriptions }));
vi.mock('@tubutree/app-core/api/subscriptions', () => ({ getSubscriptionSuggestions: mocks.getSuggestions }));
vi.mock('../services/analytics', () => ({ trackEvent: mocks.trackEvent }));
vi.mock('../components/subscribe-sheet', () => ({
  SubscribeSheet: (p: { variationId: string; initialWeeks?: number }) => (
    <div data-testid="subscribe-sheet-stub">
      {p.variationId} · {p.initialWeeks} tuần
    </div>
  ),
}));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, subscribeDiscountPct: mocks.subscribeDiscountPct }) }));
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

const SUGGESTION = {
  variationId: 'v-giat', productName: 'Nước giặt Tubu', variationName: 'Can 3,8L', slug: 'nuoc-giat', thumbnail: null,
  unitPrice: 189000, intervalWeeks: 10, lastDeliveredAt: '2026-11-01T00:00:00.000Z',
};

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
    mocks.subscriptions = [];
    mocks.getSubscriptions.mockImplementation(async () => mocks.subscriptions);
    mocks.getSuggestions.mockResolvedValue({ enabled: false, items: [] });
    mocks.subscribeDiscountPct = 0.12;
  });

  it('khách chưa đăng nhập vẫn xem rõ quyền lợi Mua xoay vòng và danh sách sản phẩm đủ điều kiện (không bị chặn đăng nhập)', async () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Mua xoay vòng' })).toBeInTheDocument();
    // Dải 40px (w62-01): chỉ số % tiết kiệm và lối "Lịch của tôi →"; thẻ sản phẩm lên ngay nửa trên màn.
    expect(screen.getByTestId('subscription-hero').textContent).toBe('Đặt định kỳ · Tiết kiệm 12%Lịch của tôi →');
    expect(await screen.findByText('Nước rửa chén sinh học')).toBeInTheDocument();
    expect(screen.queryByTestId('subscriptions-panel-mock')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả sản phẩm' }));
    expect(mocks.goSmart).toHaveBeenCalledWith('/browse?all=1');
  });

  it('phần trăm đọc đúng cấu hình (0.12 → 12%), không sàn 10%, không còn "17%" gõ cứng', async () => {
    mount();
    const hero = screen.getByTestId('subscription-hero');
    expect(hero.textContent).toContain('Tiết kiệm 12%');
    expect(hero.textContent).not.toContain('17%');
    await screen.findByText('Nước rửa chén sinh học');
  });

  it('cấu hình 0.05: ghi 5% (không tự nâng lên 10%)', async () => {
    mocks.subscribeDiscountPct = 0.05;
    mount();
    const hero = screen.getByTestId('subscription-hero');
    expect(hero.textContent).toContain('Tiết kiệm 5%');
    expect(hero.textContent).not.toContain('10%');
    await screen.findByText('Nước rửa chén sinh học');
  });

  it('cấu hình thiếu hoặc sai: không nêu con số', async () => {
    mocks.subscribeDiscountPct = undefined;
    mount();
    const hero = screen.getByTestId('subscription-hero');
    expect(hero.textContent).toContain('Đặt định kỳ · Tiết kiệm mỗi kỳ');
    expect(hero.textContent).not.toMatch(/\d+%/);
    await screen.findByText('Nước rửa chén sinh học');
  });

  it('khách đã đăng nhập và đang có gói thấy ngay lịch định kỳ đang chạy trên kệ sản phẩm', async () => {
    mocks.phase = 'authenticated';
    mocks.subscriptions = [{ status: 'ACTIVE' }];
    mocks.getSuggestions.mockResolvedValue({ enabled: true, items: [SUGGESTION] });
    mount();
    expect(await screen.findByTestId('subscriptions-panel-mock')).toBeInTheDocument();
    expect(await screen.findByText('Nước rửa chén sinh học')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lịch của tôi →' })).toBeInTheDocument();
    expect(screen.queryByTestId('subscription-suggestion')).toBeNull();
    expect(mocks.getSuggestions).not.toHaveBeenCalled();
  });

  it('lối "Lịch của tôi →" có sẵn trong dải, không chờ danh sách gói nên không hiện rồi mất', async () => {
    mocks.phase = 'authenticated';
    let resolve!: (v: unknown) => void;
    mocks.getSubscriptions.mockImplementation(() => new Promise((r) => (resolve = r)));
    mount();
    await screen.findByText('Nước rửa chén sinh học');
    expect(screen.getByRole('button', { name: 'Lịch của tôi →' })).toBeInTheDocument();
    await act(async () => resolve([{ status: 'ACTIVE' }]));
    expect(await screen.findByTestId('subscriptions-panel-mock')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lịch của tôi →' })).toBeInTheDocument();
  });

  it('đăng nhập, chưa có gói còn hiệu lực (chỉ gói đã huỷ): gợi ý theo nhịp mua ngay dưới dải quyền lợi, chạm mở sheet Đặt định kỳ chọn sẵn chu kỳ', async () => {
    mocks.phase = 'authenticated';
    mocks.subscriptions = [{ status: 'CANCELLED' }];
    mocks.getSuggestions.mockResolvedValue({ enabled: true, items: [SUGGESTION] });
    mount();
    const row = await screen.findByTestId('subscription-suggestion');
    expect(screen.getByTestId('subscription-hero').nextElementSibling).toBe(row);
    expect(row).toHaveTextContent('Bạn thường mua Nước giặt Tubu khoảng 10 tuần một lần. Đặt giao định kỳ, giảm 12%');
    expect(screen.queryByTestId('subscriptions-panel-mock')).toBeNull();
    fireEvent.click(row);
    expect(mocks.trackEvent).toHaveBeenCalledWith('subscription_suggestion_accepted', 'miniapp', { intervalWeeks: 10 });
    expect(await screen.findByTestId('subscribe-sheet-stub')).toHaveTextContent('v-giat · 10 tuần');
    fireEvent.click(screen.getByRole('button', { name: 'Lịch của tôi →' }));
    expect(mocks.goSmart).toHaveBeenCalledWith('/orders?tab=subscriptions');
  });

  it('khách chưa đăng nhập: không gọi danh sách gói hay gợi ý', async () => {
    mount();
    await screen.findByText('Nước rửa chén sinh học');
    expect(mocks.getSubscriptions).not.toHaveBeenCalled();
    expect(mocks.getSuggestions).not.toHaveBeenCalled();
    expect(screen.queryByTestId('subscription-suggestion')).toBeNull();
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
