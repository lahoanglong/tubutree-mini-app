import { describe, it, expect } from 'vitest';
import type { CartSummary } from '../../services/shop-api';
import { summarizeReorder } from './reorder-summary';
import type { ReorderLine } from './reorder-types';

const CART: CartSummary = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 0 };
const line = (key: string, productName: string): ReorderLine => ({
  key, variationId: `v-${key}`, productName, variationName: '', thumbnail: null, unitPrice: 1, defaultQuantity: 1, maxQuantity: 9, available: true,
});
const lines = [line('a', 'Nước rửa chén'), line('b', 'Xà phòng'), line('c', 'Nước lau sàn')];

describe('summarizeReorder', () => {
  it('thêm đủ → "Đã thêm N món vào giỏ"', () => {
    const s = summarizeReorder({ cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 2 }] }, lines, []);
    expect(s).toEqual({ addedLines: 1, skippedLines: 0, addedUnits: 2, hasProblems: false, message: 'Đã thêm 2 món vào giỏ' });
  });

  it('có dòng bị bỏ qua / thiếu → nêu tên + lý do tiếng Việt', () => {
    const s = summarizeReorder(
      {
        cart: CART,
        legacy: false,
        results: [
          { orderItemId: 'a', status: 'added', addedQuantity: 1 },
          { orderItemId: 'b', status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 },
          { orderItemId: 'c', status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 1 },
        ],
      },
      lines,
      [],
    );
    expect(s.addedLines).toBe(2);
    expect(s.skippedLines).toBe(1);
    expect(s.addedUnits).toBe(2);
    expect(s.hasProblems).toBe(true);
    expect(s.message).toBe('Đã thêm 2 món vào giỏ. Chưa thêm đủ: Xà phòng (hết hàng), Nước lau sàn (chỉ thêm được 1)');
  });

  it('không thêm được gì → câu báo lỗi, addedUnits 0; NOT_APPROVED hiển thị như "ngừng bán"', () => {
    const s = summarizeReorder(
      { cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'skipped', reason: 'NOT_APPROVED', addedQuantity: 0 }] },
      lines,
      [],
    );
    expect(s.addedUnits).toBe(0);
    expect(s.message).toBe('Chưa thêm được món nào vào giỏ: Nước rửa chén (ngừng bán)');
  });

  it('API cũ (legacy) → coi như thêm đủ các dòng đã chọn', () => {
    const s = summarizeReorder({ cart: CART, legacy: true, results: [] }, lines, [
      { key: 'a', variationId: 'v-a', quantity: 2 },
      { key: 'b', variationId: 'v-b', quantity: 1 },
    ]);
    expect(s).toEqual({ addedLines: 2, skippedLines: 0, addedUnits: 3, hasProblems: false, message: 'Đã thêm vào giỏ' });
  });
});
