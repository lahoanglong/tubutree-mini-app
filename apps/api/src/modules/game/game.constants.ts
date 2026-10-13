import type { SystemConfigService } from '../system-config/system-config.service';

// Loài cây mặc định khi user mới vào Vườn Xanh / quiz đầu tiên.
// Tập trung 1 chỗ để đổi nhãn không cần sửa rải rác trong game.service / game-quiz / game-economy.
// (Nếu muốn config-driven hơn → đọc từ SystemConfig key 'game.tree_default_type'.)
export const DEFAULT_TREE_TYPE = 'Cây Dứa Fuwa3e';

/** Ngưỡng đơn tối thiểu mặc định của coupon thu hoạch (quyết định Q-02, C-009). */
export const HARVEST_COUPON_MIN_ORDER_DEFAULT = 199000;

/**
 * minOrder của coupon thu hoạch (lô nhà + lô phụ dùng chung 1 khoá). Config hỏng (không phải số)
 * rơi về mặc định thay vì 0, và không bao giờ thấp hơn giá trị coupon — tránh admin sửa nhầm
 * config mà mở lại đường "coupon free trên đơn bất kỳ".
 */
export async function harvestCouponMinOrder(
  config: Pick<SystemConfigService, 'get'>,
  couponAmount: number,
): Promise<number> {
  const raw = Number(await config.get<number>('game.harvest_coupon_min_order', HARVEST_COUPON_MIN_ORDER_DEFAULT));
  const configured = Number.isFinite(raw) ? raw : HARVEST_COUPON_MIN_ORDER_DEFAULT;
  return Math.max(couponAmount, configured);
}

/** Bội số đơn tối thiểu mặc định của voucher vòng quay: cùng tỉ lệ quà đổi điểm (voucher 50.000đ cho đơn từ 300.000đ). */
export const SPIN_VOUCHER_MIN_ORDER_MULTIPLIER_DEFAULT = 6;

/**
 * minOrder của voucher trúng vòng quay = giá trị × bội số cấu hình (ENGAGE-10). Config hỏng hoặc < 1 rơi về mặc định:
 * minOrder bằng đúng giá trị biến voucher 20k thành món 25k gần như miễn phí.
 */
export async function spinVoucherMinOrder(config: Pick<SystemConfigService, 'get'>, couponAmount: number): Promise<number> {
  const raw = Number(
    await config.get<number>('game.spin_voucher_min_order_multiplier', SPIN_VOUCHER_MIN_ORDER_MULTIPLIER_DEFAULT),
  );
  const multiplier = Number.isFinite(raw) && raw >= 1 ? raw : SPIN_VOUCHER_MIN_ORDER_MULTIPLIER_DEFAULT;
  return Math.round(couponAmount * multiplier);
}
