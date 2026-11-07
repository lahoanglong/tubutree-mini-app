import { describe, expect, it } from 'vitest';
import type { ProductCard } from '../api/catalog';
import type { PurchasedItem } from '../api/orders';
import type { FlashPriceItem } from '../flash-price';
import { QUICK_REORDER_MAX, QUICK_REORDER_MIN, buildQuickReorderItems, quickReorderAvailable, quickReorderLines, quickReorderShelfItems, quickReorderTotal } from './quick-reorder';

const NOW = Date.parse('2026-11-08T03:00:00Z');

const bought = (n: number, over: Partial<PurchasedItem> = {}): PurchasedItem => ({
  variationId: `v${n}`,
  productId: `p${n}`,
  slug: `sp-${n}`,
  productName: `Sản phẩm ${n}`,
  variationName: '',
  brand: 'Tubu',
  thumbnail: `/img/${n}.jpg`,
  price: 100_000,
  salePrice: null,
  stock: 10,
  inStock: true,
  timesBought: 1,
  lastPurchasedAt: '2026-11-01T00:00:00Z',
  ...over,
});

const viewed = (n: number, over: Partial<ProductCard> = {}): ProductCard => ({
  id: `p${n}`,
  slug: `sp-${n}`,
  brand: 'Tubu',
  name: `Sản phẩm ${n}`,
  thumbnail: null,
  basePrice: 80_000,
  salePrice: null,
  isFeatured: false,
  inStock: true,
  repVariationId: `v${n}`,
  ...over,
});

const flashOn = (n: number, flashPrice: number, over: Partial<FlashPriceItem> = {}): FlashPriceItem => ({
  productSlug: `sp-${n}`,
  variationId: `v${n}`,
  flashPrice,
  endAt: '2026-11-08T05:00:00Z',
  ...over,
});

