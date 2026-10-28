import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), fetchOrders: vi.fn(), fetchActive: vi.fn(), status: 'authenticated' }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ fetchOrders: mocks.fetchOrders, fetchActiveOrderCount: mocks.fetchActive }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: { id: string } }) => unknown) => sel({ status: mocks.status, user: { id: 'u1' } }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { TODO_ROWS_KEY } from '@tubutree/app-core/home-layout';
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
    localStorage.clear();
    mocks.fetchActive.mockResolvedValue(2);
    mocks.fetchOrders.mockImplementation(async (f: { status?: string }) => page(f.status === 'PENDING_PAYMENT' ? [pendingOrder] : f.status === 'SHIPPING' ? [shippingOrder] : []));
  });

  it('không có đơn đang xử lý: không vẽ gì và không gọi danh sách đơn', async () => {
    mocks.fetchActive.mockResolvedValue(0);
    const { container } = renderStrip();
    await waitFor(() => expect(mocks.fetchActive).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(mocks.fetchOrders).not.toHaveBeenCalled();
  });

  it('có đơn chờ thanh toán: nút "Thanh toán ngay" mở trang chuyển khoản; có đơn đang giao: dòng mở chi tiết đơn', async () => {
    renderStrip();
    const pay = await screen.findByRole('button', { name: /Thanh toán ngay đơn TUBU1/ });
    fireEvent.click(pay);
    expect(mocks.navigate).toHaveBeenCalledWith('/bank-payment/TUBU1');
    fireEvent.click(await screen.findByText(/TUBU2/));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/order/TUBU2');
  });

  it('đơn COD vừa đặt (Đã xác nhận, Đang đóng gói) hiện dòng "đang chuẩn bị": một đơn mở chi tiết, nhiều đơn mở tab Đang xử lý', async () => {
    const prep = { code: 'TUBU3', total: 90000, status: 'CONFIRMED' };
    mocks.fetchOrders.mockImplementation(async (f: { status?: string; group?: string }) =>
      f.group === 'processing' ? page([prep]) : page([]),
    );
    const first = renderStrip();
    fireEvent.click(await screen.findByText('Đơn TUBU3 đang chuẩn bị'));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/order/TUBU3');
    first.unmount();
    mocks.fetchOrders.mockImplementation(async (f: { group?: string }) => (f.group === 'processing' ? { data: [prep], meta: { page: 1, limit: 1, total: 2 } } : page([])));
    renderStrip();
    fireEvent.click(await screen.findByText('2 đơn đang chuẩn bị'));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/orders?tab=processing');
  });

  it('đủ ba loại đơn thì chỉ hai dòng (chờ thanh toán, đang giao): khối vẫn gọn', async () => {
    mocks.fetchOrders.mockImplementation(async (f: { status?: string; group?: string }) =>
      page(f.status === 'PENDING_PAYMENT' ? [pendingOrder] : f.status === 'SHIPPING' ? [shippingOrder] : f.group === 'processing' ? [{ code: 'TUBU3', total: 1, status: 'CONFIRMED' }] : []),
    );
    renderStrip();
    await screen.findByText(/TUBU2/);
    expect(screen.queryByText(/TUBU3/)).toBeNull();
  });

  it('không có việc (hai danh sách rỗng) → ẩn hẳn', async () => {
    mocks.fetchOrders.mockResolvedValue(page([]));
    const { container } = renderStrip();
    await waitFor(() => expect(mocks.fetchOrders).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('lỗi tải đơn → ẩn, không thẻ lỗi', async () => {
    mocks.fetchOrders.mockRejectedValue(new Error('boom'));
    const { container } = renderStrip();
    await waitFor(() => expect(mocks.fetchOrders).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('lần đầu chưa nhớ gì: chờ đơn thì im lặng (không khung chờ rồi sụp), có việc thì khối hiện', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.fetchOrders.mockImplementation(() => new Promise((r) => { release = r; }));
    renderStrip();
    await waitFor(() => expect(mocks.fetchOrders).toHaveBeenCalled());
    expect(screen.queryByTestId('todo-strip-loading')).toBeNull();
    release(page([shippingOrder]));
  });

  it('lần mở trước có 1 dòng việc: có khung chờ giữ chỗ; xong thì ghi lại số dòng mới', async () => {
    localStorage.setItem(TODO_ROWS_KEY, JSON.stringify({ userId: 'u1', rows: 1 }));
    renderStrip();
    expect(await screen.findByTestId('todo-strip-loading')).toBeInTheDocument();
    await screen.findByText(/TUBU2/);
    expect(JSON.parse(localStorage.getItem(TODO_ROWS_KEY)!)).toEqual({ userId: 'u1', rows: 2 });
  });

  it('khách hết việc: ghi 0 dòng để lần sau không giữ chỗ', async () => {
    localStorage.setItem(TODO_ROWS_KEY, JSON.stringify({ userId: 'u1', rows: 2 }));
    mocks.fetchActive.mockResolvedValue(0);
    renderStrip();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(TODO_ROWS_KEY)!)).toEqual({ userId: 'u1', rows: 0 }));
  });
});
