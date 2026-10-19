import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// D2-06: lời mời theo dõi OA chỉ hứa điều backend làm thật (cập nhật đơn, tư vấn), không hứa "ưu đãi mới".
const mocks = vi.hoisted(() => ({ fetchOrder: vi.fn(), fetchOrders: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useParams: () => ({ code: 'TT001' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/orders/TT001', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  fetchOrder: mocks.fetchOrder,
  fetchOrders: mocks.fetchOrders,
  getPublicConfig: vi.fn().mockResolvedValue({}),
  fetchMyReturns: vi.fn().mockResolvedValue([]),
  cancelOrder: vi.fn(),
  fetchMyRefunds: vi.fn().mockResolvedValue([]),
  fetchRefundBank: vi.fn(),
  chooseRefundDestination: vi.fn(),
  requestReturn: vi.fn(),
  addToCart: vi.fn(),
  repurchaseOrder: vi.fn(),
}));
vi.mock('../services/zmp-bridge', () => ({
  hasOA: true,
  openOAChat: vi.fn(),
  openExternal: vi.fn(),
  followOA: vi.fn(),
  requestNotifyPermission: vi.fn(),
  getOaPromptState: vi.fn().mockResolvedValue({ promptSeen: false, followed: false }),
  setOaPromptState: vi.fn(),
  shouldShowFollowOaPrompt: () => true,
}));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated', user: { id: 'u1' } };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../components/image-upload', () => ({ MultiImageUpload: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import OrderDetailPage from './order-detail';

const ORDER = {
  id: 'o1', code: 'TT001', status: 'PENDING', paymentMethod: 'COD', paymentStatus: 'UNPAID', createdAt: '2026-10-01T03:00:00.000Z',
  subtotal: 100_000, discount: 0, pointsUsed: 0, pointsEarned: 0, shippingFee: 20_000, total: 120_000, hasRecyclingPickup: false,
  shippingAddress: { recipient: 'Ánh', phone: '0911111111', street: '1 Lê Lợi', ward: 'Phường Bến Nghé', province: 'TP. Hồ Chí Minh' },
  items: [{ id: 'oi1', productName: 'Xà bông thảo mộc', variationName: 'Sả', productSlug: 'xa-bong', quantity: 2, total: 100_000, backorderedQty: 0 }],
};

describe('OrderDetailPage — lời mời theo dõi OA sau đơn đầu (D2-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOrder.mockResolvedValue(ORDER);
    mocks.fetchOrders.mockResolvedValue({ data: [ORDER], meta: { page: 1, limit: 1, total: 1 } });
  });

  it('chỉ hứa cập nhật đơn và tư vấn, không hứa ưu đãi', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <OrderDetailPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Theo dõi Tubu Tree trên Zalo')).toBeInTheDocument();
    expect(screen.getByText('Nhận cập nhật đơn và tư vấn từ Tubu Tree qua Zalo — không bỏ lỡ tin quan trọng.')).toBeInTheDocument();
    expect(screen.queryByText(/ưu đãi/i)).toBeNull();
  });
});
