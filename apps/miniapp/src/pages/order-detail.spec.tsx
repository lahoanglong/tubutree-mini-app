import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { HttpError } from '../services/http';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  fetchOrder: vi.fn(),
  fetchMyReturns: vi.fn(),
  getPublicConfig: vi.fn(),
  cancelOrder: vi.fn(),
  fetchMyRefunds: vi.fn(),
  fetchRefundBank: vi.fn(),
  getWasteRequestByOrder: vi.fn(),
  copyText: vi.fn(),
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
  cancelOrder: mocks.cancelOrder,
  fetchMyRefunds: mocks.fetchMyRefunds,
  fetchRefundBank: mocks.fetchRefundBank,
  chooseRefundDestination: vi.fn(),
  requestReturn: vi.fn(),
  addToCart: vi.fn(),
  repurchaseOrder: vi.fn(),
}));
vi.mock('../services/waste-api', async (orig) => ({
  ...(await orig<object>()),
  getWasteRequestByOrder: mocks.getWasteRequestByOrder,
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
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));

import OrderDetailPage from './order-detail';
import { STATUS_COLOR } from '../utils/order-status';
import { makeRequestDetail } from '../services/waste-test-fixtures';

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

  it('đơn đã giao: lối vào "Viết đánh giá" có vùng chạm 44px và mở trang sản phẩm kèm đúng đơn để viết cho lần mua này', async () => {
    renderPage();
    const link = await screen.findByText(/Viết đánh giá/);
    expect(link.className).toContain('tubu-hit-44');
    fireEvent.click(link);
    expect(mocks.navigate).toHaveBeenCalledWith('/product/xa-bong', { state: { reviewOrderId: 'o1' } });
  });
});

describe('OrderDetailPage — giải thích vì sao không còn nút huỷ (R6-BUYER-10)', () => {
  const NOTE = 'Đơn đã giao cho đơn vị vận chuyển nên không huỷ được. Khi nhận hàng, bạn có thể gửi yêu cầu đổi/trả.';
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  it('đơn đang giao: có câu giải thích và không có nút huỷ', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING' });
    renderPage();
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
  });

  it('đơn đã xác nhận còn huỷ được: không có câu giải thích', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'CONFIRMED' });
    renderPage();
    await screen.findByText(/Chi tiết đơn hàng/);
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('đơn đã giao xong: không có câu giải thích', async () => {
    mocks.fetchOrder.mockResolvedValue(ORDER);
    renderPage();
    await screen.findByText(/Chi tiết đơn hàng/);
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

describe('OrderDetailPage — đơn không có (R6-BUYER-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  it('404 → "Không tìm thấy" kèm "Về trang chủ", không có "Thử lại"', async () => {
    mocks.fetchOrder.mockRejectedValue(new HttpError('nf', '404', { status: 404, data: {} }));
    renderPage();
    expect(await screen.findByText('Không tìm thấy đơn hàng này.')).toBeInTheDocument();
    expect(screen.queryByText('Thử lại')).toBeNull();
    fireEvent.click(screen.getByText('Về trang chủ'));
    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });

  it('lỗi máy chủ 5xx → vẫn "Thử lại"', async () => {
    mocks.fetchOrder.mockRejectedValue(new HttpError('boom', '500', { status: 500, data: {} }));
    renderPage();
    expect(await screen.findByText('Thử lại')).toBeInTheDocument();
    expect(screen.queryByText('Về trang chủ')).toBeNull();
  });
});