describe('buildQuickReorderItems: món đã mua', () => {
  it('giữ thứ tự nguồn (mới nhất trước), tên kèm phân loại và số lần đã đặt', () => {
    const items = buildQuickReorderItems({ now: NOW, purchased: [bought(1, { variationName: '500ml', timesBought: 4 }), bought(2)] });
    expect(items.map((i) => i.variationId)).toEqual(['v1', 'v2']);
    expect(items[0]).toMatchObject({ name: 'Sản phẩm 1 · 500ml', timesBought: 4, source: 'purchased', productId: 'p1', slug: 'sp-1', price: 100_000, compareAt: null, savePct: 0 });
    expect(items[1]!.name).toBe('Sản phẩm 2');
  });

  it('trần 6 món, kể cả khi truyền limit lớn hơn', () => {
    const many = Array.from({ length: 9 }, (_, i) => bought(i + 1));
    expect(buildQuickReorderItems({ now: NOW, purchased: many })).toHaveLength(QUICK_REORDER_MAX);
    expect(buildQuickReorderItems({ now: NOW, purchased: many, limit: 20 })).toHaveLength(QUICK_REORDER_MAX);
    expect(buildQuickReorderItems({ now: NOW, purchased: many, limit: 3 })).toHaveLength(3);
  });

  it('bỏ món hết hàng (cờ inStock hoặc tồn 0) trước khi cắt trần', () => {
    const items = buildQuickReorderItems({
      now: NOW,
      purchased: [bought(1, { inStock: false }), bought(2, { stock: 0 }), bought(3), bought(4), bought(5)],
    });
    expect(items.map((i) => i.variationId)).toEqual(['v3', 'v4', 'v5']);
  });

  it('dưới sàn 2 món thì trả rỗng (dải ẩn)', () => {
    expect(QUICK_REORDER_MIN).toBe(2);
    expect(buildQuickReorderItems({ now: NOW, purchased: [bought(1)] })).toEqual([]);
    expect(buildQuickReorderItems({ now: NOW, purchased: [bought(1), bought(2, { inStock: false })] })).toEqual([]);
  });

  it('loại phân loại đang ở kệ Giờ vàng và phân loại lặp', () => {
    const items = buildQuickReorderItems({
      now: NOW,
      purchased: [bought(1), bought(2), bought(2), bought(3)],
      excludeVariationIds: new Set(['v1']),
    });
    expect(items.map((i) => i.variationId)).toEqual(['v2', 'v3']);
  });

  it('một sản phẩm đã mua hai phân loại là hai thẻ', () => {
    const items = buildQuickReorderItems({
      now: NOW,
      purchased: [bought(1, { variationId: 'v1a', variationName: '1L' }), bought(1, { variationId: 'v1b', variationName: '5L' })],
    });
    expect(items.map((i) => i.key)).toEqual(['v1a', 'v1b']);
  });

  it('giá sale của phân loại: gạch giá niêm yết, phần trăm làm tròn', () => {
    const [a] = buildQuickReorderItems({ now: NOW, purchased: [bought(1, { price: 100_000, salePrice: 80_000 }), bought(2)] });
    expect(a).toMatchObject({ price: 80_000, compareAt: 100_000, savePct: 20, isFlash: false });
  });

  it('Giờ vàng đang chạy thắng khi rẻ hơn giá bán, và tính phần trăm tiết kiệm', () => {
    const [a, b] = buildQuickReorderItems({ now: NOW, purchased: [bought(1), bought(2)], flash: [flashOn(1, 60_000)] });
    expect(a).toMatchObject({ price: 60_000, compareAt: 100_000, savePct: 40, isFlash: true });
    expect(b).toMatchObject({ price: 100_000, isFlash: false });
  });

  it('Giờ vàng đã quá hạn theo giờ máy chủ không được áp', () => {
    const [a] = buildQuickReorderItems({ now: NOW, purchased: [bought(1), bought(2)], flash: [flashOn(1, 60_000, { endAt: '2026-11-08T02:59:59Z' })] });
    expect(a).toMatchObject({ price: 100_000, isFlash: false });
  });

  it('hết suất Giờ vàng của khách (flashAllowance = 0): giỏ tính giá thường nên thẻ cũng ghi giá thường', () => {
    const [a] = buildQuickReorderItems({ now: NOW, purchased: [bought(1, { flashAllowance: 0 }), bought(2)], flash: [flashOn(1, 60_000)] });
    expect(a).toMatchObject({ price: 100_000, isFlash: false });
  });

  it('giỏ đã có đủ suất Giờ vàng còn lại (flashAllowance 1, giỏ 1): thêm 1 nữa vượt suất nên thẻ ghi giá thường', () => {
    const items = buildQuickReorderItems({
      now: NOW,
      purchased: [bought(1, { flashAllowance: 1, flashPrice: 60_000 }), bought(2)],
      flash: [flashOn(1, 60_000)],
      cartUnits: new Map([['v1', 1]]),
    });
    expect(items[0]).toMatchObject({ price: 100_000, compareAt: null, isFlash: false });
  });

  it('giỏ chưa có món: còn suất thì vẫn ghi giá Giờ vàng', () => {
    const items = buildQuickReorderItems({
      now: NOW,
      purchased: [bought(1, { flashAllowance: 1, flashPrice: 60_000 }), bought(2)],
      flash: [flashOn(1, 60_000)],
      cartUnits: new Map([['v9', 4]]),
    });
    expect(items[0]).toMatchObject({ price: 60_000, isFlash: true });
  });

  it('API cũ (không gửi flashAllowance): giới hạn mỗi khách của danh sách Giờ vàng và số trong giỏ quyết định', () => {
    const base = { now: NOW, purchased: [bought(1), bought(2)], flash: [flashOn(1, 60_000, { perUserLimit: 2 })] };
    expect(buildQuickReorderItems({ ...base, cartUnits: new Map([['v1', 1]]) })[0]).toMatchObject({ price: 60_000, isFlash: true });
    expect(buildQuickReorderItems({ ...base, cartUnits: new Map([['v1', 2]]) })[0]).toMatchObject({ price: 100_000, isFlash: false });
  });

  it('Giờ vàng chỉ áp cho đúng phân loại đã mua', () => {
    const [a] = buildQuickReorderItems({
      now: NOW,
      purchased: [bought(1, { variationId: 'v1b' }), bought(2)],
      flash: [flashOn(1, 60_000, { variationId: 'v1a' })],
    });
    expect(a).toMatchObject({ price: 100_000, isFlash: false });
  });

  it('khách đã có món đã mua thì không dùng món vừa xem, kể cả khi toàn món hết hàng', () => {
    expect(buildQuickReorderItems({ now: NOW, purchased: [bought(1, { inStock: false })], viewed: [viewed(8), viewed(9)] })).toEqual([]);
  });

  it('bỏ dòng giá không dương', () => {
    expect(buildQuickReorderItems({ now: NOW, purchased: [bought(1, { price: 0 }), bought(2), bought(3)] }).map((i) => i.variationId)).toEqual(['v2', 'v3']);
  });
});

