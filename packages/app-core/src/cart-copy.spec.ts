import { describe, expect, it } from 'vitest';
import { CART_EMPTY, CART_OUT_OF_STOCK, CART_OVER_STOCK_BLOCKED, cartOutOfStockBlocked, heldPointsNote } from './cart-copy';

describe('cart-copy', () => {
  it('chữ hết hàng và chặn thanh toán', () => {
    expect(CART_OUT_OF_STOCK).toBe('Sản phẩm đã hết hàng');
    expect(CART_OVER_STOCK_BLOCKED).toBe('Giảm số lượng sản phẩm vượt tồn kho để thanh toán.');
    expect(cartOutOfStockBlocked(['Kính'])).toBe('"Kính" đã hết hàng. Bỏ chọn hoặc xoá sản phẩm này để thanh toán.');
    expect(cartOutOfStockBlocked(['A', 'B'])).toBe('"A", "B" đã hết hàng. Bỏ chọn hoặc xoá các sản phẩm này để thanh toán.');
  });
  it('giỏ trống', () => {
    expect(CART_EMPTY).toEqual({ heading: 'Giỏ còn trống đấy', body: 'Khám phá sản phẩm Tubu chọn riêng cho bạn', cta: 'Khám phá ngay' });
  });
  it('điểm bị giữ', () => {
    expect(heldPointsNote(1250)).toBe('1.250 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được');
  });
});