// R8: mỗi lần mua một đánh giá; API trả trạng thái đánh giá của từng dòng ở chính đơn này.
describe('OrderDetailPage — đánh giá theo từng dòng của đơn (R8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  const withItem = (extra: Record<string, unknown>) => ({ ...ORDER, items: [{ ...ORDER.items[0], ...extra }] });

  it('dòng đã đánh giá ở đơn này → "Sửa đánh giá", mở trang sản phẩm kèm đơn để sửa đúng đánh giá đó', async () => {
    mocks.fetchOrder.mockResolvedValue(withItem({ reviewId: 'r1', reviewable: false }));
    renderPage();
    fireEvent.click(await screen.findByText('Sửa đánh giá'));
    expect(screen.queryByText('Viết đánh giá')).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith('/product/xa-bong', { state: { reviewOrderId: 'o1' } });
  });

  it('dòng còn viết được → "Viết đánh giá"', async () => {
    mocks.fetchOrder.mockResolvedValue(withItem({ reviewId: null, reviewable: true }));
    renderPage();
    expect(await screen.findByText('Viết đánh giá')).toBeInTheDocument();
    expect(screen.queryByText('Sửa đánh giá')).toBeNull();
  });

  it('đơn không tính để đánh giá (vd. CTV đặt hộ) → không có lối vào đánh giá', async () => {
    mocks.fetchOrder.mockResolvedValue(withItem({ reviewId: null, reviewable: false }));
    renderPage();
    expect((await screen.findAllByText(/Xà bông thảo mộc/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Viết đánh giá|Sửa đánh giá/)).toBeNull();
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

  it('mã lạ → "Đang cập nhật"; trạng thái rỗng mà có mã vận đơn → "Đã gán mã vận đơn" (B-26); chuỗi tiếng Việt giữ nguyên', async () => {
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
    expect(screen.getByText('Đã gán mã vận đơn GHN001')).toBeInTheDocument();
    expect(container.textContent).not.toContain('—');
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

  it('R2-BUYERMINI-8: tóm tắt tiền tách mã giảm giá và Điểm Xanh bằng số tiền thật, không còn dòng "N điểm" trơ', async () => {
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER,
      discount: 98_000,
      couponCode: 'XANH10',
      couponDiscount: 38_000,
      pointsDiscount: 60_000,
      pointsUsed: 60,
    });
    renderPage();
    expect(await screen.findByText('Mã giảm giá (XANH10)')).toBeInTheDocument();
    expect(screen.getByText('-38.000đ')).toBeInTheDocument();
    expect(screen.getByText('Điểm Xanh (60 điểm)')).toBeInTheDocument();
    expect(screen.getByText('-60.000đ')).toBeInTheDocument();
    expect(screen.queryByText('Điểm Xanh đã dùng')).toBeNull();
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

  it('hành trình ghi giờ từng bước đã tới; bước chưa tới không có giờ; đơn huỷ ghi "Huỷ lúc"', async () => {
    const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).toISOString();
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER,
      status: 'PACKED',
      paymentMethod: 'COD',
      createdAt: at(1, 8, 0),
      statusTimes: { CONFIRMED: at(1, 8, 5), PACKED: at(2, 9, 30) },
    });
    const first = renderPage();
    await screen.findByText('Hành trình đơn hàng');
    expect(screen.getByText(/^08:05 01\/10/)).toBeInTheDocument();
    expect(screen.getByText(/^09:30 02\/10/)).toBeInTheDocument();
    expect(screen.getAllByText(/^\d\d:\d\d \d\d\/10/).length).toBeGreaterThanOrEqual(2);
    first.unmount();

    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'CANCELLED', createdAt: at(1, 8, 0), statusTimes: { CANCELLED: at(3, 14, 45) } });
    renderPage();
    expect(await screen.findByText(/Huỷ lúc/)).toBeInTheDocument();
    expect(screen.getByText('14:45 03/10/2026')).toBeInTheDocument();
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
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 7, support: { hotline: '0984 606 774', email: null, zaloOaName: null } });
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'SHIPPING' });
    renderPage();
    expect(await screen.findByRole('button', { name: /Gọi hotline/ })).toBeInTheDocument();
  });
});

// Cùng dải với scripts/uiux/static-scan.mjs, thêm ⌛ ⏳ ⭐.
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿\u231A\u231B\u23E9-\u23FF\u2B50]/u;

