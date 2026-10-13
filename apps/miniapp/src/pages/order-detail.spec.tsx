import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  fetchOrder: vi.fn(),
  fetchMyReturns: vi.fn(),
  getPublicConfig: vi.fn(),
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
  getPublicConfig: mocks.getPublicConfig,
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
import { STATUS_COLOR } from '../utils/order-status';

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

describe('OrderDetailPage — điểm, mốc giờ, hành trình, đổi/trả, hỗ trợ (BUYERMINI-14/15/16/19)', () => {
  const NOW = Date.now();
  const daysAgo = (d: number) => new Date(NOW - d * 864e5).toISOString();
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 7 });
  });

  it('đơn đang giao: "Nhận +N khi giao thành công"; đơn đã hoàn: điểm đã thu hồi', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING', pointsEarned: 35 });
    const first = renderPage();
    expect(await screen.findByText('Nhận +35 Điểm Xanh khi giao thành công')).toBeInTheDocument();
    first.unmount();

    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'RETURNED', pointsEarned: 35 });
    renderPage();
    expect(await screen.findByText('Điểm Xanh của đơn này đã được thu hồi')).toBeInTheDocument();
    expect(screen.queryByText(/khi giao thành công/)).toBeNull();
  });

  it('đơn đã giao ghi "Giao lúc" theo mốc giao; đơn khác ghi "Đặt lúc" theo giờ tạo đơn', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'DELIVERED', deliveredAt: new Date(2026, 9, 5, 9, 30).toISOString() });
    const first = renderPage();
    expect(await screen.findByText('09:30 05/10/2026')).toBeInTheDocument();
    expect(screen.getByText(/Giao lúc/)).toBeInTheDocument();
    first.unmount();

    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING' });
    renderPage();
    expect(await screen.findByText(/Đặt lúc/)).toBeInTheDocument();
  });

  it('đơn COD không có bước "Chờ thanh toán" trong hành trình; chuyển khoản thì có', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING', paymentMethod: 'COD' });
    const cod = renderPage();
    await screen.findByText('Hành trình đơn hàng');
    expect(screen.queryByText('Chờ thanh toán')).toBeNull();
    expect(screen.getByText('Đã xác nhận')).toBeInTheDocument();
    cod.unmount();

    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING', paymentMethod: 'BANK_TRANSFER' });
    renderPage();
    expect(await screen.findByText('Chờ thanh toán')).toBeInTheDocument();
  });

  it('trong hạn đổi/trả: có nút, icon nằm cùng hàng chữ và câu hướng dẫn theo số ngày cấu hình', async () => {
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 14 });
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'DELIVERED', deliveredAt: daysAgo(10) });
    renderPage();
    const btn = await screen.findByRole('button', { name: /Yêu cầu đổi\/trả/ });
    expect(btn.querySelector('svg')).not.toBeNull();
    fireEvent.click(btn);
    expect(await screen.findByText(/Trong 14 ngày từ khi nhận hàng/)).toBeInTheDocument();
  });

  it('quá hạn đổi/trả: ẩn nút, nói rõ đã quá hạn theo số ngày cấu hình', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'DELIVERED', deliveredAt: daysAgo(10) });
    renderPage();
    expect(await screen.findByText(/Đã quá hạn đổi\/trả \(7 ngày/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Yêu cầu đổi\/trả/ })).toBeNull();
  });

  it('chưa gắn OA vẫn có đường liên hệ thật: gọi hotline', async () => {
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 7, support: { hotline: '0899 149 229', email: null, zaloOaName: null } });
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING' });
    renderPage();
    expect(await screen.findByRole('button', { name: /Gọi hotline/ })).toBeInTheDocument();
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

  it('lối vào đánh giá và dòng điểm Xanh (đơn đã giao) có icon SVG, không có emoji; chữ giữ nguyên', async () => {
    const { container } = renderPage();
    const review = await screen.findByText(/Đánh giá sản phẩm này/);
    expect(review.querySelector('svg')).not.toBeNull();
    expect(review.className).toContain('tubu-hit-44');
    const points = screen.getByText(/Đã cộng \+120 Điểm Xanh vào tài khoản/);
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

// axe color-contrast (serious) ở khung trạng thái: chữ ngày giờ dùng opacity 0.8 trên cặp màu trạng thái, riêng
// "chờ thanh toán" #8A5300 trên #FFF4E0 rơi từ 5,81 xuống 3,84 (ngưỡng 4,5). Opacity làm chữ nhạt hơn mức token
// đã cho; ý "phụ" được giữ bằng cỡ chữ xSmall không đậm dưới tiêu đề trạng thái.
const TOKENS = readFileSync(join(process.cwd(), '../../packages/design-tokens/src/tokens.css'), 'utf8');
function resolveToken(ref: string): string {
  const name = ref.match(/^var\((--[\w-]+)\)$/)![1]!;
  const value = TOKENS.match(new RegExp(`${name}:\\s*([^;]+);`))![1]!.trim();
  return value.startsWith('var(') ? resolveToken(value) : value;
}
function luminance(hex: string): number {
  const ch = (at: number) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
}
function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('OrderDetailPage — tương phản chữ ngày giờ ở khung trạng thái (axe color-contrast)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  it.each(Object.keys(STATUS_COLOR))('%s: chữ ngày giờ không bị làm mờ bằng opacity', async (status) => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status });
    renderPage();
    const stamps = await screen.findAllByText('10:00 01/10/2026');
    for (const el of stamps) {
      const opacity = el.style.opacity;
      expect(opacity === '' || Number(opacity) === 1, `opacity=${opacity}`).toBe(true);
    }
  });

  it.each(Object.entries(STATUS_COLOR))('%s: cặp màu token đầy đủ (không opacity) đạt 4,5:1', (_status, { bg, fg }) => {
    expect(contrast(resolveToken(fg), resolveToken(bg))).toBeGreaterThanOrEqual(4.5);
  });
});
