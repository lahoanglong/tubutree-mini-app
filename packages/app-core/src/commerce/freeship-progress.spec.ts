import { describe, expect, it } from 'vitest';
import { FREESHIP_UPSELL_WINDOW } from '@tubutree/shared-types';
import {
  FREESHIP_ADDON_MAX,
  FREESHIP_ADDON_MIN,
  FREESHIP_ADDON_WINDOW,
  FREESHIP_BOOSTER_WINDOW,
  cartUnlockLevel,
  freeshipProgress,
  pickFreeshipAddons,
  shouldCelebrateUnlock,
  type FreeshipAddonCandidate,
} from './freeship-progress';

const c = (slug: string, price: number, over: Partial<FreeshipAddonCandidate> = {}): FreeshipAddonCandidate => ({
  slug,
  variationId: `v-${slug}`,
  price,
  inStock: true,
  ...over,
});

describe('freeshipProgress', () => {
  it('chưa đạt: số còn thiếu và phần trăm làm tròn xuống', () => {
    expect(freeshipProgress({ base: 164_000, threshold: 199_000 })).toEqual({ reached: false, remaining: 35_000, pct: 82 });
    expect(freeshipProgress({ base: 0, threshold: 199_000 })).toEqual({ reached: false, remaining: 199_000, pct: 0 });
  });

  it('còn thiếu vài đồng thì thanh chưa đầy (tối đa 99)', () => {
    expect(freeshipProgress({ base: 198_990, threshold: 199_000 })).toEqual({ reached: false, remaining: 10, pct: 99 });
  });

  it('đạt đúng ngưỡng hoặc vượt: chúc mừng, 100%', () => {
    expect(freeshipProgress({ base: 199_000, threshold: 199_000 })).toEqual({ reached: true, remaining: 0, pct: 100 });
    expect(freeshipProgress({ base: 500_000, threshold: 199_000 })).toEqual({ reached: true, remaining: 0, pct: 100 });
  });

  it('ngưỡng 0 hoặc âm: mọi đơn được miễn phí; cờ máy chủ đã đạt thắng', () => {
    expect(freeshipProgress({ base: 0, threshold: 0 }).reached).toBe(true);
    expect(freeshipProgress({ base: 10, threshold: -5 }).reached).toBe(true);
    expect(freeshipProgress({ base: 10, threshold: 199_000, serverReached: true })).toEqual({ reached: true, remaining: 0, pct: 100 });
  });

  it('số lạ (NaN, âm) không ném và không ra phần trăm ngoài 0–100', () => {
    expect(freeshipProgress({ base: Number.NaN, threshold: 199_000 })).toEqual({ reached: false, remaining: 199_000, pct: 0 });
    expect(freeshipProgress({ base: -50, threshold: 199_000 }).pct).toBe(0);
    expect(freeshipProgress({ base: 100, threshold: Number.NaN }).reached).toBe(true);
  });
});

