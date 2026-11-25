import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Dòng "Kết bạn Zalo với Tubu Tree" trong khối trạng thái của chi tiết đơn: chỉ khi cờ bật, khách đã đồng ý ở đơn này và hành trình còn mở.
const mocks = vi.hoisted(() => ({
  fetchOrder: vi.fn(),
  config: {} as Record<string, unknown>,
  getPublicConfig: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useParams: () => ({ code: 'TT001' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/orders/TT001', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('zmp-sdk/apis', () => ({ openWebview: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/shop-api', () => ({
  fetchOrder: mocks.fetchOrder,
  fetchOrders: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 1, total: 0 } }),
  getPublicConfig: mocks.getPublicConfig,
  fetchMyReturns: vi.fn().mockResolvedValue([]),
  cancelOrder: vi.fn(),
  fetchMyRefunds: vi.fn().mockResolvedValue([]),
  fetchRefundBank: vi.fn(),
  chooseRefundDestination: vi.fn(),
  requestReturn: vi.fn(),
  addToCart: vi.fn(),
  repurchaseOrder: vi.fn(),
  getCart: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock('../services/zmp-bridge', () => ({
  hasOA: false,
  openOAChat: vi.fn(),
  openExternal: vi.fn(),
  followOA: vi.fn(),
  requestNotifyPermission: vi.fn(),
  getOaPromptState: vi.fn().mockResolvedValue({ promptSeen: true, followed: true }),
  setOaPromptState: vi.fn(),
  shouldShowFollowOaPrompt: () => false,
}));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated', user: { id: 'u1' } };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../components/image-upload', () => ({ MultiImageUpload: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import OrderDetailPage from './order-detail';

const ORDER = {
  id: 'o1', code: 'TT001', status: 'CONFIRMED', paymentMethod: 'COD', paymentStatus: 'UNPAID', createdAt: '2026-11-17T03:00:00.000Z',
  subtotal: 100_000, discount: 0, pointsUsed: 0, pointsEarned: 0, shippingFee: 20_000, total: 120_000, hasRecyclingPickup: false,
  orderZaloConsent: true,
  shippingAddress: { recipient: 'Ánh', phone: '0911111111', street: '1 Lê Lợi', ward: 'Phường Bến Nghé', province: 'TP. Hồ Chí Minh' },
  items: [{ id: 'oi1', productName: 'Xà bông thảo mộc', variationName: 'Sả', productSlug: 'xa-bong', quantity: 2, total: 100_000, backorderedQty: 0 }],
};
const FRIEND = 'Nhận Bill & theo dõi đơn TT001 miễn phí qua Zalo Tubu Tree';

async function renderWith(order: Record<string, unknown>) {
  mocks.fetchOrder.mockResolvedValue(order);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OrderDetailPage />
    </QueryClientProvider>,
  );
  await screen.findAllByText(/TT001/);
  await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe('Chi tiết đơn Mini — dòng kết bạn Zalo Tubu Tree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicConfig.mockImplementation(async () => mocks.config);
    mocks.config = { orderZaloEnabled: true, tubuZaloPhone: '0899149229' };
  });

  it('cờ bật, đơn đã đồng ý, đang xử lý: một dòng kèm nút "Mở Zalo Tubu Tree"', async () => {
    await renderWith(ORDER);
    expect(await screen.findByText(FRIEND)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Mở Zalo Tubu Tree' })).toHaveLength(1);
  });

  it.each([
    ['cờ tắt', { orderZaloEnabled: false }, ORDER],
    ['đơn không đồng ý', { orderZaloEnabled: true }, { ...ORDER, orderZaloConsent: false }],
    ['đơn đã giao', { orderZaloEnabled: true }, { ...ORDER, status: 'DELIVERED' }],
    ['đơn đã huỷ', { orderZaloEnabled: true }, { ...ORDER, status: 'CANCELLED' }],
  ])('%s: không có dòng kết bạn', async (_name, config, order) => {
    mocks.config = config;
    await renderWith(order);
    expect(screen.queryByText(FRIEND)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mở Zalo Tubu Tree' })).toBeNull();
  });
});
