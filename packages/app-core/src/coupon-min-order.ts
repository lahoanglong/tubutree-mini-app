/**
 * Đơn tối thiểu của mã giảm giá khi giỏ đổi (Mini App và web dùng chung): nói số tiền cần mua thêm, và báo khi máy chủ gỡ mã vì giỏ rơi dưới mức.
 * Số tiền thiếu do máy chủ tính trên đúng phần hàng nó dùng để xét mã (loại Giờ vàng, trừ combo, hoặc đúng sản phẩm của mã), nên app không tự trừ từ tổng giỏ.
 */

export const couponMinOrderCopy = {
  /** Mã còn trong giỏ nhưng chưa áp: nối sau câu lý do của máy chủ. */
  held: (code: string, short: string) => `Mua thêm ${short} để áp mã ${code}.`,
  removed: (code: string, short: string) => `Đã gỡ mã ${code} vì giỏ chưa đủ đơn tối thiểu. Mua thêm ${short} để dùng lại.`,
  /** Sau khi mã bị gỡ, khách đã mua thêm đủ mức: mời chọn lại mã. */
  removedEnough: (code: string) => `Giỏ đã đủ đơn tối thiểu của mã ${code}. Bấm Chọn mã để dùng lại.`,
  /** Mã bị gỡ vì lý do khác đơn tối thiểu (hết hạn, bị tắt, hết lượt): nói lý do của máy chủ. */
  removedOther: (code: string, reason: string) => `Đã gỡ mã ${code}: ${reason}`,
  dismiss: 'Đóng',
  dismissAria: (code: string) => `Đóng lời báo mã ${code} đã gỡ`,
} as const;

/** Phần của giỏ hoặc báo giá mà lời báo mã đọc. Mọi trường tuỳ chọn: API cũ chưa trả `couponShortfall`. */
export interface HeldCouponSource {
  couponCode?: string | null;
  discount?: number;
  freeship?: boolean;
  couponNotice?: string | null;
  couponShortfall?: number | null;
}

/**
 * Lời báo khi giỏ giữ mã nhưng chưa áp (không giảm tiền, không miễn phí giao): câu lý do của máy chủ, kèm "Mua thêm … để áp mã" khi mã
 * chỉ thiếu đơn tối thiểu. null khi giỏ không giữ mã, mã đã có tác dụng, hoặc máy chủ không nói gì.
 */
export function heldCouponNotice(src: HeldCouponSource | null | undefined, formatMoney: (n: number) => string): string | null {
  if (!src?.couponCode) return null;
  if (!(src.discount === 0 || src.discount === undefined) || src.freeship) return null;
  const notice = src.couponNotice?.trim() || null;
  const short = src.couponShortfall != null && src.couponShortfall > 0 ? couponMinOrderCopy.held(src.couponCode, formatMoney(src.couponShortfall)) : null;
  if (!notice && !short) return null;
  return [notice, short].filter(Boolean).join(' ');
}

/**
 * Chữ lời báo mã ở giỏ và thanh toán: mã đang giữ chưa áp thì câu lý do kèm số cần mua thêm; mã đã có tác dụng mà máy chủ vẫn nói
 * (vd "Hàng Giờ vàng không được giảm thêm…") thì giữ nguyên câu của máy chủ. null khi không có gì để nói.
 */
export function couponNoticeText(src: HeldCouponSource | null | undefined, formatMoney: (n: number) => string): string | null {
  return heldCouponNotice(src, formatMoney) ?? (src?.couponNotice?.trim() || null);
}

/** Mã máy chủ vừa gỡ khỏi giỏ (trường `couponRemoved` của giỏ). `shortfall` chỉ có khi lý do là đơn tối thiểu. */
export interface RemovedCoupon {
  code: string;
  reason: string;
  shortfall?: number;
}

/** Lời báo đã nhớ, kèm phần hàng tính mã lúc gỡ (`goods`) để số thiếu đi theo khi khách mua thêm hay bỏ bớt. */
export interface RemovedCouponMemory extends RemovedCoupon {
  goods: number;
}

/** Giỏ đủ để đo phần hàng tính mã: `items` có thể thiếu ở API cũ, khi đó dùng tạm tính. */
export interface CouponGoodsSource {
  subtotal?: number;
  items?: { total: number; isFlash?: boolean }[];
}

/**
 * Phần hàng tính mã của giỏ: tổng thành tiền các dòng không phải Giờ vàng (máy chủ loại dòng Giờ vàng khỏi điều kiện đơn tối thiểu). Combo không trừ ở đây:
 * giỏ lạc quan đưa combo về 0 trong lúc chờ máy chủ nên số trừ sẽ nhảy, mà combo hiếm khi đổi giữa lúc khách bỏ và mua thêm hàng.
 */
export function couponGoodsOf(cart: CouponGoodsSource): number {
  if (!cart.items) return cart.subtotal ?? 0;
  return cart.items.reduce((sum, l) => (l.isFlash ? sum : sum + l.total), 0);
}

/**
 * Máy chủ chỉ báo `couponRemoved` ở đúng lần đọc giỏ làm nó gỡ mã (lần đọc sau mã đã không còn), nên app phải nhớ.
 * Nhớ tới khi giỏ lại có mã (khách áp lại hay mã khác) hoặc giỏ trống; lần gỡ mới thay lần cũ.
 */
export function rememberRemovedCoupon(
  prev: RemovedCouponMemory | null,
  cart: CouponGoodsSource & { couponCode?: string | null; couponRemoved?: RemovedCoupon | null },
): RemovedCouponMemory | null {
  if ((cart.subtotal ?? 0) <= 0) return null;
  if (cart.couponRemoved) return { ...cart.couponRemoved, goods: couponGoodsOf(cart) };
  if (cart.couponCode) return null;
  return prev;
}

/**
 * Chữ của lời báo mã đã bị gỡ. Số thiếu đi theo phần hàng tính mã hiện tại so với lúc gỡ (mua thêm thì giảm, bỏ bớt thì tăng; hàng Giờ vàng không đổi số
 * vì máy chủ không tính nó); đủ mức rồi thì mời chọn lại mã. Đây là số ước để nhắc khách: mã chỉ dùng được khi máy chủ xét lại.
 */
export function removedCouponNotice(
  mem: RemovedCouponMemory | null | undefined,
  goodsNow: number,
  formatMoney: (n: number) => string,
): { code: string; text: string } | null {
  if (!mem) return null;
  if (mem.shortfall === undefined) return { code: mem.code, text: couponMinOrderCopy.removedOther(mem.code, mem.reason) };
  const remaining = mem.shortfall - (goodsNow - mem.goods);
  return {
    code: mem.code,
    text: remaining > 0 ? couponMinOrderCopy.removed(mem.code, formatMoney(remaining)) : couponMinOrderCopy.removedEnough(mem.code),
  };
}
