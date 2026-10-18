// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, flush, render, type Rendered } from '@/test-utils/dom';

// Chép ý nghĩa order-strip.spec của Mini App: dải "đơn đang giao / kỳ định kỳ kế tiếp" (spec 5b.1).
const mocks = vi.hoisted(() => ({ get: vi.fn(), phase: 'authenticated' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
const routeState = vi.hoisted(() => ({ pending: new Set<string>() }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => !routeState.pending.has(p) }));

import { OrderStrip, formatDayMonth, nextActiveSubscription } from './order-strip';

const SUB = (id: string, status: 'ACTIVE' | 'PAUSED', nextRunAt: string) => ({
  id, status, nextRunAt, quantity: 1, intervalWeeks: 4, productName: `SP ${id}`, variationName: '', thumbnail: null, slug: null, unitPrice: 1, effectiveDiscountPct: 0,
});
const SHIPPING_ORDER = { code: 'TB123', status: 'SHIPPING' };

let activeCount = 0;
let orders: unknown = { data: [], meta: { page: 1, limit: 1, total: 0 } };
let subs: unknown = [];
let failing = new Set<string>();
const paths = () => mocks.get.mock.calls.map(([p]) => p as string);

let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<OrderStrip />);
  await flush(8);
  return mounted;
};

beforeEach(() => {
  routeState.pending = new Set();
  mocks.phase = 'authenticated';
  activeCount = 0;
  orders = { data: [], meta: { page: 1, limit: 1, total: 0 } };
  subs = [];
  failing = new Set();
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (failing.has(path)) throw new Error('boom');
    if (path === '/orders/active-count') return { count: activeCount };
    if (path === '/orders') return orders;
    if (path === '/me/subscriptions') return subs;
    throw new Error(`đường dẫn lạ ${path}`);
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('nextActiveSubscription / formatDayMonth', () => {
  it('kỳ ACTIVE sớm nhất (bỏ PAUSED, bỏ ngày hỏng)', () => {
    const list = [SUB('b', 'ACTIVE', '2026-10-20T00:00:00.000Z'), SUB('p', 'PAUSED', '2026-10-01T00:00:00.000Z'), SUB('a', 'ACTIVE', '2026-10-15T00:00:00.000Z')];
    expect(nextActiveSubscription(list)?.id).toBe('a');
    expect(nextActiveSubscription([])).toBeUndefined();
    expect(nextActiveSubscription([SUB('p', 'PAUSED', '2026-10-01T00:00:00.000Z')])).toBeUndefined();
    expect(nextActiveSubscription([SUB('x', 'ACTIVE', 'not-a-date')])).toBeUndefined();
  });

  it('dd/MM theo giờ Việt Nam, đệm số 0', () => {
    expect(formatDayMonth('2026-10-15T12:00:00.000Z')).toBe('15/10');
    expect(formatDayMonth('2026-03-05T12:00:00.000Z')).toBe('05/03');
    expect(formatDayMonth('2026-03-05T20:00:00.000Z')).toBe('06/03');
  });
});

describe('OrderStrip', () => {
  it('khách chưa đăng nhập → không gọi API, không render (kể cả placeholder)', async () => {
    mocks.phase = 'guest';
    const { container } = await mount();
    expect(container.textContent).toBe('');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('badge = 0: không tải danh sách đơn, không placeholder (không kéo trang xuống rồi lên)', async () => {
    const { container } = await mount();
    expect(paths()).not.toContain('/orders');
    expect(container.querySelector('[data-testid="order-strip-loading"]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('badge > 0 → placeholder giữ chỗ (ẩn với trình đọc màn hình) trong lúc tải đơn, rồi thành dòng "đang giao"', async () => {
    activeCount = 2;
    orders = { data: [SHIPPING_ORDER], meta: { page: 1, limit: 1, total: 1 } };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation(async (path: string, opts?: unknown) => {
      if (path === '/orders') await gate;
      return base(path, opts);
    });
    const { container } = render(<OrderStrip />);
    mounted = { container, root: undefined as never, unmount: () => undefined };
    await flush(6);
    const placeholder = container.querySelector('[data-testid="order-strip-loading"]');
    expect(placeholder?.getAttribute('aria-hidden')).toBe('true');
    release();
    await flush(6);
    expect(container.querySelector('[data-testid="order-strip-loading"]')).toBeNull();
    expect(container.textContent).toContain('Đơn TB123 đang giao');
  });

  it('chỉ lấy đơn SHIPPING, trang 1, 1 đơn', async () => {
    activeCount = 1;
    orders = { data: [SHIPPING_ORDER], meta: { page: 1, limit: 1, total: 1 } };
    await mount();
    const call = mocks.get.mock.calls.find(([p]) => p === '/orders')!;
    expect(call[1]).toEqual({ query: { status: 'SHIPPING', page: 1, limit: 1 } });
  });

  it('có đơn SHIPPING → dòng "Đơn … đang giao" dẫn tới chi tiết đơn của web', async () => {
    activeCount = 1;
    orders = { data: [SHIPPING_ORDER], meta: { page: 1, limit: 1, total: 1 } };
    const { container } = await mount();
    const link = byText(container, 'a', 'Đơn TB123 đang giao')!;
    expect(link.getAttribute('href')).toBe('/tai-khoan/don-hang/TB123');
    expect(link.textContent).toContain('Chạm để theo dõi đơn');
  });

  it('tab Định kỳ chưa có trang (pending) → dòng kỳ kế tiếp không còn là link', async () => {
    routeState.pending = new Set(['/tai-khoan/don-hang?tab=subscriptions']);
    subs = [SUB('a', 'ACTIVE', '2026-10-15T12:00:00.000Z')];
    const { container } = await mount();
    expect(container.textContent).toContain('Kỳ định kỳ kế tiếp: 15/10');
    expect(container.querySelector('a[href*="subscriptions"]')).toBeNull();
  });

  it('có kỳ định kỳ → dòng "Kỳ định kỳ kế tiếp: dd/MM" mở tab Định kỳ, kèm tên sản phẩm', async () => {
    subs = [SUB('a', 'ACTIVE', '2026-10-15T12:00:00.000Z')];
    const { container } = await mount();
    const link = byText(container, 'a', 'Kỳ định kỳ kế tiếp: 15/10')!;
    expect(link.getAttribute('href')).toBe('/tai-khoan/don-hang?tab=subscriptions');
    expect(link.textContent).toContain('SP a');
  });

  it('badge > 0 nhưng không có đơn SHIPPING → ẩn dòng đơn, vẫn hiện kỳ định kỳ', async () => {
    activeCount = 2;
    subs = [SUB('a', 'ACTIVE', '2026-10-15T12:00:00.000Z')];
    const { container } = await mount();
    expect(container.textContent).not.toContain('đang giao');
    expect(container.textContent).toContain('Kỳ định kỳ kế tiếp');
  });

  it('API lỗi → ẩn im lặng (không thẻ lỗi); một nguồn lỗi không ẩn nguồn còn lại', async () => {
    activeCount = 1;
    failing = new Set(['/orders', '/me/subscriptions']);
    const a = await mount();
    expect(a.container.textContent).toBe('');
    a.unmount();
    failing = new Set(['/me/subscriptions']);
    orders = { data: [SHIPPING_ORDER], meta: { page: 1, limit: 1, total: 1 } };
    const b = await mount();
    expect(b.container.textContent).toContain('Đơn TB123 đang giao');
    expect(b.container.textContent).not.toContain('Kỳ định kỳ');
  });
});
