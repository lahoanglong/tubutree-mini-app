// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Ô "Nhận hành trình đơn hàng qua Zalo" ngay trên Đặt hàng và lời mời kết bạn ở màn đặt xong (wave tubu-mss-consent-ui).

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  zalo: (() => Promise.resolve(null)) as () => Promise<unknown>,
  zaloCalls: 0,
  bodies: [] as Record<string, unknown>[],
  placed: null as unknown,
  events: [] as Array<[string, unknown]>,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/geo-client', () => ({
  getProvinces: async () => [{ code: '84_VN01', name: 'Hà Nội' }],
  getCommunes: async () => [{ code: '84_VN01_001', name: 'Cầu Giấy' }],
}));
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  trackWebEvent: (name: string, props: unknown) => mocks.events.push([name, props]),
}));
vi.mock('@/lib/core-http', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/core-http')>();
  return {
    ...orig,
    coreHttp: {
      ...orig.coreHttp,
      get: (path: string, opts?: unknown) => {
        if (path === '/config/public') return Promise.resolve(mocks.config);
        if (path === '/config/order-zalo') {
          mocks.zaloCalls += 1;
          return mocks.zalo();
        }
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
    return mocks.placed;
  },
  getAddresses: async () => [ADDR],
  getPublicConfig: () => Promise.resolve(mocks.config),
  checkoutQuote: async () => ({
    subtotal: 300000, discount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 30000, total: 330000, pointsEarned: 0, pointsBalance: 0, redeemablePoints: 0,
  }),
}));

import CheckoutPage from './page';

const ADDR = {
  id: 'a1', recipient: 'Nguyễn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ',
  provinceCode: '84_VN01', districtCode: '', wardCode: '84_VN01_001', isDefault: true,
};
const STATUS = { enabled: true, prechecked: false, choice: null, phoneMasked: '090•••4567', tubuZaloPhone: '0899149229' };
const ORDER = {
  id: 'o1', code: 'TUBU2026111557909', status: 'CONFIRMED', subtotal: 300000, discount: 0, shippingFee: 30000, total: 330000, pointsEarned: 0,
  paymentMethod: 'COD', createdAt: '2026-11-17T05:00:00Z', items: [], fulfiller: 'TUBU',
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CheckoutPage />);
  mounted.push(r);
  await flush(10);
  return r.container;
};
const consentBox = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((i) => i.closest('label')?.textContent?.includes('Nhận hành trình đơn hàng qua Zalo'));
const place = async (c: HTMLElement) => {
  click(byText(c, 'button', 'Đặt hàng'));
  await flush(10);
  return mocks.bodies[0]!;
};

beforeEach(() => {
  mocks.config = { freeshipThreshold: 500000, shippingEta: null, orderZaloEnabled: false };
  mocks.zalo = () => Promise.resolve(STATUS);
  mocks.zaloCalls = 0;
  mocks.bodies = [];
  mocks.events = [];
  mocks.placed = { ...ORDER, orderZaloConsent: false };
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/thanh-toan — ô nhận hành trình đơn qua Zalo', () => {
  it('cờ tắt: không hỏi máy chủ, không có ô, thân đơn không có orderZaloConsent', async () => {
    const c = await mount();
    expect(consentBox(c)).toBeUndefined();
    expect(c.textContent).not.toContain('Zalo này');
    expect(mocks.zaloCalls).toBe(0);
    const body = await place(c);
    expect('orderZaloConsent' in body).toBe(false);
  });

  it('cờ bật: ô gắn nhãn (label bọc input), không tick sẵn, có câu PO và số đã che', async () => {
    mocks.config = { ...mocks.config, orderZaloEnabled: true };
    const c = await mount();
    const box = consentBox(c)!;
    expect(box).toBeDefined();
    expect(box.checked).toBe(false);
    const label = box.closest('label')!;
    expect(label.textContent).toContain('Sẽ có tin nhắn nhắc xác nhận hành trình đơn hàng qua Zalo này.');
    expect(label.textContent).toContain('Số nhận: 090•••4567');
    expect(label.className).toContain('min-h-11');
    expect(mocks.events).toContainEqual(['order_zalo_consent_shown', {}]);
    const body = await place(c);
    expect(body.orderZaloConsent).toBe(false);
  });

  it('tick ô → thân place-order có orderZaloConsent: true, đo sự kiện checked', async () => {
    mocks.config = { ...mocks.config, orderZaloEnabled: true };
    const c = await mount();
    click(consentBox(c)!);
    await flush(2);
    expect(consentBox(c)!.checked).toBe(true);
    expect(mocks.events).toContainEqual(['order_zalo_consent_checked', { checked: true }]);
    const body = await place(c);
    expect(body.orderZaloConsent).toBe(true);
  });

  it('lỗi tải trạng thái Zalo: không có ô, vẫn đặt được hàng, không gửi trường', async () => {
    mocks.config = { ...mocks.config, orderZaloEnabled: true };
    mocks.zalo = () => Promise.reject(new Error('mạng'));
    const c = await mount();
    expect(mocks.zaloCalls).toBeGreaterThan(0);
    expect(consentBox(c)).toBeUndefined();
    const body = await place(c);
    expect('orderZaloConsent' in body).toBe(false);
  });
});

describe('/thanh-toan — lời mời kết bạn Zalo ở màn đặt xong', () => {
  const friendLinks = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLAnchorElement>('a')).filter((a) => a.textContent === 'Mở Zalo Tubu Tree');

  it('cờ bật và đơn có đồng ý: liên kết phụ mở zalo.me ở thẻ mới, câu mời có mã đơn; đo nguồn bấm', async () => {
    mocks.config = { ...mocks.config, orderZaloEnabled: true };
    mocks.placed = { ...ORDER, orderZaloConsent: true };
    const c = await mount();
    await place(c);
    const links = friendLinks(c);
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a.getAttribute('href')).toBe('https://zalo.me/0899149229');
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
    expect(c.textContent).toContain('Kết bạn Zalo với Tubu Tree để nhận hành trình đơn TUBU2026111557909.');
    links[0]!.addEventListener('click', (e) => e.preventDefault());
    click(links[0]!);
    expect(mocks.events).toContainEqual(['order_zalo_friend_click', { from: 'success' }]);
  });

  it('đơn không đồng ý: không có lời mời', async () => {
    mocks.config = { ...mocks.config, orderZaloEnabled: true };
    const c = await mount();
    await place(c);
    expect(c.textContent).toContain('Cảm ơn bạn đã chọn Tubu');
    expect(friendLinks(c)).toHaveLength(0);
  });
});
