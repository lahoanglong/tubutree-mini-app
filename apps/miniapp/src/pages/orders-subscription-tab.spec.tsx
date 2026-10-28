import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Cờ SUBSCRIPTIONS_IN_MINIAPP giữ nguyên (tắt): khách đặt gói trên web vẫn phải thấy tab Định kỳ, khách không có gói thì không.
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), fetchOrders: vi.fn(), fetchPurchasedItems: vi.fn(), getSubscriptions: vi.fn(), search: '', getNewCustomerOffer: vi.fn(),
  getPublicConfig: vi.fn().mockResolvedValue({ subscribeDiscountPct: 0.12 }),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/orders', search: mocks.search, state: null }),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  fetchOrders: mocks.fetchOrders,
  fetchPurchasedItems: mocks.fetchPurchasedItems,
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  repurchaseOrder: vi.fn(),
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
vi.mock('../components/home/best-seller-rail', () => ({ BestSellerRail: () => <div /> }));

import OrdersPage from './orders';

const PAGE = { data: [], meta: { page: 1, limit: 20, total: 0 } };
const SUB = (status: string) => ({
  id: `s-${status}`, quantity: 1, intervalWeeks: 4, status, nextRunAt: '2026-11-10T00:00:00.000Z', productName: 'Nước rửa chén', variationName: 'Chanh',
  thumbnail: null, slug: 'nrc', unitPrice: 65000, effectiveDiscountPct: 0.1,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OrdersPage /></QueryClientProvider>);
}
const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);

describe('OrdersPage: tab Định kỳ chỉ cho khách đã có gói (cờ Mini App tắt)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = '';
    mocks.fetchOrders.mockResolvedValue(PAGE);
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: false });
  });

  it('khách không có gói: 6 tab như cũ, không có "Định kỳ"', async () => {
    mocks.getSubscriptions.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalled());
    await waitFor(() => expect(mocks.fetchOrders).toHaveBeenCalled());
    expect(tabNames()).toEqual(['Tất cả', 'Chờ thanh toán', 'Đang xử lý', 'Đang giao', 'Đã giao', 'Đã huỷ/hoàn']);
  });

  it('khách chỉ có gói đã huỷ: vẫn không có tab Định kỳ', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB('CANCELLED')]);
    renderPage();
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalled());
    await waitFor(() => expect(mocks.fetchOrders).toHaveBeenCalled());
    expect(tabNames()).not.toContain('Định kỳ');
  });

  it.each(['ACTIVE', 'PAUSED'])('khách có gói %s: có tab "Định kỳ" ở cuối, bấm xem được gói và không có nút tạo gói', async (status) => {
    mocks.getSubscriptions.mockResolvedValue([SUB(status)]);
    renderPage();
    const tab = await screen.findByRole('tab', { name: 'Định kỳ' });
    expect(tabNames().at(-1)).toBe('Định kỳ');
    fireEvent.click(tab);
    expect(await screen.findByText('Nước rửa chén')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Đặt định kỳ|Tạo gói|Thêm gói/ })).toBeNull();
  });

  it('?tab=subscriptions (từ tin thông báo) khi khách có gói: mở thẳng tab Định kỳ, không tải danh sách đơn', async () => {
    mocks.search = '?tab=subscriptions';
    mocks.getSubscriptions.mockResolvedValue([SUB('ACTIVE')]);
    renderPage();
    const tab = await screen.findByRole('tab', { name: 'Định kỳ' });
    await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
    expect(mocks.fetchOrders).not.toHaveBeenCalled();
  });

  it('?tab=subscriptions khi khách không có gói: về tab Tất cả', async () => {
    mocks.search = '?tab=subscriptions';
    mocks.getSubscriptions.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(mocks.fetchOrders).toHaveBeenCalledWith({}, 1, 20));
    expect(screen.getByRole('tab', { name: 'Tất cả' })).toHaveAttribute('aria-selected', 'true');
  });
});
