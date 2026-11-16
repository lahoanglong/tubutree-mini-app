// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '@/lib/client-api';
import {
  GUEST_MERGE_BASE_TTL_MS,
  GUEST_MERGE_CLAIM_KEY,
  GUEST_MERGE_CLAIM_TTL_MS,
  mergeGuestCart,
  resetGuestMergeForTest,
  type GuestMergeDeps,
} from './merge';
import { addGuestLine, readGuestCart, removeGuestLine } from './store';

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
const ids = () => readGuestCart().map((l) => l.variationId);
const lineOf = (id: string) => readGuestCart().find((l) => l.variationId === id);

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
    expect(result).toEqual({ lines: 3, merged: 2, reduced: 1, failedLines: 1, kept: 0 });
    expect(items()).toEqual([
      { variationId: 'vb', quantity: 4 },
      { variationId: 'vc', quantity: 1 },
    ]);
    expect(readGuestCart()).toEqual([]);
  });

  it('ghi mốc giỏ máy chủ lên dòng ngay trước khi gửi', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 3 });
    const { deps } = server([{ variationId: 'v1', quantity: 2 }], { 'sp-1': { v1: 10 } });
    let seen: unknown = null;
    deps.addToCart.mockImplementationOnce(async (variationId: string, quantity: number) => {
      seen = lineOf('v1')?.mergeBase;
      return { items: [{ variationId, quantity: 2 + quantity }] };
    });
    await mergeGuestCart(deps, NOW);
    expect(seen).toEqual({ inCart: 2, at: NOW });
    expect(deps.addToCart.mock.calls).toEqual([['v1', 3]]);
  });

  it('giỏ máy chủ đã đủ số còn hàng: không gửi gì, dòng tính là đã gộp nhưng bị giảm, rời giỏ khách', async () => {
    addGuestLine({ variationId: 'vb', slug: 'sp-b', quantity: 2 });
    const { deps } = server([{ variationId: 'vb', quantity: 4 }], { 'sp-b': { vb: 4 } });
    expect(await mergeGuestCart(deps, NOW)).toEqual({ lines: 1, merged: 1, reduced: 1, failedLines: 0, kept: 0 });
    expect(deps.addToCart).not.toHaveBeenCalled();
    expect(readGuestCart()).toEqual([]);
  });

  it('tồn kho của sản phẩm không có phân loại đó (phân loại đã ngừng bán): lỗi dòng, bỏ dòng, không gọi addToCart', async () => {
    addGuestLine({ variationId: 'v-cu', slug: 'sp-1', quantity: 1 });
    const { deps } = server([], { 'sp-1': { 'v-moi': 5 } });
    expect(await mergeGuestCart(deps, NOW)).toEqual({ lines: 1, merged: 0, reduced: 0, failedLines: 1, kept: 0 });
    expect(deps.addToCart).not.toHaveBeenCalled();
    expect(readGuestCart()).toEqual([]);
  });

  it('không lấy được tồn kho: gửi đủ số khách chọn, để máy chủ quyết', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 3 });
    const { deps } = server([{ variationId: 'v1', quantity: 2 }], {});
    expect(await mergeGuestCart(deps, NOW)).toEqual({ lines: 1, merged: 1, reduced: 0, failedLines: 0, kept: 0 });
    expect(deps.getStock).toHaveBeenCalledWith('sp-1');
    expect(deps.addToCart.mock.calls).toEqual([['v1', 3]]);
  });

  it('không tải được giỏ máy chủ: không gửi gì, mọi dòng ở lại giỏ khách (kept)', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 5 });
    addGuestLine({ variationId: 'v2', slug: 'sp-2', quantity: 1 });
    const { deps } = server([], { 'sp-1': { v1: 3 }, 'sp-2': { v2: 3 } });
    deps.getCart.mockRejectedValueOnce(new NetworkError(false));
    expect(await mergeGuestCart(deps, NOW)).toEqual({ lines: 2, merged: 0, reduced: 0, failedLines: 0, kept: 2 });
    expect(deps.getStock).not.toHaveBeenCalled();
    expect(deps.addToCart).not.toHaveBeenCalled();
    expect(ids()).toEqual(['v1', 'v2']);
    expect(lineOf('v1')?.mergeBase).toBeUndefined();
  });

  it('hai phân loại cùng sản phẩm: hỏi tồn kho một lần', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    addGuestLine({ variationId: 'v2', slug: 'sp-1', quantity: 1 });
    const { deps } = server([], { 'sp-1': { v1: 5, v2: 5 } });
    await mergeGuestCart(deps, NOW);
    expect(deps.getStock).toHaveBeenCalledTimes(1);
    expect(deps.addToCart).toHaveBeenCalledTimes(2);
  });

  it('dòng đã bị tab khác gộp (không còn trong bộ nhớ lúc tới lượt): bỏ qua, không đếm', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    addGuestLine({ variationId: 'v2', slug: 'sp-2', quantity: 1 });
    const { deps } = server([], { 'sp-1': { v1: 5 }, 'sp-2': { v2: 5 } });
    deps.addToCart.mockImplementationOnce(async (variationId: string, quantity: number) => {
      removeGuestLine('v2');
      return { items: [{ variationId, quantity }] };
    });
    expect(await mergeGuestCart(deps, NOW)).toEqual({ lines: 2, merged: 1, reduced: 0, failedLines: 0, kept: 0 });
    expect(deps.addToCart.mock.calls).toEqual([['v1', 1]]);
  });

  it('giỏ khách trống: trả null, không gọi mạng, không giữ chỗ', async () => {
    const { deps } = server([], {});
    expect(await mergeGuestCart(deps, NOW)).toBeNull();
    expect(deps.getCart).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(GUEST_MERGE_CLAIM_KEY)).toBeNull();
  });
});

