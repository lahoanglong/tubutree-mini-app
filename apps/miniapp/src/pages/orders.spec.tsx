import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), fetchOrders: vi.fn(), fetchPurchasedItems: vi.fn(), repurchaseOrder: vi.fn(),
  getSubscriptions: vi.fn(), search: '',
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/orders', search: mocks.search, state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  fetchOrders: mocks.fetchOrders,
  fetchPurchasedItems: mocks.fetchPurchasedItems,
  repurchaseOrder: mocks.repurchaseOrder,
  addToCart: vi.fn(),
  getPublicConfig: vi.fn().mockResolvedValue({ subscribeDiscountPct: 0.12 }),
}));
vi.mock('../services/subscriptions-api', () => ({
  getSubscriptions: mocks.getSubscriptions, setSubscriptionStatus: vi.fn(), skipSubscriptionCycle: vi.fn(),
}));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }) }));
vi.mock('../services/buy-flow-events', () => ({ trackReorderClicked: vi.fn(), trackReorderCompleted: vi.fn() }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

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

  it('tiêu đề "Đơn hàng", không có nút Quay lại; 7 tab gồm "Định kỳ"', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Đơn hàng' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Tất cả', 'Chờ thanh toán', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã hủy/hoàn', 'Định kỳ',
    ]);
    expect(await screen.findByRole('button', { name: 'Đơn TUBU-777' })).toBeInTheDocument();
    expect(mocks.fetchOrders).toHaveBeenCalledWith({}, 1, 20);
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
    const card = await screen.findByRole('button', { name: 'Đơn TUBU-777' });
    fireEvent.click(card.querySelector('button.tubu-btn') as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm vào giỏ (2)' }));
    await waitFor(() =>
      expect(mocks.repurchaseOrder).toHaveBeenCalledWith('TUBU-777', { items: [{ orderItemId: 'i1', quantity: 2 }], addSource: 'repurchase' }),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
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
