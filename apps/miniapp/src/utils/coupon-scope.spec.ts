import { describe, expect, it } from 'vitest';
import { cartProductIds } from './coupon-scope';

describe('cartProductIds', () => {
  it('trả sản phẩm của mọi dòng; API cũ thiếu productId thì undefined để không khoá mã sai', () => {
    expect(cartProductIds([{ productId: 'a' }, { productId: 'b' }])).toEqual(['a', 'b']);
    expect(cartProductIds([{ productId: 'a' }, {}])).toBeUndefined();
  });
});
