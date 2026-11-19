// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addGuestLine,
  clearGuestCart,
  EMPTY_GUEST_CART,
  GUEST_CART_KEY,
  GUEST_CART_MAX_LINES,
  GUEST_CART_MAX_QTY,
  guestCartCount,
  markGuestMergeBase,
  parseGuestCart,
  readGuestCart,
  removeGuestLine,
  setGuestQuantity,
  subscribeGuestCart,
} from './store';

const saved = () => JSON.parse(localStorage.getItem(GUEST_CART_KEY) ?? 'null') as unknown;

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('giỏ khách: thêm, cộng dồn, đổi số lượng, xoá', () => {
  it('thêm món mới ghi slug, số lượng và mốc thêm; cùng phân loại thì cộng dồn trên một dòng', () => {
    expect(addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 2 }, 1000)).toEqual({ ok: true, added: 2, quantity: 2 });
    expect(addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 3 }, 2000)).toEqual({ ok: true, added: 3, quantity: 5 });
    expect(addGuestLine({ variationId: 'v2', slug: 'xa-phong', quantity: 1 }, 3000)).toEqual({ ok: true, added: 1, quantity: 1 });
    expect(readGuestCart()).toEqual([
      { variationId: 'v1', slug: 'dau-goi', quantity: 5, addedAt: 1000 },
      { variationId: 'v2', slug: 'xa-phong', quantity: 1, addedAt: 3000 },
    ]);
    expect(guestCartCount(readGuestCart())).toBe(6);
    expect(saved()).toEqual(readGuestCart());
  });

  it('setGuestQuantity kẹp về 1..99, dòng không có hay số không hợp lệ thì không ghi', () => {
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 2 });
    expect(setGuestQuantity('v1', 7)).toBe(true);
    expect(readGuestCart()[0]!.quantity).toBe(7);
    expect(setGuestQuantity('v1', 0)).toBe(true);
    expect(readGuestCart()[0]!.quantity).toBe(1);
    expect(setGuestQuantity('v1', 500)).toBe(true);
    expect(readGuestCart()[0]!.quantity).toBe(GUEST_CART_MAX_QTY);
    expect(setGuestQuantity('v1', Number.NaN)).toBe(false);
    expect(setGuestQuantity('khong-co', 3)).toBe(false);
    expect(readGuestCart()).toHaveLength(1);
    expect(readGuestCart()[0]!.quantity).toBe(GUEST_CART_MAX_QTY);
  });

  it('removeGuestLine bỏ đúng dòng; xoá dòng cuối thì gỡ khoá khỏi localStorage; clearGuestCart làm trống', () => {
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 1 });
    addGuestLine({ variationId: 'v2', slug: 'xa-phong', quantity: 1 });
    expect(removeGuestLine('v1')).toBe(true);
    expect(removeGuestLine('v1')).toBe(false);
    expect(readGuestCart().map((l) => l.variationId)).toEqual(['v2']);
    expect(removeGuestLine('v2')).toBe(true);
    expect(localStorage.getItem(GUEST_CART_KEY)).toBeNull();
    expect(readGuestCart()).toEqual([]);

    addGuestLine({ variationId: 'v3', slug: 'nuoc-rua', quantity: 4 });
    clearGuestCart();
    expect(localStorage.getItem(GUEST_CART_KEY)).toBeNull();
    expect(readGuestCart()).toBe(EMPTY_GUEST_CART);
  });
});

