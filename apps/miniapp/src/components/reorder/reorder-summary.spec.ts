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

  it('results rỗng (không phải legacy) → không có dấu ":" thừa và vẫn tính là có vấn đề', () => {
    const s = summarizeReorder({ cart: CART, legacy: false, results: [] }, lines, []);
    expect(s).toEqual({ addedLines: 0, skippedLines: 0, addedUnits: 0, hasProblems: true, message: 'Chưa thêm được món nào vào giỏ' });
  });

  it('dòng "added" nhưng addedQuantity 0 → không thêm được gì, không có ":" thừa', () => {
    const s = summarizeReorder({ cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 0 }] }, lines, []);
    expect(s.addedUnits).toBe(0);
    expect(s.hasProblems).toBe(true);
    expect(s.message).toBe('Chưa thêm được món nào vào giỏ');
  });

  it('lý do INACTIVE / EXCEEDS_STOCK / thiếu reason → nhãn tiếng Việt (thiếu reason coi như hết hàng)', () => {
    const s = summarizeReorder(
      {
        cart: CART,
        legacy: false,
        results: [
          { orderItemId: 'a', status: 'skipped', reason: 'INACTIVE', addedQuantity: 0 },
          { orderItemId: 'b', status: 'skipped', reason: 'EXCEEDS_STOCK', addedQuantity: 0 },
          { orderItemId: 'c', status: 'skipped', addedQuantity: 0 },
        ],
      },
      lines,
      [],
    );
    expect(s.message).toBe('Chưa thêm được món nào vào giỏ: Nước rửa chén (ngừng bán), Xà phòng (không đủ hàng), Nước lau sàn (hết hàng)');
  });

  it('orderItemId lạ → dùng tên dự phòng "Sản phẩm"', () => {
    const s = summarizeReorder({ cart: CART, legacy: false, results: [{ orderItemId: 'zzz', status: 'skipped', reason: 'INACTIVE', addedQuantity: 0 }] }, lines, []);
    expect(s.message).toBe('Chưa thêm được món nào vào giỏ: Sản phẩm (ngừng bán)');
  });

  it('cùng tên sản phẩm lặp lại trong đơn → thêm tên phân loại để phân biệt', () => {
    const twins = [
      { ...line('a', 'Nước rửa chén'), variationName: 'Chanh' },
      { ...line('b', 'Nước rửa chén'), variationName: 'Trà xanh' },
      { ...line('c', 'Xà phòng'), variationName: '500ml' },
    ];
    const s = summarizeReorder(
      {
        cart: CART,
        legacy: false,
        results: [
          { orderItemId: 'a', status: 'added', addedQuantity: 1 },
          { orderItemId: 'b', status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 },
          { orderItemId: 'c', status: 'skipped', reason: 'INACTIVE', addedQuantity: 0 },
        ],
      },
      twins,
      [],
    );
    expect(s.message).toBe('Đã thêm 1 món vào giỏ. Chưa thêm đủ: Nước rửa chén - Trà xanh (hết hàng), Xà phòng (ngừng bán)');
  });
});
