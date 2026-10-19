import { describe, expect, it } from 'vitest';
import { safeHexColor } from './safe-color';

// D15-01: màu do chủ nhãn/gian hàng nhập đi thẳng vào style; chỉ nhận #RGB hoặc #RRGGBB.
describe('safeHexColor', () => {
  it('nhận #RGB và #RRGGBB (không phân biệt hoa thường)', () => {
    expect(safeHexColor('#abc')).toBe('#abc');
    expect(safeHexColor('#A1B2C3')).toBe('#A1B2C3');
  });

  it('bỏ khoảng trắng hai đầu', () => {
    expect(safeHexColor('  #123456 ')).toBe('#123456');
  });

  it.each([
    'red',
    'red;background:url(https://evil.example/x)',
    '#123456;background:url(x)',
    '#123456}body{display:none',
    'url(javascript:alert(1))',
    'rgb(0,0,0)',
    '#12345',
    '#1234567',
    '#ggg',
    '123456',
    'var(--x)',
    '',
  ])('chuỗi độc hoặc sai khuôn %j bị bỏ', (v) => {
    expect(safeHexColor(v)).toBeUndefined();
  });

  it('không phải chuỗi thì bỏ', () => {
    expect(safeHexColor(null)).toBeUndefined();
    expect(safeHexColor(undefined)).toBeUndefined();
    expect(safeHexColor(123 as never)).toBeUndefined();
  });
});
