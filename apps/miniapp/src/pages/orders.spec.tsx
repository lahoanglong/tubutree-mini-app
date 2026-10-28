import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), fetchOrders: vi.fn(), fetchPurchasedItems: vi.fn(), repurchaseOrder: vi.fn(),
  getSubscriptions: vi.fn(), search: '', getNewCustomerOffer: vi.fn(),
  getPublicConfig: vi.fn().mockResolvedValue({ subscribeDiscountPct: 0.12 }),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/orders', search: mocks.search, state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  fetchOrders: mocks.fetchOrders,
  fetchPurchasedItems: mocks.fetchPurchasedItems,
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  repurchaseOrder: mocks.repurchaseOrder,
  addToCart: vi.fn(),
  getPublicConfig: mocks.getPublicConfig,
  getAddresses: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/account-api', () => ({ getNewCustomerOffer: mocks.getNewCustomerOffer }));
vi.mock('../services/subscriptions-api', () => ({
  getSubscriptions: mocks.getSubscriptions, setSubscriptionStatus: vi.fn(), skipSubscriptionCycle: vi.fn(),
}));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }) }));
vi.mock('../services/buy-flow-events', () => ({ trackReorderClicked: vi.fn(), trackReorderCompleted: vi.fn() }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../components/home/best-seller-rail', () => ({ BestSellerRail: () => <div data-testid="best-seller-rail" /> }));

import { describeNested, findNestedInteractive } from '../components/ui/nested-interactive';
import OrdersPage from './orders';

const ORDER = {
  id: 'o1', code: 'TUBU-777', status: 'DELIVERED', total: 149000, createdAt: '2026-09-20T08:00:00.000Z',
  items: [
    { id: 'i1', variationId: 'v1', productName: 'Nước rửa chén', productSlug: 'nrc', variationName: 'Chanh', unitPrice: 65000, quantity: 2, total: 130000, backorderedQty: 0, stock: 9, available: true, currentPrice: 65000, thumbnail: null },
  ],
};
const PAGE = { data: [ORDER], meta: { page: 1, limit: 20, total: 1 } };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OrdersPage /></QueryClientProvider>);
}

