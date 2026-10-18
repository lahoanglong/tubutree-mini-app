// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError, NetworkError } from '@/lib/client-api';

const ADDR = {
  id: 'a1', recipient: 'An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Ba Đình', street: '1 Phố Huế',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_00004', isDefault: true,
};
const QUOTE = { subtotal: 100000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 130000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0 };

const m = vi.hoisted(() => ({ quote: vi.fn(), placeOrder: vi.fn(), cart: vi.fn(), wasteMe: vi.fn(), pickupFlag: true }));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u', walletBalance: 0 }, status: 'authenticated' }) }));
vi.mock('@/lib/geo-client', () => ({ getProvinces: async () => [], getCommunes: async () => [] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: (...args: unknown[]) => m.cart(...args),
  getMe: async () => ({ pointsBalance: 0, walletBalance: 0 }),
  getMyCoupons: async () => [],
  getPublicConfig: async () => ({ waste: { enabled: true, dropoff: true, mailin: true, pickup: m.pickupFlag } }),
  getAddresses: async () => [ADDR],
  checkoutQuote: (...args: unknown[]) => m.quote(...args),
  placeOrder: (...args: unknown[]) => m.placeOrder(...args),
}));

vi.mock('@tubutree/app-core/api/waste', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tubutree/app-core/api/waste')>()),
  getWasteMe: (...args: unknown[]) => m.wasteMe(...args),
}));

import CheckoutPage from './page';

const PICKUP = {
  id: 'req-p', code: 'TR-PICK1', method: 'PICKUP', status: 'OPEN', orderCode: null, estimatedPoints: 12000,
  lines: [{ itemName: 'Thùng carton', unitLabel: 'thùng', declaredQty: 12 }],
};
const ME = (over: Record<string, unknown> = {}) => ({ blocked: false, shipLockedAt: null, openRequests: [PICKUP], ...over });
const waste = (r: Rendered) => r.container.querySelector('#checkout-waste-pickup');
const toggle = (r: Rendered) => waste(r)!.querySelector('input[type="checkbox"]') as HTMLInputElement;

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const placeButton = (r: Rendered) => byText(r.container, 'button', 'Đặt hàng') as HTMLButtonElement;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.placeOrder.mockReset().mockReturnValue(new Promise(() => undefined));
  m.pickupFlag = true;
  m.wasteMe.mockReset().mockResolvedValue(ME());
  m.cart.mockReset().mockResolvedValue({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: null, slug: 'dau-goi', thumbnail: null, unitPrice: 100000, quantity: 1, stock: 5, total: 100000 }],
    couponCode: null, subtotal: 100000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  });
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan — Thu kèm rác (đổi rác lấy quà, §12.2 bước 2)', () => {
  it('cờ pickup tắt → không có mục, không gọi /waste/me, body không có wasteRequestId', async () => {
    m.pickupFlag = false;
    const r = await mount();
    expect(waste(r)).toBeNull();
    expect(m.wasteMe).not.toHaveBeenCalled();
    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder.mock.calls[0]![0]).not.toHaveProperty('wasteRequestId');
  });

  it('có yêu cầu PICKUP mở chưa gắn đơn → công tắc mặc định tắt kèm tóm tắt; không bật thì không gửi', async () => {
    const r = await mount();
    expect(toggle(r).checked).toBe(false);
    const text = waste(r)!.textContent!;
    expect(text).toContain('TR-PICK1');
    expect(text).toContain('Thùng carton: 12 thùng');
    expect(text).toContain('Ước tính 12.000 điểm');
    click(placeButton(r));
    await flush(4);
    expect(m.placeOrder.mock.calls[0]![0]).not.toHaveProperty('wasteRequestId');
  });

  it('bật công tắc → body mang wasteRequestId; Idempotency-Key khác với lúc chưa bật', async () => {
    m.placeOrder.mockRejectedValue(new NetworkError(false));
    const r = await mount();
    click(placeButton(r));
    await flush(6);
    click(toggle(r));
    await flush(2);
    expect(waste(r)!.textContent).toContain('Ghi mã lên túi, bưu tá lấy khi giao đơn.');
    click(placeButton(r));
    await flush(6);
    expect(m.placeOrder.mock.calls[1]![0]).toMatchObject({ wasteRequestId: 'req-p' });
    expect(m.placeOrder.mock.calls[1]![1]).not.toBe(m.placeOrder.mock.calls[0]![1]);
  });

  it('bật công tắc + chuyển khoản → nhắc lịch thu gom đặt sau khi nhận thanh toán', async () => {
    const r = await mount();
    click(toggle(r));
    click([...r.container.querySelectorAll('label')].find((l) => l.textContent?.includes('Chuyển khoản ngân hàng'))!.querySelector('input')!);
    await flush(2);
    expect(waste(r)!.textContent).toContain('Lịch thu gom được đặt sau khi Tubu nhận được thanh toán của đơn.');
  });

  it('chưa có yêu cầu → dòng dẫn tới màn tạo yêu cầu đổi rác', async () => {
    m.wasteMe.mockResolvedValue(ME({ openRequests: [] }));
    const r = await mount();
    const link = waste(r)!.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/doi-rac/tao');
    expect(link.textContent).toContain('Thu kèm rác');
    expect(waste(r)!.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it.each([
    ['yêu cầu đã gắn đơn khác', { openRequests: [{ ...PICKUP, orderCode: 'TUBU999' }] }, true],
    ['bị khoá', { blocked: true }, false],
    ['khoá đường kho', { shipLockedAt: '2026-10-01T00:00:00.000Z' }, false],
  ])('%s → không có công tắc', async (_n, over, hasLink) => {
    m.wasteMe.mockResolvedValue(ME(over));
    const r = await mount();
    expect(r.container.querySelector('#checkout-waste-pickup input[type="checkbox"]')).toBeNull();
    expect(!!waste(r)).toBe(hasLink);
  });

  it('4xx từ chối yêu cầu thu rác đã bật → hiện nguyên văn và tải lại /waste/me', async () => {
    const message = 'Yêu cầu thu rác đã hết hạn hoặc đã huỷ';
    m.placeOrder.mockRejectedValue(new ApiError(message, 409));
    const r = await mount();
    click(toggle(r));
    const before = m.wasteMe.mock.calls.length;
    click(placeButton(r));
    await flush(8);
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(m.wasteMe.mock.calls.length).toBeGreaterThan(before);
  });

  it('mất mạng khi đã bật công tắc → không tải lại /waste/me, bấm lại gửi cùng body và cùng key', async () => {
    m.placeOrder.mockRejectedValue(new NetworkError(false));
    const r = await mount();
    click(toggle(r));
    const before = m.wasteMe.mock.calls.length;
    click(placeButton(r));
    await flush(6);
    click(placeButton(r));
    await flush(6);
    expect(m.wasteMe.mock.calls.length).toBe(before);
    expect(m.placeOrder.mock.calls[1]).toEqual(m.placeOrder.mock.calls[0]);
  });
});
