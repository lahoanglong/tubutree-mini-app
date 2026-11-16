// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUEST_MERGE_CLAIM_KEY, GUEST_MERGE_CLAIM_TTL_MS, mergeGuestCart, resetGuestMergeForTest, type GuestMergeDeps } from './merge';
import { addGuestLine, readGuestCart } from './store';

type Line = { variationId: string; quantity: number };

/** Giỏ máy chủ giả: addToCart cộng dồn như API thật và trả giỏ mới. */
function server(initial: Line[], stock: Record<string, Record<string, number>>) {
  let items = initial.map((l) => ({ ...l }));
  const deps = {
    getCart: vi.fn(async () => ({ items })),
    addToCart: vi.fn(async (variationId: string, quantity: number) => {
      const prev = items.find((l) => l.variationId === variationId);
      items = prev
        ? items.map((l) => (l === prev ? { ...l, quantity: l.quantity + quantity } : l))
        : [...items, { variationId, quantity }];
      return { items };
    }),
    getStock: vi.fn(async (slug: string) => {
      const s = stock[slug];
      if (!s) throw new Error(`no stock for ${slug}`);
      return s;
    }),
  } satisfies GuestMergeDeps;
  return { deps, items: () => items };
}

const NOW = 1_800_000_000_000;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetGuestMergeForTest();
});

describe('mergeGuestCart: gộp từng dòng vào giỏ máy chủ', () => {
  it('3 dòng: 1 hết hàng, 1 trùng phân loại đã có trong giỏ máy chủ (2 + 3 trên tồn 4 → gửi 2), 1 bình thường', async () => {
    addGuestLine({ variationId: 'va', slug: 'sp-a', quantity: 2 });
    addGuestLine({ variationId: 'vb', slug: 'sp-b', quantity: 3 });
    addGuestLine({ variationId: 'vc', slug: 'sp-c', quantity: 1 });
    const { deps, items } = server([{ variationId: 'vb', quantity: 2 }], {
      'sp-a': { va: 0 },
      'sp-b': { vb: 4 },
      'sp-c': { vc: 10 },
    });

    const result = await mergeGuestCart(deps, NOW);

    expect(deps.addToCart.mock.calls).toEqual([
      ['vb', 2],
      ['vc', 1],
    ]);
    expect(result).toEqual({ lines: 3, merged: 2, reduced: 1, failedLines: 1 });
    expect(items()).toEqual([
      { variationId: 'vb', quantity: 4 },
      { variationId: 'vc', quantity: 1 },
    ]);
    expect(readGuestCart()).toEqual([]);
    expect(sessionStorage.getItem(GUEST_MERGE_CLAIM_KEY)).toBe(String(NOW));
  });

  it('giỏ máy chủ đã đủ số còn hàng: không gửi gì, dòng tính là đã gộp (không phải lỗi)', async () => {
    addGuestLine({ variationId: 'vb', slug: 'sp-b', quantity: 2 });
    const { deps } = server([{ variationId: 'vb', quantity: 4 }], { 'sp-b': { vb: 4 } });
    expect(await mergeGuestCart(deps, NOW)).toEqual({ lines: 1, merged: 1, reduced: 0, failedLines: 0 });
    expect(deps.addToCart).not.toHaveBeenCalled();
    expect(readGuestCart()).toEqual([]);
  });

  it('một dòng bị máy chủ từ chối không chặn các dòng sau; mọi dòng vẫn rời giỏ khách', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    addGuestLine({ variationId: 'v2', slug: 'sp-2', quantity: 2 });
    const { deps } = server([], { 'sp-1': { v1: 5 }, 'sp-2': { v2: 5 } });
    deps.addToCart.mockRejectedValueOnce(new Error('409 Hết hàng'));

    const result = await mergeGuestCart(deps, NOW);

    expect(deps.addToCart.mock.calls).toEqual([
      ['v1', 1],
      ['v2', 2],
    ]);
    expect(result).toEqual({ lines: 2, merged: 1, reduced: 0, failedLines: 1 });
    expect(readGuestCart()).toEqual([]);
  });

  it('tồn kho của sản phẩm không có phân loại đó (phân loại đã ngừng bán): lỗi dòng, không gọi addToCart', async () => {
    addGuestLine({ variationId: 'v-cu', slug: 'sp-1', quantity: 1 });
    const { deps } = server([], { 'sp-1': { 'v-moi': 5 } });
    expect(await mergeGuestCart(deps, NOW)).toEqual({ lines: 1, merged: 0, reduced: 0, failedLines: 1 });
    expect(deps.addToCart).not.toHaveBeenCalled();
    expect(readGuestCart()).toEqual([]);
  });

  it('không lấy được tồn kho: gửi đủ số khách chọn, để máy chủ quyết', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 3 });
    const { deps } = server([{ variationId: 'v1', quantity: 2 }], {});
    expect(await mergeGuestCart(deps, NOW)).toEqual({ lines: 1, merged: 1, reduced: 0, failedLines: 0 });
    expect(deps.getStock).toHaveBeenCalledWith('sp-1');
    expect(deps.addToCart.mock.calls).toEqual([['v1', 3]]);
  });

  it('không tải được giỏ máy chủ: coi như giỏ trống, vẫn gộp theo tồn kho', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 5 });
    const { deps } = server([], { 'sp-1': { v1: 3 } });
    deps.getCart.mockRejectedValueOnce(new Error('network'));
    expect(await mergeGuestCart(deps, NOW)).toEqual({ lines: 1, merged: 1, reduced: 1, failedLines: 0 });
    expect(deps.addToCart.mock.calls).toEqual([['v1', 3]]);
  });

  it('hai phân loại cùng sản phẩm: hỏi tồn kho một lần', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    addGuestLine({ variationId: 'v2', slug: 'sp-1', quantity: 1 });
    const { deps } = server([], { 'sp-1': { v1: 5, v2: 5 } });
    await mergeGuestCart(deps, NOW);
    expect(deps.getStock).toHaveBeenCalledTimes(1);
    expect(deps.addToCart).toHaveBeenCalledTimes(2);
  });

  it('giỏ khách trống: trả null, không gọi mạng, không giữ chỗ', async () => {
    const { deps } = server([], {});
    expect(await mergeGuestCart(deps, NOW)).toBeNull();
    expect(deps.getCart).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(GUEST_MERGE_CLAIM_KEY)).toBeNull();
  });
});

