import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  fetchOrders: vi.fn(),
  fetchHomeTodo: vi.fn(),
  fetchActive: vi.fn(),
  status: 'authenticated',
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ fetchOrders: mocks.fetchOrders, fetchHomeTodo: mocks.fetchHomeTodo }));
// Số đơn đang xử lý lấy từ /me/summary (cùng query với thanh đáy); `fetchActive` trả số đó.
vi.mock('../../services/core-http', () => ({
  coreHttp: {
    get: (path: string) =>
      path === '/me/summary'
        ? Promise.resolve(mocks.fetchActive()).then((active: number) => ({
            orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0, active },
            unreadNotifications: 0,
            activeSubscriptions: 0,
          }))
        : Promise.reject(new Error(`không mock ${path}`)),
  },
}));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: { id: string } }) => unknown) => sel({ status: mocks.status, user: { id: 'u1' } }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { TODO_ROWS_KEY } from '@tubutree/app-core/home-layout';
import type { HomeTodo } from '../../services/shop-api';
import { TodoStrip, useHomeTodoQueries } from './todo-strip';

const FUTURE = new Date(Date.now() + 3 * 3600_000).toISOString();
const pendingOrder = { code: 'TUBU1', total: 250000, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PENDING', paymentDeadline: FUTURE };
const shippingOrder = { code: 'TUBU2', total: 100000, status: 'SHIPPING' };
const prepOrder = { code: 'TUBU3', total: 90000, status: 'CONFIRMED' };
const todo = (o: Partial<Record<'pending' | 'shipping' | 'processing', { order: object; total: number } | null>>): HomeTodo =>
  ({ pending: null, shipping: null, processing: null, ...o }) as unknown as HomeTodo;

function renderStrip(data: HomeTodo | undefined) {
  return render(<TodoStrip data={data} />);
}

describe('TodoStrip — dải ngữ cảnh một dòng', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('không có dữ liệu hay hai danh sách rỗng → không vẽ gì (khung chờ và biến thể do HomeContextStrip lo)', () => {
    expect(renderStrip(undefined).container).toBeEmptyDOMElement();
    expect(renderStrip(todo({})).container).toBeEmptyDOMElement();
  });

  it('chỉ một đơn chờ chuyển khoản: nút "Thanh toán" mở trang chuyển khoản, không có mũi tên "việc khác"', () => {
    renderStrip(todo({ pending: { order: pendingOrder, total: 1 } }));
    fireEvent.click(screen.getByRole('button', { name: /Thanh toán ngay đơn TUBU1/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/bank-payment/TUBU1');
    expect(screen.queryByRole('button', { name: /việc khác/ })).toBeNull();
  });

  it('chờ chuyển khoản + đang giao: dòng chỉ nói về đơn chờ chuyển khoản, đơn giao thành "+1 việc khác" và mũi tên mở danh sách đơn', () => {
    renderStrip(todo({ pending: { order: pendingOrder, total: 1 }, shipping: { order: shippingOrder, total: 1 } }));
    expect(screen.queryByText(/TUBU2/)).toBeNull();
    expect(screen.getByText('+1 việc khác')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem 1 việc khác trong Đơn hàng' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/orders');
    fireEvent.click(screen.getByRole('button', { name: /Thanh toán ngay đơn TUBU1/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/bank-payment/TUBU1');
  });

  it('đơn đang giao dẫn đầu: chạm dòng mở chi tiết đơn đó; đủ ba loại thì "+2 việc khác"', () => {
    renderStrip(todo({ shipping: { order: shippingOrder, total: 1 }, processing: { order: prepOrder, total: 1 } }));
    expect(screen.getByText('+1 việc khác')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Đơn TUBU2 đang giao'));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/order/TUBU2');
  });

  it('đủ ba loại và đơn đang giao có thêm đơn thứ hai: đếm cả hai vào số việc khác', () => {
    renderStrip(todo({ pending: { order: pendingOrder, total: 1 }, shipping: { order: shippingOrder, total: 2 }, processing: { order: prepOrder, total: 1 } }));
    expect(screen.getByText('+3 việc khác')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xem 3 việc khác trong Đơn hàng' })).toBeInTheDocument();
  });

  it('đơn COD vừa đặt (Đang chuẩn bị) dẫn đầu khi không có việc nào hơn: chạm mở chi tiết đơn', () => {
    renderStrip(todo({ processing: { order: prepOrder, total: 1 } }));
    fireEvent.click(screen.getByText('Đơn TUBU3 đang chuẩn bị'));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/order/TUBU3');
  });

  it('một dòng cao 64px, thẻ có viền trái cảnh báo 3px, mũi tên "việc khác" có vùng chạm 44×44 và nằm cùng dòng', () => {
    renderStrip(todo({ shipping: { order: shippingOrder, total: 1 }, processing: { order: prepOrder, total: 1 } }));
    const region = screen.getByRole('region', { name: 'Việc cần làm' });
    const rows = region.querySelectorAll<HTMLElement>('[data-todo-row]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.style.height).toBe('64px');
    expect((region.firstElementChild as HTMLElement).style.borderLeft).toContain('3px');
    expect(region.style.padding).toBe('0px 16px');
    const arrow = screen.getByRole('button', { name: /^Xem \d+ việc khác/ });
    expect(rows[0]!.contains(arrow)).toBe(true);
    expect(arrow).toHaveClass('tubu-hit-44-square');
  });

  it('tiêu đề và dòng phụ cắt "…" một dòng để tên đơn/số tiền dài không làm dòng cao thêm', () => {
    renderStrip(todo({ shipping: { order: shippingOrder, total: 1 }, processing: { order: prepOrder, total: 1 } }));
    expect(screen.getByText('Đơn TUBU2 đang giao')).toHaveStyle({ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' });
    expect(screen.getByText('+1 việc khác')).toHaveStyle({ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' });
  });
});

function Probe() {
  const q = useHomeTodoQueries();
  return (
    <output
      data-testid="probe"
      data-loading={String(q.loading)}
      data-pending={String(q.pending)}
      data-remembered={String(q.remembered)}
      data-enabled={String(q.enabled)}
      data-has={String(q.todoQ.data ? 1 : 0)}
    />
  );
}

function renderProbe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>);
}
const probe = () => screen.getByTestId('probe');
const stored = () => JSON.parse(localStorage.getItem(TODO_ROWS_KEY)!);

describe('useHomeTodoQueries — dữ liệu và gợi ý khung chờ của dải ngữ cảnh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
    localStorage.clear();
    mocks.fetchActive.mockResolvedValue(2);
    mocks.fetchHomeTodo.mockResolvedValue(todo({ shipping: { order: shippingOrder, total: 1 } }));
  });

  it('không có đơn đang xử lý: không gọi danh sách việc, chốt loading=false và ghi 0 để lần sau không giữ chỗ', async () => {
    localStorage.setItem(TODO_ROWS_KEY, JSON.stringify({ userId: 'u1', rows: 1 }));
    mocks.fetchActive.mockResolvedValue(0);
    renderProbe();
    await waitFor(() => expect(stored()).toEqual({ userId: 'u1', rows: 0 }));
    expect(probe()).toHaveAttribute('data-loading', 'false');
    expect(probe()).toHaveAttribute('data-enabled', 'false');
    expect(mocks.fetchHomeTodo).not.toHaveBeenCalled();
  });

  it('có việc: MỘT lời home-todo (không gọi /orders lọc theo trạng thái) và ghi 1', async () => {
    renderProbe();
    await waitFor(() => expect(stored()).toEqual({ userId: 'u1', rows: 1 }));
    expect(probe()).toHaveAttribute('data-has', '1');
    expect(mocks.fetchHomeTodo).toHaveBeenCalledTimes(1);
    expect(mocks.fetchOrders).not.toHaveBeenCalled();
  });

  it('nhiều việc vẫn chỉ ghi 1 (dải luôn một dòng), không ghi 2 như khối hai dòng cũ', async () => {
    mocks.fetchHomeTodo.mockResolvedValue(todo({ pending: { order: pendingOrder, total: 1 }, shipping: { order: shippingOrder, total: 1 } }));
    localStorage.setItem(TODO_ROWS_KEY, JSON.stringify({ userId: 'u1', rows: 2 }));
    renderProbe();
    await waitFor(() => expect(stored()).toEqual({ userId: 'u1', rows: 1 }));
  });

  it('đang chờ danh sách việc: loading=true và pending=true; chưa ghi gợi ý nào', async () => {
    mocks.fetchHomeTodo.mockReturnValue(new Promise(() => undefined));
    renderProbe();
    await waitFor(() => expect(mocks.fetchHomeTodo).toHaveBeenCalled());
    expect(probe()).toHaveAttribute('data-loading', 'true');
    expect(probe()).toHaveAttribute('data-pending', 'true');
    expect(localStorage.getItem(TODO_ROWS_KEY)).toBeNull();
  });

  it('lỗi tải việc: không ghi gợi ý (lỗi tạm thời không được làm khung chờ lần sau sai)', async () => {
    localStorage.setItem(TODO_ROWS_KEY, JSON.stringify({ userId: 'u1', rows: 1 }));
    mocks.fetchHomeTodo.mockRejectedValue(new Error('boom'));
    renderProbe();
    await waitFor(() => expect(probe()).toHaveAttribute('data-loading', 'false'));
    expect(stored()).toEqual({ userId: 'u1', rows: 1 });
  });

  it('một lời con lỗi (partial): không ghi gợi ý', async () => {
    localStorage.setItem(TODO_ROWS_KEY, JSON.stringify({ userId: 'u1', rows: 1 }));
    mocks.fetchHomeTodo.mockResolvedValue({ ...todo({}), partial: true });
    renderProbe();
    await waitFor(() => expect(probe()).toHaveAttribute('data-loading', 'false'));
    expect(stored()).toEqual({ userId: 'u1', rows: 1 });
  });

  it('remembered: lần mở trước của chính tài khoản này có việc → true; tài khoản khác hay chưa có → false', async () => {
    localStorage.setItem(TODO_ROWS_KEY, JSON.stringify({ userId: 'u1', rows: 1 }));
    mocks.fetchActive.mockReturnValue(new Promise(() => undefined));
    const a = renderProbe();
    expect(probe()).toHaveAttribute('data-remembered', 'true');
    a.unmount();
    localStorage.setItem(TODO_ROWS_KEY, JSON.stringify({ userId: 'khac', rows: 1 }));
    renderProbe();
    expect(probe()).toHaveAttribute('data-remembered', 'false');
  });

  it('đang khôi phục phiên: pending=true và remembered theo tài khoản dùng gần nhất (chưa biết là ai)', () => {
    mocks.status = 'loading';
    localStorage.setItem(TODO_ROWS_KEY, JSON.stringify({ userId: 'ai-do', rows: 1 }));
    renderProbe();
    expect(probe()).toHaveAttribute('data-pending', 'true');
    expect(probe()).toHaveAttribute('data-remembered', 'true');
    expect(mocks.fetchActive).not.toHaveBeenCalled();
  });

  it('khách chưa đăng nhập: không gọi gì, không pending, không remembered', () => {
    mocks.status = 'unauthenticated';
    localStorage.setItem(TODO_ROWS_KEY, JSON.stringify({ userId: 'u1', rows: 1 }));
    renderProbe();
    expect(probe()).toHaveAttribute('data-pending', 'false');
    expect(probe()).toHaveAttribute('data-remembered', 'false');
    expect(mocks.fetchActive).not.toHaveBeenCalled();
    expect(mocks.fetchHomeTodo).not.toHaveBeenCalled();
  });
});
