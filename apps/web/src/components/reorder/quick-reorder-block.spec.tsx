// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickReorderItem } from '@tubutree/app-core/commerce/quick-reorder';
import { ApiError } from '@/lib/client-api';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ post: vi.fn(), addAll: vi.fn(), push: vi.fn(), phase: 'authenticated' as string }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [], useRunningFlash: () => ({ flash: [], now: Date.now() }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: vi.fn(), post: mocks.post } }));
vi.mock('@/lib/shop-combo', () => ({ addAllToCart: mocks.addAll }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, useCartKey: () => ['cart', null], cartKey: () => ['cart', null] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/shop-client')>()), getCart: async () => ({ items: [] }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/' }));

import { QuickReorderBlock } from './quick-reorder-block';

const item = (n: number): QuickReorderItem => ({
  key: `v${n}`, productId: `p${n}`, slug: `sp-${n}`, variationId: `v${n}`, name: `Món ${n}`, thumbnail: null,
  price: 50_000, compareAt: null, savePct: 0, isFlash: false, timesBought: 1, source: 'purchased',
});
const ITEMS = [item(1), item(2), item(3)];
const CART = { items: [], itemCount: 3, subtotal: 150_000, discount: 0, freeship: false, freeshipThreshold: 199_000, couponCode: null };

