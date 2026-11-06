import { describe, expect, it } from 'vitest';
import { STAT_VALUE_LINE_HEIGHT, statValueTracking, statValueVariant } from './account-stat';

describe('statValueVariant: cỡ theo độ dài cả chuỗi để số vừa một dòng trong ô 85px ở 320px', () => {
  it('tới 8 ký tự giữ price-md', () => {
    expect(statValueVariant('0đ')).toBe('price-md');
    expect(statValueVariant('50.000đ')).toBe('price-md');
    expect(statValueVariant('999.999đ')).toBe('price-md');
    expect(statValueVariant('999 điểm')).toBe('price-md');
    expect(statValueVariant('2 mã')).toBe('price-md');
    expect(statValueVariant('—')).toBe('price-md');
  });

  it('9–10 ký tự xuống price-sm: Điểm Xanh từ 1.000 điểm (trước đây gãy "điểm" xuống dòng), ví từ một triệu', () => {
    expect(statValueVariant('1.000 điểm')).toBe('price-sm');
    expect(statValueVariant('9.999 điểm')).toBe('price-sm');
    expect(statValueVariant('1.000.000đ')).toBe('price-sm');
    expect(statValueVariant('9.999.999đ')).toBe('price-sm');
  });

  it('từ 11 ký tự xuống label 12px: ví 10 triệu tới 100 triệu (trước đây tràn 4px ở 320px), điểm từ 10.000', () => {
    expect(statValueVariant('10.000.000đ')).toBe('label');
    expect(statValueVariant('99.999.999đ')).toBe('label');
    expect(statValueVariant('100.000.000đ')).toBe('label');
    expect(statValueVariant('12.345 điểm')).toBe('label');
    expect(statValueVariant('999.999 điểm')).toBe('label');
    expect(statValueVariant('1.234.567 điểm')).toBe('label');
  });

  it('đếm theo ký tự hiển thị, bỏ khoảng trắng hai đầu', () => {
    expect(statValueVariant(' 999.999đ ')).toBe('price-md');
    expect(statValueVariant('9.999 điểm')).toBe(statValueVariant('9.999 điểm'.normalize('NFC')));
  });

  it('chỉ cỡ label khít chữ lại', () => {
    expect(statValueTracking('label')).toBe('-0.02em');
    expect(statValueTracking('price-sm')).toBeUndefined();
    expect(statValueTracking('price-md')).toBeUndefined();
  });

  it('chiều cao dòng cố định theo dòng price-md cho mọi cỡ', () => {
    expect(STAT_VALUE_LINE_HEIGHT).toBe('calc(var(--type-price-md-size) * var(--type-price-md-lh))');
  });
});