describe('mergeGuestCart: lỗi khi gửi từng dòng', () => {
  it('máy chủ từ chối hẳn (409, 400): lỗi dòng, bỏ khỏi giỏ khách, không chặn dòng sau', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    addGuestLine({ variationId: 'v2', slug: 'sp-2', quantity: 1 });
    addGuestLine({ variationId: 'v3', slug: 'sp-3', quantity: 2 });
    const { deps } = server([], { 'sp-1': { v1: 5 }, 'sp-2': { v2: 5 }, 'sp-3': { v3: 5 } });
    deps.addToCart.mockRejectedValueOnce(new ApiError('Hết hàng', 409)).mockRejectedValueOnce(new ApiError('Sai dữ liệu', 400));

    expect(await mergeGuestCart(deps, NOW)).toEqual({ lines: 3, merged: 1, reduced: 0, failedLines: 2, kept: 0 });
    expect(deps.addToCart.mock.calls).toEqual([
      ['v1', 1],
      ['v2', 1],
      ['v3', 2],
    ]);
    expect(readGuestCart()).toEqual([]);
  });

  it.each([
    ['503', new ApiError('Bảo trì', 503)],
    ['500', new ApiError('Lỗi', 500)],
    ['401', new ApiError('Hết phiên', 401)],
    ['408', new ApiError('Quá hạn', 408)],
    ['429', new ApiError('Chậm lại', 429)],
    ['mất mạng', new NetworkError(false)],
  ])('lỗi tạm (%s): dòng ở lại giỏ khách kèm mốc, dòng sau vẫn gộp', async (_label, err) => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 2 });
    addGuestLine({ variationId: 'v2', slug: 'sp-2', quantity: 1 });
    const { deps } = server([{ variationId: 'v1', quantity: 1 }], { 'sp-1': { v1: 5 }, 'sp-2': { v2: 5 } });
    deps.addToCart.mockRejectedValueOnce(err);

    expect(await mergeGuestCart(deps, NOW)).toEqual({ lines: 2, merged: 1, reduced: 0, failedLines: 0, kept: 1 });
    expect(ids()).toEqual(['v1']);
    expect(lineOf('v1')).toMatchObject({ quantity: 2, mergeBase: { inCart: 1, at: NOW } });
  });
});

