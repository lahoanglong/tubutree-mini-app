import { describe, expect, it } from 'vitest';
import { returnsPromise } from './returns-copy';

describe('returnsPromise', () => {
  it('0 ngày: API từ chối mọi đổi trả nên không hứa gì (null)', () => {
    expect(returnsPromise(0)).toBeNull();
  });

  it('có số ngày dương thì nêu số ngày từ cấu hình', () => {
    expect(returnsPromise(7)).toBe('Đổi trả trong 7 ngày nếu lỗi');
    expect(returnsPromise(14)).toBe('Đổi trả trong 14 ngày nếu lỗi');
  });

  it.each([undefined, null, -3, NaN, Infinity, '7', {}])('chưa biết hoặc không hợp lệ (%s) thì không nêu con số', (v) => {
    expect(returnsPromise(v)).toBe('Đổi trả nếu sản phẩm lỗi');
  });
});