describe('OrderDetailPage — tự huỷ tới trước khi bàn giao vận chuyển (D1, BUYERMINI-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 7 });
  });

  it('đơn lẻ đang đóng gói vẫn có nút "Huỷ đơn"; đơn đại lý đang đóng gói / đơn đang giao thì không', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, type: 'RETAIL', status: 'PACKED', paymentStatus: 'UNPAID' });
    const packed = renderPage();
    expect(await screen.findByRole('button', { name: 'Huỷ đơn' })).toBeInTheDocument();
    packed.unmount();

    mocks.fetchOrder.mockResolvedValue({ ...ORDER, type: 'DEALER', status: 'PACKED', paymentStatus: 'UNPAID' });
    const dealer = renderPage();
    expect((await screen.findAllByText(/Xà bông/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
    dealer.unmount();

    mocks.fetchOrder.mockResolvedValue({ ...ORDER, type: 'RETAIL', status: 'SHIPPING', paymentStatus: 'UNPAID' });
    renderPage();
    expect((await screen.findAllByText(/Xà bông/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
  });

  it('R3-CANCEL-2: đang đóng gói mà kho đã đặt hãng (mã GHN) — chip "Đã đặt đơn vị vận chuyển", không có nút "Huỷ đơn"', async () => {
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER, type: 'RETAIL', status: 'PACKED', paymentStatus: 'UNPAID', shippingPartner: 'GHN', shippingCode: 'GHN1933', canCancel: false,
    });
    renderPage();
    expect(await screen.findByText('Đã đặt đơn vị vận chuyển')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
  });

  it('R5-SYNC-1: chờ chuyển khoản mà hàng đã bàn giao (Tubu xử lý tay) — câu trung tính, không hạn "tự huỷ", không nút huỷ hay trả tiền', async () => {
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER,
      type: 'RETAIL',
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      paymentDeadline: '2026-10-02T03:00:00.000Z',
      canCancel: false,
      manualHandling: true,
    });
    renderPage();
    expect(await screen.findByText('Tubu đang xử lý đơn này, liên hệ CSKH nếu cần hỗ trợ.')).toBeInTheDocument();
    expect(screen.queryByText(/quá hạn đơn sẽ tự huỷ/)).toBeNull();
    expect(screen.queryByText(/Thanh toán trước/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thanh toán ngay' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Xem tất cả đơn' })).toBeInTheDocument();
  });
});