describe('mergeGuestCart: gộp lại dòng còn sót sau lỗi tạm (không cộng hai lần)', () => {
  const firstRunKeeps = async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 3 });
    const first = server([{ variationId: 'v1', quantity: 2 }], { 'sp-1': { v1: 10 } });
    first.deps.addToCart.mockRejectedValueOnce(new NetworkError(false));
    expect(await mergeGuestCart(first.deps, NOW)).toEqual({ lines: 1, merged: 0, reduced: 0, failedLines: 0, kept: 1 });
    expect(lineOf('v1')?.mergeBase).toEqual({ inCart: 2, at: NOW });
  };

  it('lần trước máy chủ đã nhận (giỏ máy chủ = mốc + khách): không gửi gì, bỏ dòng', async () => {
    await firstRunKeeps();
    const retry = server([{ variationId: 'v1', quantity: 5 }], { 'sp-1': { v1: 10 } });
    expect(await mergeGuestCart(retry.deps, NOW + 60_000)).toEqual({ lines: 1, merged: 1, reduced: 0, failedLines: 0, kept: 0 });
    expect(retry.deps.addToCart).not.toHaveBeenCalled();
    expect(readGuestCart()).toEqual([]);
  });

  it('lần trước máy chủ chưa nhận (giỏ máy chủ vẫn = mốc): gửi đúng số khách chọn', async () => {
    await firstRunKeeps();
    const retry = server([{ variationId: 'v1', quantity: 2 }], { 'sp-1': { v1: 10 } });
    expect(await mergeGuestCart(retry.deps, NOW + 60_000)).toEqual({ lines: 1, merged: 1, reduced: 0, failedLines: 0, kept: 0 });
    expect(retry.deps.addToCart.mock.calls).toEqual([['v1', 3]]);
    expect(readGuestCart()).toEqual([]);
  });

  it('mốc quá GUEST_MERGE_BASE_TTL_MS: bỏ mốc, tính theo giỏ máy chủ hiện tại', async () => {
    await firstRunKeeps();
    const later = server([{ variationId: 'v1', quantity: 5 }], { 'sp-1': { v1: 10 } });
    expect(await mergeGuestCart(later.deps, NOW + GUEST_MERGE_BASE_TTL_MS)).toEqual({ lines: 1, merged: 1, reduced: 0, failedLines: 0, kept: 0 });
    expect(later.deps.addToCart.mock.calls).toEqual([['v1', 3]]);
  });

  it('mốc còn hạn nhưng tồn kho thấp: đích kẹp theo tồn, chỉ gửi phần còn thiếu và báo giảm', async () => {
    await firstRunKeeps();
    const retry = server([{ variationId: 'v1', quantity: 3 }], { 'sp-1': { v1: 4 } });
    expect(await mergeGuestCart(retry.deps, NOW + 60_000)).toEqual({ lines: 1, merged: 1, reduced: 1, failedLines: 0, kept: 0 });
    expect(retry.deps.addToCart.mock.calls).toEqual([['v1', 1]]);
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
    expect(a).toEqual({ lines: 2, merged: 2, reduced: 0, failedLines: 0, kept: 0 });
    expect(b).toBe(a);
  });

  it('giữ chỗ trong sessionStorage khi đang chạy, bỏ khi chạy xong: gọi lại ngay sau đó vẫn gộp món mới', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    const first = server([], { 'sp-1': { v1: 5 } });
    let during: string | null = null;
    first.deps.getCart.mockImplementationOnce(async () => {
      during = sessionStorage.getItem(GUEST_MERGE_CLAIM_KEY);
      return { items: [] };
    });
    await mergeGuestCart(first.deps, NOW);
    expect(during).toBe(String(NOW));
    expect(sessionStorage.getItem(GUEST_MERGE_CLAIM_KEY)).toBeNull();

    addGuestLine({ variationId: 'v2', slug: 'sp-2', quantity: 1 });
    const again = server([], { 'sp-2': { v2: 5 } });
    expect(await mergeGuestCart(again.deps, NOW + 1_000)).toEqual({ lines: 1, merged: 1, reduced: 0, failedLines: 0, kept: 0 });
    expect(again.deps.addToCart.mock.calls).toEqual([['v2', 1]]);
  });

  it('tải lại trang giữa lúc gộp (giữ chỗ còn sót, chưa quá TTL): trả null và không gọi mạng dù giỏ khách còn món', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    sessionStorage.setItem(GUEST_MERGE_CLAIM_KEY, String(NOW));
    const { deps } = server([], { 'sp-1': { v1: 5 } });
    expect(await mergeGuestCart(deps, NOW + GUEST_MERGE_CLAIM_TTL_MS - 1)).toBeNull();
    expect(deps.getCart).not.toHaveBeenCalled();
    expect(deps.getStock).not.toHaveBeenCalled();
    expect(deps.addToCart).not.toHaveBeenCalled();
    expect(ids()).toEqual(['v1']);
    expect(sessionStorage.getItem(GUEST_MERGE_CLAIM_KEY)).toBe(String(NOW));
  });

  it('giữ chỗ còn sót đã quá TTL: gộp lại', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 2 });
    sessionStorage.setItem(GUEST_MERGE_CLAIM_KEY, String(NOW));
    const { deps } = server([], { 'sp-1': { v1: 5 } });
    expect(await mergeGuestCart(deps, NOW + GUEST_MERGE_CLAIM_TTL_MS)).toEqual({ lines: 1, merged: 1, reduced: 0, failedLines: 0, kept: 0 });
    expect(deps.addToCart.mock.calls).toEqual([['v1', 2]]);
    expect(readGuestCart()).toEqual([]);
  });

  it('không tải được giỏ máy chủ: vẫn bỏ giữ chỗ để lần mở giỏ sau gộp tiếp', async () => {
    addGuestLine({ variationId: 'v1', slug: 'sp-1', quantity: 1 });
    const { deps } = server([], { 'sp-1': { v1: 5 } });
    deps.getCart.mockRejectedValueOnce(new ApiError('Bảo trì', 503));
    await mergeGuestCart(deps, NOW);
    expect(sessionStorage.getItem(GUEST_MERGE_CLAIM_KEY)).toBeNull();
    expect(await mergeGuestCart(deps, NOW + 1_000)).toEqual({ lines: 1, merged: 1, reduced: 0, failedLines: 0, kept: 0 });
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
      expect(await mergeGuestCart(deps, NOW)).toEqual({ lines: 1, merged: 1, reduced: 0, failedLines: 0, kept: 0 });
      expect(deps.addToCart.mock.calls).toEqual([['v1', 1]]);
    } finally {
      spy.mockRestore();
    }
  });
});
