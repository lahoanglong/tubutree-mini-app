import { describe, expect, it } from 'vitest';
import type { ProductCard } from '../api/catalog';
import type { FlashPriceItem } from '../flash-price';
import { FBT_PARTNER_MAX, buildFrequentlyBoughtBundle, frequentlyBoughtLines, frequentlyBoughtSummary, pickFbtPartners, type FbtCurrent } from './frequently-bought';

const NOW = Date.parse('2026-11-08T03:00:00Z');

const current = (over: Partial<FbtCurrent> = {}): FbtCurrent => ({
  productId: 'p0',
  slug: 'sp-0',
  name: 'Món đang xem',
  thumbnail: null,
  variationId: 'v0',
  price: 100_000,
  compareAt: null,
  inStock: true,
  ...over,
});

const card = (n: number, over: Partial<ProductCard> = {}): ProductCard => ({
  id: `p${n}`,
  slug: `sp-${n}`,
  brand: 'Tubu',
  name: `Món ${n}`,
  thumbnail: null,
  basePrice: 50_000,
  salePrice: null,
  isFeatured: false,
  inStock: true,
  repVariationId: `v${n}`,
  ...over,
});

const flashOn = (n: number, flashPrice: number, over: Partial<FlashPriceItem> = {}): FlashPriceItem => ({
  productSlug: `sp-${n}`,
  variationId: `v${n}-flash`,
  flashPrice,
  endAt: '2026-11-08T05:00:00Z',
  ...over,
});

describe('buildFrequentlyBoughtBundle', () => {
  it('món đang xem đứng đầu rồi 2 món bổ trợ theo thứ tự ứng viên; tổng tính khi chọn hết', () => {
    const b = buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: [card(1), card(2), card(3)] })!;
    expect(FBT_PARTNER_MAX).toBe(2);
    expect(b.lines.map((l) => [l.productId, l.isCurrent])).toEqual([
      ['p0', true],
      ['p1', false],
      ['p2', false],
    ]);
    expect(b).toMatchObject({ count: 3, bundleTotal: 200_000, bundleOriginalTotal: 200_000, bundleSavings: 0 });
  });

  it('truyền limit nhỏ hơn thì ít món hơn; lớn hơn 2 vẫn chỉ 2', () => {
    const cs = [card(1), card(2), card(3)];
    expect(buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: cs, limit: 1 })!.lines).toHaveLength(2);
    expect(buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: cs, limit: 9 })!.lines).toHaveLength(3);
  });

  it('loại món đang xem, món hết hàng, món không có phân loại, món đã có trong giỏ và món lặp', () => {
    const b = buildFrequentlyBoughtBundle({
      now: NOW,
      current: current(),
      cartProductIds: new Set(['p4']),
      candidates: [card(0), card(1, { inStock: false }), card(2, { repVariationId: undefined }), card(4), card(5), card(5), card(6)],
    })!;
    expect(b.lines.slice(1).map((l) => l.productId)).toEqual(['p5', 'p6']);
  });

  it('một món bổ trợ vẫn tạo bộ hai món', () => {
    const b = buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: [card(1)] })!;
    expect(b.lines).toHaveLength(2);
    expect(b.count).toBe(2);
  });

  it('không còn món bổ trợ nào, hoặc ứng viên không phải mảng: null (khối ẩn)', () => {
    expect(buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: [] })).toBeNull();
    expect(buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: null })).toBeNull();
    expect(buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: undefined })).toBeNull();
    expect(buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: { length: 1 } as unknown as ProductCard[] })).toBeNull();
    expect(buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: [card(0), card(1, { inStock: false })] })).toBeNull();
  });

  it('món đang xem hết hàng, chưa có phân loại hay giá không dương: null', () => {
    const cs = [card(1), card(2)];
    expect(buildFrequentlyBoughtBundle({ now: NOW, current: current({ inStock: false }), candidates: cs })).toBeNull();
    expect(buildFrequentlyBoughtBundle({ now: NOW, current: current({ variationId: null }), candidates: cs })).toBeNull();
    expect(buildFrequentlyBoughtBundle({ now: NOW, current: current({ price: 0 }), candidates: cs })).toBeNull();
  });

  it('giá sale của món bổ trợ: gạch giá niêm yết, tính tiết kiệm', () => {
    const b = buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: [card(1, { basePrice: 60_000, salePrice: 45_000 }), card(2)] })!;
    expect(b.lines[1]).toMatchObject({ price: 45_000, compareAt: 60_000 });
    expect(b).toMatchObject({ bundleTotal: 100_000 + 45_000 + 50_000, bundleOriginalTotal: 100_000 + 60_000 + 50_000, bundleSavings: 15_000 });
  });

  it('Giờ vàng đang chạy thắng và thêm phân loại của suất; hết hạn thì giá thường và phân loại đại diện', () => {
    const live = buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: [card(1), card(2)], flash: [flashOn(1, 30_000)] })!;
    expect(live.lines[1]).toMatchObject({ variationId: 'v1-flash', price: 30_000, compareAt: 50_000 });
    const ended = buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: [card(1), card(2)], flash: [flashOn(1, 30_000, { endAt: '2026-11-08T02:00:00Z' })] })!;
    expect(ended.lines[1]).toMatchObject({ variationId: 'v1', price: 50_000, compareAt: null });
  });

  it('món ghim phân loại (CTV) luôn thêm phân loại ghim', () => {
    const b = buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: [card(1, { pinnedVariationId: 'v1-pin' }), card(2)] })!;
    expect(b.lines[1]!.variationId).toBe('v1-pin');
  });

  it('giá món đang xem do nơi gọi truyền (phân loại khách chọn), kể cả giá gạch', () => {
    const b = buildFrequentlyBoughtBundle({ now: NOW, current: current({ price: 70_000, compareAt: 90_000 }), candidates: [card(1), card(2)] })!;
    expect(b.lines[0]).toMatchObject({ price: 70_000, compareAt: 90_000, variationId: 'v0' });
    expect(b.bundleSavings).toBe(20_000);
  });

  it('bỏ ứng viên giá không dương', () => {
    const b = buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: [card(1, { basePrice: 0 }), card(2), card(3)] })!;
    expect(b.lines.slice(1).map((l) => l.productId)).toEqual(['p2', 'p3']);
  });
});

