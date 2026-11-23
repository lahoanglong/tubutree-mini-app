import { describe, expect, it } from 'vitest';
import type { BundleDTO, GiftLanding } from '../api/bundle';
import type { CartLine, CartSummary } from '../api/cart';
import type { ProductCard } from '../api/catalog';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { claimsIn } from './copy-claims-guard';
import {
  GIFT_COMBOS_COPY,
  GIFT_COMBOS_COPY_MAX,
  GIFT_COMBOS_MAX,
  comboAddedCue,
  giftCombosCallouts,
  giftCombosCopy,
  giftCombosProducts,
  giftCombosViews,
  type GiftCombosCopyKey,
} from './gift-combos';

const NOW = Date.parse('2026-11-21T10:00:00Z');

const product = (id: string, price: number, over: Partial<ProductCard> = {}): ProductCard =>
  ({ id, slug: `sp-${id}`, name: `Món ${id}`, thumbnail: null, basePrice: price, salePrice: null, inStock: true, ...over }) as ProductCard;

const combo = (id: string, over: Partial<BundleDTO> = {}): BundleDTO => ({
  id,
  kind: 'BUNDLE_PCT',
  title: `Combo ${id}`,
  pct: 10,
  endAt: '2026-12-31T00:00:00Z',
  anchorProductId: null,
  items: [
    { productId: `${id}-a`, variationId: `v-${id}-a`, maxQty: 1, addonPrice: null, inStock: true, product: product(`${id}-a`, 120_000) },
    { productId: `${id}-b`, variationId: `v-${id}-b`, maxQty: 1, addonPrice: null, inStock: true, product: product(`${id}-b`, 85_000) },
  ],
  ...over,
});

const landing = (over: Partial<GiftLanding> = {}): GiftLanding => ({ combos: [combo('c1')], freeshipThreshold: 199_000, giftTrialMinOrder: 299_000, ...over });

describe('giftCombosViews', () => {
  it('giá cả bộ lấy từ giá thật của món, tính như giỏ (floor từng món), không ghi cứng', () => {
    const [v] = giftCombosViews(landing(), NOW);
    expect(v!.total).toBe(205_000);
    // floor(120000 × 10%) + floor(85000 × 10%) = 12.000 + 8.500.
    expect(v!.comboTotal).toBe(184_500);
    expect(v!.lines).toEqual([
      { variationId: 'v-c1-a', quantity: 1 },
      { variationId: 'v-c1-b', quantity: 1 },
    ]);
  });

  it('bỏ combo hết hạn theo giờ máy chủ, combo không giảm, combo thiếu phân loại; tối đa 8', () => {
    const combos = [
      combo('ended', { endAt: '2026-11-21T09:59:59Z' }),
      combo('zero', { pct: 0 }),
      combo('novar', { items: combo('x').items.map((i, n) => (n === 0 ? { ...i, variationId: null } : i)) }),
      ...Array.from({ length: 10 }, (_, i) => combo(`ok${i}`)),
    ];
    const views = giftCombosViews(landing({ combos }), NOW);
    expect(views).toHaveLength(GIFT_COMBOS_MAX);
    expect(views.map((v) => v.id)).toEqual(['ok0', 'ok1', 'ok2', 'ok3', 'ok4', 'ok5', 'ok6', 'ok7']);
  });

  it('chưa có dữ liệu hay không có combo: rỗng (trang hiện trạng thái trống)', () => {
    expect(giftCombosViews(undefined, NOW)).toEqual([]);
    expect(giftCombosViews(landing({ combos: [] }), NOW)).toEqual([]);
  });

  it('`liveAt` = -Infinity: lượt hydrate đầu vẽ đúng combo mà HTML máy chủ đã vẽ', () => {
    const late = combo('late', { endAt: '2026-11-21T09:00:00Z' });
    expect(giftCombosViews(landing({ combos: [late] }), NOW)).toEqual([]);
    expect(giftCombosViews(landing({ combos: [late] }), NOW, -Infinity).map((v) => v.id)).toEqual(['late']);
  });
});

