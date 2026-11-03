import { describe, expect, it } from 'vitest';
import { statValueFontSize, statValueScale, statValueWidthEm } from './stat-value-fit';

/*
 * Số đo thật (Playwright + Chromium, Inter 700 tabular-nums, 15px) lấy từ ô thống kê ở /ctv/gian-hang:
 * chỗ trống chữ 90px ở khổ 375, 72px ở khổ 320. Bề ngang đo được tính theo em:
 *   836.000đ 4,778 | 1.052.000đ 5,693 | 10.282.000đ và 99.999.000đ 6,339 | 888.888.888đ 6,986 | 1.000.000.000đ 7,901.
 */
const MEASURED_EM: Record<string, number> = {
  '836.000đ': 4.778,
  '1.052.000đ': 5.693,
  '10.282.000đ': 6.339,
  '99.999.000đ': 6.339,
  '888.888.888đ': 6.986,
  '1.000.000.000đ': 7.901,
};

describe('statValueWidthEm', () => {
  it('ước lượng không thấp hơn số đo thật và không cao quá 6%', () => {
    for (const [value, measured] of Object.entries(MEASURED_EM)) {
      const est = statValueWidthEm(value);
      expect(est, value).toBeGreaterThanOrEqual(measured);
      expect(est / measured, value).toBeLessThan(1.06);
    }
  });
});

describe('statValueScale', () => {
  it('số ngắn giữ nguyên cỡ', () => {
    expect(statValueScale('39')).toBe(1);
    expect(statValueScale('12.000đ')).toBe(1);
  });

  it('giá trị ghim theo số đo thật ở ô 72px', () => {
    expect(statValueScale('836.000đ')).toBe(1);
    expect(statValueScale('1.052.000đ')).toBe(0.83);
    expect(statValueScale('10.282.000đ')).toBe(0.75);
    expect(statValueScale('99.999.000đ')).toBe(0.75);
    expect(statValueScale('888.888.888đ')).toBe(0.68);
  });

  it('chữ co theo hệ số vẫn vừa 72px (khổ 320) cho số đo thật', () => {
    for (const value of ['1.052.000đ', '10.282.000đ', '99.999.000đ', '888.888.888đ']) {
      expect(MEASURED_EM[value]! * 15 * statValueScale(value), value).toBeLessThanOrEqual(72);
    }
  });

  it('chuỗi cực dài không co dưới 0,65', () => {
    expect(statValueScale('1.000.000.000.000đ')).toBe(0.65);
  });

  it('font-size dùng token, không số cứng', () => {
    expect(statValueFontSize('39')).toBe('var(--type-body-md-size)');
    expect(statValueFontSize('10.282.000đ')).toBe('calc(var(--type-body-md-size) * 0.75)');
  });
});
