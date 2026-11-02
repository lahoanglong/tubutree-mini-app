/** Mã lỗi ổn định: batch thêm giỏ bị từ chối vì một món (hết hàng, ngừng bán); không có món nào được ghi. API ném, FE so khớp. Vượt trần số lượng thì API trả 400 thường, không mang mã này. */
export const CART_BATCH_REJECTED = 'CART_BATCH_REJECTED';

/** Nguồn của một nhóm combo trong giỏ: combo của gian hàng đang ghi công, "mua đủ bộ giảm %" hoặc "mua kèm" toàn sàn. */
export type CartComboKind = 'STOREFRONT' | 'BUNDLE_PCT' | 'ADDON';

/**
 * Một combo ĐÃ KHỚP của giỏ, lấy từ chính lần khớp tính `comboDiscount`: tổng `discount` của mọi nhóm bằng `comboDiscount`. Mỗi dòng giảm giá thuộc đúng một nhóm
 * (dòng khớp nhiều combo thuộc combo cho khoản lớn nhất, đúng luật "mỗi dòng lấy khoản lớn nhất").
 */
export interface CartComboGroup {
  /** `collection:<id>` (combo gian hàng) hoặc `bundle:<id>`. */
  id: string;
  kind: CartComboKind;
  title: string;
  /** Tổng khoản giảm của nhóm (đồng). */
  discount: number;
  /** `CartLine.id` của các dòng mang khoản giảm của nhóm, theo thứ tự dòng trong giỏ. */
  lineIds: string[];
  /** `CartLine.id` mà bỏ MỘT mình nó thì bộ không còn khớp (mất cả `discount`); gồm cả sản phẩm chính của "mua kèm", dòng này không nằm trong `lineIds`. */
  keyLineIds: string[];
}
