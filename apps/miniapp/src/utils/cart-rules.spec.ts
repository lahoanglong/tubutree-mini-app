import { describe, it, expect } from 'vitest';
import { recompute } from './cart-rules';
import type { CartLine, CartSummary } from '../services/shop-api';

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'l1',
    variationId: 'v1',
    productName: 'SP',
    variationName: '500ml',
    slug: 'sp',
    thumbnail: null,
    unitPrice: 100_000,
    quantity: 1,
    stock: 10,
    total: 100_000,
    ...overrides,
  };
}

function summary(overrides: Partial<CartSummary> = {}): CartSummary {
  return {
    items: [],
    couponCode: null,
    subtotal: 0,
    discount: 0,
    freeship: false,
    freeshipThreshold: 200_000,
    itemCount: 0,
    ...overrides,
  };
}

describe('recompute', () => {
  it('tính lại total từng dòng theo unitPrice × quantity mới (không tin total cũ từ server)', () => {
    const cart = summary();
    const items = [line({ id: 'a', unitPrice: 50_000, quantity: 2, total: 999 })];
    const result = recompute(cart, items);
    expect(result.items[0]?.total).toBe(100_000);
  });

  it('subtotal = tổng total các dòng, itemCount = tổng quantity', () => {
    const cart = summary();
    const items = [
      line({ id: 'a', unitPrice: 50_000, quantity: 2 }),
      line({ id: 'b', unitPrice: 30_000, quantity: 3 }),
    ];
    const result = recompute(cart, items);
    expect(result.subtotal).toBe(50_000 * 2 + 30_000 * 3);
    expect(result.itemCount).toBe(5);
  });

  it('danh sách rỗng (xoá hết) → subtotal/itemCount về 0, không lỗi', () => {
    const result = recompute(summary({ subtotal: 100_000, itemCount: 1 }), []);
    expect(result.subtotal).toBe(0);
    expect(result.itemCount).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('giữ nguyên discount/couponCode/freeship của cart gốc (server tính lại sau, không suy đoán ở client)', () => {
    const cart = summary({ discount: 20_000, couponCode: 'FREESHIP', freeship: true });
    const result = recompute(cart, [line()]);
    expect(result.discount).toBe(20_000);
    expect(result.couponCode).toBe('FREESHIP');
    expect(result.freeship).toBe(true);
  });
});
