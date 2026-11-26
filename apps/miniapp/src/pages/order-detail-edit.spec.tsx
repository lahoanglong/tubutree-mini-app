import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Khách tự sửa địa chỉ và ghi chú (tubu-w39-03): một lối "Sửa" ở tiêu đề khối địa chỉ khi máy chủ báo canEdit; tấm sửa là chunk lười.

const mocks = vi.hoisted(() => ({
  fetchOrder: vi.fn(),
  sheetProps: null as null | Record<string, unknown>,
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
  getPublicConfig: vi.fn().mockResolvedValue({ waste: { enabled: false, dropoff: false, mailin: false, pickup: false } }),
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
  coreHttp: { get: vi.fn().mockResolvedValue({}), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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
// Tấm sửa thật có spec riêng: ở đây chỉ đọc props trang truyền xuống.
vi.mock('../components/orders/order-edit-sheet', () => ({
  default: (p: Record<string, unknown>) => {
    mocks.sheetProps = p;
    return <div data-testid="order-edit-sheet-stub" />;
  },
}));

import OrderDetailPage from './order-detail';

const ORDER = {
  id: 'o1',
  code: 'TT001',
  status: 'CONFIRMED',
  type: 'RETAIL',
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  subtotal: 300_000,
  discount: 0,
  pointsUsed: 0,
  pointsEarned: 0,
  shippingFee: 0,
  total: 300_000,
  note: 'Gọi trước',
  hasRecyclingPickup: false,
  shippingAddress: {
    recipient: 'Ánh',
    phone: '0911111111',
    street: '1 Lê Lợi',
    ward: 'Phường Bến Nghé',
    province: 'TP. Hồ Chí Minh',
    provinceCode: '84_VN79',
    district: '',
    districtCode: '',
    wardCode: '84_VN7926740',
  },
  items: [{ id: 'oi1', productName: 'Nước rửa chén', variationName: '1L', productSlug: 'nrc', quantity: 1, total: 300_000, backorderedQty: 0 }],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrderDetailPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sheetProps = null;
});

describe('Chi tiết đơn Mini: lối "Sửa" địa chỉ và ghi chú', () => {
  it('API cũ (không có canEdit): không có lối "Sửa"', async () => {
    mocks.fetchOrder.mockResolvedValue(ORDER);
    renderPage();
    await screen.findByText('Ánh · 0911111111');
    expect(screen.queryByTestId('order-edit-open')).toBeNull();
  });

  it('canEdit=false: không có lối "Sửa"', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, canEdit: false });
    renderPage();
    await screen.findByText('Ánh · 0911111111');
    expect(screen.queryByTestId('order-edit-open')).toBeNull();
  });

  it('canEdit=true: đúng một lối "Sửa", mở tấm sửa (chunk lười) với địa chỉ và ghi chú của khách', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, canEdit: true });
    renderPage();
    const links = await screen.findAllByTestId('order-edit-open');
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toBe('Sửa');
    expect(links[0]!.getAttribute('aria-label')).toBe('Sửa địa chỉ và ghi chú đơn TT001');
    expect(links[0]!.className).toContain('tubu-hit-44');
    expect(screen.queryByTestId('order-edit-sheet-stub')).toBeNull();
    fireEvent.click(links[0]!);
    await waitFor(() => expect(screen.getByTestId('order-edit-sheet-stub')).toBeTruthy());
    expect(mocks.sheetProps).toMatchObject({ code: 'TT001', note: 'Gọi trước', split: false, address: expect.objectContaining({ wardCode: '84_VN7926740' }) });
    (mocks.sheetProps!.onClose as () => void)();
    await waitFor(() => expect(screen.queryByTestId('order-edit-sheet-stub')).toBeNull());
  });
});
