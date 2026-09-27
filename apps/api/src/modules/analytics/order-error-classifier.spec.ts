import { classifyOrderError } from './order-error-classifier';

describe('classifyOrderError', () => {
  it('message chứa "tồn kho" → OUT_OF_STOCK', () => {
    expect(classifyOrderError('Sản phẩm "A" không đủ tồn kho.')).toBe('OUT_OF_STOCK');
  });
  it('message === PRICE_CHANGED → PRICE_CHANGED', () => {
    expect(classifyOrderError('PRICE_CHANGED')).toBe('PRICE_CHANGED');
  });
  it('message chứa "Địa chỉ giao hàng" → ADDRESS_INVALID', () => {
    expect(classifyOrderError('Địa chỉ giao hàng không hợp lệ.')).toBe('ADDRESS_INVALID');
  });
  it('message chứa "Số dư"/"Điểm Xanh"/"COD" → BALANCE', () => {
    expect(classifyOrderError('Số dư Ví Tubu không đủ.')).toBe('BALANCE');
    expect(classifyOrderError('Số điểm Xanh không đủ (hiện có 10 điểm).')).toBe('BALANCE');
    expect(classifyOrderError('Đơn vượt hạn mức COD, vui lòng chọn phương thức khác.')).toBe('BALANCE');
  });
  it('message chứa "Idempotency" → VALIDATION', () => {
    expect(classifyOrderError('Idempotency-Key không hợp lệ.')).toBe('VALIDATION');
  });
  it('message không khớp gì → VALIDATION (mặc định)', () => {
    expect(classifyOrderError('Lỗi lạ chưa từng thấy')).toBe('VALIDATION');
  });
  it('message lỗi hết lượt coupon (chứa "giá" trong "giảm giá") → VALIDATION, KHÔNG phải PRICE_CHANGED', () => {
    expect(classifyOrderError('Mã giảm giá đã hết lượt sử dụng.')).toBe('VALIDATION');
    expect(classifyOrderError('Mã giảm giá đã hết hạn hoặc chưa hiệu lực.')).toBe('VALIDATION');
  });
  it('message "Điểm Xanh" viết hoa chữ Đ (message thật từ checkout.service.ts) → BALANCE', () => {
    expect(
      classifyOrderError('Đơn này dùng 500 Điểm Xanh nhưng hiện bạn chỉ dùng được 200/1000 điểm: abc. Vui lòng tải lại trang thanh toán.'),
    ).toBe('BALANCE');
  });
});
