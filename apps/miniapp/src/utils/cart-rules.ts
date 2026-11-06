import type { CartLine, CartSummary } from '../services/shop-api';

/**
 * Tính lại tổng giỏ phía client cho optimistic update. Combo, giảm của mã và giảm hạng phụ thuộc cả bộ hàng trong giỏ nên để 0 cho tới khi
 * máy chủ trả số mới (giữ số cũ sẽ hiện combo của món vừa xoá).
 * Chỉ dòng `editedId` được nhân lại: thành tiền của dòng khác do máy chủ tính (giờ vàng vượt suất có hai mức giá nên không bằng
 * unitPrice × quantity) và không được đổi chỉ vì khách sửa dòng bên cạnh.
 */
export function recompute(cart: CartSummary, items: CartLine[], editedId?: string): CartSummary {
  const lines = items.map((l) => (l.id === editedId ? { ...l, total: l.unitPrice * l.quantity } : l));
  const present = new Set(lines.map((l) => l.id));
  // Nhóm combo: đổi số lượng không làm bộ mất khớp (luật khớp chỉ cần số lượng ≥ 1) nên giữ nhóm, kẻo khối nhảy mỗi lần bấm +/−. Xoá món khoá thì bộ không
  // còn khớp: bỏ nhóm. Xoá món mang giảm nhưng không khoá: nhóm còn, chỉ bỏ id đã xoá. Số tiền của nhóm GIỮ số máy chủ trả lần cuối (chỉ `comboDiscount` ở chân
  // về 0): đầu nhóm ghi `comboPending` để nơi vẽ giữ chỗ của số mà không hiện số cũ, nên khối không đổi chiều cao khi chờ máy chủ; hộp báo bỏ món vẫn biết
  // số sẽ mất nếu khách bỏ tiếp một món khi lần sửa trước còn bay. Máy chủ trả giỏ mới (không có cờ) thì khối ghi lại số.
  const comboGroups = cart.comboGroups
    ?.filter((g) => g.keyLineIds.every((id) => present.has(id)) && g.lineIds.some((id) => present.has(id)))
    .map((g) => ({ ...g, lineIds: g.lineIds.filter((id) => present.has(id)) }));
  return {
    ...cart,
    items: lines,
    ...(comboGroups ? { comboGroups } : {}),
    ...(comboGroups?.length ? { comboPending: true } : {}),
    subtotal: lines.reduce((s, l) => s + l.total, 0),
    comboDiscount: 0,
    discount: 0,
    tierDiscount: 0,
    couponShortfall: undefined,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
  };
}
