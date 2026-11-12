import { describe, expect, it } from 'vitest';
import { normalizeOrderSearchInput, normalizeVnPhoneInput, parseVnPhoneInput, stripInvisible } from './phone-input';

describe('stripInvisible', () => {
  it('bỏ ký tự vô hình khi dán từ Zalo/Word và đổi dấu cách cứng thành dấu cách thường', () => {
    expect(stripInvisible('\u200B0912\u200C345\u200D678\u200E\u200F')).toBe('0912345678');
    expect(stripInvisible('\u202A+84 912\u202C')).toBe('+84 912');
    expect(stripInvisible('\u2060\uFEFFab\u00ADc')).toBe('abc');
    expect(stripInvisible('a\u00A0b')).toBe('a b');
  });

  it('cắt khoảng trắng hai đầu, kể cả khi bị che bởi ký tự vô hình', () => {
    expect(stripInvisible(' \u200B 0912 \u200B ')).toBe('0912');
    expect(stripInvisible('\u00A0\u00A0x\u00A0')).toBe('x');
  });

  it('chuỗi rỗng hoặc chỉ toàn ký tự vô hình → rỗng', () => {
    expect(stripInvisible('')).toBe('');
    expect(stripInvisible('\u200B\uFEFF\u00A0')).toBe('');
  });
});

describe('normalizeVnPhoneInput — các dạng khách dán', () => {
  const CASES: [string, string][] = [
    ['0912345678', '0912345678'],
    ['0912 345 678', '0912345678'],
    ['0912.345.678', '0912345678'],
    ['091-234-5678', '0912345678'],
    ['(091) 234 5678', '0912345678'],
    ['+84912345678', '0912345678'],
    ['+84 912 345 678', '0912345678'],
    ['(+84) 912 345 678', '0912345678'],
    ['84912345678', '0912345678'],
    ['84 912 345 678', '0912345678'],
    ['0084912345678', '0912345678'],
    ['0084 912 345 678', '0912345678'],
    ['  0912345678  ', '0912345678'],
    ['\u200B0912\u200B345\u200B678\u200B', '0912345678'],
    ['\u202A+84 912 345 678\u202C', '0912345678'],
    ['0912\u00A0345\u00A0678', '0912345678'],
    ['0912–345–678', '0912345678'],
    ['０９１２３４５６７８', '0912345678'],
    ['＋８４ ９１２ ３４５ ６７８', '0912345678'],
    ['（０９１）２３４－５６７８', '0912345678'],
  ];
  for (const [input, expected] of CASES) {
    it(`${JSON.stringify(input)} → ${expected}`, () => {
      expect(normalizeVnPhoneInput(input)).toBe(expected);
      expect(parseVnPhoneInput(input)).toBe(expected);
    });
  }

  it('số không đúng dạng: bỏ ký tự vô hình và dấu ngăn nhóm nhưng giữ nguyên chữ khác', () => {
    expect(normalizeVnPhoneInput('091 234 567')).toBe('091234567');
    expect(normalizeVnPhoneInput('0912.345.67a')).toBe('091234567a');
    expect(normalizeVnPhoneInput('\u200B(+84) 12\u200B')).toBe('+8412');
    expect(normalizeVnPhoneInput('abc')).toBe('abc');
    expect(normalizeVnPhoneInput('')).toBe('');
    expect(normalizeVnPhoneInput(' \u200B ')).toBe('');
  });

  it('số không đúng dạng thì parseVnPhoneInput trả null', () => {
    for (const bad of ['', '123', '091234567', '09123456789', '912345678', '+8491234567', 'abc', '0912345678x', '84 12 345 678']) {
      expect(parseVnPhoneInput(bad), bad).toBeNull();
    }
  });

  it('dãy 0 + 9 số đầu 0 (không phải số di động) giữ nguyên để luật cũ ở checkout-form quyết định', () => {
    expect(normalizeVnPhoneInput('0012345678')).toBe('0012345678');
    expect(normalizeVnPhoneInput('+84012345678')).toBe('+84012345678');
  });

  it('lặp lại trên kết quả không đổi (idempotent)', () => {
    for (const [input] of CASES) {
      const once = normalizeVnPhoneInput(input);
      expect(normalizeVnPhoneInput(once)).toBe(once);
    }
  });
});

describe('normalizeOrderSearchInput', () => {
  it('bỏ ký tự vô hình và khoảng trắng đầu/cuối: mã đơn dán từ Zalo vẫn khớp', () => {
    expect(normalizeOrderSearchInput('\u200BTUBU-1234\u200B')).toBe('TUBU-1234');
    expect(normalizeOrderSearchInput('  \u00A0TUBU-1234\uFEFF ')).toBe('TUBU-1234');
    expect(normalizeOrderSearchInput('\u202ATUBU-1234\u202C')).toBe('TUBU-1234');
  });

  it('gộp khoảng trắng liên tiếp (kể cả xuống dòng, dấu cách cứng) thành một dấu cách', () => {
    expect(normalizeOrderSearchInput('nước   rửa\u00A0\u00A0chén\n lá')).toBe('nước rửa chén lá');
    expect(normalizeOrderSearchInput('a \u200B b')).toBe('a b');
  });

  it('không đổi hoa/thường, không cắt tên sản phẩm dài, không bỏ dấu', () => {
    const long = `Nước Rửa Chén Hữu Cơ ${'x'.repeat(80)}`;
    expect(normalizeOrderSearchInput(long)).toBe(long);
    expect(normalizeOrderSearchInput('tuBU-9Ab')).toBe('tuBU-9Ab');
  });

  it('chuỗi trắng hoặc chỉ ký tự vô hình → rỗng', () => {
    expect(normalizeOrderSearchInput('   ')).toBe('');
    expect(normalizeOrderSearchInput('\u200B\u200B')).toBe('');
  });
});
