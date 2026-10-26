/** Chữ và điểm đến của nút "Sao chép" / "Dùng ngay" trên thẻ mã giảm giá (Mini App và web dùng chung). */
export const couponUseCopy = {
  copy: 'Sao chép',
  copyAria: (code: string) => `Sao chép mã ${code}`,
  copied: 'Đã sao chép mã',
  copyFailed: 'Không sao chép được, hãy đọc mã khi thanh toán',
  use: 'Dùng ngay',
  useAria: (code: string) => `Dùng mã ${code} ngay`,
  /** Mã đã chọn sẵn ở giỏ nhưng chưa dùng được cho giỏ này (đơn tối thiểu, phạm vi sản phẩm): nói lý do của máy chủ, không im lặng. */
  notApplied: (reason: string) => `Chưa chọn sẵn được mã: ${reason}`,
} as const;

export type CouponUseTarget = 'cart' | 'products';

/** Giỏ có hàng thì tới giỏ (chọn sẵn mã ở đó), chưa có thì tới danh sách sản phẩm để mua. */
export function couponUseTarget(cartItemCount: number): CouponUseTarget {
  return cartItemCount > 0 ? 'cart' : 'products';
}
