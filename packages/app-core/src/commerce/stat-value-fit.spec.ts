import { describe, expect, it } from 'vitest';
import { statValueFontSize, statValueScale } from './stat-value-fit';

describe('statValueScale', () => {
  it('số ngắn giữ nguyên cỡ', () => {
    expect(statValueScale('39')).toBe(1);
    expect(statValueScale('12.000đ')).toBe(1);
  });

  it('chuỗi dài co dần theo độ dài, không dưới 0,65', () => {
    const a = statValueScale('1.052.000đ');
    const b = statValueScale('10.282.000đ');
    expect(a).toBeLessThan(1);
    expect(b).toBeLessThan(a);
    expect(statValueScale('1.000.000.000.000đ')).toBe(0.65);
  });

  it('"10.282.000đ" ở ô 78px (chữ rộng 70px, cỡ 15px) vừa một dòng', () => {
    const scale = statValueScale('10.282.000đ');
    const widthPx = (8 * 0.6 + 2 * 0.3 + 0.6) * 15 * scale;
    expect(widthPx).toBeLessThanOrEqual(70);
  });

  it('font-size dùng token, không số cứng', () => {
    expect(statValueFontSize('39')).toBe('var(--type-body-md-size)');
    expect(statValueFontSize('10.282.000đ')).toMatch(/^calc\(var\(--type-body-md-size\) \* 0\.\d+\)$/);
  });
});
