import { describe, expect, it } from 'vitest';
import type { FlashPriceItem } from '../flash-price';
import { addOneCardPricing, addOneVariationPricing } from './add-one-pricing';

const NOW = Date.parse('2026-11-08T03:00:00Z');
const V = { id: 'v1', retailPrice: 80_000, salePrice: null };

const flash = (over: Partial<FlashPriceItem> = {}): FlashPriceItem => ({
  productSlug: 'sp-1',
  variationId: 'v1',
  flashPrice: 50_000,
  retailPrice: 80_000,
  salePrice: null,
  endAt: '2026-11-08T05:00:00Z',
  ...over,
});

describe('addOneVariationPricing', () => {
  it('còn suất: giá Giờ vàng, gạch giá bán', () => {
    expect(addOneVariationPricing(V, [flash({ perUserLimit: 3 })], 1)).toEqual({ price: 50_000, compareAt: 80_000 });
  });

  it('giỏ đã đủ suất (có 1, suất 1): thêm 1 nữa vượt, cả dòng giá thường, không gạch', () => {
    expect(addOneVariationPricing(V, [flash({ perUserLimit: 1 })], 1)).toEqual({ price: 80_000, compareAt: null });
  });

  it('đã dùng hết suất ở các đơn trước (perUserLeft 0): giá thường', () => {
    expect(addOneVariationPricing(V, [flash({ perUserLeft: 0 })], 0)).toEqual({ price: 80_000, compareAt: null });
  });

  it('chưa biết giới hạn: coi là đủ suất như giỏ (máy chủ tính lại lúc thêm)', () => {
    expect(addOneVariationPricing(V, [flash()], 5)).toEqual({ price: 50_000, compareAt: 80_000 });
  });

  it('không có suất: giá đang bán, gạch giá niêm yết khi sale', () => {
    expect(addOneVariationPricing({ ...V, salePrice: 70_000 }, [], 0)).toEqual({ price: 70_000, compareAt: 80_000 });
  });

  it('chưa tải giỏ (inCart thiếu) coi như 0', () => {
    expect(addOneVariationPricing(V, [flash({ perUserLimit: 1 })])).toEqual({ price: 50_000, compareAt: 80_000 });
  });
});

describe('addOneCardPricing', () => {
  const card = { slug: 'sp-1', basePrice: 80_000, salePrice: null, repVariationId: 'v1-rep' };

  it('Giờ vàng thắng: thêm phân loại của suất', () => {
    expect(addOneCardPricing(card, [flash({ variationId: 'v1-flash' })], NOW)).toMatchObject({ price: 50_000, compareAt: 80_000, variationId: 'v1-flash', isFlash: true });
  });

  it('khách hết suất: thẻ về giá thường và phân loại đại diện', () => {
    const r = addOneCardPricing(card, [flash({ variationId: 'v1-flash', perUserLeft: 0 })], NOW);
    expect(r).toMatchObject({ price: 80_000, compareAt: null, variationId: 'v1-rep', isFlash: false, salePct: 0 });
  });

  it('suất đã quá hạn theo giờ máy chủ: giá thường', () => {
    expect(addOneCardPricing(card, [flash({ endAt: '2026-11-08T02:00:00Z' })], NOW)).toMatchObject({ price: 80_000, isFlash: false });
  });

  it('món ghim phân loại luôn thêm phân loại ghim', () => {
    expect(addOneCardPricing({ ...card, pinnedVariationId: 'pin' }, [], NOW).variationId).toBe('pin');
  });

  it('thẻ không có phân loại nào: variationId null', () => {
    expect(addOneCardPricing({ slug: 'x', basePrice: 10_000 }, [], NOW).variationId).toBeNull();
  });
});
