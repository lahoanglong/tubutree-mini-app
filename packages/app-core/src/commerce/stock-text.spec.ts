import { exposedStock } from '@tubutree/shared-types';
import { describe, expect, it } from 'vitest';
import { cartStockNote, isLowStock, LOW_STOCK_NOTICE, overStockTarget, PLENTY_STOCK, QTY_PICK_CAP, qtyPickMax, stockText } from './stock-text';

describe('stockText: một chữ tồn kho cho cả hai app', () => {
  it('hết hàng ghi "Tạm hết hàng" như thẻ (K1)', () => {
    expect(stockText(0)).toBe('Tạm hết hàng');
    expect(stockText(-1)).toBe('Tạm hết hàng');
  });

  it('1–20 ghi "Chỉ còn n sản phẩm" (đúng số), 21–99.999 ghi "Còn hàng" (không lộ số), từ 100.000 ghi "Còn hàng — Sẵn sàng giao ngay"', () => {
    for (const n of [1, 3, 5, 6, 19, 20]) expect(stockText(n)).toBe(`Chỉ còn ${n} sản phẩm`);
    for (const n of [21, 40, 245, 99_999]) expect(stockText(n)).toBe('Còn hàng');
    for (const n of [100_000, 100_001, 99_999_988]) expect(stockText(n)).toBe('Còn hàng — Sẵn sàng giao ngay');
  });

  it('ranh giới: 20 và 21, 99.999 và 100.000 sang hai chữ khác nhau', () => {
    expect(PLENTY_STOCK).toBe(100_000);
    expect(stockText(20)).not.toBe(stockText(21));
    expect(stockText(99_999)).not.toBe(stockText(100_000));
  });

  it('hết hàng, số âm, NaN đều ghi "Tạm hết hàng", không "Chỉ còn"', () => {
    for (const n of [0, -1, Number.NaN]) {
      expect(stockText(n)).toBe('Tạm hết hàng');
      expect(stockText(n)).not.toMatch(/Chỉ còn/i);
    }
  });

  it('tồn từ 21 trở lên không bao giờ có chữ "Chỉ còn" và tồn từ 100.000 không có con số nào', () => {
    for (const n of [21, 40, 99_999, 100_000]) expect(stockText(n)).not.toMatch(/Chỉ còn/i);
    for (const n of [100_000, 999_999, 99_999_988]) expect(stockText(n)).not.toMatch(/\d/);
  });
});

describe('isLowStock: chỉ mức thấp được nhấn bằng màu cảnh báo', () => {
  it('ngưỡng là LOW_STOCK_NOTICE (20): 1..20 thấp, 0 là hết (không phải thấp), 21 trở lên bình thường', () => {
    expect(LOW_STOCK_NOTICE).toBe(20);
    expect([0, 1, 5, 20, 21, 40, 100_000].map(isLowStock)).toEqual([false, true, true, true, false, false, false]);
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

  it('chạm trần mà tồn thấp (1..20): chữ "Chỉ còn n sản phẩm" như PDP', () => {
    for (const n of [1, 3, 5, 20]) expect(cartStockNote(n, n)).toBe(`Chỉ còn ${n} sản phẩm`);
  });

  it('tồn cao (21 trở lên) mà số đã chọn bằng tồn: không có dòng, vì "đã chọn hết" là nói ra tồn thật', () => {
    expect(cartStockNote(21, 21)).toBeNull();
    expect(cartStockNote(40, 40)).toBeNull();
  });

  it('vượt tồn (quantity > stock, đang chặn thanh toán): tồn thấp ghi số, tồn cao nói "vượt" mà không có số', () => {
    expect(cartStockNote(3, 1)).toBe('Chỉ còn 1 sản phẩm');
    expect(cartStockNote(50, 40)).toBe('Vượt số hàng đang có, giảm bớt để thanh toán');
  });

  it('tồn trên ngưỡng không bao giờ có chữ số trong dòng ghi chú (21, 40, 999, 99.999, 100.000, 99.999.988)', () => {
    for (const stock of [LOW_STOCK_NOTICE + 1, 40, 999, PLENTY_STOCK - 1, PLENTY_STOCK, 99_999_988]) {
      expect(cartStockNote(stock, stock)).toBeNull();
      expect(cartStockNote(stock + 1, stock)).not.toMatch(/\d/);
    }
  });
});

describe('qtyPickMax: trần nút + của bộ chọn số lượng', () => {
  it('tồn 1..20 (đã in "Chỉ còn n"): nút + khoá đúng ở tồn', () => {
    for (const n of [1, 5, 19, 20]) expect(qtyPickMax(n)).toBe(n);
  });

  it('tồn trên 20: trần cố định, không phụ thuộc tồn, nên bấm + không dò ra tồn thật', () => {
    expect(QTY_PICK_CAP).toBe(99);
    for (const stock of [21, 25, 98, 99, 100, 500, 1000, PLENTY_STOCK]) expect(qtyPickMax(stock)).toBe(QTY_PICK_CAP);
  });

  it('hết hàng: 1 (bộ chọn khoá riêng, không về 0)', () => {
    expect(qtyPickMax(0)).toBe(1);
    expect(qtyPickMax(-3)).toBe(1);
  });
});

describe('overStockTarget: mức kéo về của dòng vượt tồn', () => {
  it('tồn 1..20 về đúng tồn; tồn trên 20 về 20, không về sát tồn thật; hết hàng về 1', () => {
    expect(overStockTarget(3)).toBe(3);
    expect(overStockTarget(20)).toBe(20);
    expect(overStockTarget(21)).toBe(LOW_STOCK_NOTICE);
    expect(overStockTarget(25)).toBe(LOW_STOCK_NOTICE);
    expect(overStockTarget(PLENTY_STOCK)).toBe(LOW_STOCK_NOTICE);
    expect(overStockTarget(0)).toBe(1);
  });
});

describe('exposedStock: tồn gửi ra client', () => {
  it('dưới ngưỡng ảo giữ nguyên để client chặn nút +, từ 100.000 trở lên bị kẹp, con số Pancake không ra ngoài', () => {
    expect(exposedStock(0)).toBe(0);
    expect(exposedStock(7)).toBe(7);
    expect(exposedStock(PLENTY_STOCK - 1)).toBe(PLENTY_STOCK - 1);
    expect(exposedStock(PLENTY_STOCK)).toBe(PLENTY_STOCK);
    expect(exposedStock(99_999_988)).toBe(PLENTY_STOCK);
  });
});
