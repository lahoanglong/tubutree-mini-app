import { describe, expect, it } from 'vitest';
import type { BundleDTO, GiftLanding } from '../api/bundle';
import type { ProductCard } from '../api/catalog';
import { GIFT_COMBOS_MAX, giftCombosCallouts, giftCombosProducts, giftCombosViews } from './gift-combos';

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
