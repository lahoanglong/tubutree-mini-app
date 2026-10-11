import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  fetchOrder: vi.fn(),
  fetchMyReturns: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useParams: () => ({ code: 'TT001' }),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/orders/TT001', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  fetchOrder: mocks.fetchOrder,
  fetchOrders: vi.fn(),
  fetchMyReturns: mocks.fetchMyReturns,
  cancelOrder: vi.fn(),
  requestReturn: vi.fn(),
  addToCart: vi.fn(),
  repurchaseOrder: vi.fn(),
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

import OrderDetailPage from './order-detail';

const ORDER = {
  id: 'o1',
  code: 'TT001',
  status: 'DELIVERED',
  paymentMethod: 'COD',
  paymentStatus: 'PAID',
  createdAt: '2026-10-01T03:00:00.000Z',
  subtotal: 100_000,
  discount: 0,
  pointsUsed: 0,
  pointsEarned: 0,
  shippingFee: 20_000,
  total: 120_000,
  hasRecyclingPickup: false,
  shippingAddress: { recipient: 'Ánh', phone: '0911111111', street: '1 Lê Lợi', ward: 'Phường Bến Nghé', province: 'TP. Hồ Chí Minh' },
  items: [
    { id: 'oi1', productName: 'Xà bông thảo mộc', variationName: 'Sả', productSlug: 'xa-bong', quantity: 2, total: 100_000, backorderedQty: 0 },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrderDetailPage />
    </QueryClientProvider>,
  );
}

describe('OrderDetailPage — vùng chạm >= 44px (C-021)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOrder.mockResolvedValue(ORDER);
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  it('đơn đã giao: lối vào "Đánh giá" có vùng chạm 44px và mở trang sản phẩm', async () => {
    renderPage();
    const link = await screen.findByText(/Đánh giá/);
    expect(link.className).toContain('tubu-hit-44');
    fireEvent.click(link);
    expect(mocks.navigate).toHaveBeenCalledWith('/product/xa-bong');
  });
});

describe('OrderDetailPage — lịch sử vận chuyển bằng tiếng Việt (C-120)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  const withShipping = (shippingHistory: unknown[], extra: Record<string, unknown> = {}) => ({
    ...ORDER,
    status: 'SHIPPING',
    shippingPartner: 'GHN',
    shippingCode: 'GHN001',
    shippingHistory,
    ...extra,
  });

  it('mã hãng "delivering" hiện "Đang giao hàng", không lộ mã gốc', async () => {
    mocks.fetchOrder.mockResolvedValue(
      withShipping([{ at: '2026-10-02T03:00:00.000Z', status: 'delivering', carrier: 'GHN', code: 'GHN001' }], {
        shippingStatus: 'delivering',
      }),
    );
    const { container } = renderPage();
    await screen.findByText('Mã vận đơn:', { exact: false });
    expect(screen.getAllByText('Đang giao hàng').length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).not.toContain('delivering');
  });

  it('mã lạ → "Đang cập nhật"; trạng thái rỗng → "—"; chuỗi tiếng Việt giữ nguyên', async () => {
    mocks.fetchOrder.mockResolvedValue(
      withShipping([
        { at: '2026-10-02T03:00:00.000Z', status: 'Đã lấy hàng', carrier: 'GHN', code: 'GHN001' },
        { at: '2026-10-02T05:00:00.000Z', status: 'xyz_weird_code', carrier: 'GHN', code: 'GHN001' },
        { at: '2026-10-02T06:00:00.000Z', status: null, carrier: 'GHN', code: 'GHN001' },
      ]),
    );
    const { container } = renderPage();
    await screen.findByText('Mã vận đơn:', { exact: false });
    expect(screen.getByText('Đã lấy hàng')).toBeInTheDocument();
    expect(screen.getByText('Đang cập nhật')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.textContent).not.toContain('xyz_weird_code');
  });

  it('mốc thời gian hiện dạng "HH:mm dd/MM/yyyy" cùng một kiểu với các màn khác', async () => {
    mocks.fetchOrder.mockResolvedValue(
      withShipping([{ at: new Date(2026, 9, 2, 8, 5).toISOString(), status: 'delivered', carrier: 'GHN', code: 'GHN001' }]),
    );
    renderPage();
    await screen.findByText('Mã vận đơn:', { exact: false });
    expect(screen.getByText('08:05 02/10/2026')).toBeInTheDocument();
  });

  it('điểm đã dùng có dấu nghìn: "12.000 điểm"', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, pointsUsed: 12_000, discount: 12_000 });
    renderPage();
    expect(await screen.findByText('12.000 điểm')).toBeInTheDocument();
  });
});

// Cùng dải với scripts/uiux/static-scan.mjs, thêm ⌛ ⏳ ⭐.
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿\u231A\u231B\u23E9-\u23FF\u2B50]/u;

describe('OrderDetailPage — không dùng emoji làm icon (C-113)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, pointsEarned: 120 });
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  it('lối vào đánh giá và dòng điểm Xanh có icon SVG, không có emoji; chữ giữ nguyên', async () => {
    const { container } = renderPage();
    const review = await screen.findByText(/Đánh giá sản phẩm này/);
    expect(review.querySelector('svg')).not.toBeNull();
    expect(review.className).toContain('tubu-hit-44');
    const points = screen.getByText(/\+120 điểm Xanh khi giao thành công/);
    expect(points.querySelector('svg')).not.toBeNull();
    expect(EMOJI.test(container.textContent ?? '')).toBe(false);
  });

  it.each([
    ['APPROVED', undefined, 'Đổi/trả đã duyệt — tiền hoàn vào Ví Tubu'],
    ['REJECTED', 'Hàng đã qua sử dụng', 'Đổi/trả bị từ chối: Hàng đã qua sử dụng'],
    ['REJECTED', undefined, 'Đổi/trả bị từ chối'],
    ['PENDING', undefined, 'Yêu cầu đổi/trả đang xử lý (trong 24h)'],
  ])('yêu cầu đổi/trả %s: hiện đúng chữ, icon SVG thay emoji', async (status, adminNote, label) => {
    mocks.fetchMyReturns.mockResolvedValue([{ orderId: 'o1', status, adminNote }]);
    const { container } = renderPage();
    const line = await screen.findByText(label);
    expect(line.querySelector('svg')).not.toBeNull();
    expect(EMOJI.test(container.textContent ?? '')).toBe(false);
  });
});
