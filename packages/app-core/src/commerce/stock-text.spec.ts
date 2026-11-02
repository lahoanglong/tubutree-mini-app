import { describe, expect, it } from 'vitest';
import { isLowStock, LOW_STOCK_NOTICE, stockText } from './stock-text';

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
