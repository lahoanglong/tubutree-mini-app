// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Thẻ nhựa đã giảm (tubu-w11-03): trang hỏi máy chủ khi cờ giới thiệu bật và đơn đã chốt; có số thì vẽ thẻ và bỏ dòng mời thứ hai.

const mocks = vi.hoisted(() => ({
  order: null as unknown,
  cfg: {} as Record<string, unknown>,
  eco: null as unknown,
  ecoCalls: [] as string[],
}));
vi.mock('@/lib/core-http', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/core-http')>();
  return {
    ...real,
    coreHttp: {
      ...real.coreHttp,
      get: async (path: string) => {
        if (path === '/config/public') return mocks.cfg;
        if (path.startsWith('/me/eco-impact/orders/')) {
          mocks.ecoCalls.push(path);
          if (mocks.eco instanceof Error) throw mocks.eco;
          return mocks.eco;
        }
        throw new Error(`không mock ${path}`);
      },
    },
  };
});
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: async () => ({ hotline: '0984 606 774', email: 'tubutree@gmail.com' }),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, status: 'authenticated' }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({ code: 'TB-9' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  fetchOrder: async () => mocks.order,
  fetchMyReturns: async () => [],
  fetchMyRefunds: async () => [],
}));
vi.mock('@/lib/analytics', () => ({ trackWebEvent: vi.fn() }));

import OrderDetailPage from './page';

const DELIVERED = {
  id: 'o1',
  code: 'TB-9',
  status: 'DELIVERED',
  type: 'RETAIL',
  subtotal: 300000,
  discount: 0,
  shippingFee: 0,
  total: 300000,
  paymentMethod: 'COD',
  paymentStatus: 'PAID',
  createdAt: new Date(Date.now() - 5 * 864e5).toISOString(),
  updatedAt: new Date(Date.now() - 864e5).toISOString(),
  deliveredAt: new Date(Date.now() - 864e5).toISOString(),
  pointsUsed: 0,
  pointsEarned: 120,
  shippingAddress: { recipient: 'An', phone: '0912345678', street: '1 Xuân Thuỷ', ward: 'Cầu Giấy', province: 'Hà Nội' },
  items: [{ id: 'i1', productName: 'Refill Nước rửa chén 10L', variationName: '10L', unitPrice: 150000, quantity: 2, total: 300000 }],
};
const IMPACT = {
  orderCode: 'TB-9',
  bottlesSaved: 5,
  plasticGrams: 0,
  refillPacks: 2,
  points: 120,
  pointsCredited: true,
  referralCode: 'LAN123',
  inviteReward: { points: 100, minOrderAmount: 199_000 },
};

async function waitFor(cond: () => boolean, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (!cond() && Date.now() < end) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OrderDetailPage />);
  mounted.push(r);
  await flush(10);
  return r.container;
};
const card = (c: HTMLElement) => c.querySelector('[data-testid="order-eco-impact"]');
const inviteLine = (c: HTMLElement) => Array.from(c.querySelectorAll('p')).find((p) => p.textContent?.startsWith('Thích Tubu Tree?')) ?? null;

beforeAll(async () => {
  await import('@/components/orders/eco-impact-card');
  await import('@tubutree/app-core/eco/order-impact');
});
beforeEach(() => {
  mocks.order = DELIVERED;
  mocks.cfg = { referralViralEnabled: true, referralShareCardEnabled: true, returnWindowDays: 7 };
  mocks.eco = IMPACT;
  mocks.ecoCalls = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('Chi tiết đơn web: thẻ nhựa đã giảm', () => {
  it('đơn đã giao có gói Refill: thẻ hiện số chai, không còn dòng "Thích Tubu Tree?" thứ hai', async () => {
    const c = await mount();
    await waitFor(() => !!card(c));
    expect(card(c)!.textContent).toContain('Đơn này bạn đã giảm 5 chai nhựa dùng 1 lần');
    expect(mocks.ecoCalls).toEqual(['/me/eco-impact/orders/TB-9']);
    await flush(5);
    expect(inviteLine(c)).toBeNull();
  });

  it('máy chủ trả số 0 (đơn không có Refill): không thẻ, dòng mời cũ vẫn còn', async () => {
    mocks.eco = { ...IMPACT, bottlesSaved: 0, points: 0 };
    const c = await mount();
    await waitFor(() => !!inviteLine(c));
    expect(card(c)).toBeNull();
    expect(inviteLine(c)).not.toBeNull();
  });

  it('cờ growth.referral_viral_enabled tắt: không hỏi máy chủ, không thẻ', async () => {
    mocks.cfg = { referralViralEnabled: false, referralShareCardEnabled: true, returnWindowDays: 7 };
    const c = await mount();
    await waitFor(() => !!inviteLine(c));
    expect(mocks.ecoCalls).toEqual([]);
    expect(card(c)).toBeNull();
  });

  it('đơn chờ chuyển khoản: không hỏi máy chủ', async () => {
    mocks.order = { ...DELIVERED, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', deliveredAt: null };
    await mount();
    await flush(10);
    expect(mocks.ecoCalls).toEqual([]);
  });

  it('API lỗi (404): không thẻ, dòng mời cũ vẫn còn', async () => {
    mocks.eco = new Error('404');
    const c = await mount();
    await waitFor(() => !!inviteLine(c));
    expect(card(c)).toBeNull();
  });
});
