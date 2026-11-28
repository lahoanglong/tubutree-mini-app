// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Trang Tiết kiệm với Refill (web) cùng ý nghĩa Mini /refill-deals: mỗi hàng "Thay cho <chai>" + thẻ gói Refill, "+ Thêm" một chạm, một lệnh mỗi lúc cho cả trang.
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  track: vi.fn(),
  phase: 'authenticated',
  guest: { enabled: false, pending: false },
}));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [], useRunningFlash: () => ({ flash: [], now: Date.now() }) }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, useCartKey: () => ['cart', null], cartKey: () => ['cart', null] }));
vi.mock('@/lib/guest-cart/flag', () => ({ useGuestCartFlag: () => mocks.guest }));
vi.mock('@/lib/analytics', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/analytics')>()), trackWebEvent: mocks.track }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => '/tiet-kiem-refill',
}));

// Thẻ Mua lại nạp qua next/dynamic (không chạy đồng bộ trong jsdom); thẻ thật có spec riêng, ở đây chỉ kiểm chỗ đặt và surface.
vi.mock('@/components/refill/repurchase-due-card-lazy', () => ({
  RepurchaseDueCard: ({ surface }: { surface: string }) => <div data-testid="repurchase-due-card-slot" data-surface={surface} />,
}));

import RefillLandingView from './refill-landing-view';

const offer = (id: string, price: number) => ({
  productId: `p-${id}`, slug: `refill-${id}`, name: `Túi Refill ${id} 2L`, thumbnail: null, variationId: `v-${id}`, price, compareAt: null, sizeLabel: '2L', inStock: true, tubu: true,
});
const bottle = (id: string) => ({ productId: `b-${id}`, slug: `chai-${id}`, name: `Nước rửa chén ${id} 500ml`, thumbnail: null, price: 68_000, compareAt: null, sizeLabel: '500ml', inStock: true });
const LANDING = {
  enabled: true,
  pairs: [
    { bottle: bottle('a'), refill: offer('a', 200_000), savingPct: 26 },
    { bottle: bottle('c'), refill: offer('c', 230_000), savingPct: 15 },
  ],
};
const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199000, itemCount: 1 };

let mounted: Rendered[] = [];
const mount = async (initial: unknown = LANDING) => {
  const r = render(<RefillLandingView initial={initial as never} initialFetchedAt={Date.now()} />);
  mounted.push(r);
  await flush(4);
  return r.container;
};
const adds = (c: Element) => [...c.querySelectorAll<HTMLButtonElement>('[data-testid="pdp-refill-add"]')];

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.guest = { enabled: false, pending: false };
  mocks.get.mockReset().mockImplementation(async (path: string) => (path === '/catalog/refill-pairs/landing' ? LANDING : { items: [] }));
  mocks.post.mockReset().mockResolvedValue(CART);
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.track.mockReset();
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('RefillLandingView (tubu-w17-01)', () => {
  it('một h1, câu mở đầu "tới X%" theo thẻ, mỗi hàng "Thay cho <chai>" + thẻ gói; báo đã hiện MỘT lần cho cả trang', async () => {
    const c = await mount();
    expect(c.querySelectorAll('h1')).toHaveLength(1);
    expect(c.querySelector('h1')!.textContent).toBe('Tiết kiệm với Refill');
    expect(c.querySelector('header')!.textContent).toMatch(/tới \d+%/);
    const rows = c.querySelectorAll('[data-testid="refill-landing-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('[data-testid="refill-landing-bottle"]')!.textContent).toBe('Thay cho Nước rửa chén a 500ml');
    expect(rows[0]!.querySelector('[data-testid="pdp-refill-open"]')!.getAttribute('href')).toBe('/san-pham/refill-a');
    expect(c.querySelector('#refill-landing-list-title')!.textContent).toBe('Danh sách gói Refill, 2 gói');
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(mocks.track.mock.calls.filter((x) => x[0] === 'refill_swap_shown')).toEqual([['refill_swap_shown', { surface: 'landing' }]]);
  });

  it('"+ Thêm" thêm đúng gói, số lượng 1, không gắn nguồn pdp; thẻ khác bị khoá (aria-disabled) tới khi xong; thành công báo surface landing', async () => {
    let resolve!: (v: unknown) => void;
    mocks.post.mockImplementation(() => new Promise((r) => (resolve = r)));
    const c = await mount();
    click(adds(c)[1]!);
    await flush(1);
    click(adds(c)[0]!);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![1]).toMatchObject({ variationId: 'v-c', quantity: 1 });
    expect(mocks.post.mock.calls[0]![1]).not.toHaveProperty('addSource', 'pdp');
    expect(adds(c)[0]!.getAttribute('aria-disabled')).toBe('true');
    resolve(CART);
    await flush(4);
    expect(byText(document.body, 'span', 'Đã thêm vào giỏ!')).not.toBeNull();
    expect(mocks.track).toHaveBeenCalledWith('refill_swap_applied', { surface: 'landing' });
    expect(adds(c)[0]!.getAttribute('aria-disabled')).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('w55-01: chỗ của thẻ "Sắp hết hàng? Đặt lại 1 chạm" (surface refill_landing) nằm trên danh sách gói', async () => {
    const c = await mount();
    const slot = c.querySelector('[data-testid="repurchase-due-card-slot"]')!;
    expect(slot.getAttribute('data-surface')).toBe('refill_landing');
    expect(slot.compareDocumentPosition(c.querySelector('[data-testid="refill-landing-list"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('khách chưa đăng nhập, giỏ khách tắt: nhớ món rồi sang đăng nhập, quay về trang gói Refill', async () => {
    mocks.phase = 'guest';
    const c = await mount();
    click(adds(c)[0]!);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Frefill-a');
  });

  it('cờ tắt hay không có cặp: lời trống dẫn về Danh mục, không báo đã hiện', async () => {
    const c = await mount({ enabled: false, pairs: [] });
    expect(c.textContent).toContain('Chưa có gói Refill nào đang mở bán');
    expect(c.querySelector('a[href="/san-pham"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="refill-landing-list"]')).toBeNull();
    expect(mocks.track).not.toHaveBeenCalledWith('refill_swap_shown', expect.anything());
  });
});
