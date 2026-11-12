// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Phân loại không đặt tên (86/154 phân loại trên PROD): danh sách đơn không dựng dòng phân loại trống dưới tên sản phẩm.

const state = vi.hoisted(() => ({ orders: [] as Record<string, unknown>[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, cartKey: () => ['cart', null], useCartKey: () => ['cart', null] }));
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
  fetchOrdersPage: async (page: number) => ({ data: state.orders, meta: { page, limit: 20, total: state.orders.length } }),
}));

import { OrdersSection } from './orders-section';

const item = (name: string, variationName: string | null) => ({ productName: name, variationName, unitPrice: 100000, quantity: 1, total: 100000, thumbnail: null });
const order = (items: ReturnType<typeof item>[], code = 'TB-1') => ({
  code, status: 'DELIVERED', subtotal: 1, discount: 0, shippingFee: 0, total: 250000, paymentMethod: 'COD', createdAt: '2026-10-01T00:00:00Z', items,
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OrdersSection />);
  mounted.push(r);
  await flush(6);
  return r.container;
};
/** Chữ của cột tên mỗi sản phẩm xem trước: các khối con của div.min-w-0.flex-1. */
const nameColumns = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('li div.min-w-0.flex-1')).map((col) => Array.from(col.children).map((n) => n.textContent));

beforeEach(() => {
  state.orders = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('danh sách đơn — phân loại không có tên', () => {
  it('có tên: tên sản phẩm kèm dòng phân loại bên dưới như trước', async () => {
    state.orders = [order([item('Dầu gội bưởi', '500ml')])];
    expect(nameColumns(await mount())).toEqual([['Dầu gội bưởi', '500ml']]);
  });

  it('tên trống, toàn khoảng trắng hay null: chỉ có tên sản phẩm, không dòng phân loại trống', async () => {
    state.orders = [order([item('Dầu gội bưởi', ''), item('Nước rửa chén', '   ')]), order([item('Xà phòng', null)], 'TB-2')];
    expect(nameColumns(await mount())).toEqual([['Dầu gội bưởi'], ['Nước rửa chén'], ['Xà phòng']]);
  });
});
