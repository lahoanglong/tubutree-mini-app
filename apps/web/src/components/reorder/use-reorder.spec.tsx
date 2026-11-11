// @vitest-environment jsdom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@/test-utils/render-hook';

// Mua lại gửi cùng endpoint/body như Mini App: một sản phẩm → POST /cart/items {variationId, quantity, addSource:'repurchase'};
// cả đơn → POST /orders/{code}/repurchase {items, addSource:'repurchase'}.
const mocks = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn(), slug: null as string | null }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { post: mocks.post } }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => mocks.slug }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

import { ApiError } from '@/lib/client-api';
import { LOCK_REFRESH_WAIT_MS } from '@/lib/settle-within';
import { useReorder } from './use-reorder';
import type { ReorderLine, ReorderTarget } from './reorder-types';

const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199000, itemCount: 1 };
const line = (key: string, over: Partial<ReorderLine> = {}): ReorderLine => ({
  key, variationId: `v-${key}`, productName: `SP ${key}`, variationName: '', thumbnail: null, unitPrice: 1000, defaultQuantity: 1, maxQuantity: 9, available: true, notices: [], ...over,
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

  it('mua lại từ thông báo nhắc: một sản phẩm gửi addSource reorder_notification như Mini App, cả đơn vẫn repurchase', async () => {
    const { result } = renderHook(() => useReorder({ source: 'notification' }));
    await act(async () => {
      await result.current.submit(ITEM, [{ key: 'a', variationId: 'v-a', quantity: 1 }]);
    });
    expect(mocks.post).toHaveBeenCalledWith('/cart/items', { variationId: 'v-a', quantity: 1, addSource: 'reorder_notification' }, undefined);
    mocks.post.mockClear();
    await act(async () => {
      await result.current.submit(ORDER, [{ key: 'a', variationId: 'v-a', quantity: 1 }]);
    });
    expect(mocks.post).toHaveBeenCalledWith('/orders/TUBU1/repurchase', { items: [{ orderItemId: 'a', quantity: 1 }], addSource: 'repurchase' });
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

  describe('máy chủ từ chối (400/404/409/422) thì giữ khoá tới khi dữ liệu làm mới về', () => {
    const SEL = [{ key: 'a', variationId: 'v-a', quantity: 1 }];
    const deferred = () => {
      let resolve!: (v?: unknown) => void;
      const promise = new Promise((res) => {
        resolve = res;
      });
      return { promise, resolve };
    };
    const outcome = (p: Promise<unknown>) => p.then(() => 'ok', () => 'rejected');
    const CASES = [
      { name: 'một món (kệ Mua lại)', target: ITEM, keys: [['cart'], ['purchased-items'], ['orders']] },
      { name: 'cả đơn', target: ORDER, keys: [['cart'], ['purchased-items'], ['orders'], ['order', 'TUBU1']] },
    ] as const;

    describe.each(CASES)('$name', (c) => {
      const okBody = c.target.kind === 'item' ? CART : { cart: CART, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 1 }] };

      it.each([400, 404, 409, 422])('bị từ chối %i: tải lại đúng khoá, giữ isPending + inFlight tới khi làm mới xong', async (status) => {
        mocks.post.mockRejectedValueOnce(new ApiError('Trạng thái đã đổi', status)).mockResolvedValue(okBody);
        const refresh = deferred();
        const { result, client } = renderHook(() => useReorder());
        const invalidate = vi.spyOn(client, 'invalidateQueries').mockImplementation((() => refresh.promise) as never);

        let first!: Promise<unknown>;
        act(() => {
          first = result.current.submit(c.target, SEL);
        });
        const firstOutcome = outcome(first);
        await waitFor(() => expect(invalidate.mock.calls.map(([filter]) => filter)).toEqual(c.keys.map((queryKey) => ({ queryKey }))));
        await waitFor(() => expect(result.current.isPending).toBe(true));

        let second!: Promise<unknown>;
        act(() => {
          second = result.current.submit(c.target, SEL);
        });
        expect(second).toBe(first);
        expect(mocks.post).toHaveBeenCalledTimes(1);

        await act(async () => {
          refresh.resolve();
          await expect(firstOutcome).resolves.toBe('rejected');
        });
        await waitFor(() => expect(result.current.isPending).toBe(false));

        invalidate.mockRestore();
        await act(async () => {
          await result.current.submit(c.target, SEL);
        });
        expect(mocks.post).toHaveBeenCalledTimes(2);
      });

      it.each([
        ['mất mạng', new Error('Network Error')],
        ['hết phiên 401', new ApiError('Unauthorized', 401)],
        ['máy chủ lỗi 503', new ApiError('Service Unavailable', 503)],
      ])('%s: không tải lại, nhả khoá ngay', async (_label, err) => {
        mocks.post.mockRejectedValueOnce(err).mockResolvedValue(okBody);
        const { result, client } = renderHook(() => useReorder());
        const invalidate = vi.spyOn(client, 'invalidateQueries').mockImplementation((() => new Promise(() => undefined)) as never);

        await act(async () => {
          await expect(result.current.submit(c.target, SEL)).rejects.toBe(err);
        });
        expect(invalidate).not.toHaveBeenCalled();
        expect(result.current.isPending).toBe(false);

        invalidate.mockRestore();
        await act(async () => {
          await result.current.submit(c.target, SEL);
        });
        expect(mocks.post).toHaveBeenCalledTimes(2);
      });

      it('tải lại treo mãi: nhả khoá đúng sau LOCK_REFRESH_WAIT_MS', async () => {
        mocks.post.mockRejectedValueOnce(new ApiError('Vừa có thay đổi', 409)).mockResolvedValue(okBody);
        const { result, client } = renderHook(() => useReorder());
        vi.spyOn(client, 'invalidateQueries').mockImplementation((() => new Promise(() => undefined)) as never);
        vi.useFakeTimers();
        try {
          let first!: Promise<unknown>;
          act(() => {
            first = result.current.submit(c.target, SEL);
          });
          const firstOutcome = outcome(first);
          await act(async () => {
            await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
          });
          expect(result.current.isPending).toBe(true);
          await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
          });
          await expect(firstOutcome).resolves.toBe('rejected');
          expect(result.current.isPending).toBe(false);
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });
});