describe('giỏ khách: trần 30 dòng và 99 mỗi dòng', () => {
  it('đủ 30 dòng thì phân loại mới bị từ chối (full), phân loại đã có vẫn cộng được', () => {
    for (let i = 0; i < GUEST_CART_MAX_LINES; i++) {
      expect(addGuestLine({ variationId: `v${i}`, slug: `sp-${i}`, quantity: 1 }).ok).toBe(true);
    }
    expect(readGuestCart()).toHaveLength(30);
    expect(addGuestLine({ variationId: 'v-moi', slug: 'sp-moi', quantity: 1 })).toEqual({ ok: false, reason: 'full' });
    expect(readGuestCart()).toHaveLength(30);
    expect(readGuestCart().some((l) => l.variationId === 'v-moi')).toBe(false);
    expect(addGuestLine({ variationId: 'v0', slug: 'sp-0', quantity: 2 })).toEqual({ ok: true, added: 2, quantity: 3 });
  });

  it('cộng vượt 99 thì kẹp về 99 (added là phần thật sự thêm); đã ở 99 thì max', () => {
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 98 });
    expect(addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 5 })).toEqual({ ok: true, added: 1, quantity: 99 });
    expect(addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 1 })).toEqual({ ok: false, reason: 'max' });
    expect(readGuestCart()[0]!.quantity).toBe(99);
  });

  it('maxQty (tồn kho đang hiển thị) kẹp số lượng; đã chạm tồn thì max và không ghi gì', () => {
    expect(addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 3, maxQty: 2 })).toEqual({ ok: true, added: 2, quantity: 2 });
    const before = localStorage.getItem(GUEST_CART_KEY);
    expect(addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 1, maxQty: 2 })).toEqual({ ok: false, reason: 'max' });
    expect(localStorage.getItem(GUEST_CART_KEY)).toBe(before);
    expect(addGuestLine({ variationId: 'v2', slug: 'het-hang', quantity: 1, maxQty: 0 })).toEqual({ ok: false, reason: 'max' });
    expect(readGuestCart().map((l) => l.variationId)).toEqual(['v1']);
  });
});

describe('giỏ khách: bộ nhớ bị chặn hay hỏng không làm vỡ trang', () => {
  it('getItem ném: đọc ra giỏ trống, đổi/xoá trả false, không ném', () => {
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 1 });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(readGuestCart()).toEqual([]);
    expect(setGuestQuantity('v1', 3)).toBe(false);
    expect(removeGuestLine('v1')).toBe(false);
  });

  it('setItem ném (đầy bộ nhớ, chế độ riêng tư): add trả storage, giỏ không đổi, không ném', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const onChange = vi.fn();
    const off = subscribeGuestCart(onChange);
    expect(addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 1 })).toEqual({ ok: false, reason: 'storage' });
    expect(readGuestCart()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
    off();
  });

  it('removeItem ném: clearGuestCart không ném', () => {
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 1 });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => clearGuestCart()).not.toThrow();
  });

  it('JSON hỏng hay không phải mảng: giỏ trống', () => {
    for (const raw of ['{không phải json', '{"variationId":"v1"}', '42', '"chuoi"', 'null', '']) {
      localStorage.setItem(GUEST_CART_KEY, raw);
      expect(readGuestCart()).toEqual([]);
    }
    expect(parseGuestCart(null)).toBe(EMPTY_GUEST_CART);
  });

  it('bỏ dòng sai kiểu hay id/slug sai dạng, giữ dòng hợp lệ; addedAt thiếu thì 0', () => {
    localStorage.setItem(
      GUEST_CART_KEY,
      JSON.stringify([
        null,
        'v1',
        42,
        { variationId: 7, slug: 'a', quantity: 1 },
        { variationId: 'id có dấu cách', slug: 'a', quantity: 1 },
        { variationId: 'x'.repeat(65), slug: 'a', quantity: 1 },
        { variationId: 'v2', slug: 'a/b', quantity: 1 },
        { variationId: 'v3', slug: 'co khoang trang', quantity: 1 },
        { variationId: 'v4', slug: 'a', quantity: '2' },
        { variationId: 'v5', slug: 'a', quantity: 0 },
        { variationId: 'v6', slug: 'a', quantity: null },
        { variationId: 'v7', slug: 7, quantity: 1 },
        { variationId: 'ok_1', slug: 'dau-goi', quantity: 2, addedAt: 5 },
        { variationId: 'ok-2', slug: 'xa-phong', quantity: 1, addedAt: 'hôm qua' },
      ]),
    );
    expect(readGuestCart()).toEqual([
      { variationId: 'ok_1', slug: 'dau-goi', quantity: 2, addedAt: 5 },
      { variationId: 'ok-2', slug: 'xa-phong', quantity: 1, addedAt: 0 },
    ]);
  });

  it('dữ liệu đã lưu có dòng trùng, số lẻ, quá 99 hay quá 30 dòng: gộp, làm tròn xuống, kẹp', () => {
    const many = Array.from({ length: 35 }, (_, i) => ({ variationId: `v${i}`, slug: `sp-${i}`, quantity: 1, addedAt: i }));
    const lines = parseGuestCart(
      JSON.stringify([
        { variationId: 'v0', slug: 'sp-0', quantity: 60, addedAt: 0 },
        { variationId: 'v0', slug: 'sp-0', quantity: 60, addedAt: 0 },
        { variationId: 'v1', slug: 'sp-1', quantity: 2.7, addedAt: 0 },
        ...many,
      ]),
    );
    expect(lines).toHaveLength(GUEST_CART_MAX_LINES);
    expect(lines.find((l) => l.variationId === 'v0')!.quantity).toBe(99);
    expect(lines.find((l) => l.variationId === 'v1')!.quantity).toBe(3);
    expect(lines.some((l) => l.variationId === 'v30')).toBe(false);
  });
});

