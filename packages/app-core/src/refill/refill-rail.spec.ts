import { describe, expect, it } from 'vitest';
import type { QuickReorderItem } from '../commerce/quick-reorder';
import type { RefillOfferDTO } from './refill-api';
import { refillQuickItems, refillUnitSaving } from './refill-rail';

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
      badge: 'Đổi sang túi Refill 10L',
      addLabel: '+ Thêm Refill',
      addAria: 'Thêm Refill 10L thay cho Chai a vào giỏ, 650.000đ',
    });
    expect(keep).toEqual(tile('b'));
    expect(keep!.badge).toBeUndefined();
  });

  it('khách thấy rõ món đổi: nhãn ghi dung tích, câu đọc nêu chai cũ, giá và mức rẻ hơn mỗi 100ml', () => {
    const [out] = refillQuickItems([tile('a', { name: 'Nước giặt 1L', price: 60_000 })], {
      'p-a': offer('r', { name: 'Nước giặt Refill 3L', sizeLabel: '3L', price: 150_000 }),
    });
    expect(out!.badge).toBe('Đổi sang túi Refill 3L');
    expect(out!.addAria).toBe('Thêm Refill 3L thay cho Nước giặt 1L vào giỏ, 150.000đ. Rẻ hơn 16% mỗi 100ml');
  });

  it('gói không ghi dung tích: nhãn vẫn nói đổi sang túi Refill, không bịa số', () => {
    const [out] = refillQuickItems([tile('a')], { 'p-a': offer('r', { sizeLabel: null, name: 'Refill r' }) });
    expect(out!.badge).toBe('Đổi sang túi Refill');
    expect(out!.addAria).toBe('Thêm Refill thay cho Chai a vào giỏ, 650.000đ');
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

describe('refillUnitSaving: mức rẻ hơn tính trên cùng lượng', () => {
  const bottle = { name: 'Sữa tắm 500ml', price: 100_000 };
  it('làm tròn xuống, theo 100ml', () => {
    expect(refillUnitSaving(bottle, { name: 'Sữa tắm Refill 1L', sizeLabel: '1L', price: 150_000 })).toEqual({ pct: 25, per: '100ml' });
  });
  it('không đọc được lượng, khác chiều, hay đắt hơn: null', () => {
    expect(refillUnitSaving({ name: 'Sữa tắm', price: 100_000 }, { name: 'Refill 1L', sizeLabel: '1L', price: 150_000 })).toBeNull();
    expect(refillUnitSaving(bottle, { name: 'Refill 1kg', sizeLabel: '1kg', price: 150_000 })).toBeNull();
    expect(refillUnitSaving(bottle, { name: 'Refill 1L', sizeLabel: '1L', price: 200_000 })).toBeNull();
    expect(refillUnitSaving(bottle, { name: 'Refill 1L', sizeLabel: '1L', price: 0 })).toBeNull();
  });
});
