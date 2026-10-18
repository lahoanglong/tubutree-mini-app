// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const store = vi.hoisted(() => ({ value: null as string | null }));
const gates = vi.hoisted(() => ({ auth: { status: 'idle', initialized: true, sessionUnavailable: false }, get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: { storage: { get: async () => store.value, set: async () => undefined } },
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => gates.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: gates.get, post: gates.post } }));
vi.mock('@/lib/shop-client', () => ({ getCart: async () => ({ itemCount: 0 }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) }));

import * as appGates from './app-gates';
import { AppGates } from './app-gates';
import * as couponGate from './coupon-claim-gate';
import * as onboardingGate from './onboarding-gate';

let mounted: Rendered | null = null;
beforeEach(() => {
  store.value = null;
  gates.auth.status = 'idle';
  gates.get.mockReset().mockResolvedValue({ onboarded: true });
  gates.post.mockReset();
  window.history.replaceState({}, '', '/');
  document.documentElement.removeAttribute('style');
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('AppGates', () => {
  it('gắn cả hai cổng của Mini App: nhận mã giảm giá và quiz chào khách mới', () => {
    expect(appGates.CouponClaimGate).toBe(couponGate.CouponClaimGate);
    expect(appGates.OnboardingGate).toBe(onboardingGate.OnboardingGate);
  });

  it('không vẽ gì ra giao diện', async () => {
    mounted = render(<AppGates />);
    await flush();
    expect(mounted.container.innerHTML).toBe('');
  });

  it('áp cỡ chữ khách đã chọn ngay khi mở bất kỳ trang nào', async () => {
    store.value = JSON.stringify({ fontScale: 'large' });
    mounted = render(<AppGates />);
    await flush();
    expect(document.documentElement.style.fontSize).toBe('18px');
  });

  it('chưa chọn thì không đổi cỡ gốc', async () => {
    mounted = render(<AppGates />);
    await flush();
    expect(document.documentElement.style.fontSize).toBe('');
  });

  it('mở link ?claim= khi đã đăng nhập: AppGates nhận mã vào ví một lần', async () => {
    window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
    gates.auth.status = 'authenticated';
    gates.post.mockResolvedValue({ code: 'SHOPEE-AB12CD34', type: 'FREESHIP', value: 0, minOrder: null, maxDiscount: null, endAt: '2026-12-31T00:00:00Z', newCustomerOnly: false, alreadyClaimed: false });
    mounted = render(<AppGates />);
    await flush(8);
    expect(gates.post).toHaveBeenCalledTimes(1);
    expect(gates.post).toHaveBeenCalledWith('/coupons/claim', { code: 'SHOPEE-AB12CD34' });
  });

  it('khách chưa làm quiz ở Trang chủ: AppGates hiện lời chào', async () => {
    gates.auth.status = 'authenticated';
    gates.get.mockResolvedValue({ onboarded: false });
    mounted = render(<AppGates />);
    await flush(8);
    expect(document.body.textContent).toContain('Chào mừng đến Tubu Tree!');
  });
});