describe('mergeGuestCart: không gộp hai lần', () => {
  it('hai lời gọi cùng lúc dùng chung một lần chạy: mỗi dòng chỉ thêm một lần, cả hai nhận cùng kết quả', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    addGuestLine({ variationId: 'v2', slug: 'sp-2', quantity: 2 });
    const { deps } = server([], { 'sp-1': { v1: 5 }, 'sp-2': { v2: 5 } });

    const [a, b] = await Promise.all([mergeGuestCart(deps, NOW), mergeGuestCart(deps, NOW)]);

    expect(deps.getCart).toHaveBeenCalledTimes(1);
    expect(deps.addToCart.mock.calls).toEqual([
      ['v1', 1],
      ['v2', 2],
    ]);
    expect(a).toEqual({ lines: 2, merged: 2, reduced: 0, failedLines: 0 });
    expect(b).toBe(a);
  });

  it('tải lại trang trong TTL (khoá bộ nhớ mất, sessionStorage còn): trả null và không gọi mạng dù giỏ khách còn món', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    const first = server([], { 'sp-1': { v1: 5 } });
    await mergeGuestCart(first.deps, NOW);

    resetGuestMergeForTest();
    addGuestLine({ variationId: 'v2', slug: 'sp-2', quantity: 1 });
    const again = server([], { 'sp-2': { v2: 5 } });
    expect(await mergeGuestCart(again.deps, NOW + GUEST_MERGE_CLAIM_TTL_MS - 1)).toBeNull();
    expect(again.deps.getCart).not.toHaveBeenCalled();
    expect(again.deps.getStock).not.toHaveBeenCalled();
    expect(again.deps.addToCart).not.toHaveBeenCalled();
    expect(readGuestCart().map((l) => l.variationId)).toEqual(['v2']);
  });

  it('quá TTL mà giỏ khách có món mới: gộp lại', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    await mergeGuestCart(server([], { 'sp-1': { v1: 5 } }).deps, NOW);

    resetGuestMergeForTest();
    addGuestLine({ variationId: 'v2', slug: 'sp-2', quantity: 2 });
    const later = server([], { 'sp-2': { v2: 5 } });
    const at = NOW + GUEST_MERGE_CLAIM_TTL_MS;
    expect(await mergeGuestCart(later.deps, at)).toEqual({ lines: 1, merged: 1, reduced: 0, failedLines: 0 });
    expect(later.deps.addToCart.mock.calls).toEqual([['v2', 2]]);
    expect(sessionStorage.getItem(GUEST_MERGE_CLAIM_KEY)).toBe(String(at));
    expect(readGuestCart()).toEqual([]);
  });

  it('sessionStorage bị chặn: vẫn gộp (khoá trong bộ nhớ chặn chạy đôi)', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    const { deps } = server([], { 'sp-1': { v1: 5 } });
    const realGet = Storage.prototype.getItem;
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === GUEST_MERGE_CLAIM_KEY) throw new DOMException('blocked', 'SecurityError');
      return realGet.call(this, key);
    });
    try {
      expect(await mergeGuestCart(deps, NOW)).toEqual({ lines: 1, merged: 1, reduced: 0, failedLines: 0 });
      expect(deps.addToCart.mock.calls).toEqual([['v1', 1]]);
    } finally {
      spy.mockRestore();
    }
  });
});
