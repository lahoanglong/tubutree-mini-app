// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ push: vi.fn(), get: vi.fn(), phase: 'authenticated', active: 2 }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));

import { TodoStrip, useHomeTodoHint, useHomeTodoQueries } from './todo-strip';

/** Trang chủ gọi ba thứ này ở cấp trang rồi đưa dữ liệu cho dải ngữ cảnh: dựng lại đúng cách đó. */
function Harness() {
  const todo = useHomeTodoQueries();
  useHomeTodoHint(todo, 'u1');
  return <TodoStrip data={todo.todoQ.data} />;
}

const FUTURE = new Date(Date.now() + 3 * 3600_000).toISOString();
const pendingOrder = { code: 'TUBU1', total: 250000, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', paymentDeadline: FUTURE };
const shippingOrder = { code: 'TUBU2', total: 100000, status: 'SHIPPING' };
const page = (rows: object[], total = rows.length) => ({ data: rows, meta: { page: 1, limit: 1, total } });

let ordersFor: (status: string | undefined) => unknown;
let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<Harness />);
  await flush(8);
  return mounted.container;
};
const orderCalls = () => mocks.get.mock.calls.filter(([p]) => p === '/orders');
const todoCalls = () => mocks.get.mock.calls.filter(([p]) => p === '/orders/home-todo');
const homeTodo = () => {
  const part = (status: string | undefined) => {
    const res = ordersFor(status) as { data: object[]; meta: { total: number } };
    return res.data[0] ? { order: res.data[0], total: res.meta.total } : null;
  };
  return { pending: part('PENDING_PAYMENT'), shipping: part('SHIPPING'), processing: part(undefined) };
};

