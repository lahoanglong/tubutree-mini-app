// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Công tắc "Gửi thêm thông báo giao hàng (không kèm giá) cho số người nhận" (PO A1) và số nhận tin khi tài khoản chưa có số (PO A2) ở /thanh-toan.

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  zalo: null as unknown,
  addresses: [] as unknown[],
  bodies: [] as Record<string, unknown>[],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/geo-client', () => ({
  getProvinces: async () => [{ code: '84_VN01', name: 'Hà Nội' }],
  getCommunes: async () => [{ code: '84_VN01_001', name: 'Cầu Giấy' }],
}));
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  trackWebEvent: () => undefined,
}));
vi.mock('@/lib/core-http', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/core-http')>();
  return {
    ...orig,
    coreHttp: {
      ...orig.coreHttp,
      get: (path: string, opts?: unknown) => {
        if (path === '/config/public') return Promise.resolve(mocks.config);
        if (path === '/config/order-zalo') return Promise.resolve(mocks.zalo);
        return orig.coreHttp.get(path, opts as never);
      },
    },
  };
});
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => ({
    items: [{ id: 'i1', variationId: 'v1', productName: 'Dầu gội', variationName: '500ml', slug: 'dau-goi', thumbnail: null, unitPrice: 300000, quantity: 1, stock: 5, total: 300000 }],
    couponCode: null, subtotal: 300000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 1,
  }),
  getMyCoupons: async () => [],
  placeOrder: async (body: Record<string, unknown>) => {
    mocks.bodies.push(body);
    return {
      id: 'o1', code: 'TB7K2M', status: 'CONFIRMED', subtotal: 300000, discount: 0, shippingFee: 30000, total: 330000, pointsEarned: 0,
      paymentMethod: 'COD', createdAt: '2026-11-25T05:00:00Z', items: [], fulfiller: 'TUBU', orderZaloConsent: true,
    };
  },
  getAddresses: async () => mocks.addresses,
  getPublicConfig: () => Promise.resolve(mocks.config),
  checkoutQuote: async () => ({
    subtotal: 300000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 330000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
  }),
}));

import CheckoutPage from './page';
import { loadCheckoutPanels } from '@/components/checkout/checkout-panels-load';

beforeAll(() => loadCheckoutPanels());

const BASE = {
  province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ', provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_001',
};
const GIFT = { ...BASE, id: 'gift', recipient: 'Bà Ngoại', phone: '0912345678', isDefault: true };
const GIFT2 = { ...BASE, id: 'gift2', recipient: 'Cô Hai', phone: '0987654321', isDefault: false };
const SELF = { ...BASE, id: 'self', recipient: 'Nguyễn An', phone: '0901234567', isDefault: false };
const STATUS = {
  enabled: true, prechecked: false, choice: null, phoneMasked: '090•••4567', buyerPhone: '0901234567', phoneSource: 'account_verified',
  recipientEnabled: true, tubuZaloPhone: '0899149229',
};
const NOTE = 'Số nhận hàng khác số tài khoản. Tin xác nhận đơn gửi về Zalo số 090•••4567.';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(10);
  return r.container;
};
const consentBox = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((i) => i.closest('label')?.textContent?.includes('Nhận hành trình đơn hàng qua Zalo'));
const recipientBlock = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="order-zalo-recipient"]');
const recipientBox = (c: HTMLElement) => recipientBlock(c)?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
const tick = async (box: HTMLInputElement) => {
  click(box);
  await flush(2);
};
const place = async (c: HTMLElement) => {
  click(byText(c, 'button', 'Đặt hàng'));
  await flush(10);
  return mocks.bodies[0]!;
};
const pickAddress = async (c: HTMLElement, recipient: string) => {
  click(c.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"][data-ds="checkout-address-card"]')!);
  await flush(2);
  const option = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="radio"]')).find((b) => b.textContent?.includes(recipient));
  click(option!);
  await flush(6);
};

