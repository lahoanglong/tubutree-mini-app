import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), fetchOrders: vi.fn(), getSubscriptions: vi.fn(), activeCount: 0, status: 'authenticated' }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ fetchOrders: mocks.fetchOrders }));
vi.mock('../../services/subscriptions-api', () => ({ getSubscriptions: mocks.getSubscriptions }));
vi.mock('../../hooks/use-active-order-count', () => ({ useActiveOrderCount: () => mocks.activeCount }));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.status }) }));

import { OrderStrip, formatDayMonth, nextActiveSubscription } from './order-strip';

const SUB = (id: string, status: 'ACTIVE' | 'PAUSED', nextRunAt: string) => ({
  id, status, nextRunAt, quantity: 1, intervalWeeks: 4, productName: `SP ${id}`, variationName: '', thumbnail: null, slug: null, unitPrice: 1, effectiveDiscountPct: 0,
});
function renderStrip() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OrderStrip /></QueryClientProvider>);
}
/** Đợi cả hai nguồn đã settle: placeholder tải biến mất (mới đúng nghĩa "ẩn", không phải "chưa tải xong"). */
const settled = () => waitFor(() => expect(screen.queryByTestId('order-strip-loading')).not.toBeInTheDocument());

describe('OrderStrip — dải "đơn đang giao / kỳ định kỳ kế tiếp" (spec 5b.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeCount = 0;
    mocks.status = 'authenticated';
    mocks.fetchOrders.mockResolvedValue({ data: [], meta: { page: 1, limit: 1, total: 0 } });
    mocks.getSubscriptions.mockResolvedValue([]);
  });

  it('nextActiveSubscription: kỳ ACTIVE sớm nhất (bỏ PAUSED)', () => {
    const subs = [SUB('b', 'ACTIVE', '2026-10-20T00:00:00.000Z'), SUB('p', 'PAUSED', '2026-10-01T00:00:00.000Z'), SUB('a', 'ACTIVE', '2026-10-15T00:00:00.000Z')];
    expect(nextActiveSubscription(subs)?.id).toBe('a');
    expect(nextActiveSubscription([])).toBeUndefined();
    expect(nextActiveSubscription([SUB('p', 'PAUSED', '2026-10-01T00:00:00.000Z')])).toBeUndefined();
    expect(nextActiveSubscription([SUB('x', 'ACTIVE', 'not-a-date')])).toBeUndefined();
  });

  it('formatDayMonth: dd/MM thủ công (toLocaleDateString trả "15-10" trên Node 24), đệm số 0', () => {
    expect(formatDayMonth('2026-10-15T05:00:00.000Z')).toBe('15/10');
    expect(formatDayMonth('2026-03-05T05:00:00.000Z')).toBe('05/03');
  });

  it('khách chưa đăng nhập → không gọi API, không render (kể cả placeholder)', async () => {
    mocks.status = 'idle';
    const { container } = renderStrip();
    expect(container).toBeEmptyDOMElement();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.getSubscriptions).not.toHaveBeenCalled();
    expect(mocks.fetchOrders).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('đang tải → placeholder giữ chỗ (ẩn với trình đọc màn hình), tải xong rỗng thì biến mất', async () => {
    const { container } = renderStrip();
    expect(screen.getByTestId('order-strip-loading')).toHaveAttribute('aria-hidden', 'true');
    await settled();
    expect(mocks.getSubscriptions).toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('badge đơn đang xử lý = 0 → không tải danh sách đơn', async () => {
    const { container } = renderStrip();
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalled());
    await settled();
    expect(mocks.fetchOrders).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('có đơn SHIPPING → dòng "Đơn … đang giao" mở chi tiết đơn', async () => {
    mocks.activeCount = 2;
    mocks.fetchOrders.mockResolvedValue({ data: [{ code: 'TUBU-9' }], meta: { page: 1, limit: 1, total: 1 } });
    renderStrip();
    fireEvent.click(await screen.findByRole('button', { name: /Đơn TUBU-9 đang giao/ }));
    expect(mocks.fetchOrders).toHaveBeenCalledWith({ status: 'SHIPPING' }, 1, 1);
    expect(mocks.navigate).toHaveBeenCalledWith('/order/TUBU-9');
    expect(screen.getByRole('region', { name: 'Đơn của bạn' })).toBeInTheDocument();
  });

  it('có kỳ định kỳ → dòng "Kỳ định kỳ kế tiếp: dd/MM" mở tab Định kỳ', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB('a', 'ACTIVE', '2026-10-15T05:00:00.000Z')]);
    renderStrip();
    fireEvent.click(await screen.findByRole('button', { name: /Kỳ định kỳ kế tiếp: 15\/10/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/orders?tab=subscriptions');
  });

  it('badge > 0 nhưng không có đơn SHIPPING (đang xử lý/chờ lấy hàng) → ẩn dòng đơn, vẫn hiện kỳ định kỳ', async () => {
    mocks.activeCount = 1;
    mocks.getSubscriptions.mockResolvedValue([SUB('a', 'ACTIVE', '2026-10-15T05:00:00.000Z')]);
    renderStrip();
    expect(await screen.findByRole('button', { name: /Kỳ định kỳ kế tiếp/ })).toBeInTheDocument();
    await waitFor(() => expect(mocks.fetchOrders).toHaveBeenCalled());
    await settled();
    expect(screen.queryByRole('button', { name: /đang giao/ })).not.toBeInTheDocument();
  });

  it('API lỗi → ẩn im lặng (không ErrorState)', async () => {
    mocks.activeCount = 1;
    mocks.fetchOrders.mockRejectedValue(new Error('500'));
    mocks.getSubscriptions.mockRejectedValue(new Error('404'));
    const { container } = renderStrip();
    await waitFor(() => expect(mocks.fetchOrders).toHaveBeenCalled());
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalled());
    await settled();
    expect(container).toBeEmptyDOMElement();
  });

  it('một nguồn lỗi không ẩn nguồn còn lại', async () => {
    mocks.activeCount = 1;
    mocks.fetchOrders.mockRejectedValue(new Error('500'));
    mocks.getSubscriptions.mockResolvedValue([SUB('a', 'ACTIVE', '2026-10-15T05:00:00.000Z')]);
    renderStrip();
    expect(await screen.findByRole('button', { name: /Kỳ định kỳ kế tiếp/ })).toBeInTheDocument();
  });
});
