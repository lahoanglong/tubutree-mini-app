import { describe, it, expect } from 'vitest';
import { formatVnd } from './format-vnd';
import { formatVnd as fromApi } from './api';
import { formatVnd as fromShopClient } from './shop-client';

describe('formatVnd', () => {
  it.each([
    [0, '0đ'],
    [289000, '289.000đ'],
    [1000000, '1.000.000đ'],
  ])('%d -> %s', (n, expected) => {
    expect(formatVnd(n)).toBe(expected);
  });

  it('api và shop-client re-export cùng một hàm', () => {
    expect(fromApi).toBe(formatVnd);
    expect(fromShopClient).toBe(formatVnd);
  });
});