describe('giftCombosViews: số "Tiết kiệm" theo máy chủ (cùng hàm giỏ trừ)', () => {
  it('giá cả bộ = tổng lẻ trừ đúng số máy chủ; nhãn % giữ nguyên khi số khớp mức %', () => {
    const [v] = giftCombosViews(landing({ combos: [{ ...combo('c1'), saving: 20_500 }] }), NOW);
    expect(v!.comboTotal).toBe(184_500);
    expect(v!.pct).toBe(10);
  });

  it('máy chủ kẹp thấp hơn mức % (trần tiền bộ nhân viên): thẻ hứa đúng số kẹp, nhãn % là mức thật làm tròn xuống', () => {
    const [v] = giftCombosViews(landing({ combos: [{ ...combo('c1'), pct: 50, saving: 30_000 }] }), NOW);
    expect(v!.total - v!.comboTotal).toBe(30_000);
    // 30.000 / 205.000 = 14,6% → 14.
    expect(v!.pct).toBe(14);
  });

  it('máy chủ báo 0đ: bỏ bộ (không quảng cáo "mua cả bộ" mà giỏ không giảm)', () => {
    expect(giftCombosViews(landing({ combos: [{ ...combo('c1'), saving: 0 }, combo('c2')] }), NOW).map((v) => v.id)).toEqual(['c2']);
  });

  it('API cũ (thiếu số) hay số hỏng: giữ phép tính ở máy khách; số lớn hơn tổng thì kẹp ở tổng', () => {
    expect(giftCombosViews(landing({ combos: [{ ...combo('c1'), saving: 12.5 }] }), NOW)[0]!.comboTotal).toBe(184_500);
    expect(giftCombosViews(landing({ combos: [{ ...combo('c1'), saving: 999_999 }] }), NOW)[0]!.comboTotal).toBe(0);
  });
});

const line = (o: Partial<CartLine>): CartLine => ({ id: 'l', variationId: 'v', slug: 's', stock: 5, total: 0, quantity: 1, ...o }) as CartLine;
const cart = (o: Partial<CartSummary> & { lines?: Partial<CartLine>[] } = {}) => ({
  items: (o.lines ?? [{ total: 150_000 }]).map(line),
  freeship: o.freeship ?? false,
  freeshipThreshold: o.freeshipThreshold ?? 199_000,
  giftTrial: o.giftTrial,
});
const gift = (minOrder: number, o: Record<string, unknown> = {}) =>
  ({ base: 0, minOrder, nextMinOrder: minOrder, shortfall: 0, options: [{ variationId: 'g1' }], selectedVariationId: null, declined: false, ...o }) as never;

describe('comboAddedCue (câu mốc sau "Thêm cả combo")', () => {
  it('chưa đủ Miễn phí giao hàng: số còn thiếu đọc từ giỏ vừa trả về', () => {
    expect(comboAddedCue(cart())).toEqual({ kind: 'freeship', text: 'Mua thêm 49.000đ để được Miễn phí giao hàng 🚚' });
  });

  it('đủ Miễn phí giao hàng, còn mốc quà: số còn thiếu tới quà dùng thử 0đ', () => {
    expect(comboAddedCue(cart({ lines: [{ total: 220_000 }], giftTrial: gift(299_000) }))).toEqual({ kind: 'gift', text: '🎁 Thêm 79.000đ để nhận quà dùng thử 0đ' });
  });

  it('đủ cả hai mốc, hay không có mốc quà (cờ tắt, khách không nhận quà): câu chúc mừng', () => {
    expect(comboAddedCue(cart({ lines: [{ total: 320_000 }], giftTrial: gift(299_000) }))).toEqual({ kind: 'done', text: GIFT_COMBOS_COPY.cueAllReached });
    expect(comboAddedCue(cart({ lines: [{ total: 220_000 }] }))).toEqual({ kind: 'done', text: '🎉 Đơn hàng đã được Miễn phí giao hàng' });
    expect(comboAddedCue(cart({ lines: [{ total: 220_000 }], giftTrial: gift(299_000, { declined: true }) }))?.kind).toBe('done');
  });

  it('dòng hết hàng không tính; cờ freeship của máy chủ chỉ tin khi không có dòng hết hàng', () => {
    const c = cart({ lines: [{ total: 150_000 }, { total: 100_000, stock: 0 }], freeship: true });
    expect(comboAddedCue(c)).toEqual({ kind: 'freeship', text: 'Mua thêm 49.000đ để được Miễn phí giao hàng 🚚' });
    expect(comboAddedCue(cart({ freeship: true }))?.kind).toBe('done');
  });

  it('giỏ có hàng gian hàng tự giao: chỉ tính phần Tubu Tree giao, câu nói rõ', () => {
    const merchant = { kind: 'MERCHANT', storefrontId: 'sf', name: 'Shop' } as const;
    const c = cart({ lines: [{ total: 120_000 }, { total: 200_000, fulfiller: merchant }], freeship: true });
    expect(comboAddedCue(c)).toEqual({ kind: 'freeship', text: 'Mua thêm 79.000đ để được Miễn phí giao hàng cho phần hàng Tubu Tree giao 🚚' });
  });

  it('giỏ có hàng gian hàng tự giao, phần Tubu Tree đạt cả hai mốc: câu nói phần Tubu Tree giao, không nói cả đơn được miễn phí giao', () => {
    const merchant = { kind: 'MERCHANT', storefrontId: 'sf', name: 'Shop' } as const;
    const c = cart({ lines: [{ total: 320_000 }, { total: 200_000, fulfiller: merchant }], giftTrial: gift(299_000) });
    expect(comboAddedCue(c)).toEqual({ kind: 'done', text: '🎉 Phần hàng Tubu Tree giao đã được Miễn phí giao hàng' });
  });

  it('giỏ hỏng hay thiếu ngưỡng: không nói gì', () => {
    expect(comboAddedCue(undefined)).toBeNull();
    expect(comboAddedCue({ items: [], freeship: false, freeshipThreshold: Number.NaN } as never)).toBeNull();
  });
});

