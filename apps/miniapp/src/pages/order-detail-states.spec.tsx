import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  getCart: vi.fn().mockResolvedValue({ items: [] }),
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

// Gói hl: mỗi trạng thái đơn đúng một nút chính, nút cấm không bao giờ hiện, mã vận đơn chép được, hành trình có aria-current.
const NOW = '2026-11-05T05:00:00.000Z';
const hoursFromNow = (h: number) => new Date(Date.parse(NOW) + h * 3_600_000).toISOString();

const REVIEWED_ITEMS = [{ ...ORDER.items[0]!, reviewId: 'r1' }];
const SHIPPING_HISTORY = [
  { at: hoursFromNow(-30), status: 'Chờ lấy hàng' },
  { at: hoursFromNow(-24), status: 'Đã lấy hàng' },
  { at: hoursFromNow(-6), status: 'Đang vận chuyển' },
  { at: hoursFromNow(-1), status: 'Đang giao hàng' },
];

interface StateRow {
  name: string;
  order: Record<string, unknown>;
  primary: string;
  menu: string[];
  absent: string[];
}

const STATES: StateRow[] = [
  {
    name: 'chờ chuyển khoản còn hạn',
    order: { status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', paymentDeadline: hoursFromNow(2), canCancel: true },
    primary: 'Thanh toán ngay',
    menu: ['Huỷ đơn', 'Liên hệ Tubu'],
    absent: ['Mua lại đơn này', 'Yêu cầu đổi/trả', 'Đánh giá sản phẩm'],
  },
  {
    name: 'chờ chuyển khoản, Tubu xử lý tay',
    order: { status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', paymentDeadline: hoursFromNow(2), canCancel: false, manualHandling: true },
    primary: 'Liên hệ Tubu',
    menu: [],
    absent: ['Thanh toán ngay', 'Huỷ đơn', 'Mua lại đơn này'],
  },
  {
    name: 'đã xác nhận, huỷ được',
    order: { status: 'CONFIRMED', canCancel: true },
    primary: 'Huỷ đơn',
    menu: ['Liên hệ Tubu'],
    absent: ['Thanh toán ngay', 'Mua lại đơn này', 'Yêu cầu đổi/trả'],
  },
  {
    name: 'đóng gói, API báo không huỷ được',
    order: { status: 'PACKED', canCancel: false },
    primary: 'Liên hệ Tubu',
    menu: [],
    absent: ['Huỷ đơn', 'Thanh toán ngay', 'Mua lại đơn này'],
  },
  {
    name: 'hãng đã nhận hàng',
    order: { status: 'PACKED', shippingCode: 'GHN123', shippingPartner: 'Giao Hàng Nhanh' },
    primary: 'Liên hệ Tubu',
    menu: [],
    absent: ['Huỷ đơn', 'Thanh toán ngay', 'Mua lại đơn này'],
  },
  {
    name: 'đang giao',
    order: { status: 'SHIPPING', shippingCode: 'GHN6789012345', shippingPartner: 'Giao Hàng Nhanh', shippingHistory: SHIPPING_HISTORY },
    primary: 'Liên hệ Tubu',
    menu: [],
    absent: ['Huỷ đơn', 'Thanh toán ngay', 'Mua lại đơn này', 'Yêu cầu đổi/trả', 'Xem tất cả đơn'],
  },
  {
    name: 'đã giao, còn dòng chưa đánh giá',
    order: { status: 'DELIVERED', deliveredAt: hoursFromNow(-24) },
    primary: 'Đánh giá sản phẩm',
    menu: ['Mua lại đơn này', 'Yêu cầu đổi/trả', 'Liên hệ Tubu'],
    absent: ['Huỷ đơn', 'Thanh toán ngay'],
  },
  {
    name: 'đã giao, đã đánh giá hết',
    order: { status: 'DELIVERED', deliveredAt: hoursFromNow(-24), items: REVIEWED_ITEMS },
    primary: 'Mua lại đơn này',
    menu: ['Yêu cầu đổi/trả', 'Liên hệ Tubu'],
    absent: ['Huỷ đơn', 'Thanh toán ngay', 'Đánh giá sản phẩm'],
  },
  {
    name: 'đã giao quá hạn đổi/trả',
    order: { status: 'DELIVERED', deliveredAt: hoursFromNow(-24 * 10), items: REVIEWED_ITEMS },
    primary: 'Mua lại đơn này',
    menu: ['Liên hệ Tubu'],
    absent: ['Yêu cầu đổi/trả', 'Huỷ đơn'],
  },
  {
    name: 'đã huỷ',
    order: { status: 'CANCELLED', canCancel: false },
    primary: 'Mua lại đơn này',
    menu: ['Liên hệ Tubu'],
    absent: ['Huỷ đơn', 'Thanh toán ngay', 'Yêu cầu đổi/trả'],
  },
  {
    name: 'đã hoàn',
    order: { status: 'RETURNED', paymentStatus: 'PAID' },
    primary: 'Mua lại đơn này',
    menu: ['Liên hệ Tubu'],
    absent: ['Huỷ đơn', 'Thanh toán ngay'],
  },
];

describe('OrderDetailPage — nút theo trạng thái (gói hl)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    mocks.fetchMyReturns.mockResolvedValue([]);
    mocks.getPublicConfig.mockResolvedValue({ shippingEta: { minDays: 1, maxDays: 3 }, returnWindowDays: 7, waste: {} });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const bar = () => screen.getByTestId('sticky-bar');
  const barButtons = () =>
    Array.from(bar().querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '');

  it.each(STATES)('$name', async (row) => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, createdAt: hoursFromNow(-48), updatedAt: hoursFromNow(-2), ...row.order });
    renderPage();
    await screen.findByTestId('sticky-bar');
    const top = barButtons().filter((n) => n !== 'Thêm thao tác');
    expect(top).toEqual([row.primary]);
    expect(barButtons().includes('Thêm thao tác')).toBe(row.menu.length > 0);
    for (const name of row.absent) expect(screen.queryByRole('button', { name })).toBeNull();
    if (row.menu.length > 0) {
      fireEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }));
      const group = await screen.findByRole('group', { name: 'Thao tác với đơn' });
      expect(Array.from(group.querySelectorAll('[role="button"]')).map((n) => n.textContent?.trim())).toEqual(row.menu);
    }
  });

  it('chờ chuyển khoản: hero ghi hạn trả kèm thời gian còn lại, nút chính nằm cạnh dòng còn bao lâu', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, ...STATES[0]!.order, createdAt: hoursFromNow(-1), updatedAt: hoursFromNow(-1) });
    renderPage();
    expect(await screen.findByText(/Thanh toán trước 14:00 05\/11, còn 2 giờ/)).toBeInTheDocument();
    expect(screen.getByText('Đơn đang chờ bạn thanh toán.')).toBeInTheDocument();
    expect(within(bar()).getByText(/Còn 2 giờ/)).toBeInTheDocument();
  });

  it('đang giao: hành trình có đúng một bước aria-current, mốc hãng mới nhất trên cùng, mã vận đơn chép được', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, createdAt: hoursFromNow(-48), updatedAt: hoursFromNow(-1), ...STATES[5]!.order });
    renderPage();
    const list = await screen.findByRole('list', { name: 'Hành trình đơn hàng' });
    const current = list.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain('Đang giao');
    const events = () => within(within(list).getByRole('list', { name: 'Mốc vận chuyển' })).getAllByRole('listitem').map((e) => e.querySelector('div')?.textContent);
    expect(events()).toEqual(['Đang giao hàng', 'Đang vận chuyển', 'Đã lấy hàng']);
    expect(screen.getByTestId('track-events-toggle')).toHaveTextContent('Xem thêm 1 mốc vận chuyển');
    fireEvent.click(screen.getByTestId('track-events-toggle'));
    expect(events()).toEqual(['Đang giao hàng', 'Đang vận chuyển', 'Đã lấy hàng', 'Chờ lấy hàng']);
    expect(screen.getByText('Giao Hàng Nhanh')).toBeInTheDocument();
    mocks.copyText.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã vận đơn GHN6789012345' }));
    expect(mocks.copyText).toHaveBeenCalledWith('GHN6789012345');
    await waitFor(() => expect(screen.getByTestId('order-shipping')).toHaveTextContent('Đã sao chép mã vận đơn'));
  });

  it.each(STATES)('khối "Cần hỗ trợ?" ở cuối nội dung trang, trước thanh nút: $name', async (row) => {
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 7, support: { hotline: '0984 606 774', email: null, zaloOaName: null } });
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, createdAt: hoursFromNow(-48), updatedAt: hoursFromNow(-2), ...row.order });
    renderPage();
    const bar = await screen.findByTestId('sticky-bar');
    const [title] = await screen.findAllByText('Cần hỗ trợ?');
    expect(within(title!.parentElement!).getByRole('button', { name: /Gọi hotline 0984 606 774/ })).toBeInTheDocument();
    const hero = screen.getByTestId('status-hero');
    expect(hero.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title!.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('"Liên hệ Tubu" mở bảng liên hệ, không chuyển trang', async () => {
    mocks.getPublicConfig.mockResolvedValue({ returnWindowDays: 7, support: { hotline: '0984 606 774', email: null, zaloOaName: null } });
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, createdAt: hoursFromNow(-48), updatedAt: hoursFromNow(-1), ...STATES[5]!.order });
    renderPage();
    fireEvent.click(await within(await screen.findByTestId('sticky-bar')).findByRole('button', { name: 'Liên hệ Tubu' }));
    expect(await screen.findByRole('dialog', { name: 'Liên hệ Tubu' })).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('đơn huỷ chưa có vận chuyển, lịch sử vận chuyển rỗng: không rơi chữ số 0 ra trang', async () => {
    mocks.fetchOrder.mockResolvedValue({ ...ORDER, status: 'CANCELLED', createdAt: hoursFromNow(-30), updatedAt: hoursFromNow(-5), shippingHistory: [], statusTimes: { CANCELLED: hoursFromNow(-6) } });
    const { container } = renderPage();
    await screen.findByText('Đơn đã huỷ.');
    expect(container.querySelector('[data-testid="order-shipping"]')).toBeNull();
    const hero = screen.getByTestId('status-hero');
    expect(hero.nextSibling?.textContent ?? '').not.toBe('0');
    expect(within(container).queryByText(/^0$/)).toBeNull();
  });

  it('đơn huỷ mà lịch sử vận chuyển toàn dòng rác: không dựng khung vận chuyển trống', async () => {
    mocks.fetchOrder.mockResolvedValue({
      ...ORDER,
      status: 'CANCELLED',
      createdAt: hoursFromNow(-30),
      updatedAt: hoursFromNow(-5),
      statusTimes: { CANCELLED: hoursFromNow(-6) },
      shippingHistory: [{ at: hoursFromNow(-6) }, { at: hoursFromNow(-5), status: '', code: null }, null],
    });
    const { container } = renderPage();
    await screen.findByText('Đơn đã huỷ.');
    expect(container.querySelector('[data-testid="order-shipping"]')).toBeNull();
    const emptyFrames = Array.from(container.querySelectorAll<HTMLElement>('div')).filter(
      (d) => d.style.background.includes('--color-bg-surface') && d.childElementCount === 0 && !d.textContent?.trim(),
    );
    expect(emptyFrames).toHaveLength(0);
  });

  it('đơn chuyển khoản đã huỷ mà API chưa trả cancelReason: chỉ nói "Đơn đã huỷ.", không suy ra lý do quá hạn thanh toán', async () => {
    const base = { ...ORDER, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', createdAt: hoursFromNow(-30), updatedAt: hoursFromNow(-5) };
    mocks.fetchOrder.mockResolvedValue({ ...base, paymentDeadline: hoursFromNow(-6), statusTimes: { CANCELLED: hoursFromNow(-6) } });
    renderPage();
    expect(await screen.findByText('Đơn đã huỷ.')).toBeInTheDocument();
    expect(screen.queryByText(/quá hạn thanh toán/)).toBeNull();
    expect(screen.queryByTestId('order-cancel-reason')).toBeNull();
  });

  it('đơn huỷ API trả cancelReason: khối đầu trang hiện đúng câu lý do (lời khách, tự huỷ quá hạn, Tubu huỷ)', async () => {
    const base = { ...ORDER, status: 'CANCELLED', createdAt: hoursFromNow(-30), updatedAt: hoursFromNow(-5), statusTimes: { CANCELLED: hoursFromNow(-6) } };
    for (const reason of ['Bạn đã huỷ: Đổi ý, không muốn mua nữa', 'Đơn tự huỷ vì quá hạn thanh toán', 'Tubu Tree đã huỷ đơn này. Cần biết thêm, bạn liên hệ CSKH.']) {
      mocks.fetchOrder.mockResolvedValue({ ...base, cancelReason: reason });
      const { unmount } = renderPage();
      const hero = await screen.findByTestId('status-hero');
      expect(within(hero).getByTestId('order-cancel-reason')).toHaveTextContent(reason);
      unmount();
    }
  });
});
