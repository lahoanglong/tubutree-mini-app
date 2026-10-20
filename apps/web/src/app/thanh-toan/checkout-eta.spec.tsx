// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Dòng "Giao dự kiến" ở tóm tắt đơn như Mini App (544c9ad7): cùng nhãn, cùng hàm ghép ngày, ẩn khi chưa có cấu hình.

const mocks = vi.hoisted(() => ({ config: null as unknown, configPending: false, addresses: [] as unknown[], quoteError: null as unknown }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/geo-client', () => ({
  getProvinces: async () => [{ code: '84_VN01', name: 'Hà Nội' }],
  getCommunes: async () => [{ code: '84_VN01_001', name: 'Cầu Giấy' }],
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: '500ml', slug: 'dau-goi', thumbnail: null, unitPrice: 300000, quantity: 1, stock: 5, total: 300000 }],
    couponCode: null, subtotal: 300000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  }),
  getMyCoupons: async () => [],
  getAddresses: async () => mocks.addresses,
  getPublicConfig: () => (mocks.configPending ? new Promise(() => {}) : Promise.resolve(mocks.config)),
  checkoutQuote: async () => {
    if (mocks.quoteError) throw mocks.quoteError;
    return { subtotal: 300000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 330000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };
  },
}));

import { ApiError } from '@/lib/client-api';
import CheckoutPage from './page';

const ADDR = {
  id: 'a1', recipient: 'Nguyễn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_001', isDefault: true,
};
let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const row = (c: HTMLElement, label: string) => Array.from(c.querySelectorAll('div.flex')).find((d) => d.firstElementChild?.textContent === label);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 30, 12, 0, 0));
  mocks.addresses = [ADDR];
  mocks.config = { freeshipThreshold: 500000, shippingEta: { minDays: 2, maxDays: 4 } };
  mocks.configPending = false;
  mocks.quoteError = null;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
});

describe('/thanh-toan — dòng "Giao dự kiến"', () => {
  it('có cấu hình: ngay dưới phí vận chuyển, ghi khoảng ngày dd/MM – dd/MM', async () => {
    const c = await mount();
    const fee = row(c, 'Phí vận chuyển')!;
    const eta = row(c, 'Giao dự kiến')!;
    expect(eta.lastElementChild!.textContent).toBe('02/10 – 04/10');
    expect(fee.parentElement).toBe(eta.parentElement);
    expect(fee.nextElementSibling).toBe(eta);
  });

  it('cấu hình chưa có shippingEta (null hoặc thiếu): không hứa ngày giao', async () => {
    mocks.config = { freeshipThreshold: 500000, shippingEta: null };
    expect(row(await mount(), 'Giao dự kiến')).toBeUndefined();
  });

  it('cấu hình chưa tải xong: không hứa ngày giao', async () => {
    mocks.configPending = true;
    expect(row(await mount(), 'Giao dự kiến')).toBeUndefined();
  });
});

describe('/thanh-toan — "Giao dự kiến" chỉ hiện khi đã có báo giá', () => {
  it('chưa chọn địa chỉ: không có dòng ngày giao', async () => {
    mocks.addresses = [];
    expect(row(await mount(), 'Giao dự kiến')).toBeUndefined();
  });

  it('báo giá bị từ chối (địa chỉ cũ trước 2025): không có dòng ngày giao', async () => {
    mocks.quoteError = new ApiError('Địa chỉ cần cập nhật', 400, 'ADDRESS_OUTDATED');
    expect(row(await mount(), 'Giao dự kiến')).toBeUndefined();
  });
});
