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
