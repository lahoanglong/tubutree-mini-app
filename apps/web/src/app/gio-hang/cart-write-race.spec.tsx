// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, remount, render, type Rendered } from '@/test-utils/dom';
import { ApiError, NetworkError } from '@/lib/client-api';

// W100B pha 2: mọi lệnh GHI giỏ (đổi số lượng/xoá dòng, món bù freeship, Hoàn tác, mã giảm giá) đều trả NGUYÊN giỏ, nên phản hồi về lệch thứ tự
// ghi đè phần của lệnh mới. Spec dựng cả trang giỏ với shop-client giả: hàng đợi, cache, dải món bù và các nút là bản thật.

interface Deferred {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  promise: Promise<unknown>;
}
const defer = (): Deferred => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const state = vi.hoisted(() => ({
  cart: null as unknown,
  gate: null as null | Promise<unknown>,
  cartGets: 0,
  best: null as unknown,
  update: null as null | ((id: string, q: number) => Promise<unknown>),
  remove: null as null | ((id: string) => Promise<unknown>),
  add: null as null | ((variationId: string, q: number) => Promise<unknown>),
  apply: null as null | ((code: string) => Promise<unknown>),
  coupons: [] as unknown[],
  previews: [] as unknown[],
  updates: [] as { id: string; q: number }[],
  adds: [] as string[],
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/gio-hang' }));
vi.mock('@/lib/use-flash-sales', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/use-flash-sales')>()), useActiveFlashSales: () => [] }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      if (path === '/products') return state.best;
      throw new Error(`đường dẫn lạ ${path}`);
    },
  },
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  // Giỏ chụp lúc BẮT ĐẦU lần tải (như máy chủ trả giỏ của lúc nhận yêu cầu), không phải lúc lần tải về.
  getCart: async () => {
    state.cartGets += 1;
    const snapshot = state.cart;
    if (state.gate) await state.gate;
    return snapshot;
  },
  getMyCoupons: async () => state.coupons,
  getCouponPreviews: async () => state.previews,
  applyCoupon: (code: string) => state.apply!(code),
  getCartSelection: async () => {
    throw new Error('chưa mock');
  },
  updateCartItem: (id: string, q: number) => {
    state.updates.push({ id, q });
    return state.update!(id, q);
  },
  removeCartItem: (id: string) => state.remove!(id),
  addToCart: (variationId: string) => {
    state.adds.push(variationId);
    return state.add!(variationId, 1);
  },
}));

import CartPage from './page';

