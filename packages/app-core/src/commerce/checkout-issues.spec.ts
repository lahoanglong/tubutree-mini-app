import { describe, expect, it } from 'vitest';
import { checkoutLineProblem, checkoutLineProblems, isPriceChangedError, priceChangedActions } from './checkout-issues';

const line = (over: Partial<{ id: string; productName: string; quantity: number; stock: number }> = {}) => ({
  id: 'i1',
  productName: 'Nước rửa chén',
  quantity: 2,
  stock: 10,
  ...over,
});

describe('checkoutLineProblem', () => {
  it('đủ hàng thì không có vấn đề', () => {
    expect(checkoutLineProblem(line())).toBeNull();
    expect(checkoutLineProblem(line({ quantity: 10, stock: 10 }))).toBeNull();
  });

  it('hết hàng (tồn 0): ghi "Hết hàng", sửa nhanh là bỏ dòng khỏi đơn', () => {
    const p = checkoutLineProblem(line({ stock: 0 }))!;
    expect(p.kind).toBe('sold-out');
    expect(p.text).toBe('Hết hàng');
    expect(p.fix).toEqual({ kind: 'remove' });
    expect(p.fixLabel).toBe('Bỏ khỏi đơn');
  });

  it('vượt tồn: ghi số còn lại, sửa nhanh là giảm số lượng xuống đúng số còn', () => {
    const p = checkoutLineProblem(line({ quantity: 5, stock: 3 }))!;
    expect(p.kind).toBe('over');
    expect(p.text).toBe('Còn 3 sản phẩm');
    expect(p.fix).toEqual({ kind: 'reduce', quantity: 3 });
    expect(p.fixLabel).toBe('Giảm còn 3');
  });

  it('tồn âm (dữ liệu lỗi) coi như hết hàng', () => {
    expect(checkoutLineProblem(line({ stock: -2 }))!.kind).toBe('sold-out');
  });
});

describe('checkoutLineProblems', () => {
  it('trả theo mã dòng, chỉ các dòng có vấn đề, giữ nguyên thứ tự dòng', () => {
    const map = checkoutLineProblems([line({ id: 'a' }), line({ id: 'b', stock: 0 }), line({ id: 'c', quantity: 4, stock: 1 })]);
    expect(Object.keys(map)).toEqual(['b', 'c']);
    expect(map.b!.kind).toBe('sold-out');
    expect(map.c!.fix).toEqual({ kind: 'reduce', quantity: 1 });
  });
});

describe('checkoutLineProblems — dòng cuối cùng của thanh toán một phần', () => {
  it('chỉ còn đúng một dòng được chọn mà hết hàng: không xoá tại màn (xoá là rỗng lựa chọn, màn sẽ chuyển sang cả giỏ), sửa nhanh là về giỏ hàng', () => {
    const p = checkoutLineProblems([line({ id: 'a', stock: 0 })], { keepLastLine: true }).a!;
    expect(p.kind).toBe('sold-out');
    expect(p.fix).toEqual({ kind: 'cart' });
    expect(p.fixLabel).toBe('Về giỏ hàng');
  });

  it('còn từ hai dòng được chọn trở lên: vẫn bỏ được dòng hết hàng', () => {
    const map = checkoutLineProblems([line({ id: 'a', stock: 0 }), line({ id: 'b' })], { keepLastLine: true });
    expect(map.a!.fix).toEqual({ kind: 'remove' });
    expect(map.a!.fixLabel).toBe('Bỏ khỏi đơn');
  });

  it('dòng vượt tồn vẫn giảm được dù là dòng duy nhất (giảm không làm rỗng lựa chọn)', () => {
    const p = checkoutLineProblems([line({ id: 'a', quantity: 5, stock: 2 })], { keepLastLine: true }).a!;
    expect(p.fix).toEqual({ kind: 'reduce', quantity: 2 });
  });

  it('không bật keepLastLine (thanh toán cả giỏ) thì như cũ', () => {
    expect(checkoutLineProblems([line({ id: 'a', stock: 0 })]).a!.fix).toEqual({ kind: 'remove' });
  });
});

describe('isPriceChangedError', () => {
  it('nhận mã PRICE_CHANGED ở cả hai dạng lỗi: axios của Mini App (thân phản hồi) và ApiError của web (message)', () => {
    expect(isPriceChangedError({ response: { status: 400, data: { statusCode: 400, message: 'PRICE_CHANGED' } } })).toBe(true);
    expect(isPriceChangedError({ response: { status: 400, data: { code: 'PRICE_CHANGED', message: 'x' } } })).toBe(true);
    expect(isPriceChangedError(new Error('PRICE_CHANGED'))).toBe(true);
  });

  it('lỗi khác, mảng message, giá trị lạ thì không', () => {
    expect(isPriceChangedError({ response: { data: { message: 'Hết suất ưu đãi.' } } })).toBe(false);
    expect(isPriceChangedError({ response: { data: { message: ['PRICE_CHANGED'] } } })).toBe(true);
    expect(isPriceChangedError(null)).toBe(false);
    expect(isPriceChangedError('PRICE_CHANGED')).toBe(false);
  });
});

describe('priceChangedActions', () => {
  it('hai lối sửa: nhận giá mới ngay tại màn thanh toán (làm chính) và xem lại giỏ hàng', () => {
    expect(priceChangedActions()).toEqual({ accept: 'Cập nhật giá mới', viewCart: 'Xem lại giỏ hàng' });
  });
});
