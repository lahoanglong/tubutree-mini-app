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
});
