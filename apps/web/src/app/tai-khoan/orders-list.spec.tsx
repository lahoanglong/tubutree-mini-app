// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// R2-BUYERWEB-8: danh sách đơn chỉ có mã đơn, số sản phẩm và ngày; khách nhiều đơn không nhận ra đơn nào là đơn nào.

const state = vi.hoisted(() => ({
  calls: [] as { page: number; filter: Record<string, string> }[],
  orders: [] as Record<string, unknown>[],
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u', fullName: 'An', referralCode: 'AN1', pointsBalance: 0, walletBalance: 0 },
    status: 'authenticated',
    initialized: true,
    sessionUnavailable: false,
    logout: vi.fn(),
  }),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  fetchOrdersPage: async (page: number, filter: Record<string, string> = {}) => {
    state.calls.push({ page, filter });
    return { data: state.orders, meta: { page, limit: 20, total: state.orders.length } };
  },
}));

import { OrdersSection } from './orders-section';

const item = (name: string, thumbnail: string | null = null, quantity = 1) => ({
  productName: name, variationName: '500ml', unitPrice: 100000, quantity, total: 100000 * quantity, thumbnail,
});
const order = (code: string, items: ReturnType<typeof item>[]) => ({
  code, status: 'DELIVERED', subtotal: 1, discount: 0, shippingFee: 0, total: 250000, paymentMethod: 'COD', createdAt: '2026-10-01T00:00:00Z', items,
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OrdersSection />);
  mounted.push(r);
  await flush(6);
  return r.container;
};

beforeEach(() => {
  state.calls = [];
  state.orders = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('danh sách đơn — tên và ảnh sản phẩm', () => {
  it('hiện tên + ảnh nhỏ của tối đa 2 sản phẩm đầu và đếm số còn lại', async () => {
    state.orders = [
      order('TB-1', [item('Dầu gội bưởi', 'https://img.test/a.jpg', 2), item('Nước rửa chén', null), item('Xà phòng'), item('Bàn chải')]),
    ];
    const c = await mount();
    const li = c.querySelector('li')!;
    expect(li.textContent).toContain('Dầu gội bưởi');
    expect(li.textContent).toContain('×2');
    expect(li.textContent).toContain('Nước rửa chén');
    expect(li.textContent).not.toContain('Xà phòng');
    expect(li.textContent).toContain('và 2 sản phẩm khác');
    const img = li.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://img.test/a.jpg');
    expect(img.getAttribute('alt')).toBe('');
  });

  it('đơn một sản phẩm: không có dòng "và … khác"', async () => {
    state.orders = [order('TB-2', [item('Mật ong')])];
    const c = await mount();
    expect(c.textContent).toContain('Mật ong');
    expect(c.textContent).not.toContain('sản phẩm khác');
  });
});

describe('danh sách đơn — ô tìm kiếm', () => {
  it('gửi từ khoá cho API cùng bộ lọc trạng thái đang chọn và có nút Xóa tìm kiếm', async () => {
    state.orders = [order('TB-1', [item('Dầu gội bưởi')])];
    const c = await mount();
    click(byText(c, 'button', 'Đã giao'));
    await flush(4);
    typeInto(c.querySelector('input[type="search"]'), '  dau goi ');
    click(byText(c, 'button', 'Tìm'));
    await flush(6);
    expect(state.calls.at(-1)).toEqual({ page: 1, filter: { status: 'DELIVERED', q: 'dau goi' } });
    expect(c.textContent).toContain('Kết quả cho “dau goi”');
    click(byText(c, 'button', 'Xóa tìm kiếm'));
    await flush(6);
    expect(state.calls.at(-1)).toEqual({ page: 1, filter: { status: 'DELIVERED' } });
    expect((c.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('');
  });

  it('không khớp đơn nào: câu báo riêng, không nói "chưa có đơn hàng nào"', async () => {
    const c = await mount();
    typeInto(c.querySelector('input[type="search"]'), 'zzz');
    click(byText(c, 'button', 'Tìm'));
    await flush(6);
    expect(c.textContent).toContain('Không tìm thấy đơn nào khớp “zzz”');
    expect(c.textContent).not.toContain('Bạn chưa có đơn hàng nào');
  });

  it('ô tìm có nhãn, nút đủ vùng chạm', async () => {
    const c = await mount();
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});