describe('GIFT_COMBOS_COPY', () => {
  it('không thuật ngữ cấm, không tuyên bố, không vượt ngân sách', () => {
    for (const key of Object.keys(GIFT_COMBOS_COPY) as GiftCombosCopyKey[]) {
      const text = giftCombosCopy(key);
      for (const { pattern, use } of FORBIDDEN_TERMS) expect(text, `${key}: dùng "${use}"`).not.toMatch(pattern);
      expect(claimsIn(text), key).toEqual([]);
      expect(text.length, key).toBeLessThanOrEqual(GIFT_COMBOS_COPY_MAX[key]);
    }
  });
});

describe('giftCombosCallouts', () => {
  it('đọc đúng hai mốc máy chủ trả, số có dấu chấm ngăn nghìn', () => {
    expect(giftCombosCallouts(landing())).toEqual([
      { kind: 'freeship', text: 'Miễn phí giao hàng cho đơn từ 199.000đ' },
      { kind: 'gift', text: 'Tặng quà dùng thử 0đ cho đơn từ 299.000đ' },
    ]);
  });

  it('mốc đổi ở cấu hình thì chữ đổi theo (không ghi cứng 199k/299k)', () => {
    expect(giftCombosCallouts(landing({ freeshipThreshold: 250_000, giftTrialMinOrder: 450_000 })).map((c) => c.text)).toEqual([
      'Miễn phí giao hàng cho đơn từ 250.000đ',
      'Tặng quà dùng thử 0đ cho đơn từ 450.000đ',
    ]);
  });

  it('mốc null, 0 hay hỏng thì không hứa', () => {
    expect(giftCombosCallouts(landing({ giftTrialMinOrder: null })).map((c) => c.kind)).toEqual(['freeship']);
    expect(giftCombosCallouts(landing({ freeshipThreshold: null, giftTrialMinOrder: 0 }))).toEqual([]);
    expect(giftCombosCallouts(landing({ freeshipThreshold: Number.NaN }))).toHaveLength(1);
    expect(giftCombosCallouts(undefined)).toEqual([]);
  });
});

describe('giftCombosProducts', () => {
  it('món của các combo, mỗi slug một lần, theo thứ tự hiện trên trang (cho ItemList JSON-LD)', () => {
    const shared = combo('c2', { items: [combo('c1').items[0]!, combo('c2').items[1]!] });
    const views = giftCombosViews(landing({ combos: [combo('c1'), shared] }), NOW);
    expect(giftCombosProducts(views)).toEqual([
      { slug: 'sp-c1-a', name: 'Món c1-a' },
      { slug: 'sp-c1-b', name: 'Món c1-b' },
      { slug: 'sp-c2-b', name: 'Món c2-b' },
    ]);
  });
});
