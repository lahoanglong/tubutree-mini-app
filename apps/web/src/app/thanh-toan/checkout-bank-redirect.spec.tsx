// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Mini App checkout.tsx: BANK_TRANSFER → navigate(`/bank-payment/${code}`, { replace: true }) ngay sau khi đặt,
// không qua màn "Đặt hàng thành công". Web đi tới /thanh-toan/chuyen-khoan/[code] theo cùng cách.

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };
const placed = (over: Record<string, unknown> = {}) => ({
  id: 'o1', code: 'TB-9', status: 'PENDING_PAYMENT', subtotal: 100000, discount: 0, shippingFee: 30000, total: 130000,
  paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', createdAt: '2026-10-19T00:00:00Z', items: [], ...over,
});

const m = vi.hoisted(() => ({ quote: vi.fn(), placeOrder: vi.fn(), replace: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: m.replace, push: m.push }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 }],
    couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  }),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getAddresses: async () => [ADDR],
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
  placeOrder: (...args: unknown[]) => m.placeOrder(...args),
  getBankQr: async () => {
    throw new Error('trang đặt hàng không được tự dựng QR');
  },
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const radio = (r: Rendered, label: string) =>
  [...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.placeOrder.mockReset();
  m.replace.mockReset();
  m.push.mockReset();
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — chuyển khoản sang trang QR riêng', () => {
  it('đặt đơn BANK_TRANSFER → thay trang bằng /thanh-toan/chuyen-khoan/<mã>, không hiện màn thành công', async () => {
    m.placeOrder.mockResolvedValue(placed());
    const r = await mount();
    click(radio(r, 'Chuyển khoản ngân hàng'));
    await flush(4);
    click(byText(r.container, 'button', 'Đặt hàng'));
    await flush(8);
    expect(m.placeOrder.mock.calls[0]![0]).toMatchObject({ paymentMethod: 'BANK_TRANSFER' });
    expect(m.replace).toHaveBeenCalledWith('/thanh-toan/chuyen-khoan/TB-9');
    expect(r.container.textContent).not.toContain('Đặt hàng thành công');
  });

  it('mã đơn được mã hoá trong đường dẫn', async () => {
    m.placeOrder.mockResolvedValue(placed({ code: 'TB/1' }));
    const r = await mount();
    click(radio(r, 'Chuyển khoản ngân hàng'));
    await flush(4);
    click(byText(r.container, 'button', 'Đặt hàng'));
    await flush(8);
    expect(m.replace).toHaveBeenCalledWith('/thanh-toan/chuyen-khoan/TB%2F1');
  });

  it('đặt đơn COD → vẫn màn "Đặt hàng thành công", không chuyển trang', async () => {
    m.placeOrder.mockResolvedValue(placed({ paymentMethod: 'COD' }));
    const r = await mount();
    click(byText(r.container, 'button', 'Đặt hàng'));
    await flush(8);
    expect(m.replace).not.toHaveBeenCalled();
    expect(r.container.textContent).toContain('Đặt hàng thành công');
  });

  it('đơn 0đ bị ép COD dù khách đã chọn chuyển khoản → màn thành công, không sang trang QR', async () => {
    m.quote.mockResolvedValue({ ...QUOTE, total: 0, subtotal: 100000, discount: 100000, shippingFee: 0 });
    m.placeOrder.mockResolvedValue(placed({ paymentMethod: 'COD', total: 0 }));
    const r = await mount();
    click(byText(r.container, 'button', 'Đặt hàng'));
    await flush(8);
    expect(m.placeOrder.mock.calls[0]![0]).toMatchObject({ paymentMethod: 'COD' });
    expect(m.replace).not.toHaveBeenCalled();
  });
});
