import { describe, it, expect } from 'vitest';
import { formatRate, parseRateInput } from './commission-rates';

describe('parseRateInput — % hoa hồng CTV là phần trăm (10 = 10%)', () => {
  it.each([
    ['10', 10],
    ['7,5', 7.5],
    ['7.25', 7.25],
    [' 12 % ', 12],
    ['0', 0],
    ['50', 50],
  ])('nhận "%s" → %s', (text, rate) => {
    expect(parseRateInput(text, 50)).toEqual({ rate });
  });

  it.each([
    ['', 'Nhập % hoa hồng.'],
    ['abc', 'Chỉ nhập số'],
    ['-1', 'Chỉ nhập số'],
    ['1,234', 'Tối đa 2 chữ số thập phân.'],
    ['50,5', 'Tối đa 50%'],
  ])('từ chối "%s"', (text, msg) => {
    const r = parseRateInput(text, 50);
    expect('error' in r && r.error).toContain(msg);
  });
});

describe('formatRate', () => {
  it('kiểu Việt Nam, null là "Chưa có %"', () => {
    expect(formatRate(7.5)).toBe('7,5%');
    expect(formatRate(10)).toBe('10%');
    expect(formatRate(null)).toBe('Chưa có %');
  });
});
