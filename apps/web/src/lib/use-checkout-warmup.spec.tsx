// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@/test-utils/render-hook';
import { shippingEstimateQuery } from '@/components/checkout/shipping-estimate-query';
import { useCheckoutWarmup, WARM_ADDRESSES_MS } from './use-checkout-warmup';

// Giỏ làm nóng Thanh toán khi nút Thanh toán vào khung nhìn: mã trang, chunk khối tải lười, sổ địa chỉ, đúng khoá phí giao ước tính. Một lần, chỉ đọc.

const state = vi.hoisted(() => ({ prefetch: vi.fn(), addresses: vi.fn(), estimate: vi.fn(), panels: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ prefetch: state.prefetch, push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/shop-client', () => ({ getAddresses: state.addresses }));
vi.mock('@/components/checkout/checkout-panels-load', () => ({ loadCheckoutPanels: state.panels }));
vi.mock('@tubutree/app-core/api/shipping-estimate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tubutree/app-core/api/shipping-estimate')>()),
  getShippingEstimate: state.estimate,
}));

class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(readonly cb: IntersectionObserverCallback) {
    FakeObserver.all.push(this);
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
  }
  /** Trình duyệt báo phần tử `el` (đang được theo dõi) vào/ra khung nhìn. */
  report(el: Element, isIntersecting: boolean) {
    if (!this.targets.has(el)) return;
    this.cb([{ target: el, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

let idle: Array<() => void> = [];
const runIdle = () => {
  const queue = idle;
  idle = [];
  act(() => queue.forEach((cb) => cb()));
};
const button = () => document.createElement('a');
const observer = () => FakeObserver.all[0]!;

beforeEach(() => {
  FakeObserver.all = [];
  idle = [];
  state.prefetch.mockReset();
  state.addresses.mockReset().mockResolvedValue([{ id: 'a1' }]);
  state.estimate.mockReset().mockResolvedValue({ fee: 30000 });
  state.panels.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => idle.push(cb));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCheckoutWarmup', () => {
  it('chưa vào khung nhìn thì chưa làm gì; vào khung nhìn rồi rảnh thì tải sẵn trang, khối tải lười, sổ địa chỉ và đúng khoá phí giao Thanh toán đọc', async () => {
    const { result, client } = renderHook((base: number | null) => useCheckoutWarmup(base), { initialProps: 250_000.4 });
    const el = button();
    result.current(el);
    expect(idle).toHaveLength(0);
    expect(state.prefetch).not.toHaveBeenCalled();

    observer().report(el, false);
    expect(idle).toHaveLength(0);

    observer().report(el, true);
    expect(state.prefetch).not.toHaveBeenCalled();
    expect(state.panels).not.toHaveBeenCalled();
    runIdle();

    expect(state.prefetch).toHaveBeenCalledWith('/thanh-toan');
    expect(state.panels).toHaveBeenCalledTimes(1);
    expect(state.addresses).toHaveBeenCalledTimes(1);
    expect(state.estimate).toHaveBeenCalledTimes(1);
    expect(state.estimate).toHaveBeenCalledWith(expect.anything(), { subtotal: 250_000, provinceCode: undefined }, { anonymous: undefined });
    await waitFor(() => expect(client.getQueryData(['addresses'])).toEqual([{ id: 'a1' }]));
    // Khoá trùng khoá `useShippingEstimate(250000)` của Thanh toán khi chưa có địa chỉ (đã đăng nhập, không tỉnh).
    expect(shippingEstimateQuery(250_000).queryKey).toEqual(['shipping-estimate', 250_000, null, 'me']);
    await waitFor(() => expect(client.getQueryData(['shipping-estimate', 250_000, null, 'me'])).toEqual({ fee: 30000 }));
  });

  it('chỉ chạy một lần mỗi lần mở giỏ, kể cả khi nút thứ hai (thanh dính đáy) vào khung nhìn sau', () => {
    const { result } = renderHook(() => useCheckoutWarmup(100_000));
    const lg = button();
    const bar = button();
    result.current(lg);
    result.current(bar);
    expect(FakeObserver.all).toHaveLength(1);
    observer().report(lg, true);
    observer().report(bar, true);
    runIdle();
    const later = button();
    expect(result.current(later)).toBeUndefined();
    runIdle();
    expect(state.prefetch).toHaveBeenCalledTimes(1);
    expect(state.panels).toHaveBeenCalledTimes(1);
    expect(state.addresses).toHaveBeenCalledTimes(1);
  });

  it('có hàng gian hàng tự giao (estimateBase null): không hỏi phí giao ước tính, vẫn tải trang và sổ địa chỉ', () => {
    const { result } = renderHook(() => useCheckoutWarmup(null));
    const el = button();
    result.current(el);
    observer().report(el, true);
    runIdle();
    expect(state.estimate).not.toHaveBeenCalled();
    expect(state.prefetch).toHaveBeenCalledTimes(1);
    expect(state.addresses).toHaveBeenCalledTimes(1);
  });

  it('sổ địa chỉ đã có và còn mới (đọc trong 30 giây): không gọi lại', async () => {
    const { result, client } = renderHook(() => useCheckoutWarmup(null));
    client.setQueryData(['addresses'], [{ id: 'cached' }]);
    const el = button();
    result.current(el);
    observer().report(el, true);
    runIdle();
    expect(WARM_ADDRESSES_MS).toBe(30_000);
    expect(state.addresses).not.toHaveBeenCalled();
    expect(client.getQueryData(['addresses'])).toEqual([{ id: 'cached' }]);
  });

  it('nút bị gỡ (giỏ hết đặt được) trước khi vào khung nhìn: không làm gì', () => {
    const { result } = renderHook(() => useCheckoutWarmup(100_000));
    const el = button();
    const cleanup = result.current(el);
    cleanup?.();
    observer().report(el, true);
    runIdle();
    expect(state.prefetch).not.toHaveBeenCalled();
    expect(state.panels).not.toHaveBeenCalled();
    expect(state.addresses).not.toHaveBeenCalled();
  });

  it('router.prefetch lỗi vẫn đọc sẵn sổ địa chỉ', () => {
    state.prefetch.mockImplementation(() => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => useCheckoutWarmup(null));
    const el = button();
    result.current(el);
    observer().report(el, true);
    runIdle();
    expect(state.addresses).toHaveBeenCalledTimes(1);
  });

  it('trình duyệt không có IntersectionObserver: không làm gì (Thanh toán tự tải như cũ)', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { result } = renderHook(() => useCheckoutWarmup(100_000));
    expect(result.current(button())).toBeUndefined();
    runIdle();
    expect(state.prefetch).not.toHaveBeenCalled();
    expect(state.addresses).not.toHaveBeenCalled();
  });
});
