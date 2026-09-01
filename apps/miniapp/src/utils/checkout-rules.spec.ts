import { describe, it, expect } from 'vitest';
import { isInvoiceValid, shouldFallbackToCod, type InvoiceInfo } from './checkout-rules';

const emptyInvoice: InvoiceInfo = { taxCode: '', companyName: '', address: '', email: '' };
const validInvoice: InvoiceInfo = {
  taxCode: '0312345678',
  companyName: 'Cty ABC',
  address: '123 Lê Lợi',
  email: 'ke-toan@abc.vn',
};

describe('isInvoiceValid', () => {
  it('không yêu cầu xuất hoá đơn → luôn hợp lệ dù các trường rỗng', () => {
    expect(isInvoiceValid(false, emptyInvoice)).toBe(true);
  });

  it('yêu cầu xuất + thiếu bất kỳ trường nào → không hợp lệ', () => {
    expect(isInvoiceValid(true, emptyInvoice)).toBe(false);
    expect(isInvoiceValid(true, { ...validInvoice, taxCode: '' })).toBe(false);
    expect(isInvoiceValid(true, { ...validInvoice, companyName: '   ' })).toBe(false);
  });

  it('yêu cầu xuất + email sai định dạng → không hợp lệ', () => {
    expect(isInvoiceValid(true, { ...validInvoice, email: 'not-an-email' })).toBe(false);
  });

  it('yêu cầu xuất + đủ 4 trường hợp lệ → hợp lệ', () => {
    expect(isInvoiceValid(true, validInvoice)).toBe(true);
  });
});

describe('shouldFallbackToCod', () => {
  it('WALLET không đủ số dư trả tổng đơn → true', () => {
    expect(shouldFallbackToCod('WALLET', 50_000, 0, 100_000)).toBe(true);
  });

  it('WALLET đủ số dư → false', () => {
    expect(shouldFallbackToCod('WALLET', 200_000, 0, 100_000)).toBe(false);
  });

  it('XU không đủ số dư trả tổng đơn → true', () => {
    expect(shouldFallbackToCod('XU', 0, 50_000, 100_000)).toBe(true);
  });

  it('COD hoặc BANK_TRANSFER không bao giờ tự fallback (không dùng số dư)', () => {
    expect(shouldFallbackToCod('COD', 0, 0, 100_000)).toBe(false);
    expect(shouldFallbackToCod('BANK_TRANSFER', 0, 0, 100_000)).toBe(false);
  });
});
