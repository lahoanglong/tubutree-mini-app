import { describe, expect, it } from 'vitest';
import type { ProductCard } from '../api/catalog';
import type { FlashPriceItem } from '../flash-price';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { pickCardFlash, productCardView } from './product-card-view';
import type { MyRestockAlerts } from '../api/restock-alerts';
import { applyRestockToggle, isInStock, isOnSale, restockWatchIndex, wishlistFilterView, wishlistRestockView, type WishlistFilterItem } from './wishlist-filter';

const NOW = Date.parse('2026-11-08T05:00:00Z');
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const item = (basePrice: number, salePrice: number | null, inStock: boolean | undefined, id = 'p'): WishlistFilterItem & { id: string } => ({
  id,
  slug: id,
  basePrice,
  salePrice,
  inStock: inStock as boolean,
});

const MIXED = [
  item(100_000, 80_000, true, 'sale-in'),
  item(100_000, null, true, 'full-in'),
  item(100_000, 70_000, false, 'sale-out'),
  item(100_000, null, false, 'full-out'),
];

describe('isOnSale', () => {
  it('chỉ khi giá khuyến mãi dương và thấp hơn giá gốc', () => {
    expect(isOnSale({ slug: 'p', basePrice: 100_000, salePrice: 99_000 })).toBe(true);
  });
  it.each([
    ['không có giá khuyến mãi', null],
    ['giá khuyến mãi 0', 0],
    ['giá khuyến mãi âm', -5],
    ['bằng giá gốc', 100_000],
    ['cao hơn giá gốc', 120_000],
    ['không phải số hữu hạn', Number.NaN],
  ])('không tính khi %s', (_name, salePrice) => {
    expect(isOnSale({ slug: 'p', basePrice: 100_000, salePrice })).toBe(false);
  });
  it('giá gốc hỏng thì không tính là giảm', () => {
    expect(isOnSale({ slug: 'p', basePrice: Number.NaN, salePrice: 50_000 })).toBe(false);
  });
});

describe('isInStock', () => {
  it('chỉ false rõ ràng mới là hết hàng; thiếu cờ coi như còn', () => {
    expect(isInStock({ inStock: true })).toBe(true);
    expect(isInStock({ inStock: false })).toBe(false);
    expect(isInStock({ inStock: undefined as unknown as boolean })).toBe(true);
  });
});

describe('wishlistFilterView', () => {
  it('ba chip theo thứ tự Tất cả, Đang giảm, Còn hàng, số đếm trên toàn danh sách, chip đang chọn đánh dấu', () => {
    const v = wishlistFilterView(MIXED, 'all');
    expect(v.chips.map((c) => [c.key, c.label, c.count, c.selected])).toEqual([
      ['all', 'Tất cả', 4, true],
      ['sale', 'Đang giảm', 2, false],
      ['inStock', 'Còn hàng', 2, false],
    ]);
    expect(v.groupAria).toBe('Lọc sản phẩm yêu thích');
    expect(v.items).toHaveLength(4);
    expect(v.empty).toBeNull();
  });

  it('số trên chip không đổi theo bộ lọc đang chọn, chỉ cờ selected đổi', () => {
    const counts = (key: 'all' | 'sale' | 'inStock') => wishlistFilterView(MIXED, key).chips.map((c) => c.count);
    expect(counts('sale')).toEqual(counts('all'));
    expect(counts('inStock')).toEqual(counts('all'));
    expect(wishlistFilterView(MIXED, 'sale').chips.map((c) => c.selected)).toEqual([false, true, false]);
  });

  it('lọc Đang giảm và Còn hàng giữ đúng món, đúng thứ tự gốc', () => {
    expect(wishlistFilterView(MIXED, 'sale').items.map((p) => p.id)).toEqual(['sale-in', 'sale-out']);
    expect(wishlistFilterView(MIXED, 'inStock').items.map((p) => p.id)).toEqual(['sale-in', 'full-in']);
  });

  it('lọc ra rỗng khi danh sách còn món: có câu báo theo bộ lọc và nút về Tất cả', () => {
    const noSale = [item(100_000, null, true), item(100_000, 100_000, true)];
    const sale = wishlistFilterView(noSale, 'sale');
    expect(sale.items).toEqual([]);
    expect(sale.empty).toEqual({ message: 'Chưa có sản phẩm đang giảm giá trong danh sách yêu thích', ctaLabel: 'Xem tất cả sản phẩm đã lưu' });

    const allOut = [item(100_000, null, false)];
    expect(wishlistFilterView(allOut, 'inStock').empty).toEqual({
      message: 'Chưa có sản phẩm còn hàng trong danh sách yêu thích',
      ctaLabel: 'Xem tất cả sản phẩm đã lưu',
    });
  });

  it('Tất cả không bao giờ rỗng khi danh sách còn món; danh sách gốc rỗng thì không có lời báo lọc', () => {
    expect(wishlistFilterView(MIXED, 'all').empty).toBeNull();
    for (const key of ['all', 'sale', 'inStock'] as const) {
      const v = wishlistFilterView([], key);
      expect(v.items).toEqual([]);
      expect(v.empty).toBeNull();
    }
  });

  it('chữ không dính thuật ngữ cấm', () => {
    const v = wishlistFilterView([item(100_000, null, true)], 'sale');
    const text = [v.groupAria, ...v.chips.map((c) => c.label), v.empty!.message, v.empty!.ctaLabel].join(' | ');
    for (const t of FORBIDDEN_TERMS) expect(text, String(t.pattern)).not.toMatch(t.pattern);
  });
});

