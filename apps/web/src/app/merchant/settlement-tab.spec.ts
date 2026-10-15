import { describe, expect, it } from 'vitest';
import { signedVnd } from './settlement-tab';

describe('signedVnd', () => {
  it('số âm có dấu trừ, số dương giữ nguyên', () => {
    expect(signedVnd(-26400)).toBe('−26.400đ');
    expect(signedVnd(218600)).toBe('218.600đ');
  });

  it('không hiện "-0đ" khi cột bị đảo dấu của số 0 (dòng trả hàng không có COD)', () => {
    expect(signedVnd(-0)).toBe('0đ');
    expect(signedVnd(0)).toBe('0đ');
  });
});