describe('frequentlyBoughtSummary và frequentlyBoughtLines', () => {
  const b = buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: [card(1, { basePrice: 60_000, salePrice: 45_000 }), card(2)] })!;
  const all = new Set(b.lines.map((l) => l.key));

  it('chọn một phần: đếm và cộng đúng các dòng đã chọn', () => {
    const picked = new Set(['v0', 'v1']);
    expect(frequentlyBoughtSummary(b.lines, picked)).toEqual({ count: 2, bundleTotal: 145_000, bundleOriginalTotal: 160_000, bundleSavings: 15_000 });
  });

  it('bỏ chọn hết: tổng 0', () => {
    expect(frequentlyBoughtSummary(b.lines, new Set())).toEqual({ count: 0, bundleTotal: 0, bundleOriginalTotal: 0, bundleSavings: 0 });
  });

  it('chọn hết khớp tổng của bộ', () => {
    const { lines, ...totals } = b;
    expect(lines).toHaveLength(3);
    expect(frequentlyBoughtSummary(b.lines, all)).toEqual(totals);
  });

  it('giá gạch thấp hơn giá khách trả (dữ liệu lạ) không cho ra số tiết kiệm âm', () => {
    const odd = [{ ...b.lines[0]!, price: 100_000, compareAt: 80_000 }];
    expect(frequentlyBoughtSummary(odd, new Set(['v0']))).toMatchObject({ bundleSavings: 0 });
  });

  it('dòng giỏ chỉ gồm món đã chọn, mỗi món một đơn vị, theo thứ tự dòng', () => {
    expect(frequentlyBoughtLines(b.lines, new Set(['v2', 'v0']))).toEqual([
      { variationId: 'v0', quantity: 1 },
      { variationId: 'v2', quantity: 1 },
    ]);
    expect(frequentlyBoughtLines(b.lines, new Set())).toEqual([]);
  });
});

describe('pickFbtPartners', () => {
  it('chọn cùng các món bổ trợ như bộ gợi ý, không cần biết phân loại khách đang chọn', () => {
    const cs = [card(0), card(1), card(2, { inStock: false }), card(3), card(4)];
    const partners = pickFbtPartners({ now: NOW, currentProductId: 'p0', candidates: cs, cartProductIds: new Set(['p3']) });
    expect(partners.map((l) => l.productId)).toEqual(['p1', 'p4']);
    const bundle = buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: cs, cartProductIds: new Set(['p3']) })!;
    expect(bundle.lines.slice(1)).toEqual(partners);
  });

  it('bộ dựng từ partners đã chọn sẵn dùng đúng chúng', () => {
    const partners = pickFbtPartners({ now: NOW, currentProductId: 'p0', candidates: [card(1), card(2)] });
    const bundle = buildFrequentlyBoughtBundle({ now: NOW, current: current(), candidates: [], partners })!;
    expect(bundle.lines.map((l) => l.productId)).toEqual(['p0', 'p1', 'p2']);
  });

  it('không ứng viên hợp lệ thì rỗng', () => {
    expect(pickFbtPartners({ now: NOW, currentProductId: 'p0', candidates: [card(0)] })).toEqual([]);
  });
});
