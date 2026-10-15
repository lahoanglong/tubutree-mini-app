// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// BUYERWEB-8: /tai-khoan chỉ liệt kê 20 đơn mới nhất, không báo tổng, không có "Xem thêm"/lọc trạng thái.

const state = vi.hoisted(() => ({
  orders: [] as { code: string; status: string }[],
  calls: [] as { page: number; filter: Record<string, string> }[],
  failPage: 0,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u', fullName: 'Nguyễn An', referralCode: 'AN1', pointsBalance: 0, walletBalance: 0 },
    status: 'authenticated',
    initialized: true,
    logout: vi.fn(),
  }),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getMe: async () => ({ pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0 }),
  fetchOrdersPage: async (page: number, filter: Record<string, string> = {}) => {
    state.calls.push({ page, filter });
    if (state.failPage === page) throw new Error('boom');
    const list = state.orders.filter(
      (o) =>
        (!filter.status || o.status === filter.status) &&
        (!filter.group || (filter.group === 'closed' ? ['CANCELLED', 'RETURNED'].includes(o.status) : ['CONFIRMED', 'PACKED'].includes(o.status))),
    );
    return { data: list.slice((page - 1) * 20, page * 20).map(full), meta: { page, limit: 20, total: list.length } };
  },
}));

import AccountPage from './page';

const full = (o: { code: string; status: string }) => ({
  ...o, subtotal: 1, discount: 0, shippingFee: 0, total: 100000, paymentMethod: 'COD', createdAt: '2026-10-01T00:00:00Z', items: [],
});
const mk = (n: number, status = 'DELIVERED') => Array.from({ length: n }, (_, i) => ({ code: `TB-${i + 1}`, status }));

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<AccountPage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const codes = (c: HTMLElement) => Array.from(c.querySelectorAll('li > div:first-child > span:first-child')).map((s) => s.textContent);

beforeEach(() => {
  state.orders = mk(36);
  state.calls = [];
  state.failPage = 0;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/tai-khoan — danh sách đơn nhiều hơn 20 (BUYERWEB-8)', () => {
  it('tải trang đầu 20 đơn, báo tổng số đơn và số đang hiển thị, có nút Xem thêm', async () => {
    const { container } = await mount();
    expect(codes(container)).toHaveLength(20);
    expect(container.textContent).toContain('Đơn hàng của tôi (36)');
    expect(container.textContent).toContain('Đang hiển thị 20 / 36 đơn');
    expect(byText(container, 'button', 'Xem thêm đơn cũ hơn')).not.toBeNull();
  });

  it('Xem thêm tải trang 2 nối vào danh sách đủ 36 đơn rồi ẩn nút', async () => {
    const { container } = await mount();
    click(byText(container, 'button', 'Xem thêm đơn cũ hơn'));
    await flush(6);
    expect(state.calls.map((c) => c.page)).toEqual([1, 2]);
    expect(codes(container)).toHaveLength(36);
    expect(container.textContent).toContain('Đang hiển thị 36 / 36 đơn');
    expect(byText(container, 'button', 'Xem thêm đơn cũ hơn')).toBeNull();
  });

  it('≤ 20 đơn: không có nút Xem thêm', async () => {
    state.orders = mk(5);
    const { container } = await mount();
    expect(codes(container)).toHaveLength(5);
    expect(byText(container, 'button', 'Xem thêm đơn cũ hơn')).toBeNull();
  });

  it('tải trang 2 lỗi: giữ nguyên 20 đơn đã có, báo lỗi và cho bấm lại', async () => {
    state.failPage = 2;
    const { container } = await mount();
    click(byText(container, 'button', 'Xem thêm đơn cũ hơn'));
    await flush(6);
    expect(codes(container)).toHaveLength(20);
    expect(container.textContent).toContain('Không tải thêm được đơn hàng');
    expect(byText(container, 'button', 'Xem thêm đơn cũ hơn')).not.toBeNull();
  });

  it('lọc theo trạng thái gửi đúng tham số cho API và đếm theo bộ lọc', async () => {
    state.orders = [...mk(30), ...mk(3, 'CANCELLED').map((o, i) => ({ ...o, code: `HX-${i}` }))];
    const { container } = await mount();
    click(byText(container, 'button', 'Đã hủy/hoàn'));
    await flush(6);
    expect(state.calls.at(-1)).toEqual({ page: 1, filter: { group: 'closed' } });
    expect(codes(container)).toEqual(['#HX-0', '#HX-1', '#HX-2']);
    expect(container.textContent).toContain('Đơn hàng của tôi (3)');
    click(byText(container, 'button', 'Đã giao'));
    await flush(6);
    expect(state.calls.at(-1)).toEqual({ page: 1, filter: { status: 'DELIVERED' } });
  });

  it('bộ lọc không có đơn: câu báo riêng, không nói "chưa có đơn hàng nào"', async () => {
    state.orders = mk(3);
    const { container } = await mount();
    click(byText(container, 'button', 'Đang giao'));
    await flush(6);
    expect(container.textContent).toContain('Không có đơn hàng nào ở trạng thái này');
    expect(container.textContent).not.toContain('Bạn chưa có đơn hàng nào');
  });

  it('có lối vào Sổ địa chỉ (BUYERWEB-14)', async () => {
    const { container } = await mount();
    const link = container.querySelector<HTMLAnchorElement>('nav[aria-label="Quản lý tài khoản"] a');
    expect(link?.getAttribute('href')).toBe('/tai-khoan/dia-chi');
    expect(link?.textContent).toContain('Sổ địa chỉ');
  });

  it('tab đang chọn có aria-pressed; trang vẫn đúng một h1, nút đủ tên và vùng chạm', async () => {
    const { container } = await mount();
    const pressed = Array.from(container.querySelectorAll('[role="group"] button')).map((b) => b.getAttribute('aria-pressed'));
    expect(pressed[0]).toBe('true');
    expect(pressed.slice(1).every((p) => p === 'false')).toBe(true);
    expect(headingProblems(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });
});
