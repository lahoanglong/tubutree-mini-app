// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ push: vi.fn(), get: vi.fn(), phase: 'authenticated', active: 2 }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));

import { TodoStrip } from './todo-strip';

const FUTURE = new Date(Date.now() + 3 * 3600_000).toISOString();
const pendingOrder = { code: 'TUBU1', total: 250000, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PENDING', paymentDeadline: FUTURE };
const shippingOrder = { code: 'TUBU2', total: 100000, status: 'SHIPPING' };
const page = (rows: object[], total = rows.length) => ({ data: rows, meta: { page: 1, limit: 1, total } });

let ordersFor: (status: string | undefined) => unknown;
let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<TodoStrip />);
  await flush(8);
  return mounted.container;
};
const orderCalls = () => mocks.get.mock.calls.filter(([p]) => p === '/orders');

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.active = 2;
  mocks.push.mockReset();
  ordersFor = (status) => page(status === 'PENDING_PAYMENT' ? [pendingOrder] : status === 'SHIPPING' ? [shippingOrder] : []);
  mocks.get.mockReset().mockImplementation(async (path: string, opts?: { query?: { status?: string } }) => {
    if (path === '/orders/active-count') return { count: mocks.active };
    if (path === '/orders') return ordersFor(opts?.query?.status);
    throw new Error(`đường dẫn lạ ${path}`);
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('TodoStrip web — Việc cần làm', () => {
  it('chưa đăng nhập: không vẽ gì và không gọi API', async () => {
    mocks.phase = 'guest';
    const c = await mount();
    expect(c.textContent).toBe('');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('không có đơn đang xử lý: không vẽ gì và không tải danh sách đơn', async () => {
    mocks.active = 0;
    const c = await mount();
    expect(c.textContent).toBe('');
    expect(orderCalls()).toHaveLength(0);
  });

  it('đơn chờ thanh toán: nút "Thanh toán ngay" mở trang chuyển khoản; đơn đang giao: dòng mở chi tiết đơn', async () => {
    const c = await mount();
    click(c.querySelector('button[aria-label^="Thanh toán ngay"]'));
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan/chuyen-khoan/TUBU1');
    const ship = Array.from(c.querySelectorAll<HTMLElement>('[role="button"]')).find((r) => r.textContent?.includes('TUBU2'))!;
    click(ship);
    expect(mocks.push).toHaveBeenLastCalledWith('/tai-khoan/don-hang/TUBU2');
  });

  it('nhiều đơn đang giao: một dòng gộp mở danh sách đã lọc Đang giao', async () => {
    ordersFor = (status) => (status === 'SHIPPING' ? page([shippingOrder], 3) : page([]));
    const c = await mount();
    const row = Array.from(c.querySelectorAll<HTMLElement>('[role="button"]')).find((r) => r.textContent?.includes('3'))!;
    click(row);
    expect(mocks.push).toHaveBeenCalledWith('/tai-khoan/don-hang?tab=shipping');
  });

  it('không có việc hoặc lỗi tải đơn: ẩn hẳn, không thẻ lỗi', async () => {
    ordersFor = () => page([]);
    expect((await mount()).textContent).toBe('');
    mounted!.unmount();
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/orders/active-count') return { count: 2 };
      throw new Error('boom');
    });
    expect((await mount()).textContent).toBe('');
  });
});
