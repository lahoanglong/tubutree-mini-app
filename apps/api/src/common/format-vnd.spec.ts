import { formatVndDigits, formatVndText } from './format-vnd';

describe('format-vnd', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1_000, '1.000'],
    [80_000, '80.000'],
    [1_234_567, '1.234.567'],
  ])('formatVndDigits(%i) = %s (không phụ thuộc ICU của máy)', (n, out) => {
    expect(formatVndDigits(n)).toBe(out);
  });

  it('formatVndText thêm chữ "đ" sau đúng chuỗi của formatVndDigits', () => {
    expect(formatVndText(1_234_567)).toBe('1.234.567đ');
    expect(formatVndText(0)).toBe('0đ');
  });
});
