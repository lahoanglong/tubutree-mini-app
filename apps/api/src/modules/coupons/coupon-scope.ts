/**
 * Nguồn sự thật DUY NHẤT cho điều kiện scope của coupon đối với 1 user.
 *
 * Trước đây logic này bị nhân đôi ở 2 nơi và đã từng lệch nhau:
 *  - LoyaltyService.getAvailableCoupons (lọc danh sách hiển thị)
 *  - CouponsService.assertScopeOwnership (chặn validate/redeem)
 * Lệch → coupon HIỆN trong list nhưng redeem bị từ chối (list/apply lệch).
 * Tách thành 1 hàm thuần để 2 đường (list & apply) luôn quyết định giống nhau.
 *
 * Lưu ý đồng nhất với assertScopeOwnership:
 *  - PUBLIC (hoặc scope null phòng thủ): luôn cho phép.
 *  - USER_GROUP: bắt buộc meta.userId tồn tại VÀ khớp user.id.
 *  - TIER: bắt buộc meta.tierId tồn tại VÀ khớp user.tierId (chặn case
 *    meta.tierId=undefined + user.tierId=null → undefined===undefined bypass).
 *  - BIRTHDAY/INVITE/scope chưa biết: DENY tới khi có logic chính thức.
 */
export type CouponScopeInfo = { scope?: string | null; scopeMeta?: unknown };
export type EligibilityUser = { id: string; tierId?: string | null };

export function isCouponEligible(coupon: CouponScopeInfo, user: EligibilityUser): boolean {
  if (coupon.scope === 'PUBLIC' || coupon.scope == null) return true;

  if (coupon.scope === 'USER_GROUP') {
    const meta = (coupon.scopeMeta ?? {}) as { userId?: string };
    return !!meta.userId && meta.userId === user.id;
  }

  if (coupon.scope === 'TIER') {
    const meta = (coupon.scopeMeta ?? {}) as { tierId?: string };
    return !!meta.tierId && meta.tierId === user.tierId;
  }

  // BIRTHDAY / INVITE / scope chưa biết → default DENY (tránh leak voucher cá nhân).
  return false;
}

/**
 * Mã công khai có giới hạn lượt/người chỉ có nghĩa khi "người" là tài khoản thật: tài khoản khách
 * (deviceId mới = tài khoản mới) dùng lại được mã "khách mới" vô hạn (MONEY-16). Mã công khai không
 * giới hạn theo người (perUserLimit <= 0) thì ai dùng cũng như nhau nên không cần.
 */
export function requiresRealUser(coupon: CouponScopeInfo & { perUserLimit?: number | null }): boolean {
  return (coupon.scope === 'PUBLIC' || coupon.scope == null) && (coupon.perUserLimit ?? 0) > 0;
}