const flash = (over: Partial<FlashPriceItem> = {}): FlashPriceItem => ({
  productSlug: 'p',
  variationId: 'v1',
  flashPrice: 70_000,
  endAt: iso(NOW + H),
  ...over,
});

describe('Giờ vàng trong "Đang giảm"', () => {
  it('món không có giá khuyến mãi nhưng có suất Giờ vàng đang chạy rẻ hơn thì tính là đang giảm', () => {
    expect(isOnSale(item(100_000, null, true), [flash()], NOW)).toBe(true);
  });

  it('không truyền danh sách Giờ vàng thì chỉ xét giá khuyến mãi', () => {
    expect(isOnSale(item(100_000, null, true), undefined, NOW)).toBe(false);
    expect(isOnSale(item(100_000, 80_000, true), undefined, NOW)).toBe(true);
  });

  it('suất đã hết hạn hoặc đúng giây hết hạn thì không tính', () => {
    expect(isOnSale(item(100_000, null, true), [flash({ endAt: iso(NOW - 1) })], NOW)).toBe(false);
    expect(isOnSale(item(100_000, null, true), [flash({ endAt: iso(NOW) })], NOW)).toBe(false);
    expect(isOnSale(item(100_000, null, true), [flash({ endAt: iso(NOW + 1) })], NOW)).toBe(true);
  });

  it('suất không rẻ hơn giá đang bán của thẻ thì không tính', () => {
    expect(isOnSale(item(100_000, null, true), [flash({ flashPrice: 100_000 })], NOW)).toBe(false);
    expect(isOnSale(item(100_000, null, true), [flash({ flashPrice: 120_000 })], NOW)).toBe(false);
    expect(isOnSale(item(100_000, 60_000, true), [flash({ flashPrice: 70_000 })], NOW)).toBe(true);
  });

  it('suất của sản phẩm khác không làm món này thành đang giảm', () => {
    expect(isOnSale(item(100_000, null, true, 'a'), [flash({ productSlug: 'b' })], NOW)).toBe(false);
  });

  it('món gian hàng CTV ghim phân loại chỉ tính suất của đúng phân loại đó', () => {
    const pinned = { ...item(100_000, null, true), pinnedVariationId: 'v2' };
    expect(isOnSale(pinned, [flash({ variationId: 'v1' })], NOW)).toBe(false);
    expect(isOnSale(pinned, [flash({ variationId: 'v2' })], NOW)).toBe(true);
  });

  it('chip, lưới và lời báo rỗng đều theo Giờ vàng: món chỉ giảm nhờ Giờ vàng nằm trong Đang giảm', () => {
    const list = [item(100_000, null, true, 'flash-only'), item(100_000, 80_000, true, 'sale'), item(100_000, null, true, 'plain')];
    const flashes = [flash({ productSlug: 'flash-only' })];
    const v = wishlistFilterView(list, 'sale', flashes, NOW);
    expect(v.chips.map((c) => c.count)).toEqual([3, 2, 3]);
    expect(v.items.map((p) => p.id)).toEqual(['flash-only', 'sale']);
    expect(wishlistFilterView(list, 'all', flashes, NOW).chips[1]!.count).toBe(2);
  });

  it('cùng danh sách, qua mốc hết giờ thì số đếm và lưới tự bỏ món Giờ vàng, lọc ra rỗng thì có lời báo', () => {
    const list = [item(100_000, null, true, 'flash-only')];
    const flashes = [flash({ productSlug: 'flash-only', endAt: iso(NOW + H) })];
    expect(wishlistFilterView(list, 'sale', flashes, NOW).items).toHaveLength(1);
    const after = wishlistFilterView(list, 'sale', flashes, NOW + H);
    expect(after.chips[1]!.count).toBe(0);
    expect(after.items).toEqual([]);
    expect(after.empty?.message).toBe('Chưa có sản phẩm đang giảm giá trong danh sách yêu thích');
  });

  it('Còn hàng không bị Giờ vàng đổi: món hết hàng có Giờ vàng vẫn nằm ở Đang giảm, không nằm ở Còn hàng', () => {
    const list = [item(100_000, null, false, 'out')];
    const v = wishlistFilterView(list, 'all', [flash({ productSlug: 'out' })], NOW);
    expect(v.chips.map((c) => c.count)).toEqual([1, 1, 0]);
  });

  it('khớp thẻ: "đang giảm" đúng khi thẻ có nhãn giảm (isDeal), qua cùng suất mà thẻ chọn', () => {
    const card = (over: Partial<ProductCard>): ProductCard => ({
      id: 'x',
      slug: 'x',
      brand: 'Tubu',
      name: 'Món thử',
      thumbnail: null,
      basePrice: 100_000,
      salePrice: null,
      isFeatured: false,
      inStock: true,
      ...over,
    });
    const cards = [
      card({}),
      card({ salePrice: 80_000 }),
      card({ salePrice: 100_000 }),
      card({ salePrice: 0 }),
      card({ repVariationId: 'v1' }),
      card({ pinnedVariationId: 'v9' }),
    ];
    const lists: FlashPriceItem[][] = [
      [],
      [flash({ productSlug: 'x' })],
      [flash({ productSlug: 'x', endAt: iso(NOW - H) })],
      [flash({ productSlug: 'x', flashPrice: 100_000 })],
      [flash({ productSlug: 'x', variationId: 'v1', flashPrice: 60_000 }), flash({ productSlug: 'x', variationId: 'v2', flashPrice: 50_000 })],
      [flash({ productSlug: 'y' })],
    ];
    for (const c of cards) {
      for (const list of lists) {
        const view = productCardView({ product: c, flash: pickCardFlash(c, list, NOW), variant: 'grid', now: NOW });
        expect(isOnSale(c, list, NOW), JSON.stringify({ c, list })).toBe(view.isDeal);
      }
    }
  });
});

