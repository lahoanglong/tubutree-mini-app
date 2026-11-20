import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Thẻ nhựa đã giảm (tubu-w11-03): trang hỏi máy chủ khi cờ giới thiệu bật và đơn đã chốt; có số thì vẽ thẻ và bỏ dòng mời thứ hai.

const mocks = vi.hoisted(() => ({
  fetchOrder: vi.fn(),
  getPublicConfig: vi.fn(),
  coreGet: vi.fn(),
}));
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
  fetchOrders: vi.fn(),
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
vi.mock('../services/core-http', async (orig) => ({
  ...(await orig<object>()),
  coreHttp: { get: mocks.coreGet, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../services/zmp-bridge', () => ({
  hasOA: false,
  openOAChat: vi.fn(),
  openExternal: vi.fn(),
  followOA: vi.fn(),
  requestNotifyPermission: vi.fn(),
  getOaPromptState: vi.fn().mockResolvedValue({ promptSeen: true }),
  setOaPromptState: vi.fn(),
  shouldShowFollowOaPrompt: () => false,
}));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated', user: { id: 'u1' } };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../components/image-upload', () => ({ MultiImageUpload: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../services/analytics', async (orig) => ({ ...(await orig<object>()), trackEvent: vi.fn() }));

import OrderDetailPage from './order-detail';

const ORDER = {
  id: 'o1',
  code: 'TT001',
  status: 'DELIVERED',
  type: 'RETAIL',
  paymentMethod: 'COD',
  paymentStatus: 'PAID',
  createdAt: new Date(Date.now() - 5 * 864e5).toISOString(),
  deliveredAt: new Date(Date.now() - 864e5).toISOString(),
  subtotal: 300_000,
  discount: 0,
  pointsUsed: 0,
  pointsEarned: 120,
  shippingFee: 0,
  total: 300_000,
  hasRecyclingPickup: false,
  shippingAddress: { recipient: 'Ánh', phone: '0911111111', street: '1 Lê Lợi', ward: 'Phường Bến Nghé', province: 'TP. Hồ Chí Minh' },
  items: [{ id: 'oi1', productName: 'Refill Nước rửa chén 10L', variationName: '10L', productSlug: 'refill-x', quantity: 2, total: 300_000, backorderedQty: 0 }],
};
const IMPACT = {
  orderCode: 'TT001',
  bottlesSaved: 5,
  plasticGrams: 0,
  refillPacks: 2,
  points: 120,
  pointsCredited: true,
  referralCode: 'LAN123',
  inviteReward: { points: 100, minOrderAmount: 199_000 },
};
const ECO_PATH = '/me/eco-impact/orders/TT001';
const CFG_ON = { referralViralEnabled: true, referralShareCardEnabled: true, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrderDetailPage />
    </QueryClientProvider>,
  );
}
const inviteLead = () => screen.queryByRole('button', { name: 'Mời bạn sống xanh' });

beforeAll(async () => {
  await import('../components/orders/eco-impact-card');
  await import('@tubutree/app-core/eco/order-impact');
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchOrder.mockResolvedValue(ORDER);
  mocks.getPublicConfig.mockResolvedValue(CFG_ON);
  mocks.coreGet.mockImplementation(async (path: string) => {
    if (path === ECO_PATH) return IMPACT;
    throw new Error(`không mock ${path}`);
  });
});

describe('Chi tiết đơn Mini: thẻ nhựa đã giảm', () => {
  it('đơn đã giao có gói Refill: thẻ hiện số chai, không còn dòng "Thích Tubu Tree?" thứ hai', async () => {
    renderPage();
    const card = await screen.findByTestId('order-eco-impact');
    expect(card.textContent).toContain('Đơn này bạn đã giảm 5 chai nhựa dùng 1 lần');
    expect(mocks.coreGet).toHaveBeenCalledWith(ECO_PATH);
    expect(inviteLead()).toBeNull();
  });

  it('máy chủ trả số 0: không thẻ, dòng mời cũ vẫn còn', async () => {
    mocks.coreGet.mockResolvedValue({ ...IMPACT, bottlesSaved: 0, points: 0 });
    renderPage();
    await waitFor(() => expect(inviteLead()).not.toBeNull());
    expect(screen.queryByTestId('order-eco-impact')).toBeNull();
  });

  it('cờ growth.referral_viral_enabled tắt: không hỏi máy chủ', async () => {
    mocks.getPublicConfig.mockResolvedValue({ ...CFG_ON, referralViralEnabled: false });
    renderPage();
    await waitFor(() => expect(inviteLead()).not.toBeNull());
    expect(mocks.coreGet).not.toHaveBeenCalledWith(ECO_PATH);
    expect(screen.queryByTestId('order-eco-impact')).toBeNull();
  });

  it('API lỗi (404): không thẻ, dòng mời cũ vẫn còn', async () => {
    mocks.coreGet.mockRejectedValue(new Error('404'));
    renderPage();
    await waitFor(() => expect(inviteLead()).not.toBeNull());
    expect(screen.queryByTestId('order-eco-impact')).toBeNull();
  });
});
