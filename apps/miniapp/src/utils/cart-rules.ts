import type { CartLine, CartSummary } from '../services/shop-api';

/**
 * Tính lại tổng giỏ phía client cho optimistic update. Combo và giảm của mã phụ thuộc cả bộ hàng trong giỏ nên để 0 cho tới khi
 * máy chủ trả số mới (giữ số cũ sẽ hiện combo của món vừa xoá).
 */
export function recompute(cart: CartSummary, items: CartLine[]): CartSummary {
  const lines = items.map((l) => ({ ...l, total: l.unitPrice * l.quantity }));
  return {
    ...cart,
    items: lines,
    subtotal: lines.reduce((s, l) => s + l.total, 0),
    comboDiscount: 0,
    discount: 0,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
  };
}
