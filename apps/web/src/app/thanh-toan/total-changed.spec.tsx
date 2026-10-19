// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

const NEW_ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };

const m = vi.hoisted(() => ({
  addresses: [] as unknown[],
  quote: vi.fn(),
  placeOrder: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 }],
    couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  }),
  getMyCoupons: async () => [],
  getAddresses: async () => m.addresses,
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
  placeOrder: (...args: unknown[]) => m.placeOrder(...args),
}));

import CheckoutPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const placeButton = (r: Rendered) => [...r.container.querySelectorAll('button')].find((b) => b.textContent === 'Đặt hàng')!;

beforeEach(() => {
  m.addresses = [NEW_ADDR];
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.placeOrder.mockReset();
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — tổng tiền đổi lúc đặt (PANCAKE-13)', () => {
  it('gửi kèm expectedTotal = tổng khách đang thấy', async () => {
    m.placeOrder.mockReturnValue(new Promise(() => undefined));
    const r = await mount();
    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder.mock.calls[0]![0]).toMatchObject({ addressId: 'a1', expectedTotal: 130000 });
  });

  it('BE trả TOTAL_CHANGED → hiện câu báo tổng mới và tải lại báo giá', async () => {
    const message = 'Tổng tiền đơn vừa thay đổi từ 130.000đ thành 140.000đ do giá hoặc phí giao vừa cập nhật. Vui lòng xem lại trước khi đặt.';
    m.placeOrder.mockRejectedValue(new ApiError(message, 400, 'TOTAL_CHANGED'));
    const r = await mount();
    const before = m.quote.mock.calls.length;
    click(placeButton(r));
    await flush(8);
    expect(r.container.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect(m.quote.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('/thanh-toan — cách thanh toán bị máy chủ khoá lúc đặt (R7 review #4)', () => {
  const radio = (r: Rendered, label: string) =>
    [...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!;

  it('BE trả PAYMENT_METHOD_NOT_ALLOWED → tải lại báo giá, khoá COD kèm lý do và tự chọn chuyển khoản; bấm đặt lại gửi chuyển khoản', async () => {
    const reason = 'Đơn có hàng gian hàng đối tác tự giao: thanh toán khi nhận hàng tạm chưa nhận cho đơn này.';
    let blocked = false;
    m.quote.mockImplementation(async () => (blocked ? { ...QUOTE, blockedPaymentMethods: { COD: reason } } : QUOTE));
    m.placeOrder.mockRejectedValueOnce(new ApiError(reason, 400, 'PAYMENT_METHOD_NOT_ALLOWED')).mockReturnValue(new Promise(() => undefined));
    const r = await mount();
    expect(radio(r, 'Thanh toán khi nhận hàng').checked).toBe(true);

    blocked = true;
    const before = m.quote.mock.calls.length;
    click(placeButton(r));
    await flush(8);
    expect(m.placeOrder.mock.calls[0]![0]).toMatchObject({ paymentMethod: 'COD' });
    expect(m.quote.mock.calls.length).toBeGreaterThan(before);
    const cod = radio(r, 'Thanh toán khi nhận hàng');
    expect(cod.disabled).toBe(true);
    expect(r.container.querySelector(`#${cod.getAttribute('aria-describedby')}`)!.textContent).toBe(reason);
    expect(radio(r, 'Chuyển khoản ngân hàng').checked).toBe(true);

    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder.mock.calls[1]![0]).toMatchObject({ paymentMethod: 'BANK_TRANSFER' });
  });
});

describe('/thanh-toan — địa chỉ theo địa giới cũ (PANCAKE-16)', () => {
  it('địa chỉ mã cũ: gắn nhãn cảnh báo; báo giá bị từ chối ADDRESS_OUTDATED thì nói rõ cần thêm địa chỉ mới', async () => {
    m.addresses = [{ ...NEW_ADDR, provinceCode: '01', wardCode: '00004' }];
    m.quote.mockRejectedValue(new ApiError('Địa chỉ giao hàng chưa theo địa giới mới. Vui lòng cập nhật lại địa chỉ.', 400, 'ADDRESS_OUTDATED'));
    const r = await mount();
    const text = r.container.textContent ?? '';
    expect(text).toContain('Địa giới cũ (trước khi sắp xếp tỉnh/phường 2025)');
    expect(text).toContain('Hãy bấm Sửa ở địa chỉ đó để chọn lại tỉnh/phường, hoặc thêm địa chỉ mới.');
    expect(placeButton(r).disabled).toBe(true);
  });

  it('địa chỉ hệ mới: không gắn nhãn cảnh báo', async () => {
    const r = await mount();
    expect(r.container.textContent).not.toContain('Địa giới cũ');
  });
});
