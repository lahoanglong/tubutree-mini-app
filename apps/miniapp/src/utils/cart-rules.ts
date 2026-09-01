import type { CartLine, CartSummary } from '../services/shop-api';

/** Tính lại tổng giỏ phía client cho optimistic update (discount để server tính lại sau). */
export function recompute(cart: CartSummary, items: CartLine[]): CartSummary {
  const lines = items.map((l) => ({ ...l, total: l.unitPrice * l.quantity }));
  return {
    ...cart,
    items: lines,
    subtotal: lines.reduce((s, l) => s + l.total, 0),
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
  };
}