beforeEach(() => {
  window.localStorage.clear();
  mocks.phase = 'authenticated';
  mocks.active = 2;
  mocks.push.mockReset();
  ordersFor = (status) => page(status === 'PENDING_PAYMENT' ? [pendingOrder] : status === 'SHIPPING' ? [shippingOrder] : []);
  mocks.get.mockReset().mockImplementation(async (path: string, opts?: { query?: { status?: string } }) => {
    if (path === '/me/summary') return { orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0, active: mocks.active }, unreadNotifications: 0, activeSubscriptions: 0 };
    if (path === '/orders/home-todo') return homeTodo();
    throw new Error(`đường dẫn lạ ${path}`);
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('TodoStrip web — Việc cần làm (một dòng trong dải ngữ cảnh)', () => {
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
    expect(todoCalls()).toHaveLength(0);
  });

  it('một lời home-todo thay ba lời /orders lọc theo trạng thái', async () => {
    await mount();
    expect(todoCalls()).toHaveLength(1);
    expect(orderCalls()).toHaveLength(0);
  });

  it('chờ chuyển khoản + đang giao: chỉ vẽ việc dẫn đầu (chờ chuyển khoản), nút "Thanh toán" mở trang chuyển khoản, chữ phụ giữ hạn chuyển khoản kèm "+1 việc khác", không thêm mũi tên cạnh nút', async () => {
    const c = await mount();
    expect(c.querySelectorAll('[data-todo-row]')).toHaveLength(1);
    expect(c.textContent).not.toContain('TUBU2');
    expect(c.textContent).toContain('Chờ chuyển khoản 250.000');
    expect(c.textContent).toMatch(/Còn .+ · \+1 việc khác/);
    click(c.querySelector('button[aria-label^="Thanh toán ngay"]'));
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan/chuyen-khoan/TUBU1');
    expect(c.querySelector('a[aria-label*="việc khác"]')).toBeNull();
  });

  it('chỉ có đơn đang giao: dòng mở chi tiết đơn, mũi tên chevron của dòng (không có mũi tên "việc khác") và chữ phụ hướng dẫn', async () => {
    ordersFor = (status) => page(status === 'SHIPPING' ? [shippingOrder] : []);
    const c = await mount();
    const ship = Array.from(c.querySelectorAll<HTMLElement>('[role="button"]')).find((r) => r.textContent?.includes('TUBU2'))!;
    expect(ship.textContent).toContain('Chạm để theo dõi đơn');
    expect(c.querySelector('a[aria-label*="việc khác"]')).toBeNull();
    click(ship);
    expect(mocks.push).toHaveBeenLastCalledWith('/tai-khoan/don-hang/TUBU2');
  });

  it('nhiều đơn đang giao: dòng nói đơn dẫn đầu, các đơn còn lại tính vào "+N việc khác" và mũi tên mở danh sách đơn', async () => {
    ordersFor = (status) => (status === 'SHIPPING' ? page([shippingOrder], 3) : page([]));
    const c = await mount();
    expect(c.textContent).toContain('Đơn TUBU2 đang giao');
    expect(c.textContent).toContain('+2 việc khác');
    const arrow = c.querySelector<HTMLAnchorElement>('a[aria-label="Xem 2 việc khác trong Đơn hàng"]')!;
    expect(arrow.getAttribute('href')).toBe('/tai-khoan/don-hang');
    expect(arrow.className).toMatch(/\bh-11\b.*\bw-11\b|\bw-11\b.*\bh-11\b/);
  });

  it('chỉ có đơn đang chuẩn bị (COD vừa đặt): một dòng mở chi tiết đơn', async () => {
    ordersFor = (status) => (status === undefined ? page([{ code: 'TUBU3', total: 90000, status: 'PROCESSING' }]) : page([]));
    const c = await mount();
    const row = Array.from(c.querySelectorAll<HTMLElement>('[role="button"]')).find((r) => r.textContent?.includes('TUBU3'))!;
    click(row);
    expect(mocks.push).toHaveBeenCalledWith('/tai-khoan/don-hang/TUBU3');
  });

  it('không có việc hoặc lỗi tải đơn: ẩn hẳn, không thẻ lỗi', async () => {
    ordersFor = () => page([]);
    expect((await mount()).textContent).toBe('');
    mounted!.unmount();
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/me/summary') return { orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0, active: 2 }, unreadNotifications: 0, activeSubscriptions: 0 };
      throw new Error('boom');
    });
    expect((await mount()).textContent).toBe('');
  });

  it('dòng cao đúng 64px (bằng dải ngữ cảnh), thẻ có viền trái cảnh báo 3px và không đệm dọc; chữ dài cắt một dòng bằng "…", không xuống dòng', async () => {
    const c = await mount();
    const region = c.querySelector<HTMLElement>('section[aria-label="Việc cần làm"]')!;
    const row = region.querySelector<HTMLElement>('[data-todo-row]')!;
    expect(row.style.height).toBe('64px');
    expect((region.firstElementChild as HTMLElement).style.borderLeft).toContain('3px');
    expect(region.style.padding).toBe('');
    const title = Array.from(region.querySelectorAll<HTMLElement>('span')).find((x) => x.textContent?.startsWith('Chờ chuyển khoản'))!;
    expect(title.style.whiteSpace).toBe('nowrap');
    expect(title.style.textOverflow).toBe('ellipsis');
  });

  describe('trí nhớ "có việc cần làm" (không chớp khung chờ rồi sụp)', () => {
    const KEY = 'tubu_home_todo_rows';

    it('có việc: ghi 1 để lần sau dải giữ khung chờ', async () => {
      await mount();
      expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ userId: 'u1', rows: 1 });
    });

    it('một lời con lỗi (partial): dòng còn lại vẫn hiện, không ghi đè dấu nhớ cũ', async () => {
      window.localStorage.setItem(KEY, JSON.stringify({ userId: 'u1', rows: 1 }));
      mocks.get.mockImplementation(async (path: string) => {
        if (path === '/me/summary') return { orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0, active: 2 }, unreadNotifications: 0, activeSubscriptions: 0 };
        return { pending: null, shipping: { order: shippingOrder, total: 1 }, processing: null, partial: true };
      });
      const c = await mount();
      expect(c.textContent).toContain('TUBU2');
      expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ userId: 'u1', rows: 1 });
    });

    it('không còn việc: ghi 0 để lần sau không dựng khung chờ', async () => {
      window.localStorage.setItem(KEY, JSON.stringify({ userId: 'u1', rows: 1 }));
      mocks.active = 0;
      await mount();
      expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ userId: 'u1', rows: 0 });
    });
  });
});