describe('buildQuickReorderItems: món vừa xem (khách chưa có đơn)', () => {
  it('dùng thẻ vừa xem với phân loại đại diện, timesBought 0', () => {
    const items = buildQuickReorderItems({ now: NOW, viewed: [viewed(1), viewed(2)] });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ variationId: 'v1', source: 'viewed', timesBought: 0, price: 80_000 });
  });

  it('bỏ thẻ hết hàng và thẻ không có phân loại để thêm', () => {
    const items = buildQuickReorderItems({
      now: NOW,
      viewed: [viewed(1, { inStock: false }), viewed(2, { repVariationId: undefined }), viewed(3), viewed(4)],
    });
    expect(items.map((i) => i.productId)).toEqual(['p3', 'p4']);
  });

  it('món ghim phân loại thêm phân loại ghim; suất Giờ vàng thắng thì thêm phân loại của suất đó', () => {
    const items = buildQuickReorderItems({
      now: NOW,
      viewed: [viewed(1, { pinnedVariationId: 'v1-pin' }), viewed(2, { repVariationId: 'v2-rep' })],
      flash: [flashOn(2, 50_000, { variationId: 'v2-flash' })],
    });
    expect(items[0]!.variationId).toBe('v1-pin');
    expect(items[1]).toMatchObject({ variationId: 'v2-flash', price: 50_000, isFlash: true });
  });

  it('không có nguồn nào thì rỗng, không ném', () => {
    expect(buildQuickReorderItems({ now: NOW })).toEqual([]);
    expect(buildQuickReorderItems({ now: NOW, purchased: [], viewed: [] })).toEqual([]);
  });
});

describe('dòng giỏ và tổng của cả dải', () => {
  const items = buildQuickReorderItems({ now: NOW, purchased: [bought(1, { price: 100_000, salePrice: 90_000 }), bought(2, { price: 50_000 })], flash: [flashOn(2, 40_000)] });

  it('mỗi món một đơn vị, đúng phân loại', () => {
    expect(quickReorderLines(items)).toEqual([
      { variationId: 'v1', quantity: 1 },
      { variationId: 'v2', quantity: 1 },
    ]);
  });

  it('tổng là tổng giá khách trả đang hiện', () => {
    expect(quickReorderTotal(items)).toBe(90_000 + 40_000);
    expect(quickReorderTotal([])).toBe(0);
  });
});

describe('quickReorderAvailable', () => {
  it('còn hàng, có tồn và có giá', () => {
    expect(quickReorderAvailable(bought(1))).toBe(true);
    expect(quickReorderAvailable(bought(1, { inStock: false }))).toBe(false);
    expect(quickReorderAvailable(bought(1, { stock: 0 }))).toBe(false);
    expect(quickReorderAvailable(bought(1, { price: 0, salePrice: null }))).toBe(false);
    expect(quickReorderAvailable(bought(1, { price: 0, salePrice: 5_000 }))).toBe(true);
  });

  it('khớp đúng tập món dải vẽ khi chưa chạm trần: không món nào dải vẽ mà vị từ loại, và ngược lại', () => {
    const list = [bought(1, { inStock: false }), bought(2), bought(3, { stock: 0 }), bought(4), bought(5, { price: 0, salePrice: null }), bought(6)];
    const drawn = buildQuickReorderItems({ now: NOW, purchased: list }).map((i) => i.variationId);
    expect(drawn).toEqual(list.filter(quickReorderAvailable).map((p) => p.variationId));
  });
});

describe('quickReorderShelfItems', () => {
  it('đủ 2 món dùng được: kệ chỉ giữ món dùng được (đúng tập dải vẽ)', () => {
    const list = [bought(1, { inStock: false }), bought(2), bought(3, { stock: 0 }), bought(4)];
    expect(quickReorderShelfItems(list).map((p) => p.variationId)).toEqual(['v2', 'v4']);
  });

  it('dưới 2 món dùng được: dải ẩn nên kệ cũ vẽ đủ, kể cả món hết hàng', () => {
    const one = [bought(1, { stock: 0 })];
    expect(quickReorderShelfItems(one)).toEqual(one);
    const mixed = [bought(1), bought(2, { inStock: false })];
    expect(quickReorderShelfItems(mixed).map((p) => p.variationId)).toEqual(['v1', 'v2']);
    expect(quickReorderShelfItems([])).toEqual([]);
  });

  it('không đổi thứ tự nguồn và trả bản sao (không sửa mảng vào)', () => {
    const list = [bought(2), bought(1)];
    const out = quickReorderShelfItems(list);
    expect(out.map((p) => p.variationId)).toEqual(['v2', 'v1']);
    expect(out).not.toBe(list);
  });
});
