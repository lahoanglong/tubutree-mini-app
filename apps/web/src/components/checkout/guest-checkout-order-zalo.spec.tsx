// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseGeo, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { act } from 'react';

// Ô "Nhận hành trình đơn hàng qua Zalo" ở form đặt không đăng nhập (PO A2): số nhận là số khách vừa gõ, chỉ khi cổng mở cho mọi khách.

const m = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  quote: vi.fn(),
  place: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/thanh-toan' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null, status: 'idle', initialized: true, startZaloLogin: vi.fn() }) }));
vi.mock('@/lib/geo-client', () => ({
  getProvinces: async () => [{ code: '84_VN01', name: 'Hà Nội' }],
  getCommunes: async () => [{ code: '84_VN01_001', name: 'Cầu Giấy' }],
}));
vi.mock('@/lib/core-http', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/core-http')>();
  return {
    ...orig,
    coreHttp: {
      ...orig.coreHttp,
      get: (path: string, opts?: unknown) => (path === '/config/public' ? Promise.resolve(m.config) : orig.coreHttp.get(path, opts as never)),
    },
  };
});
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: vi.fn(async () => {
    throw new Error('không gọi giỏ tài khoản khi chưa đăng nhập');
  }),
  getAddresses: vi.fn(async () => []),
  getPublicConfig: () => Promise.resolve(m.config),
}));
vi.mock('@/lib/guest-cart/use-guest-cart', () => ({
  useGuestCartLines: () => [{ variationId: 'v1', slug: 'dau-goi', quantity: 2, addedAt: 1 }],
}));
vi.mock('@/lib/guest-cart/products', () => ({ useGuestCartProducts: () => new Map() }));
vi.mock('@/lib/use-flash-sales', () => ({ useRunningFlash: () => ({ flash: [], now: 0 }) }));
vi.mock('@/lib/guest-cart/view', () => ({
  guestCartView: () => ({
    rows: [
      {
        variationId: 'v1', slug: 'dau-goi', quantity: 2, state: 'ok', productName: 'Dầu gội', variationName: 'Chai 500ml', thumbnail: null,
        unitPrice: 120_000, compareAt: null, isFlash: false, total: 240_000, stock: 9, maxQty: 9, tubu: true, blockedText: null,
      },
    ],
    subtotal: 240_000,
    tubuSubtotal: 240_000,
    hasMerchant: false,
    settled: true,
  }),
}));
vi.mock('@/lib/guest-cart/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/guest-cart/store')>()),
  clearGuestCart: () => undefined,
}));
vi.mock('@/lib/guest-checkout/api', () => ({
  guestQuote: (...a: unknown[]) => m.quote(...a),
  guestPlaceOrder: (...a: unknown[]) => m.place(...a),
  guestTrackOrder: vi.fn(),
  guestBankQr: vi.fn(),
  claimGuestOrdersRequest: vi.fn(),
}));

import CheckoutPage from '@/app/thanh-toan/page';

beforeAll(async () => {
  await import('@/components/checkout/guest-checkout');
});

const QUOTE = {
  flashNotice: false, blockedPaymentMethods: {}, codMax: 500_000, subtotal: 240_000, discount: 0, comboDiscount: 0, shippingFee: 0, total: 240_000,
  items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: 'Chai 500ml', slug: 'dau-goi', thumbnail: null, unitPrice: 120_000, quantity: 2, total: 240_000 }],
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const field = (r: Rendered, label: string) => {
  const l = Array.from(r.container.querySelectorAll('label')).find((x) => x.textContent?.trim() === label);
  return document.getElementById(l!.htmlFor) as HTMLInputElement;
};
async function fillForm(r: Rendered, phone = '+84 912 345 678') {
  typeInto(field(r, 'Họ tên người nhận'), 'Lan');
  typeInto(field(r, 'Số điện thoại'), phone);
  act(() => {
    field(r, 'Số điện thoại').dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  chooseGeo(r.container, 'Tỉnh/Thành phố', '84_VN01');
  await flush(4);
  chooseGeo(r.container, 'Phường/Xã', '84_VN01_001');
  typeInto(field(r, 'Số nhà, tên đường'), '12 Ngõ 5');
  await new Promise((res) => setTimeout(res, 700));
  await flush(6);
}
const consentBox = (r: Rendered) =>
  Array.from(r.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((i) => i.closest('label')?.textContent?.includes('Nhận hành trình đơn hàng qua Zalo'));
const place = async (r: Rendered) => {
  click(r.container.ownerDocument.querySelector<HTMLButtonElement>('[data-testid="guest-place-order"]')!);
  await flush(6);
  expect(m.place).toHaveBeenCalledTimes(1);
  return m.place.mock.calls[0]![0] as Record<string, unknown>;
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  m.config = { webGuestCheckoutEnabled: true, orderZaloEnabled: true, orderZaloGuest: true, orderZaloPrechecked: false };
  m.quote.mockReset().mockResolvedValue(QUOTE);
  m.place.mockReset().mockResolvedValue({ code: 'TB7K2M', status: 'PENDING', paymentMethod: 'COD', total: 240_000, codes: ['TB7K2M'], keyAccepted: true });
});
afterEach(() => {
  mounted.forEach((x) => x.unmount());
  mounted = [];
});

describe('/thanh-toan chưa đăng nhập — ô nhận hành trình đơn qua Zalo (PO A2)', () => {
  it('cổng chưa mở cho mọi khách (orderZaloGuest vắng): không có ô, thân đơn không có orderZaloConsent', async () => {
    m.config = { webGuestCheckoutEnabled: true, orderZaloEnabled: true };
    const r = await mount();
    await fillForm(r);
    expect(consentBox(r)).toBeUndefined();
    const body = await place(r);
    expect('orderZaloConsent' in body).toBe(false);
  });

  it('chưa gõ số: chưa có ô; gõ số đúng thì ô hiện với số đã che của khách, mặc định theo cấu hình (không tick)', async () => {
    const r = await mount();
    expect(consentBox(r)).toBeUndefined();
    await fillForm(r);
    const box = consentBox(r)!;
    expect(box.checked).toBe(false);
    expect(box.closest('label')!.textContent).toContain('Số nhận: 091•••5678');
    expect(r.container.querySelector('[data-testid="order-zalo-recipient"]')).toBeNull();
    const body = await place(r);
    expect(body.orderZaloConsent).toBe(false);
    expect('notifyRecipientZalo' in body).toBe(false);
  });

  it('tick ô: thân đơn có orderZaloConsent: true', async () => {
    const r = await mount();
    await fillForm(r);
    click(consentBox(r)!);
    await flush(2);
    expect(consentBox(r)!.checked).toBe(true);
    const body = await place(r);
    expect(body.orderZaloConsent).toBe(true);
  });

  it('cấu hình tick sẵn: ô tick sẵn, gửi true', async () => {
    m.config = { ...m.config, orderZaloPrechecked: true };
    const r = await mount();
    await fillForm(r);
    expect(consentBox(r)!.checked).toBe(true);
    const body = await place(r);
    expect(body.orderZaloConsent).toBe(true);
  });

  it('số bàn (không phải di động): không có ô', async () => {
    const r = await mount();
    await fillForm(r, '024 3123 4567');
    expect(consentBox(r)).toBeUndefined();
  });
});
