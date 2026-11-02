import { describe, expect, it } from 'vitest';
import { cartStockNote, isLowStock, LOW_STOCK_NOTICE, stockText } from './stock-text';

describe('stockText: một chữ tồn kho cho cả hai app', () => {
  it('hết hàng ghi "Tạm hết hàng" như thẻ (K1)', () => {
    expect(stockText(0)).toBe('Tạm hết hàng');
    expect(stockText(-1)).toBe('Tạm hết hàng');
  });

  it('mọi n > 0 ghi "Còn n sản phẩm", không đổi chữ theo mức tồn (kể cả n > ngưỡng, không "Còn 6" trần)', () => {
    for (const n of [1, 3, 5, 6, 40, 245]) expect(stockText(n)).toBe(`Còn ${n} sản phẩm`);
  });

  it('không có chữ giục "Chỉ còn" (thuật ngữ cấm)', () => {
    for (const n of [0, 1, 5, 6, 40]) expect(stockText(n)).not.toMatch(/Chỉ còn/i);
  });
});

describe('isLowStock: chỉ mức thấp được nhấn bằng màu cảnh báo', () => {
  it('ngưỡng là LOW_STOCK_NOTICE (5): 1..5 thấp, 0 là hết (không phải thấp), 6 trở lên bình thường', () => {
    expect(LOW_STOCK_NOTICE).toBe(5);
    expect([0, 1, 5, 6, 40].map(isLowStock)).toEqual([false, true, true, false, false]);
  });
});

describe('cartStockNote: dòng tồn kho ở giỏ, một luật cho hai app (L5 3)', () => {
  it('chưa chạm trần (quantity < stock) hoặc hết hàng (stock <= 0, chỗ gọi có câu hết hàng riêng): không có dòng', () => {
    expect(cartStockNote(2, 5)).toBeNull();
    expect(cartStockNote(39, 40)).toBeNull();
    expect(cartStockNote(1, 0)).toBeNull();
    expect(cartStockNote(0, 0)).toBeNull();
    expect(cartStockNote(3, -1)).toBeNull();
  });

  it('chạm trần mà tồn thấp (1..5): cảnh báo, chữ "Còn n sản phẩm"', () => {
    for (const n of [1, 3, 5]) expect(cartStockNote(n, n)).toEqual({ text: `Còn ${n} sản phẩm`, tone: 'warning' });
  });

  it('chạm trần mà tồn cao (6 trở lên): chữ thường, không cam', () => {
    expect(cartStockNote(6, 6)).toEqual({ text: 'Còn 6 sản phẩm', tone: 'neutral' });
    expect(cartStockNote(40, 40)).toEqual({ text: 'Còn 40 sản phẩm', tone: 'neutral' });
  });

  it('vượt tồn (quantity > stock, đang chặn thanh toán): luôn cảnh báo kể cả tồn cao', () => {
    expect(cartStockNote(3, 1)).toEqual({ text: 'Còn 1 sản phẩm', tone: 'warning' });
    expect(cartStockNote(50, 40)).toEqual({ text: 'Còn 40 sản phẩm', tone: 'warning' });
  });
});
