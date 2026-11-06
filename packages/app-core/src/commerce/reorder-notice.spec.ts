import { describe, expect, it } from 'vitest';
import { isDiscontinuedItem, reorderLineNotices, reorderSkippedNote, type ReorderLineFacts } from './reorder-notice';

const line = (over: Partial<ReorderLineFacts> = {}): ReorderLineFacts => ({
  available: true,
  discontinued: false,
  orderedQuantity: 2,
  stock: 50,
  paidPrice: 120_000,
  currentPrice: 120_000,
  ...over,
});

describe('reorderLineNotices: câu dưới từng dòng sheet Mua lại', () => {
  it('còn bán, đủ hàng, giá như cũ: không có câu nào', () => {
    expect(reorderLineNotices(line())).toEqual([]);
  });

  it('hết hàng: "Tạm hết hàng"; ngừng bán: "Ngừng bán"; không kèm câu giá hay số lượng', () => {
    expect(reorderLineNotices(line({ available: false, stock: 0, currentPrice: 150_000 }))).toEqual([{ kind: 'out', tone: 'danger', text: 'Tạm hết hàng' }]);
    expect(reorderLineNotices(line({ available: false, discontinued: true }))).toEqual([{ kind: 'discontinued', tone: 'danger', text: 'Ngừng bán' }]);
  });

  it('còn ít hơn số đã mua: báo đã giảm, nêu số đơn trước, không in số tồn', () => {
    const [n] = reorderLineNotices(line({ orderedQuantity: 5, stock: 2 }));
    expect(n).toEqual({ kind: 'reduced', tone: 'warning', text: 'Không đủ 5 như đơn trước, đã giảm số lượng' });
    expect(n!.text).not.toContain('2');
    expect(reorderLineNotices(line({ orderedQuantity: 2, stock: 2 }))).toEqual([]);
  });

  it('API cũ không cho biết tồn hay giá: không đoán', () => {
    expect(reorderLineNotices(line({ orderedQuantity: 5, stock: null, currentPrice: null }))).toEqual([]);
  });

  it('giá tăng: cảnh báo kèm giá đã trả; giá giảm: báo tin vui kèm giá đã trả', () => {
    expect(reorderLineNotices(line({ currentPrice: 135_000 }))).toEqual([{ kind: 'priceUp', tone: 'warning', text: 'Giá tăng so với đơn trước (120.000đ)' }]);
    expect(reorderLineNotices(line({ currentPrice: 99_000 }))).toEqual([{ kind: 'priceDown', tone: 'success', text: 'Giá giảm so với đơn trước (120.000đ)' }]);
  });

  it('vừa giảm số lượng vừa đổi giá: hai câu, số lượng trước', () => {
    expect(reorderLineNotices(line({ orderedQuantity: 3, stock: 1, currentPrice: 130_000 })).map((n) => n.kind)).toEqual(['reduced', 'priceUp']);
  });
});

describe('reorderSkippedNote: câu đầu sheet', () => {
  it('mọi dòng còn bán: null; vài dòng: nêu số dòng; cả đơn: câu riêng', () => {
    expect(reorderSkippedNote([{ available: true }])).toBeNull();
    expect(reorderSkippedNote([{ available: true }, { available: false }, { available: false }])).toBe('2 món hết hàng hoặc ngừng bán sẽ không được thêm vào giỏ.');
    expect(reorderSkippedNote([{ available: false }])).toBe('Các món trong đơn này đều đã hết hàng hoặc ngừng bán.');
  });
});

describe('isDiscontinuedItem: phân biệt ngừng bán với hết hàng', () => {
  it('API mới có cờ: theo cờ', () => {
    expect(isDiscontinuedItem({ available: false, stock: 0, discontinued: true })).toBe(true);
    expect(isDiscontinuedItem({ available: false, stock: 0, discontinued: false })).toBe(false);
  });

  it('API cũ: trang sản phẩm gỡ hoặc không bán được mà còn tồn là ngừng bán; hết tồn là hết hàng', () => {
    expect(isDiscontinuedItem({ available: false, stock: 0, productPublic: false })).toBe(true);
    expect(isDiscontinuedItem({ available: false, stock: 7, productPublic: true })).toBe(true);
    expect(isDiscontinuedItem({ available: false, stock: 0, productPublic: true })).toBe(false);
    expect(isDiscontinuedItem({})).toBe(false);
  });
});
