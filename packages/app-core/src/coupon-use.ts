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
  /** Giỏ đang giữ mã khác: nói rõ mã cũ đã bị thay để khách không ngạc nhiên ở bước thanh toán. */
  switched: (code: string) => `Đã đổi sang mã ${code}`,
} as const;

export type CouponUseTarget = 'cart' | 'products';

/** Giỏ có hàng thì tới giỏ (chọn sẵn mã ở đó), chưa có thì tới danh sách sản phẩm để mua. */
export function couponUseTarget(cartItemCount: number): CouponUseTarget {
  return cartItemCount > 0 ? 'cart' : 'products';
}

export type CouponUseOutcome = { kind: 'ok' } | { kind: 'switched'; text: string } | { kind: 'notApplied'; text: string };

/**
 * Kết quả sau khi áp mã vào giỏ bằng "Dùng ngay". `previous` là mã giỏ đang giữ TRƯỚC khi áp. Máy chủ giữ mã nhưng chưa
 * tính giảm (đơn tối thiểu, phạm vi sản phẩm) thì nói lý do; mã khác với mã cũ thì báo đã đổi.
 */
export function couponUseOutcome(
  previous: string | null | undefined,
  code: string,
  cart: { couponCode: string | null; discount: number; freeship?: boolean; couponNotice?: string | null },
): CouponUseOutcome {
  if (cart.couponNotice && cart.discount === 0 && !cart.freeship) return { kind: 'notApplied', text: couponUseCopy.notApplied(cart.couponNotice) };
  const now = (cart.couponCode ?? code).toUpperCase();
  if (previous && previous.toUpperCase() !== now) return { kind: 'switched', text: couponUseCopy.switched(now) };
  return { kind: 'ok' };
}