describe('OrderDetailPage — không dùng emoji làm icon (C-113)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, pointsEarned: 120 });
    mocks.fetchMyReturns.mockResolvedValue([]);
  });

  it('lối vào đánh giá và dòng điểm Xanh (đơn đã giao) có icon SVG, không có emoji; chữ giữ nguyên', async () => {
    const { container } = renderPage();
    const review = await screen.findByText(/Viết đánh giá/);
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

describe('OrderDetailPage — huỷ đơn chọn nơi nhận tiền hoàn, hạn thanh toán (D2, BUYERMINI-8/9, MONEY-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.fetchMyRefunds.mockResolvedValue([]);
    mocks.fetchRefundBank.mockResolvedValue({ bankName: 'VCB', accountNumber: '0071000123456', accountName: 'TRAN THI B' });
    mocks.cancelOrder.mockResolvedValue({ ...ORDER, status: 'CANCELLED' });
  });

  const paidTransfer = { ...ORDER, status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', total: 114_000 };

  it('đơn chuyển khoản đã trả: chọn tài khoản ngân hàng → gửi nơi nhận kèm tài khoản điền sẵn', async () => {
    mocks.fetchOrder.mockResolvedValue(paidTransfer);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    expect(screen.getByText('Nhận lại 114.000đ về')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Tài khoản ngân hàng/ }));
    await waitFor(() => expect(screen.getByLabelText('Số tài khoản')).toHaveValue('0071000123456'));
    fireEvent.click(screen.getByRole('button', { name: /Đổi ý/ }));
    const buttons = screen.getAllByRole('button', { name: 'Huỷ đơn' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() =>
      expect(mocks.cancelOrder).toHaveBeenCalledWith('TT001', {
        refundMethod: 'BANK',
        bankName: 'VCB',
        accountNumber: '0071000123456',
        accountName: 'TRAN THI B',
      }, { cancelReasonCode: 'CHANGED_MIND' }),
    );
  });

  it('đơn chuyển khoản đã trả: giữ mặc định Ví Tubu → gửi refundMethod WALLET', async () => {
    mocks.fetchOrder.mockResolvedValue(paidTransfer);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    fireEvent.click(screen.getByRole('button', { name: /Đổi ý/ }));
    const buttons = screen.getAllByRole('button', { name: 'Huỷ đơn' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(mocks.cancelOrder).toHaveBeenCalledWith('TT001', { refundMethod: 'WALLET' }, { cancelReasonCode: 'CHANGED_MIND' }));
  });

  it('chưa chọn lý do: báo chọn lý do và không gọi API; "Lý do khác" có ô viết thêm và gửi kèm', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'CONFIRMED' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    expect(screen.queryByLabelText('Mô tả lý do huỷ')).toBeNull();
    const buttons = screen.getAllByRole('button', { name: 'Huỷ đơn' });
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(await screen.findByText('Bạn chọn lý do huỷ giúp Tubu nhé')).toBeInTheDocument();
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Lý do khác/ }));
    fireEvent.change(screen.getByLabelText('Mô tả lý do huỷ'), { target: { value: ' Con ốm ' } });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() =>
      expect(mocks.cancelOrder).toHaveBeenCalledWith('TT001', { refundMethod: 'WALLET' }, { cancelReasonCode: 'OTHER', cancelReasonText: 'Con ốm' }),
    );
  });

  it('R3-MONEY-1: đơn đang xử lý đã nhận tiền mà khách trả dư → khối Hoàn tiền hiện khoản trả dư', async () => {
    mocks.fetchOrder.mockResolvedValue(paidTransfer);
    mocks.fetchMyRefunds.mockResolvedValue([
      {
        id: 'r9', orderId: 'o1', orderCode: 'TT001', kind: 'OVERPAYMENT', amount: 114_000, method: 'MANUAL_TRANSFER', status: 'PENDING',
        bankName: null, bankAccountNo: null, bankAccountName: null, bankRef: null, completedAt: null,
        createdAt: '2026-10-14T00:00:00Z', canChooseDestination: true,
      },
    ]);
    renderPage();
    expect(await screen.findByText('Tiền bạn trả dư: chờ bạn chọn nơi nhận · 114.000đ')).toBeInTheDocument();
    expect(mocks.fetchMyRefunds).toHaveBeenCalledWith('o1');
  });

  it('đơn chuyển khoản chưa ghi nhận tiền: hiện hạn thanh toán và cảnh báo trước khi huỷ', async () => {
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      paymentDeadline: '2026-10-02T03:00:00.000Z',
    });
    renderPage();
    expect(await screen.findByText(/quá hạn đơn sẽ tự huỷ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ đơn' }));
    expect(screen.getByRole('note')).toHaveTextContent('Nếu bạn vừa chuyển khoản');
    fireEvent.click(screen.getByRole('button', { name: /Đổi ý/ }));
    const buttons = screen.getAllByRole('button', { name: 'Huỷ đơn' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(mocks.cancelOrder).toHaveBeenCalledWith('TT001', undefined, { cancelReasonCode: 'CHANGED_MIND' }));
  });

  it.each([
    ['còn hạn', 3_600_000, true],
    ['quá hạn (cron sắp huỷ)', -60_000, false],
  ])('đơn chuyển khoản chờ tiền %s: nút "Thanh toán ngay" theo hạn', async (_label, offsetMs, shown) => {
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      paymentDeadline: new Date(Date.now() + offsetMs).toISOString(),
      manualHandling: false,
    });
    renderPage();
    await screen.findByRole('button', { name: 'Huỷ đơn' });
    expect(screen.queryByRole('button', { name: 'Thanh toán ngay' }) !== null).toBe(shown);
  });

  it('đã duyệt trả một phần: hiện số tiền, dòng trả, trạng thái nhận hàng và cho trả thêm', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, deliveredAt: new Date().toISOString() });
    mocks.fetchMyReturns.mockResolvedValue([
      {
        id: 'r1',
        orderId: 'o1',
        status: 'APPROVED',
        refundMethod: 'WALLET',
        refundAmount: 50_000,
        shippingRefund: 0,
        receivedAt: null,
        items: [{ orderItemId: 'oi1', quantity: 1, refundAmount: 50_000 }],
      },
    ]);
    renderPage();
    expect(await screen.findByText('Đổi/trả đã duyệt — đã hoàn 50.000đ vào Ví Tubu')).toBeInTheDocument();
    expect(screen.getByText('Trả: Xà bông thảo mộc ×1')).toBeInTheDocument();
    expect(screen.getByText('Tubu sẽ liên hệ để nhận lại hàng.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trả thêm sản phẩm' })).toBeInTheDocument();
  });
});

describe('OrderDetailPage — đơn gian hàng tự giao và đơn cùng lần đặt (D4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 7 });
  });

  it('đơn gian hàng tự giao: nói rõ ai giao và hotline gian hàng; đơn cùng lần đặt chạm được để mở', async () => {
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER,
      code: 'TB2',
      status: 'CONFIRMED',
      fulfilment: { kind: 'MERCHANT', name: 'Mật ong Linh', phone: '0912000111' },
      siblings: [{ code: 'TB1', status: 'SHIPPING', total: 130_000, fulfillerName: 'Tubu Tree' }],
    });
    renderPage();
    expect(await screen.findByText('Giao bởi Mật ong Linh')).toBeInTheDocument();
    expect(screen.getByText(/Liên hệ gian hàng: 0912000111/)).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Đơn cùng lần đặt' });
    expect(region.textContent).toContain('Tubu Tree giao · Đang giao');
    expect(region.textContent).toContain('130.000đ');
    fireEvent.click(screen.getByRole('link', { name: 'Xem đơn TB1, Tubu Tree giao' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TB1');
  });

  it('đơn Tubu giao không tách: không có khối nơi giao', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, fulfilment: { kind: 'TUBU', name: 'Tubu Tree', phone: null }, siblings: [] });
    renderPage();
    await screen.findByText(/Xà bông thảo mộc/);
    expect(screen.queryByText(/Giao bởi/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Đơn cùng lần đặt' })).toBeNull();
  });
});