describe('giỏ khách: ảnh chụp và lắng nghe cho useSyncExternalStore', () => {
  it('chuỗi đã lưu không đổi thì cùng một tham chiếu; ghi mới thì tham chiếu mới', () => {
    expect(readGuestCart()).toBe(EMPTY_GUEST_CART);
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 1 });
    const a = readGuestCart();
    expect(readGuestCart()).toBe(a);
    expect(readGuestCart()).toBe(a);
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 1 });
    const b = readGuestCart();
    expect(b).not.toBe(a);
    expect(readGuestCart()).toBe(b);
    expect(Object.isFrozen(b)).toBe(true);
  });

  it('nghe được lần ghi trong tab này và sự kiện storage của đúng khoá (hoặc storage.clear ở tab khác); bỏ nghe thì thôi', () => {
    const cb = vi.fn();
    const off = subscribeGuestCart(cb);
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 1 });
    expect(cb).toHaveBeenCalledTimes(1);
    setGuestQuantity('v1', 2);
    removeGuestLine('v1');
    expect(cb).toHaveBeenCalledTimes(3);

    window.dispatchEvent(new StorageEvent('storage', { key: GUEST_CART_KEY }));
    expect(cb).toHaveBeenCalledTimes(4);
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(cb).toHaveBeenCalledTimes(5);
    window.dispatchEvent(new StorageEvent('storage', { key: 'tubu_khac' }));
    expect(cb).toHaveBeenCalledTimes(5);

    off();
    addGuestLine({ variationId: 'v2', slug: 'xa-phong', quantity: 1 });
    window.dispatchEvent(new StorageEvent('storage', { key: GUEST_CART_KEY }));
    expect(cb).toHaveBeenCalledTimes(5);
  });

  it('tab khác ghi giỏ: lần đọc kế tiếp thấy dữ liệu mới', () => {
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 1 });
    const before = readGuestCart();
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify([{ variationId: 'v9', slug: 'tab-khac', quantity: 4, addedAt: 1 }]));
    const after = readGuestCart();
    expect(after).not.toBe(before);
    expect(after.map((l) => l.variationId)).toEqual(['v9']);
  });
});

