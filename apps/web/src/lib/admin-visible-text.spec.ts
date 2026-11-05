import { describe, expect, it } from 'vitest';
import { hasVisibleText } from './admin-visible-text';

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
