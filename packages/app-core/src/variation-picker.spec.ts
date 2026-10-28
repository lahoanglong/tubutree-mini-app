import { describe, expect, it } from 'vitest';
import { clampPickerQty, needsVariationPicker, pickerStartId, pickerStockText, pickerView } from './variation-picker';

const v = (id: string, retailPrice: number, stock: number, salePrice: number | null = null) => ({ id, sku: id, retailPrice, salePrice, stock });

describe('needsVariationPicker', () => {
  it('chỉ mở bảng chọn khi có từ 2 phân loại', () => {
    expect(needsVariationPicker([])).toBe(false);
    expect(needsVariationPicker([v('a', 100, 5)])).toBe(false);
    expect(needsVariationPicker([v('a', 100, 5), v('b', 200, 0)])).toBe(true);
  });
});

describe('pickerStartId', () => {
  const list = [v('a', 100, 0), v('b', 200, 3), v('c', 150, 4)];
  it('giữ phân loại đang chọn nếu còn hàng', () => {
    expect(pickerStartId(list, 'b')).toBe('b');
  });
  it('phân loại đang chọn hết hàng thì lấy phân loại còn hàng rẻ nhất', () => {
    expect(pickerStartId(list, 'a')).toBe('c');
    expect(pickerStartId(list, null)).toBe('c');
  });
  it('tất cả hết hàng thì vẫn trả một id để hiện bảng', () => {
    expect(pickerStartId([v('a', 100, 0), v('b', 90, 0)], null)).toBe('b');
  });
  it('danh sách rỗng', () => {
    expect(pickerStartId([], null)).toBeNull();
  });
});

describe('clampPickerQty', () => {
  it('kẹp trong 1..tồn kho', () => {
    expect(clampPickerQty(v('a', 1, 3), 9)).toBe(3);
    expect(clampPickerQty(v('a', 1, 3), 0)).toBe(1);
    expect(clampPickerQty(v('a', 1, 0), 2)).toBe(1);
    expect(clampPickerQty(undefined, 2)).toBe(1);
  });
});

describe('pickerStockText', () => {
  it('hết hàng, sắp hết, còn nhiều', () => {
    expect(pickerStockText(0)).toBe('Hết hàng');
    expect(pickerStockText(3)).toBe('Chỉ còn 3');
    expect(pickerStockText(40)).toBe('Còn 40');
  });
});

describe('pickerView', () => {
  it('lấy giá Giờ vàng khi rẻ hơn', () => {
    const view = pickerView(v('a', 200000, 5), [{ variationId: 'a', flashPrice: 150000 } as never]);
    expect(view.price).toBe(150000);
    expect(view.compareAt).toBe(200000);
    expect(view.isFlash).toBe(true);
  });
  it('không có Giờ vàng thì giá bán', () => {
    const view = pickerView(v('a', 200000, 5, 180000), []);
    expect(view.price).toBe(180000);
    expect(view.isFlash).toBe(false);
  });
});
