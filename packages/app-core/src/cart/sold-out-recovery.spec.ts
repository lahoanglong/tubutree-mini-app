import { describe, expect, it } from 'vitest';
import { CART_RETURN_REFETCH_MS, cartPricingLines, cartRefetchOnReturn, soldOutRecovery, type RecoveryLine } from './sold-out-recovery';

const line = (id: string, over: Partial<RecoveryLine> = {}): RecoveryLine => ({ id, productName: `Món ${id}`, quantity: 1, stock: 10, ...over });

describe('soldOutRecovery', () => {
  it('không có món hết: null (nút Thanh toán bình thường)', () => {
    expect(soldOutRecovery([line('a'), line('b', { quantity: 10, stock: 10 })])).toBeNull();
    expect(soldOutRecovery([])).toBeNull();
  });

  it('một món hết, còn món mua được: bỏ đúng món hết, giữ thứ tự phần còn lại, nhãn và câu báo từ shop-copy', () => {
    const r = soldOutRecovery([line('a'), line('b', { stock: 0, productName: 'Dầu gội' }), line('c', { quantity: 3, stock: 3 })]);
    expect(r).toEqual({
      soldOutIds: ['b'],
      keepIds: ['a', 'c'],
      cta: 'Bỏ món hết & thanh toán tiếp',
      note: '"Dầu gội" đã hết hàng, được giữ lại trong giỏ.',
    });
  });

  it('nhiều món hết: câu báo liệt kê đủ tên theo thứ tự trong giỏ', () => {
    const r = soldOutRecovery([line('a', { stock: 0, productName: 'A' }), line('b'), line('c', { stock: 0, productName: 'C' })]);
    expect(r?.soldOutIds).toEqual(['a', 'c']);
    expect(r?.keepIds).toEqual(['b']);
    expect(r?.note).toBe('"A", "C" đã hết hàng, được giữ lại trong giỏ.');
  });

  it('tồn âm (máy chủ trừ quá tay) cũng tính là hết', () => {
    expect(soldOutRecovery([line('a', { stock: -2 }), line('b')])?.soldOutIds).toEqual(['a']);
  });

  it('mọi món đang chọn đều hết: null, không có gì để thanh toán tiếp', () => {
    expect(soldOutRecovery([line('a', { stock: 0 }), line('b', { stock: 0 })])).toBeNull();
  });

  it('còn dòng vượt tồn (tồn > 0): null, khách tự chọn số lượng chứ không giảm hộ', () => {
    expect(soldOutRecovery([line('a', { stock: 0 }), line('b', { quantity: 5, stock: 2 })])).toBeNull();
  });

  it('dòng đúng bằng tồn vẫn mua được', () => {
    expect(soldOutRecovery([line('a', { stock: 0 }), line('b', { quantity: 2, stock: 2 })])?.keepIds).toEqual(['b']);
  });
});

describe('cartRefetchOnReturn', () => {
  const NOW = 1_000_000;
  it('vắng từ 30 giây và không lệnh nào bay: đọc lại', () => {
    expect(cartRefetchOnReturn(NOW - CART_RETURN_REFETCH_MS, 0, NOW)).toBe(true);
    expect(cartRefetchOnReturn(NOW - 3_600_000, 0, NOW)).toBe(true);
  });
  it('vừa đọc chưa tới 30 giây: không đọc (đổi cửa sổ qua lại)', () => {
    expect(cartRefetchOnReturn(NOW - CART_RETURN_REFETCH_MS + 1, 0, NOW)).toBe(false);
  });
  it('còn lệnh sửa giỏ đang bay: không đọc dù đã cũ', () => {
    expect(cartRefetchOnReturn(NOW - 3_600_000, 1, NOW)).toBe(false);
  });
  it('chưa có dữ liệu: đọc', () => {
    expect(cartRefetchOnReturn(0, 0, NOW)).toBe(true);
  });
});

describe('cartPricingLines', () => {
  it('đang có nút bỏ món hết một chạm: chỉ phần còn lại, đúng `keepIds`, giữ nguyên dòng (kể cả trường riêng của app)', () => {
    const lines = [{ ...line('a'), total: 10 }, { ...line('b', { stock: 0 }), total: 20 }, { ...line('c', { quantity: 2, stock: 2 }), total: 30 }];
    const out = cartPricingLines(lines);
    expect(out.map((l) => l.id)).toEqual(soldOutRecovery(lines)?.keepIds);
    expect(out).toEqual([lines[0], lines[2]]);
  });

  it('không có món hết: đúng các dòng đang chọn, theo thứ tự', () => {
    const lines = [line('a'), line('b')];
    expect(cartPricingLines(lines)).toEqual(lines);
    expect(cartPricingLines([])).toEqual([]);
  });

  it('không có nút một chạm (mọi món hết, hoặc còn dòng vượt tồn): giữ đúng các dòng đang chọn như cũ', () => {
    const allOut = [line('a', { stock: 0 }), line('b', { stock: 0 })];
    expect(cartPricingLines(allOut)).toEqual(allOut);
    const overStock = [line('a', { stock: 0 }), line('b', { quantity: 5, stock: 2 })];
    expect(cartPricingLines(overStock)).toEqual(overStock);
  });

  it('không sửa mảng đầu vào', () => {
    const lines = [line('a'), line('b', { stock: 0 })];
    const out = cartPricingLines(lines);
    out.push(line('z'));
    expect(lines.map((l) => l.id)).toEqual(['a', 'b']);
  });
});
