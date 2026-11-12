import { describe, expect, it } from 'vitest';
import {
  ADDRESS_FIELD_ORDER,
  INVOICE_FIELD_ORDER,
  firstInvalidAddressField,
  firstInvalidInvoiceField,
  validateAddressFields,
  validateInvoiceFields,
} from './checkout-form';

const GEO = { provinceCode: '84_VN79', wardCode: '84_VN79_26734' };
const OK = { recipient: 'Nguyễn Văn A', phone: '0901234567', street: '12 Lê Lợi' };

describe('validateAddressFields', () => {
  it('đủ và đúng thì không lỗi', () => {
    expect(validateAddressFields(OK, GEO)).toEqual({});
  });

  it('mỗi ô thiếu có câu riêng, không dùng một câu chung cho mọi ô', () => {
    const e = validateAddressFields({ recipient: ' ', phone: '', street: '' }, { provinceCode: '', wardCode: '' });
    expect(e).toEqual({
      recipient: 'Nhập tên người nhận.',
      phone: 'Nhập số điện thoại.',
      province: 'Chọn tỉnh/thành.',
      ward: 'Chọn phường/xã.',
      street: 'Nhập số nhà, tên đường.',
    });
  });

  it('SĐT sai định dạng: câu nói rõ đúng dạng cần nhập; chấp nhận +84 và khoảng trắng', () => {
    expect(validateAddressFields({ ...OK, phone: '123' }, GEO).phone).toBe('Số điện thoại chưa đúng. Nhập 10 số bắt đầu bằng 0 (hoặc +84 và 9 số).');
    expect(validateAddressFields({ ...OK, phone: '+84 901 234 567' }, GEO).phone).toBeUndefined();
    expect(validateAddressFields({ ...OK, phone: '090 123 4567' }, GEO).phone).toBeUndefined();
  });

  it('SĐT dán từ Zalo (chấm, gạch, ngoặc, 84, 0084, ký tự vô hình, số full-width) vẫn hợp lệ', () => {
    for (const pasted of [
      '0901.234.567',
      '090-123-4567',
      '(090) 123 4567',
      '(+84) 901 234 567',
      '84901234567',
      '84 901 234 567',
      '0084901234567',
      '\u200B0901234567\u200B',
      '\u202A+84 901 234 567\u202C',
      '0901\u00A0234\u00A0567',
      '０９０１２３４５６７',
    ]) {
      expect(validateAddressFields({ ...OK, phone: pasted }, GEO).phone, pasted).toBeUndefined();
    }
  });

  it('SĐT sai vẫn báo đúng câu cũ, kể cả khi có dấu ngăn nhóm hoặc ký tự vô hình', () => {
    const MSG = 'Số điện thoại chưa đúng. Nhập 10 số bắt đầu bằng 0 (hoặc +84 và 9 số).';
    for (const bad of ['090.123.456', '(090) 123 45678', '84 90 123 456', '+8490123456', '0901234567x', '\u200Babc\u200B', '901234567']) {
      expect(validateAddressFields({ ...OK, phone: bad }, GEO).phone, bad).toBe(MSG);
    }
  });

  it('chỉ có ký tự vô hình hoặc dấu ngăn nhóm: coi là chưa nhập', () => {
    expect(validateAddressFields({ ...OK, phone: ' \u200B \u00A0' }, GEO).phone).toBe('Nhập số điện thoại.');
  });

  it('luật cũ cho dãy 0 + 9 số vẫn giữ: không đổi hành vi với số đã lưu trước đây', () => {
    expect(validateAddressFields({ ...OK, phone: '0012345678' }, GEO).phone).toBeUndefined();
  });

  it('tên và địa chỉ không chứa < >, không dài quá giới hạn của API', () => {
    expect(validateAddressFields({ ...OK, recipient: 'A<b>' }, GEO).recipient).toBe('Tên người nhận không được chứa ký tự < hoặc >.');
    expect(validateAddressFields({ ...OK, street: 'x'.repeat(256) }, GEO).street).toBe('Số nhà, tên đường tối đa 255 ký tự.');
    expect(validateAddressFields({ ...OK, recipient: 'x'.repeat(121) }, GEO).recipient).toBe('Tên người nhận tối đa 120 ký tự.');
  });
});

describe('firstInvalidAddressField', () => {
  it('trả ô lỗi đầu tiên theo thứ tự trên màn hình: tên, SĐT, tỉnh, phường, đường', () => {
    expect(ADDRESS_FIELD_ORDER).toEqual(['recipient', 'phone', 'province', 'ward', 'street']);
    expect(firstInvalidAddressField({ street: 'x', phone: 'y' })).toBe('phone');
    expect(firstInvalidAddressField({ ward: 'x', province: 'y' })).toBe('province');
    expect(firstInvalidAddressField({})).toBeNull();
  });
});

describe('validateInvoiceFields', () => {
  const INVOICE = { taxCode: '0312345678', companyName: 'Công ty A', address: '1 Phố Huế', email: 'ke-toan@congty.vn' };

  it('đủ và đúng thì không lỗi', () => {
    expect(validateInvoiceFields(INVOICE)).toEqual({});
  });

  it('thiếu từng trường: câu riêng cho từng ô', () => {
    expect(validateInvoiceFields({ taxCode: '', companyName: '', address: '', email: '' })).toEqual({
      taxCode: 'Nhập mã số thuế.',
      companyName: 'Nhập tên công ty.',
      address: 'Nhập địa chỉ xuất hoá đơn.',
      email: 'Nhập email nhận hoá đơn.',
    });
  });

  it('MST sai dạng và email sai dạng có câu riêng; MST chi nhánh và CCCD 12 số hợp lệ', () => {
    const e = validateInvoiceFields({ ...INVOICE, taxCode: '12345', email: 'khong-hop-le' });
    expect(e.taxCode).toBe('Mã số thuế gồm 10 số (chi nhánh thêm -3 số) hoặc 12 số.');
    expect(e.email).toBe('Email chưa đúng. Ví dụ: ten@congty.vn.');
    expect(validateInvoiceFields({ ...INVOICE, taxCode: '0312345678-001' })).toEqual({});
    expect(validateInvoiceFields({ ...INVOICE, taxCode: '012345678901' })).toEqual({});
  });

  it('firstInvalidInvoiceField theo thứ tự MST, tên công ty, địa chỉ, email', () => {
    expect(INVOICE_FIELD_ORDER).toEqual(['taxCode', 'companyName', 'address', 'email']);
    expect(firstInvalidInvoiceField({ email: 'x', address: 'y' })).toBe('address');
    expect(firstInvalidInvoiceField({})).toBeNull();
  });
});
