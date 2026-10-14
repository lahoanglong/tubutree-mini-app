import { describe, expect, it } from 'vitest';
import {
  ORDER_NOTE_MAX,
  effectiveReferralCode,
  isCartFixableError,
  isInvoiceValid,
  outOfStockLine,
  overStockMessage,
  shouldFallbackToCod,
  walletUnavailableReason,
} from './checkout-rules';

const FULL = { taxCode: '0312345678', companyName: 'Công ty A', address: '1 Phố Huế, Hà Nội', email: 'ketoan@a.vn' };

describe('ORDER_NOTE_MAX', () => {
  it('khớp trần 500 ký tự của API và Mini App', () => {
    expect(ORDER_NOTE_MAX).toBe(500);
  });
});

describe('isInvoiceValid', () => {
  it('không yêu cầu hoá đơn thì luôn hợp lệ', () => {
    expect(isInvoiceValid(false, { taxCode: '', companyName: '', address: '', email: '' })).toBe(true);
  });
  it('cần đủ MST, tên công ty, địa chỉ và email đúng định dạng', () => {
    expect(isInvoiceValid(true, FULL)).toBe(true);
    expect(isInvoiceValid(true, { ...FULL, taxCode: '  ' })).toBe(false);
    expect(isInvoiceValid(true, { ...FULL, companyName: '' })).toBe(false);
    expect(isInvoiceValid(true, { ...FULL, address: '' })).toBe(false);
    expect(isInvoiceValid(true, { ...FULL, email: 'ketoan@' })).toBe(false);
  });
});

describe('Ví Tubu ở thanh toán', () => {
  it('số dư đủ → dùng được, không có lý do khoá', () => {
    expect(walletUnavailableReason(50000, 50000)).toBeNull();
    expect(shouldFallbackToCod('WALLET', 50000, 50000)).toBe(false);
  });
  it('số dư thiếu → nói thiếu bao nhiêu và tự rơi về COD', () => {
    expect(walletUnavailableReason(50000, 120000)).toBe('Số dư chưa đủ — cần thêm 70.000đ');
    expect(shouldFallbackToCod('WALLET', 50000, 120000)).toBe(true);
    expect(shouldFallbackToCod('COD', 0, 120000)).toBe(false);
  });
});

describe('effectiveReferralCode', () => {
  it('mã khách vừa nhập thắng mã còn trong phiên từ link', () => {
    expect(effectiveReferralCode('ABC', 'LINK')).toBe('ABC');
    expect(effectiveReferralCode(null, 'LINK')).toBe('LINK');
    expect(effectiveReferralCode(null, null)).toBeUndefined();
  });
});

describe('lỗi chỉ sửa được ở giỏ', () => {
  it('nhận ra lỗi hết tồn kho và suất ưu đãi', () => {
    expect(isCartFixableError('Sản phẩm "Dầu gội" không đủ tồn kho.')).toBe(true);
    expect(isCartFixableError('Hết suất ưu đãi.')).toBe(true);
    expect(isCartFixableError('Vượt giới hạn mua ưu đãi.')).toBe(true);
    expect(isCartFixableError('Địa chỉ không hợp lệ.')).toBe(false);
  });
  it('outOfStockLine chọn dòng đầu tiên vượt tồn hoặc hết hàng', () => {
    const items = [
      { id: 'a', productName: 'A', quantity: 1, stock: 5 },
      { id: 'b', productName: 'B', quantity: 3, stock: 2 },
      { id: 'c', productName: 'C', quantity: 1, stock: 0 },
    ];
    expect(outOfStockLine(items)?.id).toBe('b');
    expect(outOfStockLine(items.slice(0, 1))).toBeUndefined();
  });
});

describe('overStockMessage', () => {
  it('còn ít hơn số đặt → nói còn bao nhiêu; hết hàng → bảo bỏ khỏi giỏ', () => {
    expect(overStockMessage('Dầu gội', 2)).toBe('Sản phẩm "Dầu gội" chỉ còn 2 sản phẩm. Vui lòng sửa số lượng trong giỏ.');
    expect(overStockMessage('Dầu gội', 0)).toBe('Sản phẩm "Dầu gội" đã hết hàng. Vui lòng bỏ khỏi giỏ để đặt các món còn lại.');
  });
});
