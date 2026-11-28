// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pdpRefillOffer } from '@tubutree/app-core/refill/refill-saving';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Cùng ý nghĩa thẻ gói Refill trang chi tiết Mini App (product-detail-information.spec): một khối cho mọi khách, "+ Thêm" một chạm.
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  track: vi.fn(),
  addGuest: vi.fn(),
  phase: 'authenticated',
  guest: { enabled: false, pending: false },
}));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [], useRunningFlash: () => ({ flash: [], now: Date.now() }) }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, useCartKey: () => ['cart', null], cartKey: () => ['cart', null] }));
vi.mock('@/lib/guest-cart/flag', () => ({ useGuestCartFlag: () => mocks.guest }));
vi.mock('@/lib/analytics', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/analytics')>()), trackWebEvent: mocks.track }));
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/navigation')>()), useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock('@/lib/guest-cart/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/guest-cart/store')>();
  return { ...real, addGuestLine: (...a: Parameters<typeof real.addGuestLine>) => (mocks.addGuest(...a), real.addGuestLine(...a)) };
});

import { PdpRefillOfferBlock } from './pdp-refill-offer';

const OFFER = {
  productId: 'p-refill', slug: 'refill-nuoc-rua-chen-10l', name: 'Túi Refill nước rửa chén 10L', thumbnail: null, variationId: 'v-refill',
  price: 890_000, compareAt: null, sizeLabel: '10L', inStock: true, tubu: true,
};
const VIEW = pdpRefillOffer({ name: 'Nước rửa chén 500ml', price: 68_000 }, OFFER)!;
const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199000, itemCount: 1 };

let mounted: Rendered[] = [];
const mount = async (props: Partial<React.ComponentProps<typeof PdpRefillOfferBlock>> = {}) => {
  const r = render(<PdpRefillOfferBlock view={VIEW} {...props} />);
  mounted.push(r);
  await flush(4);
  return r.container;
};

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.guest = { enabled: false, pending: false };
  mocks.get.mockReset().mockResolvedValue({ items: [] });
  mocks.post.mockReset().mockResolvedValue(CART);
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.addGuest.mockReset();
  mocks.track.mockReset();
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('PdpRefillOfferBlock (tubu-w13-01)', () => {
  it('một thẻ: số tiết kiệm, số chai thay, liên kết thật tới trang gói, nút "+ Thêm" 44px có tên đọc; báo đã hiện', async () => {
    const c = await mount();
    expect(c.querySelectorAll('[data-testid="pdp-refill"]')).toHaveLength(1);
    const open = c.querySelector<HTMLAnchorElement>('[data-testid="pdp-refill-open"]')!;
    expect(open.getAttribute('href')).toBe('/san-pham/refill-nuoc-rua-chen-10l');
    expect(open.textContent).toBe('Chọn túi Refill 10L tiết kiệm 470.000đ (~34%)Thay thế 20 chai nhựa · 890.000đ');
    const add = c.querySelector<HTMLButtonElement>('[data-testid="pdp-refill-add"]')!;
    expect(add.textContent).toBe('+ Thêm');
    expect(add.getAttribute('aria-label')).toContain('Túi Refill nước rửa chén 10L');
    expect(c.querySelectorAll('button')).toHaveLength(1);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(mocks.track).toHaveBeenCalledWith('refill_swap_shown', { surface: 'pdp' });
  });

  it('trackShown=false: thẻ không tự báo đã hiện (trang sản phẩm báo một lần khi dải chọn cách mua có Túi Refill)', async () => {
    await mount({ trackShown: false });
    expect(mocks.track).not.toHaveBeenCalledWith('refill_swap_shown', expect.anything());
  });

  it('đã đăng nhập: "+ Thêm" thêm đúng phân loại gói, số lượng 1, nguồn pdp, một lần dù chạm đúp; thành công thì báo đã đổi', async () => {
    let resolve!: (v: unknown) => void;
    mocks.post.mockImplementation(() => new Promise((r) => (resolve = r)));
    const c = await mount();
    const add = c.querySelector<HTMLButtonElement>('[data-testid="pdp-refill-add"]')!;
    click(add);
    click(add);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![0]).toBe('/cart/items');
    expect(mocks.post.mock.calls[0]![1]).toMatchObject({ variationId: 'v-refill', quantity: 1, addSource: 'pdp' });
    expect(mocks.track).not.toHaveBeenCalledWith('refill_swap_applied', expect.anything());
    resolve(CART);
    await flush(4);
    expect(byText(document.body, 'span', 'Đã thêm vào giỏ!')).not.toBeNull();
    expect(mocks.track).toHaveBeenCalledWith('refill_swap_applied', { surface: 'pdp' });
    expect(mocks.get.mock.calls.some((x) => String(x[0]).startsWith('/cart'))).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('máy chủ từ chối (gói vừa hết hàng, đổi giá): báo lỗi và làm mới trang để thẻ dựng lại từ cặp mới, không báo đã đổi', async () => {
    mocks.post.mockRejectedValue(Object.assign(new Error('Sản phẩm đã hết hàng'), { status: 409 }));
    const c = await mount();
    click(c.querySelector('[data-testid="pdp-refill-add"]')!);
    await flush(6);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.track).not.toHaveBeenCalledWith('refill_swap_applied', expect.anything());
  });

  it('khách chưa đăng nhập, giỏ khách tắt: nhớ món rồi sang đăng nhập, quay về trang gói Refill', async () => {
    mocks.phase = 'guest';
    const c = await mount();
    click(c.querySelector('[data-testid="pdp-refill-add"]')!);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Frefill-nuoc-rua-chen-10l');
  });

  it('khách chưa đăng nhập, giỏ khách bật: thêm vào giỏ khách tại chỗ, không chuyển trang', async () => {
    mocks.phase = 'guest';
    mocks.guest = { enabled: true, pending: false };
    const c = await mount();
    click(c.querySelector('[data-testid="pdp-refill-add"]')!);
    await flush(2);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(byText(document.body, 'span', 'Đã thêm vào giỏ!')).not.toBeNull();
    expect(mocks.addGuest).toHaveBeenCalledTimes(1);
    expect(mocks.addGuest.mock.calls[0]![0]).toMatchObject({ variationId: 'v-refill', slug: 'refill-nuoc-rua-chen-10l', quantity: 1 });
  });

  it('giỏ khách: chạm đúp chỉ thêm một gói', async () => {
    mocks.phase = 'guest';
    mocks.guest = { enabled: true, pending: false };
    const c = await mount();
    const add = c.querySelector('[data-testid="pdp-refill-add"]')!;
    click(add);
    click(add);
    await flush(2);
    expect(mocks.addGuest).toHaveBeenCalledTimes(1);
  });

  it('đang khôi phục phiên hay lệnh ghi giỏ khác đang chạy: bỏ qua cú chạm', async () => {
    mocks.phase = 'loading';
    let c = await mount();
    click(c.querySelector('[data-testid="pdp-refill-add"]')!);
    mocks.phase = 'authenticated';
    c = await mount({ blocked: true });
    const add = c.querySelector<HTMLButtonElement>('[data-testid="pdp-refill-add"]')!;
    expect(add.getAttribute('aria-disabled')).toBe('true');
    click(add);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
