// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Dòng "Kết bạn Zalo với Tubu Tree" trong khối trạng thái chi tiết đơn web, cùng điều kiện với Mini (order-detail-order-zalo.spec.tsx).

const mocks = vi.hoisted(() => ({
  order: null as unknown,
  cfg: {} as Record<string, unknown>,
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: async () => ({ hotline: '0984 606 774', email: 'tubutree@gmail.com' }),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated' }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({ code: 'TB-9' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/core-http', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/core-http')>();
  const coreHttp = new Proxy(orig.coreHttp, {
    get(target, key) {
      if (key !== 'get') return Reflect.get(target, key);
      return (path: string, ...rest: unknown[]) =>
        path === '/config/public' ? Promise.resolve(mocks.cfg) : (target.get as (...a: unknown[]) => Promise<unknown>).call(target, path, ...rest);
    },
  });
  return { ...orig, coreHttp };
});
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  fetchOrder: async () => mocks.order,
  fetchMyReturns: async () => [],
}));

import OrderDetailPage from './page';

const ORDER = {
  code: 'TB-9',
  status: 'CONFIRMED',
  orderZaloConsent: true,
  subtotal: 300000,
  discount: 0,
  couponDiscount: 0,
  comboDiscount: 0,
  tierDiscount: 0,
  pointsDiscount: 0,
  shippingFee: 30000,
  total: 330000,
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  createdAt: '2026-11-17T03:00:00Z',
  couponCode: null,
  pointsUsed: 0,
  note: null,
  shippingAddress: { recipient: 'Nguyễn An', phone: '0912345678', province: 'Hà Nội', district: '', ward: 'Cầu Giấy', street: '1 Xuân Thuỷ' },
  shippingPartner: null,
  shippingCode: null,
  trackingLink: null,
  items: [{ productName: 'Dầu gội bồ kết', variationName: '500ml', unitPrice: 150000, quantity: 2, total: 300000, thumbnail: null }],
};
const FRIEND = 'Nhận Bill & theo dõi đơn TB-9 miễn phí qua Zalo Tubu Tree';

let mounted: Rendered[] = [];
const mount = async (order: Record<string, unknown>) => {
  mocks.order = order;
  const r = render(<OrderDetailPage />);
  mounted.push(r);
  await flush(10);
  return r.container;
};
const friendLinks = (c: HTMLElement) => [...c.querySelectorAll('a')].filter((a) => a.textContent === 'Mở Zalo Tubu Tree');

beforeEach(() => {
  mocks.cfg = { orderZaloEnabled: true, tubuZaloPhone: '0899149229' };
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('Chi tiết đơn web — dòng kết bạn Zalo Tubu Tree', () => {
  it('cờ bật, đơn đã đồng ý, đang xử lý: một dòng trong khối trạng thái, liên kết mở tab mới tới zalo.me', async () => {
    const c = await mount(ORDER);
    const timeline = c.querySelector('[data-testid="order-timeline"]') ?? c;
    expect(timeline.textContent).toContain(FRIEND);
    const links = friendLinks(c);
    expect(links).toHaveLength(1);
    expect(timeline.contains(links[0]!)).toBe(true);
    expect(links[0]!.getAttribute('href')).toBe('https://zalo.me/0899149229');
    expect(links[0]!.getAttribute('target')).toBe('_blank');
    expect(links[0]!.getAttribute('rel')).toContain('noopener');
  });

  it.each([
    ['cờ tắt', { orderZaloEnabled: false }, ORDER],
    ['đơn không đồng ý', { orderZaloEnabled: true }, { ...ORDER, orderZaloConsent: false }],
    ['đơn đã giao', { orderZaloEnabled: true }, { ...ORDER, status: 'DELIVERED' }],
    ['đơn đã huỷ', { orderZaloEnabled: true }, { ...ORDER, status: 'CANCELLED' }],
  ])('%s: không có dòng kết bạn', async (_name, cfg, order) => {
    mocks.cfg = cfg;
    const c = await mount(order);
    expect(c.textContent).toContain('Dầu gội bồ kết');
    expect(c.textContent).not.toContain(FRIEND);
    expect(friendLinks(c)).toHaveLength(0);
  });
});
