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

/** Thang số 💧 để thu hoạch cây nhà: cây thứ n (từ 1) dùng phần tử n, quá độ dài thì dùng phần tử cuối. */
export const TREE_TARGET_LADDER_DEFAULT: readonly number[] = [60, 300, 600];

/** Thang hợp lệ = mảng số nguyên dương không rỗng. Config hỏng rơi về mặc định (vòng thu hoạch không được có target <= 0). */
export function parseTreeTargetLadder(raw: unknown): number[] {
  if (Array.isArray(raw) && raw.length > 0 && raw.every((n) => Number.isInteger(n) && (n as number) > 0)) {
    return raw as number[];
  }
  return [...TREE_TARGET_LADDER_DEFAULT];
}

export async function treeTargetLadder(config: Pick<SystemConfigService, 'get'>): Promise<number[]> {
  return parseTreeTargetLadder(await config.get<unknown>('game.tree_target_ladder', [...TREE_TARGET_LADDER_DEFAULT]));
}

/** Target của cây kế tiếp sau khi đã trồng `treesPlanted` cây. */
export function ladderTarget(ladder: readonly number[], treesPlanted: number): number {
  return ladder[Math.min(Math.max(0, treesPlanted), ladder.length - 1)]!;
}

/**
 * Tiền tố mã thu hoạch: lô nhà `HARVEST…`, lô phụ `GARDEN…`. Mã vòng quay và nhiệm vụ mang tiền tố `GAME…` nên KHÔNG
 * được đếm vào trần mã thu hoạch ngày/tháng.
 */
export const HARVEST_COUPON_PREFIX = 'HARVEST';
export const GARDEN_COUPON_PREFIX = 'GARDEN';
export const HARVEST_COUPON_CODE_PREFIXES = [HARVEST_COUPON_PREFIX, GARDEN_COUPON_PREFIX] as const;

export const DAILY_LOGIN_SEEDS_DEFAULT = 10;
export const DEW_SEEDS_DEFAULT = 15;
export const STREAK_7_SEEDS_DEFAULT = 20;
export const QUIZ_WRONG_SEEDS_DEFAULT = 2;
export const FIRST_CHECKIN_BONUS_DEFAULT = 50;
export const COMEBACK_GAP_DAYS_DEFAULT = 7;
export const COMEBACK_SEEDS_DEFAULT = 60;
export const FIRST_HARVEST_POINTS_DEFAULT = 2000;
export const HARVEST_COUPON_DAILY_CAP_DEFAULT = 1;
export const HARVEST_COUPON_MONTHLY_CAP_DEFAULT = 4;
/** Nhắc "cây khát" chỉ trong ngần ấy ngày sau lần tưới cuối: cây không còn "chết" nên không nhắc mãi người đã bỏ. */
export const THIRSTY_REMINDER_MAX_DAYS = 7;

/** Số nguyên không âm từ cấu hình; hỏng rơi về mặc định. */
export async function configInt(config: Pick<SystemConfigService, 'get'>, key: string, fallback: number): Promise<number> {
  const n = Number(await config.get<number>(key, fallback));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** `game.streak_7_bonus.seeds`: object hỏng/thiếu rơi về mặc định. */
export async function streak7Seeds(config: Pick<SystemConfigService, 'get'>): Promise<number> {
  const raw = await config.get<{ seeds?: unknown } | null>('game.streak_7_bonus', { seeds: STREAK_7_SEEDS_DEFAULT });
  const n = Number(raw?.seeds ?? STREAK_7_SEEDS_DEFAULT);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : STREAK_7_SEEDS_DEFAULT;
}

export const ORDER_WATER_SEEDS_DEFAULT = 100;
export const ORDER_WATER_WEEKLY_CAP_DEFAULT = 300;
/** Lý do (cột reason của game_water_events) của nước thưởng đơn giao; refId = id đơn. */
export const ORDER_WATER_REASON = 'ORDER_DELIVERED';
/** Dòng sổ âm khi đơn đã giao bị trả/huỷ; cùng refId với dòng cộng, createdAt = của dòng cộng để trần tuần cũ được trả lại. */
export const ORDER_WATER_REVERSED_REASON = 'ORDER_REVERSED';