const lineX = (quantity: number, over: Record<string, unknown> = {}) => ({
  id: 'i1', variationId: 'v-x', productName: 'Serum dưỡng ẩm', variationName: '30ml', slug: 'serum', thumbnail: null,
  unitPrice: 50000, quantity, stock: 20, total: 50000 * quantity, ...over,
});
const lineB = (quantity: number) => lineX(quantity, { id: 'i2', variationId: 'v-soap', productName: 'Xà bông cỏ', slug: 'xa-bong' });
const lineY = () => ({
  id: 'i9', variationId: 'v-a', productName: 'Món a', variationName: '', slug: 'a', thumbnail: null, unitPrice: 50000, quantity: 1, stock: 9, total: 50000,
});
const cartOf = (items: unknown[]) => {
  const subtotal = (items as { total: number }[]).reduce((s, it) => s + it.total, 0);
  return { items, couponCode: null, subtotal, discount: 0, freeship: subtotal >= 500000, freeshipThreshold: 500000, itemCount: items.length };
};
const card = (slug: string, price: number) => ({
  id: slug, slug, brand: 'Tubu', name: `Món ${slug}`, thumbnail: null, basePrice: price, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${slug}`,
});
const BEST = { data: [card('a', 50000), card('b', 120000), card('c', 230000), card('d', 300000)], meta: { page: 1, limit: 10, total: 4 } };

let client: QueryClient;
let mounted: Rendered[] = [];
let deferred: Deferred[] = [];
const hold = () => {
  const d = defer();
  deferred.push(d);
  return d.promise;
};
const mount = async () => {
  const r = render(<CartPage />, client);
  mounted.push(r);
  await flush(8);
  return r;
};
const qa = (c: ParentNode, id: string) => Array.from(c.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
const plusOf = (c: ParentNode, name = 'Serum dưỡng ẩm') => c.querySelector<HTMLButtonElement>(`button[aria-label="Tăng số lượng ${name}"]`)!;
const addOf = (c: ParentNode, slug: string) => qa(c, 'freeship-addon').find((e) => e.dataset.slug === slug)!.querySelector<HTMLElement>('[data-testid="freeship-add"]')!;
const qtys = (c: ParentNode) => qa(c, 'cart-line').map((l) => l.querySelector('[aria-live="polite"]')!.textContent);
const cached = () => client.getQueryData<{ items: { id: string; quantity: number }[] }>(['cart', null]);
const cachedQtys = () => Object.fromEntries((cached()?.items ?? []).map((i) => [i.id, i.quantity]));
const settle = async () => flush(10);

beforeEach(() => {
  sessionStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  deferred = [];
  state.cartGets = 0;
  state.gate = null;
  state.updates = [];
  state.adds = [];
  state.best = BEST;
  state.cart = cartOf([lineX(4)]);
  state.update = async () => state.cart;
  state.remove = async () => state.cart;
  state.add = async () => state.cart;
  state.apply = null;
  state.coupons = [];
  state.previews = [];
});
afterEach(() => {
  vi.useRealTimers();
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

const X4 = () => lineX(4);
const X5 = () => lineX(5);

describe('/gio-hang — lệnh dòng và lệnh món bù chồng nhau, phản hồi về lệch thứ tự (W100B pha 2)', () => {
  describe('lệnh dòng bấm trước, món bù bấm sau (máy chủ xử lý dòng rồi món bù)', () => {
    const start = async () => {
      const r = await mount();
      click(plusOf(r.container));
      await flush(2);
      click(addOf(r.container, 'a'));
      await flush(2);
      expect(deferred).toHaveLength(2);
      state.cart = cartOf([X5(), lineY()]);
      return r;
    };
    // deferred[0] = lệnh dòng (giỏ sau nó chưa có món bù), deferred[1] = món bù (đã có cả hai thay đổi).
    const lineResponse = () => cartOf([X5()]);
    const addResponse = () => cartOf([X5(), lineY()]);

    it('phản hồi món bù về trước, phản hồi dòng (chưa có món bù) về sau: giỏ cuối có số lượng mới VÀ món bù', async () => {
      state.update = hold;
      state.add = hold;
      const { container } = await start();
      await act(async () => deferred[1]!.resolve(addResponse()));
      await act(async () => deferred[0]!.resolve(lineResponse()));
      await settle();
      expect(qtys(container)).toEqual(['5', '1']);
      expect(cachedQtys()).toEqual({ i1: 5, i9: 1 });
    });

    it('phản hồi dòng về trước, món bù về sau: giỏ cuối đúng', async () => {
      state.update = hold;
      state.add = hold;
      const { container } = await start();
      await act(async () => deferred[0]!.resolve(lineResponse()));
      await act(async () => deferred[1]!.resolve(addResponse()));
      await settle();
      expect(qtys(container)).toEqual(['5', '1']);
      expect(cachedQtys()).toEqual({ i1: 5, i9: 1 });
    });
  });

  describe('món bù bấm trước, lệnh dòng bấm sau (máy chủ xử lý món bù rồi dòng)', () => {
    const start = async () => {
      const r = await mount();
      click(addOf(r.container, 'a'));
      await flush(2);
      click(plusOf(r.container));
      await flush(2);
      expect(deferred).toHaveLength(2);
      state.cart = cartOf([X5(), lineY()]);
      return r;
    };
    // deferred[0] = món bù (giỏ sau nó còn số lượng cũ), deferred[1] = lệnh dòng (đã có cả hai thay đổi).
    const addResponse = () => cartOf([X4(), lineY()]);
    const lineResponse = () => cartOf([X5(), lineY()]);

    it('phản hồi dòng về trước, phản hồi món bù (số lượng cũ) về muộn: số lượng mới không bị kéo lùi', async () => {
      state.update = hold;
      state.add = hold;
      const { container } = await start();
      await act(async () => deferred[1]!.resolve(lineResponse()));
      await act(async () => deferred[0]!.resolve(addResponse()));
      await settle();
      expect(qtys(container)).toEqual(['5', '1']);
      expect(cachedQtys()).toEqual({ i1: 5, i9: 1 });
    });

    it('phản hồi món bù về trước, dòng về sau: giỏ cuối đúng', async () => {
      state.update = hold;
      state.add = hold;
      const { container } = await start();
      await act(async () => deferred[0]!.resolve(addResponse()));
      await act(async () => deferred[1]!.resolve(lineResponse()));
      await settle();
      expect(qtys(container)).toEqual(['5', '1']);
      expect(cachedQtys()).toEqual({ i1: 5, i9: 1 });
    });
  });

  it('hai lệnh dòng khác dòng chồng nhau, phản hồi lệch thứ tự: cả hai số lượng mới còn nguyên', async () => {
    state.cart = cartOf([X4(), lineB(2)]);
    state.update = hold;
    const { container } = await mount();
    click(plusOf(container));
    await flush(2);
    click(plusOf(container, 'Xà bông cỏ'));
    await flush(2);
    state.cart = cartOf([X5(), lineB(3)]);
    await act(async () => deferred[1]!.resolve(cartOf([X5(), lineB(3)])));
    await act(async () => deferred[0]!.resolve(cartOf([X5(), lineB(2)])));
    await settle();
    expect(qtys(container)).toEqual(['5', '3']);
  });

  it('ba lệnh chồng nhau (món bù rồi hai dòng) về ngược thứ tự bấm: giỏ cuối đủ cả ba thay đổi', async () => {
    state.cart = cartOf([X4(), lineB(1)]);
    state.update = hold;
    state.add = hold;
    const { container } = await mount();
    click(addOf(container, 'a'));
    await flush(2);
    click(plusOf(container));
    await flush(2);
    click(plusOf(container, 'Xà bông cỏ'));
    await flush(2);
    expect(deferred).toHaveLength(3);
    const final = cartOf([X5(), lineB(2), lineY()]);
    state.cart = final;
    // Máy chủ xử lý theo thứ tự bấm; phản hồi về ngược lại, phản hồi món bù (cũ nhất) về cuối cùng.
    await act(async () => deferred[2]!.resolve(final));
    await act(async () => deferred[1]!.resolve(cartOf([X5(), lineB(1), lineY()])));
    await act(async () => deferred[0]!.resolve(cartOf([X4(), lineB(1), lineY()])));
    await settle();
    expect(qtys(container)).toEqual(['5', '2', '1']);
  });

  it('lệnh đi một mình (không chồng với ai): ghi thẳng phản hồi, không tải lại giỏ', async () => {
    const { container } = await mount();
    const gets = state.cartGets;
    state.update = async () => cartOf([X5()]);
    click(plusOf(container));
    await settle();
    expect(state.cartGets).toBe(gets);
    expect(qtys(container)).toEqual(['5']);
  });

  describe('giỏ đang tải lại thì lệnh mới không được tin phản hồi giỏ cũ về sau', () => {
    it('món bù bị từ chối làm giỏ tải lại (đang treo); lệnh dòng bấm lúc đó: giỏ tải lần đầu về muộn không đè số lượng mới', async () => {
      state.add = async () => {
        throw new ApiError('Món a vừa hết hàng.', 409);
      };
      state.update = hold;
      const { container } = await mount();
      // Lần tải đầu tiên (do bị từ chối) trả giỏ CŨ và bị giữ.
      const oldGet = defer();
      state.gate = oldGet.promise;
      click(addOf(container, 'a'));
      await flush(4);
      const gets = state.cartGets;
      expect(gets).toBeGreaterThan(0);
      // Lệnh dòng bấm trong lúc lần tải còn treo; sau đó lần tải kế tiếp (nếu có) trả giỏ mới.
      click(plusOf(container));
      await flush(2);
      state.cart = cartOf([X5()]);
      state.gate = null;
      await act(async () => deferred[0]!.resolve(cartOf([X5()])));
      await act(async () => oldGet.resolve(undefined));
      await settle();
      expect(qtys(container)).toEqual(['5']);
      expect(cachedQtys()).toEqual({ i1: 5 });
    });

    it('lần tải do cơ chế này khởi động không chạy khi còn lệnh đang bay: chờ lệnh xong rồi tải một lần', async () => {
      state.update = hold;
      state.add = async () => {
        throw new ApiError('Món a vừa hết hàng.', 409);
      };
      const { container } = await mount();
      click(plusOf(container));
      await flush(2);
      const gets = state.cartGets;
      click(addOf(container, 'a'));
      await settle();
      expect(state.cartGets).toBe(gets);
      state.cart = cartOf([X5()]);
      await act(async () => deferred[0]!.resolve(cartOf([X5()])));
      await settle();
      expect(state.cartGets).toBe(gets + 1);
      expect(qtys(container)).toEqual(['5']);
    });

    it('lệnh dòng treo quá 4 giây: lần tải vẫn chạy (không chờ mãi)', async () => {
      state.update = hold;
      state.add = async () => {
        throw new ApiError('Món a vừa hết hàng.', 409);
      };
      const { container } = await mount();
      click(plusOf(container));
      await flush(2);
      const gets = state.cartGets;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      click(addOf(container, 'a'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_900);
      });
      expect(state.cartGets).toBe(gets);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(state.cartGets).toBe(gets + 1);
    });
  });

  describe('lỗi và mất mạng trả lại sổ đếm: giỏ không kẹt ở "đang bay"', () => {
    // Sau khi mọi lệnh xong, một lệnh đi MỘT MÌNH phải ghi thẳng phản hồi (giỏ tải về vẫn là bản cũ): không tải lại, số lượng lấy từ phản hồi.
    const aloneWritesDirectly = async (container: HTMLElement, expected: string[]) => {
      const gets = state.cartGets;
      const lineNow = cachedQtys().i1 ?? 4;
      state.update = async () => cartOf([lineX(lineNow + 1), ...(expected.length > 1 ? [lineY()] : [])]);
      click(plusOf(container));
      await settle();
      expect(state.cartGets).toBe(gets);
      expect(qtys(container)[0]).toBe(String(lineNow + 1));
    };

    it('lệnh dòng bị 500 trong lúc món bù đang bay, món bù xong: lệnh dòng kế tiếp đi một mình và ghi thẳng', async () => {
      state.update = hold;
      state.add = hold;
      const { container } = await mount();
      click(plusOf(container));
      await flush(2);
      click(addOf(container, 'a'));
      await flush(2);
      await act(async () => deferred[0]!.reject(new ApiError('Máy chủ lỗi', 500)));
      await act(async () => deferred[1]!.resolve(cartOf([X4(), lineY()])));
      state.cart = cartOf([X4(), lineY()]);
      await settle();
      await aloneWritesDirectly(container, ['4', '1']);
    });

    it('món bù mất mạng trong lúc lệnh dòng đang bay: lệnh dòng xong thì lệnh sau đi một mình và ghi thẳng', async () => {
      state.update = hold;
      state.add = async () => {
        throw new NetworkError(false);
      };
      const { container } = await mount();
      click(plusOf(container));
      await flush(2);
      click(addOf(container, 'a'));
      await settle();
      await act(async () => deferred[0]!.resolve(cartOf([X5()])));
      state.cart = cartOf([X5()]);
      await settle();
      await aloneWritesDirectly(container, ['5']);
    });

    it('lệnh dòng một mình bị 5xx: lệnh sau đi một mình và ghi thẳng', async () => {
      state.update = async () => {
        throw new ApiError('Máy chủ lỗi', 500);
      };
      const { container } = await mount();
      click(plusOf(container));
      await settle();
      await aloneWritesDirectly(container, ['4']);
    });

    it('món bù bị từ chối (409) khi không có lệnh nào khác: tải giỏ xong thì lệnh dòng kế tiếp đi một mình và ghi thẳng', async () => {
      state.add = async () => {
        throw new ApiError('Món a vừa hết hàng.', 409);
      };
      const { container } = await mount();
      click(addOf(container, 'a'));
      await settle();
      await aloneWritesDirectly(container, ['4']);
    });
  });

  describe('rời trang rồi quay lại khi lệnh cũ còn bay', () => {
    it('lệnh dòng ở lần dựng cũ còn bay; món bù ở lần dựng mới chồng lên: phản hồi đảo thứ tự vẫn ra giỏ đúng', async () => {
      state.update = hold;
      state.add = hold;
      const r = await mount();
      click(plusOf(r.container));
      await flush(2);
      remount(r, <CartPage />, client);
      await flush(8);
      click(addOf(r.container, 'a'));
      await flush(2);
      expect(deferred).toHaveLength(2);
      state.cart = cartOf([X5(), lineY()]);
      await act(async () => deferred[1]!.resolve(cartOf([X5(), lineY()])));
      await act(async () => deferred[0]!.resolve(cartOf([X5()])));
      await settle();
      expect(qtys(r.container)).toEqual(['5', '1']);
      expect(cachedQtys()).toEqual({ i1: 5, i9: 1 });
    });
  });

  describe('hết giờ Giờ vàng: tải lại giỏ qua cùng đường', () => {
    const flashLine = (msFromNow: number) => lineX(4, { isFlash: true, flashEndAt: new Date(Date.now() + msFromNow).toISOString() });

    it('dòng Giờ vàng đã quá giờ lúc mở giỏ: giỏ tải lại một lần để máy chủ tính lại giá', async () => {
      state.cart = cartOf([flashLine(-60_000)]);
      await mount();
      expect(state.cartGets).toBe(2);
    });

    it('hết giờ khi lệnh dòng còn bay: chưa tải giỏ; lệnh xong mới tải', async () => {
      state.cart = cartOf([flashLine(1_200)]);
      state.update = hold;
      const { container } = await mount();
      expect(state.cartGets).toBe(1);
      click(plusOf(container));
      await flush(2);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1_600));
      });
      expect(state.cartGets).toBe(1);
      await act(async () => deferred[0]!.resolve(cartOf([lineX(5)])));
      await settle();
      expect(state.cartGets).toBe(2);
    });
  });

  describe('Hoàn tác (thêm lại dòng đã xoá) cùng đường ghi giỏ', () => {
    const removeBThenUndoButton = async (container: HTMLElement) => {
      click(container.querySelector('button[aria-label="Xoá Xà bông cỏ khỏi giỏ hàng"]'));
      await settle();
      return [...container.querySelectorAll('button')].find((b) => b.textContent === 'Hoàn tác')!;
    };

    it('Hoàn tác đi một mình: ghi thẳng phản hồi (giỏ tải về vẫn thiếu dòng), không tải lại', async () => {
      state.cart = cartOf([X4(), lineB(2)]);
      state.remove = async () => cartOf([X4()]);
      const { container } = await mount();
      const undo = await removeBThenUndoButton(container);
      state.cart = cartOf([X4()]);
      const gets = state.cartGets;
      state.add = async () => cartOf([X4(), lineB(2)]);
      click(undo);
      await settle();
      expect(qtys(container)).toEqual(['4', '2']);
      expect(state.cartGets).toBe(gets);
    });

    it('Hoàn tác lỗi trả lại chỗ trong sổ: lệnh dòng kế tiếp đi một mình và ghi thẳng', async () => {
      state.cart = cartOf([X4(), lineB(2)]);
      state.remove = async () => cartOf([X4()]);
      const { container } = await mount();
      const undo = await removeBThenUndoButton(container);
      state.cart = cartOf([X4()]);
      state.add = async () => {
        throw new NetworkError(false);
      };
      click(undo);
      await settle();
      const gets = state.cartGets;
      state.update = async () => cartOf([X5()]);
      click(plusOf(container));
      await settle();
      expect(qtys(container)).toEqual(['5']);
      expect(state.cartGets).toBe(gets);
    });

    it('Hoàn tác chồng với lệnh đổi số lượng dòng khác, phản hồi đảo thứ tự: giỏ cuối đủ cả hai', async () => {
      state.cart = cartOf([X4(), lineB(2)]);
      state.remove = async () => cartOf([X4()]);
      const { container } = await mount();
      click(container.querySelector('button[aria-label="Xoá Xà bông cỏ khỏi giỏ hàng"]'));
      await settle();
      state.update = hold;
      state.add = hold;
      const undo = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Hoàn tác');
      expect(undo).toBeTruthy();
      click(plusOf(container));
      await flush(2);
      click(undo!);
      await flush(2);
      expect(deferred).toHaveLength(2);
      const final = cartOf([X5(), lineB(2)]);
      state.cart = final;
      await act(async () => deferred[1]!.resolve(final));
      await act(async () => deferred[0]!.resolve(cartOf([X5()])));
      await settle();
      expect(qtys(container)).toEqual(['5', '2']);
    });
  });

  describe('"Áp dụng ngay" (dải gợi ý mã) cùng đường ghi giỏ', () => {
    const GIAM45 = { code: 'GIAM45', type: 'AMOUNT', value: 45000, minOrder: null, maxDiscount: null, endAt: '2030-01-01T00:00:00Z' };
    const withCoupon = (items: unknown[]) => ({ ...cartOf(items), couponCode: 'GIAM45', discount: 45000 });
    const cta = (c: ParentNode) => c.querySelector<HTMLElement>('[data-testid="cart-voucher-apply-cta"]');
    const cachedCoupon = () => client.getQueryData<{ couponCode: string | null }>(['cart', null])?.couponCode;
    const start = async () => {
      state.coupons = [GIAM45];
      state.previews = [{ code: 'GIAM45', eligible: true, discount: 45000 }];
      const r = await mount();
      // Xem trước mã chạy sau nhịp debounce của màn.
      await act(async () => {
        await new Promise((res) => setTimeout(res, 500));
      });
      await flush(6);
      expect(cta(r.container)).toBeTruthy();
      return r;
    };

    it('dòng bấm trước, mã bấm sau, phản hồi mã về trước và phản hồi dòng (chưa có mã) về sau: giỏ cuối có số lượng mới VÀ mã', async () => {
      state.update = hold;
      state.apply = hold;
      const { container } = await start();
      click(plusOf(container));
      await flush(2);
      click(cta(container));
      await flush(2);
      expect(deferred).toHaveLength(2);
      state.cart = withCoupon([X5()]);
      await act(async () => deferred[1]!.resolve(withCoupon([X5()])));
      // Phản hồi mã bị bỏ vì chồng với lệnh dòng còn bay: nút vẫn bận tới khi giỏ mới về, không cho chạm lại trên giỏ cũ.
      await flush(2);
      expect(cta(container)!.getAttribute('aria-busy')).toBe('true');
      await act(async () => deferred[0]!.resolve(cartOf([X5()])));
      await settle();
      expect(qtys(container)).toEqual(['5']);
      expect(cachedCoupon()).toBe('GIAM45');
    });

    it('mã bấm trước, dòng bấm sau, phản hồi dòng về trước và phản hồi mã (số lượng cũ) về muộn: số lượng mới không bị kéo lùi', async () => {
      state.update = hold;
      state.apply = hold;
      const { container } = await start();
      click(cta(container));
      await flush(2);
      click(plusOf(container));
      await flush(2);
      expect(deferred).toHaveLength(2);
      state.cart = withCoupon([X5()]);
      await act(async () => deferred[1]!.resolve(withCoupon([X5()])));
      await act(async () => deferred[0]!.resolve(withCoupon([X4()])));
      await settle();
      expect(qtys(container)).toEqual(['5']);
      expect(cachedCoupon()).toBe('GIAM45');
    });

    it('mã bị từ chối trong lúc lệnh dòng đang bay: trả lại chỗ trong sổ, lệnh dòng xong thì lệnh sau đi một mình và ghi thẳng', async () => {
      state.update = hold;
      state.apply = hold;
      const { container } = await start();
      click(plusOf(container));
      await flush(2);
      click(cta(container));
      await flush(2);
      await act(async () => deferred[1]!.reject(new ApiError('Mã đã hết lượt dùng.', 400)));
      await act(async () => deferred[0]!.resolve(cartOf([X5()])));
      state.cart = cartOf([X5()]);
      await settle();
      const gets = state.cartGets;
      state.update = async () => cartOf([lineX(6)]);
      click(plusOf(container));
      await settle();
      expect(state.cartGets).toBe(gets);
      expect(qtys(container)).toEqual(['6']);
    });
  });
});
