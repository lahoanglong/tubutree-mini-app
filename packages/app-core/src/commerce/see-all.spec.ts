import { describe, expect, it } from 'vitest';
import { seeAllLabel } from './see-all';

describe('seeAllLabel (một mẫu "Tất cả (n)")', () => {
  it('ẩn khi không có mục nào hoặc số không hợp lệ', () => {
    for (const n of [0, -1, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(seeAllLabel(n)).toBeNull();
  });
  it('từ một mục trở lên ghi "Tất cả (n)"', () => {
    expect(seeAllLabel(1)).toBe('Tất cả (1)');
    expect(seeAllLabel(16)).toBe('Tất cả (16)');
  });
});