describe('pickFreeshipAddons', () => {
  const pool = [c('a', 10_000), c('b', 20_000), c('c', 30_000), c('d', 40_000), c('e', 50_000), c('f', 60_000), c('g', 70_000)];

  it('đã đạt ngưỡng (remaining <= 0) hoặc số lạ: không gợi ý', () => {
    expect(pickFreeshipAddons(pool, { remaining: 0 })).toEqual([]);
    expect(pickFreeshipAddons(pool, { remaining: -1 })).toEqual([]);
    expect(pickFreeshipAddons(pool, { remaining: Number.NaN })).toEqual([]);
    expect(pickFreeshipAddons(null, { remaining: 35_000 })).toEqual([]);
  });

  it('món đóng được khoảng thiếu một mình (rẻ nhất trước) đứng trước các món rẻ hơn', () => {
    const out = pickFreeshipAddons(pool, { remaining: 35_000 });
    expect(out.map((x) => x.slug)).toEqual(['d', 'e', 'f', 'a', 'b']);
  });

  it('bỏ món đắt hơn remaining + 25.000 và tối đa 5 món', () => {
    const out = pickFreeshipAddons(pool, { remaining: 35_000 });
    expect(out.every((x) => x.price <= 35_000 + FREESHIP_ADDON_WINDOW)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(FREESHIP_ADDON_MAX);
    expect(out.find((x) => x.slug === 'g')).toBeUndefined();
  });

  it('bỏ món hết hàng, thiếu phân loại, giá không dương, trùng slug', () => {
    const out = pickFreeshipAddons(
      [c('a', 10_000, { inStock: false }), c('b', 20_000, { variationId: null }), c('c', 0), c('d', 40_000), c('d', 41_000), c('e', 50_000), c('f', 60_000), c('g', 30_000)],
      { remaining: 35_000 },
    );
    expect(out.map((x) => x.slug)).toEqual(['d', 'e', 'f', 'g']);
  });

  it('bỏ món đã có trong giỏ theo slug hoặc theo phân loại', () => {
    const out = pickFreeshipAddons(pool, { remaining: 35_000, inCartSlugs: new Set(['d']), inCartVariationIds: new Set(['v-e']) });
    expect(out.map((x) => x.slug)).toEqual(['f', 'a', 'b', 'c']);
  });

  it(`dưới ${FREESHIP_ADDON_MIN} món hợp lệ thì dải ẩn (rỗng)`, () => {
    expect(pickFreeshipAddons([c('a', 10_000), c('b', 20_000)], { remaining: 35_000 })).toEqual([]);
    expect(pickFreeshipAddons([c('a', 10_000), c('b', 20_000), c('c', 30_000)], { remaining: 35_000 })).toHaveLength(3);
  });

  it('limit nhỏ hơn trần được tôn trọng, lớn hơn trần bị kẹp về trần', () => {
    expect(pickFreeshipAddons(pool, { remaining: 35_000, limit: 3 })).toHaveLength(3);
    expect(pickFreeshipAddons(pool, { remaining: 35_000, limit: 99 })).toHaveLength(FREESHIP_ADDON_MAX);
  });

  it('khoảng thiếu rất nhỏ: món đóng được gồm cả món đắt tới 25.000 + thiếu', () => {
    const out = pickFreeshipAddons([c('a', 5_000), c('b', 20_000), c('c', 29_000), c('d', 31_000)], { remaining: 5_000 });
    expect(out.map((x) => x.slug)).toEqual(['a', 'b', 'c']);
  });

  it('không sửa mảng đầu vào', () => {
    const input = [...pool];
    pickFreeshipAddons(input, { remaining: 35_000 });
    expect(input).toEqual(pool);
  });
});

describe('pickFreeshipAddons — dải "Thêm 1 món nhỏ" (cửa sổ 45.000, thứ tự máy chủ)', () => {
  it('cửa sổ bằng đúng số của máy chủ', () => {
    expect(FREESHIP_BOOSTER_WINDOW).toBe(FREESHIP_UPSELL_WINDOW);
    expect(FREESHIP_BOOSTER_WINDOW).toBe(45_000);
  });

  it('window 45.000: món đắt tới remaining + 45.000 vào, hơn 1 đồng thì không', () => {
    const pool = [c('a', 80_000), c('b', 80_001), c('c', 10_000), c('d', 20_000)];
    expect(pickFreeshipAddons(pool, { remaining: 35_000, window: FREESHIP_BOOSTER_WINDOW }).map((x) => x.slug)).toEqual(['a', 'c', 'd']);
    // Cửa sổ cũ (mặc định 25.000) vẫn như trước khi không truyền.
    expect(pickFreeshipAddons(pool, { remaining: 35_000 })).toEqual([]);
  });

  it('ranked: món đóng khoảng giữ thứ tự nguồn (bán chạy trước), không xếp lại theo giá', () => {
    const pool = [c('hot', 70_000), c('mid', 40_000), c('cheap', 10_000), c('cold', 36_000)];
    const opts = { remaining: 35_000, window: FREESHIP_BOOSTER_WINDOW };
    expect(pickFreeshipAddons(pool, { ...opts, ranked: true }).map((x) => x.slug)).toEqual(['hot', 'mid', 'cold', 'cheap']);
    expect(pickFreeshipAddons(pool, opts).map((x) => x.slug)).toEqual(['cold', 'mid', 'hot', 'cheap']);
  });

  it('ranked vẫn xét lại theo giỏ mới nhất: món vừa vào giỏ bị bỏ, dưới 3 món thì ẩn', () => {
    const pool = [c('a', 40_000), c('b', 50_000), c('c', 60_000)];
    expect(pickFreeshipAddons(pool, { remaining: 35_000, window: FREESHIP_BOOSTER_WINDOW, ranked: true, inCartSlugs: new Set(['b']) })).toEqual([]);
  });
});

describe('cartUnlockLevel / shouldCelebrateUnlock', () => {
  it('mức: 0 khi chưa đạt; đạt thì 1 + số món của bậc Hộp Xanh', () => {
    expect(cartUnlockLevel(false, 5)).toBe(0);
    expect(cartUnlockLevel(true)).toBe(1);
    expect(cartUnlockLevel(true, null)).toBe(1);
    expect(cartUnlockLevel(true, 3)).toBe(4);
    expect(cartUnlockLevel(true, 0)).toBe(1);
  });

  it('lần vẽ đầu không mừng; chỉ mừng khi vượt mức cao nhất đã thấy', () => {
    expect(shouldCelebrateUnlock(null, 1)).toBe(false);
    expect(shouldCelebrateUnlock(0, 1)).toBe(true);
    expect(shouldCelebrateUnlock(1, 4)).toBe(true);
    expect(shouldCelebrateUnlock(1, 1)).toBe(false);
    // Tụt rồi lên lại tới mức cũ (bỏ chọn rồi chọn lại): không mừng lần hai.
    expect(shouldCelebrateUnlock(4, 1)).toBe(false);
    expect(shouldCelebrateUnlock(4, 4)).toBe(false);
  });
});
