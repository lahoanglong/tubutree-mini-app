// @vitest-environment jsdom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/test-utils/render-hook';

// Mua lại gửi cùng endpoint/body như Mini App: một sản phẩm → POST /cart/items {variationId, quantity, addSource:'repurchase'};
// cả đơn → POST /orders/{code}/repurchase {items, addSource:'repurchase'}.
const mocks = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn(), slug: null as string | null }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { post: mocks.post } }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => mocks.slug }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

import { useReorder } from './use-reorder';
import type { ReorderLine, ReorderTarget } from './reorder-types';

const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 1 };
const line = (key: string, over: Partial<ReorderLine> = {}): ReorderLine => ({
  key, variationId: `v-${key}`, productName: `SP ${key}`, variationName: '', thumbnail: null, unitPrice: 1000, defaultQuantity: 1, maxQuantity: 9, available: true, ...over,
});
const ITEM: ReorderTarget = { kind: 'item', line: line('a') };
const ORDER: ReorderTarget = { kind: 'order', orderCode: 'TUBU1', lines: [line('a'), line('b')] };

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue(CART);
  mocks.push.mockReset();
  mocks.slug = null;
});

describe('useReorder', () => {
  it('một sản phẩm: POST /cart/items kèm addSource repurchase, rồi sang giỏ khi navigateToCart', async () => {
    const { result, client } = renderHook(() => useReorder({ navigateToCart: true }));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    let summary;
    await act(async () => {
      summary = await result.current.submit(ITEM, [{ key: 'a', variationId: 'v-a', quantity: 3 }]);
    });
    expect(mocks.post).toHaveBeenCalledWith('/cart/items', { variationId: 'v-a', quantity: 3, addSource: 'repurchase' }, undefined);
    expect(summary).toMatchObject({ addedUnits: 3, hasProblems: false });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cart'] });
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('gửi kèm gian hàng CTV đang ghi công như giỏ thường', async () => {
    mocks.slug = 'ctv-an';
    const { result } = renderHook(() => useReorder());
    await act(async () => {
      await result.current.submit(ITEM, [{ key: 'a', variationId: 'v-a', quantity: 1 }]);
    });
    expect(mocks.post).toHaveBeenCalledWith('/cart/items', expect.any(Object), { query: { storefrontSlug: 'ctv-an' } });
  });

  it('cả đơn: POST /orders/{code}/repurchase với từng dòng đã chọn; dòng bị bỏ qua thì ở lại để đọc lý do, không sang giỏ', async () => {
    mocks.post.mockResolvedValue({
      ...CART,
      cart: CART,
      results: [
        { orderItemId: 'a', status: 'added', addedQuantity: 1 },
        { orderItemId: 'b', status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 },
      ],
    });
    const { result } = renderHook(() => useReorder({ navigateToCart: true }));
    let summary;
    await act(async () => {
      summary = await result.current.submit(ORDER, [
        { key: 'a', variationId: 'v-a', quantity: 1 },
        { key: 'b', variationId: 'v-b', quantity: 2 },
      ]);
    });
    expect(mocks.post).toHaveBeenCalledWith('/orders/TUBU1/repurchase', {
      items: [{ orderItemId: 'a', quantity: 1 }, { orderItemId: 'b', quantity: 2 }],
      addSource: 'repurchase',
    });
    expect(summary).toMatchObject({ addedUnits: 1, hasProblems: true });
    expect((summary as unknown as { message: string }).message).toContain('SP b (hết hàng)');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('không thêm được món nào → ở lại, không sang giỏ trống', async () => {
    mocks.post.mockResolvedValue({ ...CART, cart: CART, results: [{ orderItemId: 'a', status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 }] });
    const { result } = renderHook(() => useReorder({ navigateToCart: true }));
    await act(async () => {
      await result.current.submit(ORDER, [{ key: 'a', variationId: 'v-a', quantity: 1 }]);
    });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('chưa chọn dòng nào → không gọi API', async () => {
    const { result } = renderHook(() => useReorder());
    await act(async () => {
      await expect(result.current.submit(ITEM, [])).rejects.toThrow('Chưa chọn sản phẩm');
    });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('chống bấm đúp: lần gọi thứ hai khi đang bay trả về đúng yêu cầu đang bay, chỉ MỘT request', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.post.mockReturnValue(new Promise((r) => (release = r)));
    const { result } = renderHook(() => useReorder());
    let a: Promise<unknown>, b: Promise<unknown>;
    act(() => {
      a = result.current.submit(ITEM, [{ key: 'a', variationId: 'v-a', quantity: 1 }]);
      b = result.current.submit(ITEM, [{ key: 'a', variationId: 'v-a', quantity: 1 }]);
    });
    expect(a!).toBe(b!);
    await act(async () => {
      release(CART);
      await a!;
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('lỗi mạng → ném lại để sheet giữ lựa chọn', async () => {
    mocks.post.mockRejectedValue(new Error('Mất kết nối'));
    const { result } = renderHook(() => useReorder());
    await act(async () => {
      await expect(result.current.submit(ITEM, [{ key: 'a', variationId: 'v-a', quantity: 1 }])).rejects.toThrow('Mất kết nối');
    });
  });
});
