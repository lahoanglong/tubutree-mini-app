import { needsVariationPicker } from './variation-picker';

/** Lời báo khi bấm giỏ nhanh mà SP vừa hết hàng: không hứa ngày hàng về, chỉ đường sang SP khác. Mini App và web dùng chung. */
export const QUICK_ADD_SOLD_OUT = 'Sản phẩm vừa hết hàng. Bạn xem sản phẩm khác nhé.';

export type QuickAddPlan = { kind: 'add'; variationId: string } | { kind: 'pick' } | { kind: 'soldOut' };

/**
 * Nút giỏ nhanh trên thẻ sản phẩm (không có chi tiết phân loại trong thẻ, nên phải tải chi tiết rồi hỏi hàm này):
 * một phân loại còn hàng thì thêm thẳng, từ hai phân loại thì mở bảng chọn (cùng luật Thêm vào giỏ ở trang chi tiết),
 * hết hàng hoặc thiếu dữ liệu thì không thêm gì.
 */
export function quickAddPlan(variations: readonly { id: string; stock: number }[]): QuickAddPlan {
  if (!variations.some((v) => v.stock > 0)) return { kind: 'soldOut' };
  if (needsVariationPicker(variations)) return { kind: 'pick' };
  return { kind: 'add', variationId: variations[0]!.id };
}
