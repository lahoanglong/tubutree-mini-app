/** Phần của lượt đổi quà (GiftRedemptionDTO) mà dòng phụ mã giảm giá ở "Quà của tôi" cần. */
export interface RedemptionCouponInfo {
  couponCode: string | null;
  couponEndAt?: string | null;
  couponUsed?: boolean;
}

/** dd/mm theo giờ Việt Nam (UTC+7), cùng quy ước với các ngày khác trên màn hình. */
function vnDayMonth(iso: string): string {
  const v = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}`;
}

/**
 * Dòng phụ của lượt đổi quà là mã giảm giá: "Mã X · HSD dd/mm" khi còn dùng được, "Mã X · Đã dùng", "Mã X · Hết hạn". `usable`
 * quyết định dòng có bấm "Dùng ngay" được không. Mã đã bị dọn khỏi hệ thống (không còn `couponCode`) chỉ có thể là đã dùng hoặc hết hạn.
 */
export function redemptionCouponLine(r: RedemptionCouponInfo, now: Date = new Date()): { text: string; usable: boolean } {
  if (!r.couponCode) return { text: 'Mã đã dùng hoặc hết hạn', usable: false };
  const head = `Mã ${r.couponCode}`;
  if (r.couponUsed) return { text: `${head} · Đã dùng`, usable: false };
  if (r.couponEndAt) {
    if (new Date(r.couponEndAt).getTime() < now.getTime()) return { text: `${head} · Hết hạn`, usable: false };
    return { text: `${head} · HSD ${vnDayMonth(r.couponEndAt)}`, usable: true };
  }
  return { text: head, usable: true };
}