let mounted: Rendered | null = null;
const mount = async (items = ITEMS) => {
  mounted = render(<QuickReorderBlock items={items} />);
  await flush(4);
  return mounted.container;
};
const adds = (c: ParentNode) => Array.from(c.querySelectorAll<HTMLButtonElement>('[data-testid="quick-reorder-add"]'));
const addAll = (c: ParentNode) => c.querySelector<HTMLButtonElement>('.tubu-quick-head button')!;
const announced = (c: ParentNode) => c.querySelector('[role="status"]')?.textContent ?? '';

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.post.mockReset().mockResolvedValue(CART);
  mocks.addAll.mockReset().mockResolvedValue(CART);
  mocks.push.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('QuickReorderBlock (web)', () => {
  it('"+ Thêm": một chạm thêm đúng phân loại, số lượng 1, nguồn repurchase; báo "Đã thêm vào giỏ!" ở thông báo nổi', async () => {
    const c = await mount();
    click(adds(c)[1]!);
    await flush(6);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/cart/items', { variationId: 'v2', quantity: 1, addSource: 'repurchase' }, undefined);
    expect(announced(c)).toContain('Đã thêm vào giỏ!');
  });

  it('"+ Thêm" lỗi (hết hàng): thông báo lỗi dạng alert, nút mở khoá để bấm lại', async () => {
    mocks.post.mockRejectedValue(new ApiError('Sản phẩm Món 1 đã hết hàng', 400));
    const c = await mount();
    click(adds(c)[0]!);
    await flush(6);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('hết hàng');
    expect(adds(c)[0]!.disabled).toBe(false);
  });

  it('bấm "+ Thêm" lần hai lúc lần một chưa xong: chỉ một lệnh bay', async () => {
    let release!: (v: unknown) => void;
    mocks.post.mockImplementation(() => new Promise((r) => (release = r)));
    const c = await mount();
    click(adds(c)[0]!);
    click(adds(c)[1]!);
    await flush(2);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    release(CART);
    await flush(4);
  });

  describe('khoá đồng bộ chéo giữa "+ Thêm" và "Thêm lại tất cả" (hai cú bấm trong cùng một act)', () => {
    const inOneAct = (...els: HTMLElement[]) =>
      act(() => {
        for (const el of els) el.click();
      });

    it('"+ Thêm" rồi "Thêm lại tất cả": chỉ lệnh đầu đi', async () => {
      mocks.post.mockImplementation(() => new Promise(() => undefined));
      const c = await mount();
      inOneAct(adds(c)[0]!, addAll(c));
      await flush(3);
      expect(mocks.post).toHaveBeenCalledTimes(1);
      expect(mocks.addAll).not.toHaveBeenCalled();
    });

    it('"Thêm lại tất cả" rồi "+ Thêm": chỉ lệnh lô đi', async () => {
      mocks.addAll.mockImplementation(() => new Promise(() => undefined));
      const c = await mount();
      inOneAct(addAll(c), adds(c)[0]!);
      await flush(3);
      expect(mocks.addAll).toHaveBeenCalledTimes(1);
      expect(mocks.post).not.toHaveBeenCalled();
    });

    it('hai "+ Thêm" của hai món khác nhau: chỉ một lệnh bay', async () => {
      mocks.post.mockImplementation(() => new Promise(() => undefined));
      const c = await mount();
      inOneAct(adds(c)[0]!, adds(c)[1]!);
      await flush(3);
      expect(mocks.post).toHaveBeenCalledTimes(1);
    });

    it('"+ Thêm" xong (thành công) thì nhả khoá: "Thêm lại tất cả" đi được', async () => {
      const c = await mount();
      click(adds(c)[0]!);
      await flush(6);
      click(addAll(c));
      await flush(6);
      expect(mocks.addAll).toHaveBeenCalledTimes(1);
    });

    it('"+ Thêm" lỗi thì cũng nhả khoá: "Thêm lại tất cả" đi được', async () => {
      mocks.post.mockRejectedValue(new ApiError('Sản phẩm Món 1 đã hết hàng', 400));
      const c = await mount();
      click(adds(c)[0]!);
      await flush(6);
      click(addAll(c));
      await flush(6);
      expect(mocks.addAll).toHaveBeenCalledTimes(1);
    });

    it('"Thêm lại tất cả" xong thì nhả khoá: "+ Thêm" đi được', async () => {
      const c = await mount();
      click(addAll(c));
      await flush(6);
      click(adds(c)[0]!);
      await flush(6);
      expect(mocks.post).toHaveBeenCalledTimes(1);
    });

    it('khách chưa đăng nhập bấm "Thêm lại tất cả" (sang đăng nhập, không có lệnh bay): "+ Thêm" không bị khoá', async () => {
      mocks.phase = 'guest';
      const c = await mount();
      click(addAll(c));
      await flush(2);
      click(adds(c)[0]!);
      await flush(4);
      expect(mocks.post).toHaveBeenCalledTimes(1);
    });
  });

  it('"Thêm lại tất cả": một lệnh lô với mỗi món một đơn vị theo thứ tự thẻ; báo "Đã thêm 3 món vào giỏ"', async () => {
    const c = await mount();
    click(addAll(c));
    await flush(6);
    expect(mocks.addAll).toHaveBeenCalledTimes(1);
    expect(mocks.addAll).toHaveBeenCalledWith([
      { variationId: 'v1', quantity: 1 },
      { variationId: 'v2', quantity: 1 },
      { variationId: 'v3', quantity: 1 },
    ]);
    expect(announced(c)).toContain('Đã thêm 3 món vào giỏ');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('"Thêm lại tất cả" bị máy chủ từ chối (một món hết hàng): giỏ không đổi, thông báo lỗi nói rõ, không món nào được báo đã thêm', async () => {
    mocks.addAll.mockRejectedValue(new ApiError('Sản phẩm Món 2 đã hết hàng', 400));
    const c = await mount();
    click(addAll(c));
    await flush(6);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Món 2 đã hết hàng');
    expect(announced(c)).not.toContain('Đã thêm 3 món');
  });

  it('"Thêm lại tất cả" lỗi mạng: câu cố định, không nói "đã thêm"', async () => {
    mocks.addAll.mockRejectedValue(new ApiError('Network', 503));
    const c = await mount();
    click(addAll(c));
    await flush(6);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Chưa thêm được vào giỏ. Bạn thử lại nhé.');
  });

  it('khách chưa đăng nhập bấm "Thêm lại tất cả": sang đăng nhập kèm đường quay lại, chưa gọi API', async () => {
    mocks.phase = 'guest';
    const c = await mount();
    click(addAll(c));
    await flush(2);
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2F');
    expect(mocks.addAll).not.toHaveBeenCalled();
  });

  it('đang thêm lại tất cả: nút "+ Thêm" khoá, bấm không gọi thêm lệnh', async () => {
    let release!: (v: unknown) => void;
    mocks.addAll.mockImplementation(() => new Promise((r) => (release = r)));
    const c = await mount();
    click(addAll(c));
    await flush(2);
    expect(c.querySelector('[data-testid="quick-reorder"]')?.getAttribute('aria-busy')).toBe('true');
    for (const b of adds(c)) expect(b.disabled).toBe(true);
    click(adds(c)[0]!);
    expect(mocks.post).not.toHaveBeenCalled();
    release(CART);
    await flush(4);
  });

  it('chạm thân thẻ mở trang sản phẩm ở đúng phân loại đã mua', async () => {
    const c = await mount();
    click(c.querySelectorAll('.tubu-quick-open')[2]!);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push.mock.calls[0]![0]).toContain('/san-pham/sp-3');
    expect(mocks.push.mock.calls[0]![0]).toContain('v3');
  });
});