describe('OrdersPage (tab gốc)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = '';
    mocks.fetchOrders.mockResolvedValue(PAGE);
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    mocks.getSubscriptions.mockResolvedValue([]);
  });

  it('tiêu đề "Đơn hàng", có nút Quay lại (trang con của Cá nhân); 7 tab gồm "Định kỳ"', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Đơn hàng' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Tất cả', 'Chờ thanh toán', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã huỷ/hoàn', 'Định kỳ',
    ]);
    expect(await screen.findByRole('button', { name: 'Đơn TUBU-777' })).toBeInTheDocument();
    expect(mocks.fetchOrders).toHaveBeenCalledWith({}, 1, 20);
  });

  it('R2-BUYERMINI-10: tab trạng thái đứng trước kệ Mua lại; kệ chỉ ở tab "Tất cả", nằm dưới danh sách đơn', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({
      items: [{ productId: 'p1', variationId: 'v1', slug: 'nrc', productName: 'Nước rửa chén', variationName: 'Chanh', brand: 'Tubu', thumbnail: null, price: 65000, salePrice: null, inStock: true, timesBought: 2 }],
      nextCursor: null,
    });
    renderPage();
    const rail = await screen.findByRole('region', { name: 'Mua lại' });
    const tabs = screen.getByRole('tablist');
    const card = await screen.findByRole('button', { name: 'Đơn TUBU-777' });
    expect(tabs.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Định kỳ' }));
    expect(screen.queryByRole('region', { name: 'Mua lại' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Đang giao' }));
    expect(screen.queryByRole('region', { name: 'Mua lại' })).toBeNull();
  });

  it('đơn chuyển khoản chờ thanh toán: nút "Thanh toán ngay" mở đúng màn chuyển khoản của đơn', async () => {
    mocks.fetchOrders.mockResolvedValue({
      data: [{ ...ORDER, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', paymentDeadline: new Date(Date.now() + 3_600_000).toISOString() }],
      meta: { page: 1, limit: 20, total: 1 },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thanh toán ngay' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/bank-payment/TUBU-777');
  });

  it('tab "Đang xử lý" gửi group=processing', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Đang xử lý' }));
    await waitFor(() => expect(mocks.fetchOrders).toHaveBeenCalledWith({ group: 'processing' }, 1, 20));
  });

  it('?tab=subscriptions → mở thẳng "Định kỳ", không tải danh sách đơn', async () => {
    mocks.search = '?tab=subscriptions';
    renderPage();
    expect(screen.getByRole('tab', { name: 'Định kỳ' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Chưa có lịch đặt định kỳ')).toBeInTheDocument();
    expect(mocks.fetchOrders).not.toHaveBeenCalled();
  });

  it('"Mua lại" trên thẻ → sheet → gửi repurchase → sang /cart', async () => {
    mocks.repurchaseOrder.mockResolvedValue({
      cart: { items: [], itemCount: 2 }, legacy: false, results: [{ orderItemId: 'i1', status: 'added', addedQuantity: 2 }],
    });
    renderPage();
    await screen.findByRole('button', { name: 'Đơn TUBU-777' });
    fireEvent.click(within(screen.getByTestId('order-card')).getByRole('button', { name: 'Mua lại' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ (2)' }));
    await waitFor(() =>
      expect(mocks.repurchaseOrder).toHaveBeenCalledWith('TUBU-777', { items: [{ orderItemId: 'i1', quantity: 2 }], addSource: 'repurchase' }),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
  });

  it('thẻ đơn có "Mua lại" mà không phần tử bấm được nào chứa phần tử focus được khác (axe nested-interactive)', async () => {
    const { container } = renderPage();
    await screen.findByRole('button', { name: 'Đơn TUBU-777' });
    expect(within(screen.getByTestId('order-card')).getByRole('button', { name: 'Mua lại' })).toBeInTheDocument();
    expect(findNestedInteractive(container).map(describeNested)).toEqual([]);
  });

  it('chạm thẻ → chi tiết đơn', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đơn TUBU-777' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TUBU-777');
  });

  it('tab khác "Tất cả" rỗng → thông báo nhẹ, không CTA mua đơn đầu', async () => {
    mocks.fetchOrders.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Đang giao' }));
    expect(await screen.findByText('Không có đơn nào ở mục này')).toBeInTheDocument();
  });

  it('còn trang sau → "Xem thêm" tải trang 2', async () => {
    mocks.fetchOrders
      .mockResolvedValueOnce({ data: [ORDER], meta: { page: 1, limit: 20, total: 21 } })
      .mockResolvedValueOnce({ data: [{ ...ORDER, id: 'o2', code: 'TUBU-778' }], meta: { page: 2, limit: 20, total: 21 } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
    expect(await screen.findByRole('button', { name: 'Đơn TUBU-778' })).toBeInTheDocument();
    expect(mocks.fetchOrders).toHaveBeenLastCalledWith({}, 2, 20);
    expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
  });

  it('tab "Tất cả" rỗng → trạng thái trống có CTA mua đơn đầu', async () => {
    mocks.fetchOrders.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu mua' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });

  it('lỗi tải → ErrorState, thử lại gọi lại API', async () => {
    mocks.fetchOrders.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(PAGE);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Thử lại/ }));
    expect(await screen.findByRole('button', { name: 'Đơn TUBU-777' })).toBeInTheDocument();
  });
});

// D5-10: dòng gợi ý trên màn đơn hàng trống chỉ nhắc voucher chào mừng khi khách thật sự có mã, số lấy từ chính mã đó.
describe('OrdersPage — đơn hàng trống chỉ nhắc voucher chào mừng khi khách thật sự có (D5-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = '';
    mocks.fetchOrders.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    mocks.getSubscriptions.mockResolvedValue([]);
    mocks.getPublicConfig.mockResolvedValue({
      subscribeDiscountPct: 0.12,
      newCustomer: { welcomeVoucher: { amount: 30000, minOrder: 199000 }, firstOrderFreeShip: { enabled: false, minSubtotal: 0 } },
    });
  });
  const voucher = (value: number, minOrder: number | null, type = 'AMOUNT') => ({
    code: 'WELCOME-U1', type, value, minOrder, endAt: '2026-11-20T00:00:00.000Z',
  });

  it('có mã chào mừng: số trong chữ theo mã của khách, không theo số cũ hay config', async () => {
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: true, welcomeVoucher: voucher(15000, 99000) });
    renderPage();
    expect(await screen.findByText('Đơn đầu từ 99.000đ dùng được mã giảm giá chào mừng 15.000đ')).toBeInTheDocument();
  });

  it('mã không đòi đơn tối thiểu: bỏ cụm "từ …"', async () => {
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: true, welcomeVoucher: voucher(30000, null) });
    renderPage();
    expect(await screen.findByText('Đơn đầu dùng được mã giảm giá chào mừng 30.000đ')).toBeInTheDocument();
  });

  it.each([
    ['khách mới nhưng chưa có mã (cron chưa chạy, đã dùng, hết hạn)', { isNewCustomer: true, welcomeVoucher: null }],
    ['không phải khách mới', { isNewCustomer: false, welcomeVoucher: null }],
    ['mã không phải giảm số tiền', { isNewCustomer: true, welcomeVoucher: voucher(10, 0, 'PERCENT') }],
    ['mã mệnh giá 0', { isNewCustomer: true, welcomeVoucher: voucher(0, 199000) }],
  ])('%s: không nhắc voucher dù config còn mệnh giá 30.000đ', async (_name, offer) => {
    mocks.getNewCustomerOffer.mockResolvedValue(offer);
    renderPage();
    expect(await screen.findByText('Bạn chưa có đơn nào')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getNewCustomerOffer).toHaveBeenCalled());
    expect(screen.queryByText(/mã giảm giá chào mừng/)).toBeNull();
  });

  it('không tải được ưu đãi khách mới: màn trống vẫn hiện, không nhắc voucher', async () => {
    mocks.getNewCustomerOffer.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByText('Bạn chưa có đơn nào')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getNewCustomerOffer).toHaveBeenCalled());
    expect(screen.queryByText(/mã giảm giá chào mừng/)).toBeNull();
  });

  it('đơn rỗng ở tab Tất cả: có hàng sản phẩm bán chạy dưới nút Bắt đầu mua; có đơn thì không có', async () => {
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: false, welcomeVoucher: null });
    const { unmount } = renderPage();
    await screen.findByText('Bạn chưa có đơn nào');
    expect(screen.getByTestId('best-seller-rail')).toBeInTheDocument();
    unmount();
    mocks.fetchOrders.mockResolvedValue(PAGE);
    renderPage();
    await screen.findByText(/TUBU-777/);
    expect(screen.queryByTestId('best-seller-rail')).toBeNull();
  });

  it('khách đã có đơn: không gọi API ưu đãi khách mới', async () => {
    mocks.fetchOrders.mockResolvedValue(PAGE);
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: true, welcomeVoucher: voucher(30000, 199000) });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Đơn TUBU-777' })).toBeInTheDocument();
    expect(mocks.getNewCustomerOffer).not.toHaveBeenCalled();
  });
});