beforeEach(() => {
  mocks.config = { freeshipThreshold: 500000, shippingEta: null, orderZaloEnabled: true };
  mocks.zalo = STATUS;
  mocks.addresses = [GIFT, GIFT2, SELF];
  mocks.bodies = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/thanh-toan — công tắc tin giao hàng cho người nhận (PO A1)', () => {
  it('số nhận hàng khác số tài khoản: chưa tick ô đồng ý thì chưa có công tắc; tick thì hiện lời báo + công tắc mặc định TẮT', async () => {
    const c = await mount();
    expect(recipientBlock(c)).toBeNull();
    await tick(consentBox(c)!);
    expect(recipientBlock(c)!.textContent).toContain(NOTE);
    expect(recipientBlock(c)!.textContent).toContain('Gửi thêm thông báo giao hàng (không kèm giá) cho số người nhận');
    expect(recipientBox(c)!.checked).toBe(false);
    expect(recipientBox(c)!.closest('label')!.className).toContain('min-h-11');
    const body = await place(c);
    expect(body.orderZaloConsent).toBe(true);
    expect('notifyRecipientZalo' in body).toBe(false);
  });

  it('bật công tắc: thân đơn có notifyRecipientZalo: true cùng orderZaloConsent: true', async () => {
    const c = await mount();
    await tick(consentBox(c)!);
    await tick(recipientBox(c)!);
    expect(recipientBox(c)!.checked).toBe(true);
    const body = await place(c);
    expect(body).toMatchObject({ orderZaloConsent: true, notifyRecipientZalo: true });
  });

  it('bỏ tick ô đồng ý: công tắc ẩn và tự tắt, tick lại thì công tắc vẫn TẮT; thân đơn không có notifyRecipientZalo', async () => {
    const c = await mount();
    await tick(consentBox(c)!);
    await tick(recipientBox(c)!);
    await tick(consentBox(c)!);
    expect(recipientBlock(c)).toBeNull();
    await tick(consentBox(c)!);
    expect(recipientBox(c)!.checked).toBe(false);
    await tick(consentBox(c)!);
    const body = await place(c);
    expect(body.orderZaloConsent).toBe(false);
    expect('notifyRecipientZalo' in body).toBe(false);
  });

  it('đổi địa chỉ: công tắc về TẮT; chọn địa chỉ trùng số tài khoản thì không còn công tắc', async () => {
    const c = await mount();
    await tick(consentBox(c)!);
    await tick(recipientBox(c)!);
    await pickAddress(c, GIFT2.recipient);
    expect(recipientBox(c)!.checked).toBe(false);
    await tick(recipientBox(c)!);
    await pickAddress(c, SELF.recipient);
    expect(recipientBlock(c)).toBeNull();
    const body = await place(c);
    expect(body).toMatchObject({ addressId: 'self', orderZaloConsent: true });
    expect('notifyRecipientZalo' in body).toBe(false);
  });

  it('địa chỉ trùng số tài khoản (kể cả dạng +84): không có công tắc', async () => {
    mocks.addresses = [{ ...SELF, phone: '+84 901 234 567', isDefault: true }];
    const c = await mount();
    await tick(consentBox(c)!);
    expect(recipientBlock(c)).toBeNull();
  });

  it('cờ người nhận tắt (recipientEnabled false): không có công tắc', async () => {
    mocks.zalo = { ...STATUS, recipientEnabled: false };
    const c = await mount();
    await tick(consentBox(c)!);
    expect(recipientBlock(c)).toBeNull();
    const body = await place(c);
    expect('notifyRecipientZalo' in body).toBe(false);
  });
});

describe('/thanh-toan — số nhận tin khi tài khoản chưa xác minh hoặc chưa có số (PO A2)', () => {
  it('máy chủ trả số tài khoản chưa xác minh (checkout_contact): ô hiện với số đó', async () => {
    mocks.zalo = { ...STATUS, phoneSource: 'checkout_contact' };
    const c = await mount();
    expect(consentBox(c)!.closest('label')!.textContent).toContain('Số nhận: 090•••4567');
  });

  it('tài khoản chưa có số: ô dùng số nhận hàng của địa chỉ đang chọn, không có công tắc người nhận', async () => {
    mocks.zalo = { ...STATUS, phoneMasked: null, buyerPhone: null, phoneSource: null };
    const c = await mount();
    expect(consentBox(c)!.closest('label')!.textContent).toContain('Số nhận: 091•••5678');
    await tick(consentBox(c)!);
    expect(recipientBlock(c)).toBeNull();
    await pickAddress(c, GIFT2.recipient);
    expect(consentBox(c)!.closest('label')!.textContent).toContain('Số nhận: 098•••4321');
    const body = await place(c);
    expect(body).toMatchObject({ addressId: 'gift2', orderZaloConsent: true });
  });

  it('tài khoản chưa có số và địa chỉ không có số đọc được: không có ô, không gửi orderZaloConsent', async () => {
    mocks.zalo = { ...STATUS, phoneMasked: null, buyerPhone: null, phoneSource: null };
    mocks.addresses = [{ ...GIFT, phone: '12345' }];
    const c = await mount();
    expect(consentBox(c)).toBeUndefined();
    const body = await place(c);
    expect('orderZaloConsent' in body).toBe(false);
  });
});
