import { describe, expect, it } from 'vitest';
import { SHOP_COPY } from '../shop-copy';
import { cartTotalLabel } from './cart-total';

// Một nhãn cho số "tạm tính đã trừ giảm giá, chưa gồm phí giao": Mini 375, web 375 và web 1280 cùng đọc hàm này (P2 #13).
describe('cartTotalLabel', () => {
  it.each([[0], [-1], [Number.NaN], [Number.NEGATIVE_INFINITY]])('chưa có khoản giảm nào (%s): "Tạm tính"', (sum) => {
    expect(cartTotalLabel(sum)).toBe('Tạm tính');
  });

  it.each([[1], [5_000], [123_456]])('có giảm %s: "Tạm tính (đã giảm)"', (sum) => {
    expect(cartTotalLabel(sum)).toBe('Tạm tính (đã giảm)');
  });

  it('chữ lấy từ SHOP_COPY, không ghi "Tổng" (số này chưa gồm phí giao) và không nhắc ship', () => {
    expect(SHOP_COPY['cart.subtotal']).toBe('Tạm tính');
    expect(SHOP_COPY['cart.subtotalNet']).toBe('Tạm tính (đã giảm)');
    for (const key of ['cart.subtotal', 'cart.subtotalNet']) expect(SHOP_COPY[key]).not.toMatch(/tổng|ship/i);
  });
});
