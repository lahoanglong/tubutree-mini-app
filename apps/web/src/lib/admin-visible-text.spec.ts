import { describe, expect, it } from 'vitest';
import { hasVisibleText, isPhoneInput, stripInvisible, trimVisible } from './admin-visible-text';

describe('hasVisibleText: ô bắt buộc của màn quản trị có chữ nhìn thấy được', () => {
  it('chuỗi rỗng hoặc chỉ khoảng trắng → false', () => {
    expect(hasVisibleText('')).toBe(false);
    expect(hasVisibleText('   \t\n  ')).toBe(false);
    expect(hasVisibleText(' 　')).toBe(false);
  });

  it.each([
    ['U+00AD soft hyphen', '­'],
    ['U+180E', '᠎'],
    ['U+200B–U+200F (rộng 0, ZWNJ, ZWJ, dấu hướng)', '​‌‍‎‏'],
    ['U+202A–U+202E (khung hướng)', '‪‫‬‭‮'],
    ['U+2060–U+2064 (word joiner, ký hiệu vô hình)', '⁠⁡⁢⁣⁤'],
    ['U+2066–U+2069 (cô lập hướng)', '⁦⁧⁨⁩'],
    ['U+FEFF BOM', '﻿'],
    ['trộn khoảng trắng và ký tự vô hình', ' ​﻿⁠ ​'],
  ])('chỉ có %s → false', (_name, text) => {
    expect(hasVisibleText(text)).toBe(false);
  });

  it('có ít nhất một ký tự nhìn thấy → true, kể cả khi bọc bởi ký tự vô hình', () => {
    expect(hasVisibleText('a')).toBe(true);
    expect(hasVisibleText('​ Mã giảm giá ﻿')).toBe(true);
    expect(hasVisibleText('0912345678')).toBe(true);
  });

  it('U+200D giữa các thành phần emoji ghép không làm mất chữ nhìn thấy', () => {
    expect(hasVisibleText('👨‍👩‍👧')).toBe(true);
  });
});

describe('stripInvisible', () => {
  it('bỏ ký tự vô hình ở mọi vị trí, giữ khoảng trắng', () => {
    expect(stripInvisible('0912\u2060345\u200b678')).toBe('0912345678');
    expect(stripInvisible('\ufeff0912 345\u00ad 678\u200e')).toBe('0912 345 678');
    expect(stripInvisible('\u200b\u2060')).toBe('');
  });
});

describe('isPhoneInput: cùng luật với searchPhone của API (apps/api/src/modules/admin/admin-order-filter.ts)', () => {
  it.each(['0912345678', '+84 912 345 678', '0912.345.678', '(028) 3822-1234', ' 0912345678 ', '912345678', '0912\u2060345678', '\u200b0912345678'])(
    '%j là SĐT',
    (v) => expect(isPhoneInput(v)).toBe(true),
  );
  it.each(['', '   ', '12', '+', 'abc', '0912345678 Lan', '09123x45678', '\u200b\u200b', '84+912345678'])('%j không phải SĐT', (v) =>
    expect(isPhoneInput(v)).toBe(false),
  );
});

describe('trimVisible', () => {
  it('cắt khoảng trắng và ký tự vô hình ở hai đầu, giữ phần giữa', () => {
    expect(trimVisible('​ Công ty ‍ Tubu ﻿')).toBe('Công ty ‍ Tubu');
  });

  it('chuỗi chỉ toàn khoảng trắng và ký tự vô hình thành rỗng', () => {
    expect(trimVisible(' ​﻿⁠ ')).toBe('');
  });
});
