import { describe, expect, it } from 'vitest';
import { formatPhoneDisplay } from './phone';

describe('formatPhoneDisplay (R5-BUYER-5)', () => {
  it.each([
    ['18001234', '1800 1234'],
    ['19001234', '1900 1234'],
    ['1800123456', '1800 123456'],
    ['0899149229', '0899 149 229'],
    ['0899 149 229', '0899 149 229'],
    ['0899.149.229', '0899 149 229'],
    ['0899-149-229', '0899 149 229'],
    ['+84899149229', '0899 149 229'],
    ['+84 899 149 229', '0899 149 229'],
    ['84899149229', '0899 149 229'],
    ['02838221234', '028 3822 1234'],
    ['028 3822 1234', '028 3822 1234'],
  ])('%s → %s', (raw, shown) => {
    expect(formatPhoneDisplay(raw)).toBe(shown);
  });

  it('số lạ (ngắn, dài, có chữ) giữ nguyên đã cắt khoảng trắng đầu cuối, không đoán', () => {
    expect(formatPhoneDisplay(' 115 ')).toBe('115');
    expect(formatPhoneDisplay('ext. 12')).toBe('ext. 12');
    expect(formatPhoneDisplay('089914922900')).toBe('089914922900');
  });

  it('rỗng hoặc thiếu → chuỗi rỗng', () => {
    expect(formatPhoneDisplay('')).toBe('');
    expect(formatPhoneDisplay(null)).toBe('');
    expect(formatPhoneDisplay(undefined)).toBe('');
  });
});
