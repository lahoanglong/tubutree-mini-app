import { fillCopy } from '../shop-copy';

/**
 * Nhãn của số "tạm tính" ở chân giỏ: tiền hàng đã trừ giảm combo, mã giảm giá và ưu đãi hạng, CHƯA gồm phí giao. Có khoản giảm thì ghi
 * "(đã giảm)" để khách không nhầm với "Tạm tính" gộp chưa trừ gì ở màn Thanh toán; chưa có thì chỉ "Tạm tính". Mini App và web (mọi khổ) cùng gọi
 * hàm này, không ai ghi "Tổng" cho số chưa gồm phí giao. `discountSum` là tổng ba khoản giảm đang hiển thị (không hợp lệ thì coi như 0).
 */
export function cartTotalLabel(discountSum: number): string {
  return fillCopy(Number.isFinite(discountSum) && discountSum > 0 ? 'cart.subtotalNet' : 'cart.subtotal');
}
