import type { CartLine, CartSummary } from '../services/shop-api';

/**
 * Tính lại tổng giỏ phía client cho optimistic update. Combo, giảm của mã và giảm hạng phụ thuộc cả bộ hàng trong giỏ nên để 0 cho tới khi
 * máy chủ trả số mới (giữ số cũ sẽ hiện combo của món vừa xoá).
 * Chỉ dòng `editedId` được nhân lại: thành tiền của dòng khác do máy chủ tính (giờ vàng vượt suất có hai mức giá nên không bằng
 * unitPrice × quantity) và không được đổi chỉ vì khách sửa dòng bên cạnh.
 */
export function recompute(cart: CartSummary, items: CartLine[], editedId?: string): CartSummary {
  const lines = items.map((l) => (l.id === editedId ? { ...l, total: l.unitPrice * l.quantity } : l));
  return {
    ...cart,
    items: lines,
    subtotal: lines.reduce((s, l) => s + l.total, 0),
    comboDiscount: 0,
    discount: 0,
    tierDiscount: 0,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
  };
}
