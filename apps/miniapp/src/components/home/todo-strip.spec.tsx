import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), fetchOrders: vi.fn(), active: 0, status: 'authenticated' }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ fetchOrders: mocks.fetchOrders }));
vi.mock('../../hooks/use-active-order-count', () => ({ useActiveOrderCount: () => mocks.active }));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { TodoStrip } from './todo-strip';

const FUTURE = new Date(Date.now() + 3 * 3600_000).toISOString();
const pendingOrder = { code: 'TUBU1', total: 250000, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PENDING', paymentDeadline: FUTURE };
const shippingOrder = { code: 'TUBU2', total: 100000, status: 'SHIPPING' };
const page = (rows: object[]) => ({ data: rows, meta: { page: 1, limit: 1, total: rows.length } });

function renderStrip() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><TodoStrip /></QueryClientProvider>);
}

describe('TodoStrip — Việc cần làm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
    mocks.active = 2;
    mocks.fetchOrders.mockImplementation(async (f: { status?: string }) => page(f.status === 'PENDING_PAYMENT' ? [pendingOrder] : f.status === 'SHIPPING' ? [shippingOrder] : []));
  });

  it('khách chưa đăng nhập hoặc không có đơn đang xử lý: không vẽ gì và không gọi API', () => {
    mocks.active = 0;
    const { container } = renderStrip();
    expect(container).toBeEmptyDOMElement();
    expect(mocks.fetchOrders).not.toHaveBeenCalled();
  });

  it('có đơn chờ thanh toán: nút "Thanh toán ngay" mở trang chuyển khoản; có đơn đang giao: dòng mở chi tiết đơn', async () => {
    renderStrip();
    const pay = await screen.findByRole('button', { name: /Thanh toán ngay/ });
    fireEvent.click(pay);
    expect(mocks.navigate).toHaveBeenCalledWith('/bank-payment/TUBU1');
    fireEvent.click(await screen.findByText(/TUBU2/));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/order/TUBU2');
  });

  it('không có việc (hai danh sách rỗng) → ẩn hẳn', async () => {
    mocks.fetchOrders.mockResolvedValue(page([]));
    const { container } = renderStrip();
    await waitFor(() => expect(mocks.fetchOrders).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('lỗi tải đơn → ẩn, không thẻ lỗi', async () => {
    mocks.fetchOrders.mockRejectedValue(new Error('boom'));
    const { container } = renderStrip();
    await waitFor(() => expect(mocks.fetchOrders).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
