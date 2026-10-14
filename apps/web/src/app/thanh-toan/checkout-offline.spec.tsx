// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { click, flush } from '@/test-utils/dom';
import { NetworkError } from '@/lib/client-api';
import { createQueryClient } from '@/lib/query-client';

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };

const m = vi.hoisted(() => ({ placeOrder: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 }],
    couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  }),
  getMyCoupons: async () => [],
  getAddresses: async () => [ADDR],
  checkoutQuote: async () => QUOTE,
  placeOrder: (...args: unknown[]) => m.placeOrder(...args),
  getPublicConfig: async () => ({ recyclingEnabled: false }),
}));

import CheckoutPage from './page';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  m.placeOrder.mockReset();
});
afterEach(() => {
  onlineManager.setOnline(true);
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('/thanh-toan — mất mạng khi bấm Đặt hàng (R4-BUYER-1 cho web)', () => {
  it('offline: yêu cầu đặt đơn vẫn được gửi, hiện câu mất kết nối, nút bấm lại được; có mạng lại không tự đặt thêm', async () => {
    const client = createQueryClient();
    client.setDefaultOptions({ ...client.getDefaultOptions(), queries: { retry: false } });
    m.placeOrder.mockRejectedValue(new NetworkError(false));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<QueryClientProvider client={client}><CheckoutPage /></QueryClientProvider>));
    await flush(8);
    const place = () => [...container!.querySelectorAll('button')].find((b) => /^Đặt hàng|^Đang đặt hàng/.test(b.textContent ?? ''))!;
    expect(place().disabled).toBe(false);

    onlineManager.setOnline(false);
    click(place());
    await flush(6);

    expect(m.placeOrder).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Mất kết nối. Vui lòng kiểm tra mạng rồi thử lại.');
    expect(place().textContent).toBe('Đặt hàng');
    expect(place().disabled).toBe(false);

    onlineManager.setOnline(true);
    await client.resumePausedMutations();
    await flush(4);
    expect(m.placeOrder).toHaveBeenCalledTimes(1);
  });
});