describe('Chờ hàng về: chip, nhãn và chuông trên thẻ hết hàng', () => {
  const alert = (productId: string, variationId: string) => ({ variationId, productId, productSlug: productId, productName: productId, variationName: 'Loại', stock: 0, createdAt: iso(NOW) });
  const alerts = (...items: ReturnType<typeof alert>[]): MyRestockAlerts => ({ enabled: true, items });
  const card = (id: string, inStock: boolean, rep?: string, pinned?: string) => ({ ...item(100_000, null, inStock, id), ...(rep ? { repVariationId: rep } : {}), ...(pinned ? { pinnedVariationId: pinned } : {}) });

  it('không có đăng ký nào (hoặc cờ tắt, chưa tải): không có chip "Chờ hàng về", ba chip như cũ', () => {
    for (const a of [undefined, alerts(), { enabled: false, items: [alert('full-out', 'v1')] }]) {
      const v = wishlistFilterView(MIXED, 'all', [], NOW, restockWatchIndex(a));
      expect(v.chips.map((c) => c.key)).toEqual(['all', 'sale', 'inStock']);
    }
  });

  it('có món hết hàng đang chờ: chip thứ tư đếm đúng các thẻ mang nhãn, lọc ra đúng các thẻ đó', () => {
    // sale-in còn hàng: đăng ký đang chờ (hàng vừa về, cron chưa gửi) không làm thẻ mang nhãn nên không đếm.
    const watch = restockWatchIndex(alerts(alert('full-out', 'v1'), alert('full-out', 'v2'), alert('sale-out', 'v3'), alert('sale-in', 'v4'), alert('gone', 'v5')));
    const v = wishlistFilterView(MIXED, 'restock', [], NOW, watch);
    expect(v.active).toBe('restock');
    expect(v.chips.map((c) => [c.key, c.label, c.count, c.selected])).toEqual([
      ['all', 'Tất cả', 4, false],
      ['sale', 'Đang giảm', 2, false],
      ['inStock', 'Còn hàng', 2, false],
      ['restock', 'Chờ hàng về', 2, true],
    ]);
    expect(v.items.map((p) => p.id)).toEqual(['sale-out', 'full-out']);
    expect(v.empty).toBeNull();
    const badged = MIXED.filter((p) => wishlistRestockView(p, alerts(alert('full-out', 'v1'), alert('sale-out', 'v3'), alert('sale-in', 'v4')), watch).kind === 'waiting');
    expect(badged.map((p) => p.id)).toEqual(v.items.map((p) => p.id));
  });

  it('đang chọn "Chờ hàng về" mà huỷ món cuối: chip biến mất và lọc về Tất cả (nơi gọi đặt lại state theo `active`)', () => {
    const before = alerts(alert('full-out', 'v1'));
    const view = wishlistRestockView(card('full-out', false, 'v1'), before);
    expect(view).toEqual({ kind: 'waiting', variationIds: ['v1'] });
    const after = applyRestockToggle(before, 'full-out', view as Exclude<typeof view, { kind: 'none' }>);
    expect(after.items).toEqual([]);
    const v = wishlistFilterView(MIXED, 'restock', [], NOW, restockWatchIndex(after));
    expect(v.active).toBe('all');
    expect(v.chips.map((c) => c.key)).toEqual(['all', 'sale', 'inStock']);
    expect(v.chips[0]!.selected).toBe(true);
    expect(v.items).toHaveLength(4);
  });

  it('vòng đăng ký → nhãn → huỷ trên một thẻ: phân loại ghim trước phân loại đại diện; huỷ gỡ mọi phân loại đang chờ của sản phẩm', () => {
    const p = card('full-out', false, 'vRep', 'vPin');
    let state = alerts(alert('other', 'vX'));
    const sub = wishlistRestockView(p, state);
    expect(sub).toEqual({ kind: 'subscribe', variationId: 'vPin' });
    state = applyRestockToggle(state, p.id, sub as Exclude<typeof sub, { kind: 'none' }>, NOW);
    expect(state.items.map((a) => [a.productId, a.variationId])).toEqual([['other', 'vX'], ['full-out', 'vPin']]);
    // Gọi lại khi đã có dòng (bấm đúp) không thêm dòng thứ hai.
    expect(applyRestockToggle(state, p.id, sub as Exclude<typeof sub, { kind: 'none' }>, NOW)).toBe(state);
    // Phân loại khác của cùng sản phẩm đăng ký ở trang chi tiết: một chạm trên thẻ huỷ cả hai.
    state = { ...state, items: [...state.items, alert('full-out', 'vOther')] };
    const waiting = wishlistRestockView(p, state);
    expect(waiting).toEqual({ kind: 'waiting', variationIds: ['vPin', 'vOther'] });
    state = applyRestockToggle(state, p.id, waiting as Exclude<typeof waiting, { kind: 'none' }>);
    expect(state.items.map((a) => a.variationId)).toEqual(['vX']);
    expect(wishlistRestockView(p, state)).toEqual({ kind: 'subscribe', variationId: 'vPin' });
  });

  it('không có chuông: thẻ còn hàng, cờ tắt, chưa tải, hoặc thẻ không mang phân loại nào', () => {
    expect(wishlistRestockView(card('a', true, 'v1'), alerts())).toEqual({ kind: 'none' });
    expect(wishlistRestockView(card('a', undefined as unknown as boolean, 'v1'), alerts())).toEqual({ kind: 'none' });
    expect(wishlistRestockView(card('a', false, 'v1'), { enabled: false, items: [] })).toEqual({ kind: 'none' });
    expect(wishlistRestockView(card('a', false, 'v1'), undefined)).toEqual({ kind: 'none' });
    expect(wishlistRestockView(card('a', false), alerts())).toEqual({ kind: 'none' });
    expect(wishlistRestockView(card('a', false, 'v1'), alerts())).toEqual({ kind: 'subscribe', variationId: 'v1' });
  });

  it('chữ mới không dính thuật ngữ cấm', () => {
    const v = wishlistFilterView(MIXED, 'restock', [], NOW, restockWatchIndex(alerts(alert('full-out', 'v1'))));
    const text = v.chips.map((c) => c.label).join(' | ');
    expect(FORBIDDEN_TERMS.filter((t) => t.pattern.test(text))).toEqual([]);
  });
});