describe('OrderDetailPage — dòng yêu cầu thu rác (§12.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOrder.mockResolvedValue(ORDER);
    mocks.fetchMyReturns.mockResolvedValue([]);
  });
  it('đơn không thu kèm → không gọi /waste/requests/by-order, không có dòng', async () => {
    renderPage();
    await screen.findByText('TT001');
    expect(mocks.getWasteRequestByOrder).not.toHaveBeenCalled();
    expect(screen.queryByText(/Yêu cầu thu rác/)).toBeNull();
  });
  it('đơn thu kèm → dòng "Yêu cầu thu rác TR-…" dẫn tới trang theo dõi', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, hasRecyclingPickup: true, recyclingNote: 'TR-PICK1: 12 thùng' });
    mocks.getWasteRequestByOrder.mockResolvedValue(makeRequestDetail({ id: 'req-p', code: 'TR-PICK1', method: 'PICKUP', orderCode: 'TT001', orderId: 'o1' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Yêu cầu thu rác TR-PICK1/ }));
    expect(mocks.getWasteRequestByOrder).toHaveBeenCalledWith('o1');
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/r/req-p');
  });
  it('404 (đơn cũ trước đổi rác) → không có dòng, không báo lỗi', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, hasRecyclingPickup: true });
    mocks.getWasteRequestByOrder.mockRejectedValue(new HttpError('nf', 'ERR_BAD_REQUEST', { status: 404 }));
    renderPage();
    await screen.findByText('TT001');
    await waitFor(() => expect(mocks.getWasteRequestByOrder).toHaveBeenCalled());
    expect(screen.queryByText(/Yêu cầu thu rác/)).toBeNull();
  });
  it('không còn khối thu gom cũ; mã vận đơn Gomdon vẫn hiện như mọi đơn', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, hasRecyclingPickup: true, gomdonStatus: '3', recyclingNote: 'x', shippingCode: 'BE123456', shippingPartner: 'BestExpress' });
    mocks.getWasteRequestByOrder.mockResolvedValue(makeRequestDetail());
    const { container } = renderPage();
    await screen.findByText('TT001');
    expect(container.querySelector('#order-recycling')).toBeNull();
    expect(container.textContent).not.toMatch(/tài trợ 100% phí thu gom|Vật dụng gửi|tái chế/);
    expect(screen.getByText('BE123456')).toBeInTheDocument();
  });
});

describe('OrderDetailPage — không mở trang ngoài (Zalo 4.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.copyText.mockResolvedValue(true);
  });

  const shipped = (extra: Record<string, unknown> = {}) => ({
    ...ORDER,
    status: 'SHIPPING',
    shippingPartner: 'GHN',
    shippingCode: 'GHN001',
    trackingLink: 'https://ghn.vn/tra-cuu?code=GHN001',
    shippingHistory: [{ at: '2026-10-02T03:00:00.000Z', status: 'delivering', carrier: 'GHN', code: 'GHN001' }],
    ...extra,
  });

  it('vận đơn: hiện hãng, mã, hành trình và nút "Chép mã"; không có nút/link tra cứu trang hãng', async () => {
    mocks.fetchOrder.mockResolvedValue(shipped());
    renderPage();
    expect(await screen.findByText('GHN')).toBeInTheDocument();
    expect(screen.getByText('GHN001')).toBeInTheDocument();
    expect(screen.getAllByText('Đang giao hàng').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: 'Tra cứu hành trình' })).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Chép mã' }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('GHN001'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép mã vận đơn', type: 'success' }));
  });

  it('hoá đơn điện tử: chỉ chép đường dẫn, không mở ngoài', async () => {
    mocks.fetchOrder.mockResolvedValue(shipped({ invoiceStatus: 'ISSUED', invoiceUrl: 'https://hoadon.test/abc.pdf' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Chép đường dẫn' }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('https://hoadon.test/abc.pdf'));
    expect(screen.queryByRole('button', { name: 'Tải PDF' })).toBeNull();
  });
});
