import { describe, expect, it } from 'vitest';
import type { FlashPriceItem } from '@tubutree/app-core/flash-price';
import type { ProductCard } from '../services/shop-api';
import { cardAddTarget } from './card-add-target';

const NOW = Date.parse('2026-11-07T10:00:00Z');
const card = (over: Partial<ProductCard> = {}): ProductCard => ({
  id: 'p1',
  slug: 'rau-cu',
  brand: 'Tubu',
  name: 'Rau củ',
  thumbnail: null,
  basePrice: 50_000,
  salePrice: null,
  repVariationId: 'v-rep',
  isFeatured: false,
  inStock: true,
  ...over,
});
const flash = (over: Partial<FlashPriceItem> = {}): FlashPriceItem => ({
  productSlug: 'rau-cu',
  variationId: 'v-flash',
  flashPrice: 30_000,
  retailPrice: 50_000,
  endAt: '2026-11-07T12:00:00Z',
  ...over,
});

describe('cardAddTarget', () => {
  it('không có Giờ vàng: phân loại đại diện, giá = giá thẻ', () => {
    expect(cardAddTarget(card(), [], NOW)).toEqual({ variationId: 'v-rep', price: 50_000, compareAt: null });
  });

  it('giá đang bán thấp hơn giá gốc: giá bán và giá gạch là giá gốc', () => {
    const t = cardAddTarget(card({ salePrice: 40_000 }), [], NOW);
    expect(t.price).toBe(40_000);
    expect(t.compareAt).toBe(50_000);
    expect(t.variationId).toBe('v-rep');
  });

  it('Giờ vàng thắng: thêm phân loại của suất, giá = giá Giờ vàng (khách trả đúng số đang hiện)', () => {
    const t = cardAddTarget(card(), [flash()], NOW);
    expect(t.variationId).toBe('v-flash');
    expect(t.price).toBe(30_000);
    expect(t.compareAt).toBe(50_000);
  });

  it('suất Giờ vàng đã quá hạn theo giờ máy chủ: bỏ, về phân loại đại diện', () => {
    const t = cardAddTarget(card(), [flash({ endAt: '2026-11-07T09:00:00Z' })], NOW);
    expect(t).toEqual({ variationId: 'v-rep', price: 50_000, compareAt: null });
  });

  it('suất Giờ vàng của sản phẩm khác không ảnh hưởng', () => {
    const t = cardAddTarget(card(), [flash({ productSlug: 'khac' })], NOW);
    expect(t.variationId).toBe('v-rep');
  });

  it('Giờ vàng đắt hơn giá thẻ: không thắng, giữ phân loại đại diện', () => {
    const t = cardAddTarget(card(), [flash({ flashPrice: 60_000 })], NOW);
    expect(t.variationId).toBe('v-rep');
    expect(t.price).toBe(50_000);
  });

  it('món CTV ghim phân loại: luôn phân loại ghim, kể cả khi có Giờ vàng', () => {
    expect(cardAddTarget(card({ pinnedVariationId: 'v-pin' }), [flash()], NOW).variationId).toBe('v-pin');
    expect(cardAddTarget(card({ pinnedVariationId: 'v-pin' }), [], NOW).variationId).toBe('v-pin');
  });

  it('thẻ từ API cũ không có phân loại nào: variationId null (nơi gọi tự chọn theo chi tiết)', () => {
    expect(cardAddTarget(card({ repVariationId: undefined }), [], NOW).variationId).toBeNull();
  });
});