describe('giỏ khách: mốc gộp (mergeBase)', () => {
  const lineOf = (id: string) => readGuestCart().find((l) => l.variationId === id);

  it('markGuestMergeBase ghi mốc lên đúng dòng; dòng không có thì false', () => {
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 2 });
    addGuestLine({ variationId: 'v2', slug: 'xa-phong', quantity: 1 });
    expect(markGuestMergeBase('v1', 3, 1000)).toBe(true);
    expect(lineOf('v1')).toMatchObject({ quantity: 2, mergeBase: { inCart: 3, at: 1000 } });
    expect(lineOf('v2')!.mergeBase).toBeUndefined();
    expect(markGuestMergeBase('khong-co', 1, 1000)).toBe(false);
  });

  it('parseGuestCart giữ mốc hợp lệ, bỏ mốc sai dạng nhưng vẫn giữ dòng', () => {
    const row = (id: string, mergeBase: unknown) => ({ variationId: id, slug: 'sp', quantity: 1, addedAt: 0, mergeBase });
    const lines = parseGuestCart(
      JSON.stringify([
        row('ok', { inCart: 0, at: 5 }),
        row('am', { inCart: -1, at: 5 }),
        row('le', { inCart: 1.5, at: 5 }),
        row('qua-lon', { inCart: 10_000, at: 5 }),
        row('chuoi', { inCart: '2', at: 5 }),
        row('khong-at', { inCart: 2 }),
        row('at-chuoi', { inCart: 2, at: 'x' }),
        row('khong-phai-object', 3),
      ]),
    );
    expect(lines.map((l) => l.variationId)).toEqual(['ok', 'am', 'le', 'qua-lon', 'chuoi', 'khong-at', 'at-chuoi', 'khong-phai-object']);
    expect(lines[0]!.mergeBase).toEqual({ inCart: 0, at: 5 });
    for (const l of lines.slice(1)) expect(l).not.toHaveProperty('mergeBase');
  });

  it('khách tự thêm hay đổi số lượng là ý định mới: addGuestLine và setGuestQuantity bỏ mốc', () => {
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 1 });
    markGuestMergeBase('v1', 2, 1000);
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 1 });
    expect(lineOf('v1')).toEqual({ variationId: 'v1', slug: 'dau-goi', quantity: 2, addedAt: expect.any(Number) });

    markGuestMergeBase('v1', 2, 1000);
    setGuestQuantity('v1', 5);
    expect(lineOf('v1')).not.toHaveProperty('mergeBase');
    expect(lineOf('v1')!.quantity).toBe(5);
  });

  it('thêm món khác hay xoá dòng khác không đụng mốc của dòng đang có mốc', () => {
    addGuestLine({ variationId: 'v1', slug: 'dau-goi', quantity: 1 });
    addGuestLine({ variationId: 'v2', slug: 'xa-phong', quantity: 1 });
    markGuestMergeBase('v1', 2, 1000);
    addGuestLine({ variationId: 'v3', slug: 'nuoc-rua', quantity: 1 });
    removeGuestLine('v2');
    expect(lineOf('v1')!.mergeBase).toEqual({ inCart: 2, at: 1000 });
  });
});

describe('giỏ khách: cookie "có món" cho middleware (bản dựng sẵn giỏ trống)', () => {
  const cookieOn = () => document.cookie.split('; ').includes('tubu_guest_cart=1');

  it('thêm món thì bật cookie, xoá hết món thì gỡ', () => {
    addGuestLine({ variationId: 'vc1', slug: 'xa-phong', quantity: 1 }, 1000);
    expect(cookieOn()).toBe(true);
    removeGuestLine('vc1');
    expect(cookieOn()).toBe(false);
    addGuestLine({ variationId: 'vc2', slug: 'xa-phong', quantity: 1 }, 1000);
    clearGuestCart();
    expect(cookieOn()).toBe(false);
  });

  it('giỏ có món từ trước khi có cookie (hay cookie đã hết hạn): lần đọc đầu của trang ghi bù cookie, một lần', async () => {
    window.localStorage.setItem('tubu.guestCart.v1', JSON.stringify([{ variationId: 'old1', slug: 'xa-phong', quantity: 1, addedAt: 1 }]));
    document.cookie = 'tubu_guest_cart=; Path=/; Max-Age=0';
    expect(cookieOn()).toBe(false);
    vi.resetModules();
    const fresh = await import('./store');
    expect(fresh.readGuestCart()).toHaveLength(1);
    expect(cookieOn()).toBe(true);
    document.cookie = 'tubu_guest_cart=; Path=/; Max-Age=0';
    fresh.readGuestCart();
    expect(cookieOn(), 'chỉ đồng bộ ở lần đọc đầu, không ghi cookie mỗi lượt vẽ').toBe(false);
  });
});
