import { describe, expect, it } from 'vitest';
import { statValueVariant } from './account-stat';

describe('statValueVariant', () => {
  it('số ngắn giữ price-md', () => {
    expect(statValueVariant('0đ')).toBe('price-md');
    expect(statValueVariant('50.000đ')).toBe('price-md');
    expect(statValueVariant('999.999đ')).toBe('price-md');
    expect(statValueVariant('2 mã')).toBe('price-md');
    expect(statValueVariant('—')).toBe('price-md');
  });

  it('ví từ một triệu (10 ký tự liền nhau) xuống price-sm', () => {
    expect(statValueVariant('1.000.000đ')).toBe('price-sm');
    expect(statValueVariant('1.234.567đ')).toBe('price-sm');
    expect(statValueVariant('12.345.678đ')).toBe('price-sm');
  });

  it('chỉ tính từ dài nhất: "điểm" đứng riêng sau khoảng trắng nên không kéo dài từ', () => {
    expect(statValueVariant('1.234.567 điểm')).toBe('price-md');
    expect(statValueVariant('12.345.678 điểm')).toBe('price-sm');
    expect(statValueVariant('123.456.789 điểm')).toBe('price-sm');
  });
});
