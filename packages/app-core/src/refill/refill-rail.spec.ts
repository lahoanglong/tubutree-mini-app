import { describe, expect, it } from 'vitest';
import type { QuickReorderItem } from '../commerce/quick-reorder';
import type { RefillOfferDTO } from './refill-api';
import { refillQuickItems } from './refill-rail';

const tile = (id: string, over: Partial<QuickReorderItem> = {}): QuickReorderItem => ({
  key: `k-${id}`,
  productId: `p-${id}`,
  slug: `s-${id}`,
  variationId: `v-${id}`,
  name: `Chai ${id}`,
  thumbnail: null,
  price: 60_000,
  compareAt: 70_000,
  savePct: 14,
  isFlash: true,
  timesBought: 3,
  source: 'purchased',
  ...over,
});
const offer = (id: string, over: Partial<RefillOfferDTO> = {}): RefillOfferDTO => ({
  productId: `p-${id}`,
  slug: `s-${id}`,
  name: `Refill ${id} 10L`,
  thumbnail: 'r.jpg',
  variationId: `v-${id}`,
  price: 650_000,
  compareAt: null,
  sizeLabel: '10L',
  inStock: true,
  tubu: true,
  ...over,
});

describe('refillQuickItems: ô chai khách đã có thành gói Refill ở dải "Mua lại món quen"', () => {
  it('không có cặp (cờ tắt hoặc chưa tải): trả nguyên dải, cùng thứ tự', () => {
    const items = [tile('a'), tile('b')];
    expect(refillQuickItems(items, undefined)).toEqual(items);
    expect(refillQuickItems(items, {})).toEqual(items);
  });

  it('ô chai có cặp còn hàng: thay bằng gói refill, giá thuần của gói (không mang giá Giờ vàng của chai), giữ ô chai gốc trong `bottle`', () => {
    const a = tile('a');
    const [out, keep] = refillQuickItems([a, tile('b')], { 'p-a': offer('r') });
    expect(out).toMatchObject({
      key: 'refill:k-a',
      productId: 'p-r',
      slug: 's-r',
      variationId: 'v-r',
      name: 'Refill r 10L',
      thumbnail: 'r.jpg',
      price: 650_000,
      compareAt: null,
      savePct: 0,
      isFlash: false,
      timesBought: 0,
      source: 'purchased',
      bottle: a,
    });
    expect(keep).toEqual(tile('b'));
  });

  it('gói refill hết hàng: giữ ô chai', () => {
    const items = [tile('a')];
    expect(refillQuickItems(items, { 'p-a': offer('r', { inStock: false }) })).toEqual(items);
  });

  it('gói refill đã là một ô khác của dải: giữ ô chai, một món không hiện hai lần', () => {
    const items = [tile('a'), tile('r')];
    expect(refillQuickItems(items, { 'p-a': offer('r') })).toEqual(items);
  });

  it('hai chai cùng trỏ một gói refill: chỉ chai đầu đổi, chai sau giữ nguyên', () => {
    const out = refillQuickItems([tile('a'), tile('b')], { 'p-a': offer('r'), 'p-b': offer('r') });
    expect(out.map((i) => i.productId)).toEqual(['p-r', 'p-b']);
    expect(out[1]!.bottle).toBeUndefined();
  });

  it('không đổi mảng đầu vào', () => {
    const items = [tile('a')];
    const copy = structuredClone(items);
    refillQuickItems(items, { 'p-a': offer('r') });
    expect(items).toEqual(copy);
  });
});
