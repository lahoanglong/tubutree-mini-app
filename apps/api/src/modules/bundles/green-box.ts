import { BadRequestException } from '@nestjs/common';
import type { SystemConfigService } from '../system-config/system-config.service';
import { CouponMinOrderError } from '../coupons/coupons.service';
import { BUNDLE_MIN_PRODUCTS } from './bundle-rules';
import { readBundleMaxPct } from './bundle-read';

/**
 * Hộp Xanh: khách tự ghép nhiều món Tubu giao, đủ số sản phẩm khác nhau thì giảm theo bậc. Không có thực thể "hộp": máy chủ đếm trên
 * chính các dòng giỏ, và khoản giảm đi vào `comboPerLine` như một bộ combo ảo, nên `OrderItem.total`/`paidTotal` (hoàn trả, hoa hồng CTV,
 * đối soát), `Order.comboDiscount` và điểm tích (trên tiền hàng sau mọi giảm) tự đúng mà không có đường tiền thứ hai.
 */
export const GREEN_BOX_ENABLED_KEY = 'commerce.green_box_enabled';
export const GREEN_BOX_TIERS_KEY = 'commerce.green_box_tiers';
export const GREEN_BOX_TIERS_DEFAULT: readonly GreenBoxTier[] = [
  { minItems: 3, pct: 3 },
  { minItems: 5, pct: 5 },
  { minItems: 7, pct: 7 },
];
/** Trần cứng trong mã: cấu hình ghi tay vượt mức này vẫn chỉ giảm tới đây (và không vượt `bundle.max_pct`). */
export const GREEN_BOX_HARD_MAX_PCT = 10;
/** Mỗi dòng chỉ được giảm cho tối đa từng này đơn vị: Hộp Xanh thưởng ghép nhiều món, không phải mua sỉ một món. */
export const GREEN_BOX_MAX_UNITS_PER_LINE = 2;
const MAX_TIERS = 10;
const MAX_MIN_ITEMS = 50;

export interface GreenBoxTier {
  /** Số sản phẩm KHÁC NHAU đủ điều kiện cần có trong giỏ. */
  minItems: number;
  pct: number;
}

export interface GreenBoxSettings {
  enabled: boolean;
  /** Đã kẹp trần, tăng dần theo `minItems`; rỗng = không giảm (cờ tắt hoặc cấu hình sai dạng). */
  tiers: GreenBoxTier[];
}

export const GREEN_BOX_OFF: GreenBoxSettings = { enabled: false, tiers: [] };

/**
 * Đọc bậc từ cấu hình (THUẦN). Sai dạng ở bất kỳ đâu (không phải mảng, thiếu trường, `minItems` trùng hay dưới 2, `pct` không dương) thì
 * coi như không có bậc: không giảm, không ném lỗi lúc đặt hàng. `pct` kẹp ở `min(10, bundle.max_pct)`; bậc sau không được giảm ít hơn bậc trước.
 */
export function parseGreenBoxTiers(raw: unknown, bundleMaxPct: number): GreenBoxTier[] {
  const cap = Math.min(GREEN_BOX_HARD_MAX_PCT, Number.isFinite(bundleMaxPct) ? bundleMaxPct : 0);
  if (!(cap > 0) || !Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TIERS) return [];
  const tiers: GreenBoxTier[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') return [];
    const { minItems, pct } = t as Record<string, unknown>;
    if (typeof minItems !== 'number' || !Number.isInteger(minItems) || minItems < BUNDLE_MIN_PRODUCTS || minItems > MAX_MIN_ITEMS) return [];
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0) return [];
    tiers.push({ minItems, pct: Math.min(pct, cap) });
  }
  tiers.sort((a, b) => a.minItems - b.minItems);
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i]!.minItems === tiers[i - 1]!.minItems || tiers[i]!.pct < tiers[i - 1]!.pct) return [];
  }
  return tiers;
}

/** Cờ + bậc đang hiệu lực. Không có `config` (test dựng tay) hoặc cờ không đúng `true` thì tắt. */
export async function loadGreenBoxSettings(config: Pick<SystemConfigService, 'get'> | undefined): Promise<GreenBoxSettings> {
  if (!config || (await config.get<boolean>(GREEN_BOX_ENABLED_KEY, false)) !== true) return GREEN_BOX_OFF;
  const [raw, maxPct] = await Promise.all([config.get<unknown>(GREEN_BOX_TIERS_KEY, GREEN_BOX_TIERS_DEFAULT), readBundleMaxPct(config)]);
  return { enabled: true, tiers: parseGreenBoxTiers(raw, maxPct) };
}

/** Một dòng giỏ đưa vào xét Hộp Xanh. `total = unitPrice × quantity` (giá đang bán, chưa giảm). */
export interface GreenBoxLine {
  variationId: string;
  productId: string;
  total: number;
  quantity: number;
  /** Đang hưởng giá Giờ vàng. */
  isFlash: boolean;
  /** Kho Tubu giao và không phải hàng của gian hàng đối tác (hàng đối tác chỉ bán giá lẻ, `partner-goods.ts`). */
  tubu: boolean;
  /** Tồn đủ cho số lượng của dòng. */
  inStock: boolean;
}

/** Combo đã khớp của cùng lần tính: dòng có khoản giảm combo, và dòng khoá của bộ đang áp (vd sản phẩm chính của "mua kèm"). */
export interface ComboFootprint {
  perLine: Readonly<Record<string, number>>;
  keyVariationIds?: ReadonlySet<string>;
}

/** Dòng được tính vào Hộp Xanh: giá thường (không Giờ vàng, không thuộc combo/mua kèm đang áp), Tubu giao, còn hàng, có giá. */
export function isGreenBoxEligible(l: GreenBoxLine, combo: ComboFootprint): boolean {
  if (l.isFlash || !l.tubu || !l.inStock) return false;
  if (!(l.quantity >= 1) || !(l.total > 0)) return false;
  if ((combo.perLine[l.variationId] ?? 0) > 0) return false;
  return !(combo.keyVariationIds?.has(l.variationId) ?? false);
}

export interface GreenBoxResult {
  /** Số sản phẩm khác nhau đủ điều kiện (hai phân loại của một sản phẩm tính 1). */
  items: number;
  /** Bậc đang đạt, null khi chưa đủ bậc đầu. */
  tier: GreenBoxTier | null;
  /** Bậc kế tiếp, null khi đã ở bậc cao nhất (hoặc không có bậc). */
  next: GreenBoxTier | null;
  tiers: GreenBoxTier[];
  /** Tổng khoản giảm (đồng) = tổng `perLine`. */
  total: number;
  /** Khoản giảm từng dòng, key = variationId. */
  perLine: Record<string, number>;
}

const byVariationId = (a: GreenBoxLine, b: GreenBoxLine) => (a.variationId < b.variationId ? -1 : a.variationId > b.variationId ? 1 : 0);

/**
 * Khoản giảm Hộp Xanh trên các dòng đã lọc đủ điều kiện (THUẦN). Bậc chọn theo số sản phẩm khác nhau; mỗi dòng giảm `pct`% cho tối đa
 * `GREEN_BOX_MAX_UNITS_PER_LINE` đơn vị, làm tròn xuống từng dòng, không bao giờ vượt `total` của dòng. Duyệt theo `variationId` để mọi
 * đường (giỏ, báo giá, đặt đơn) ra cùng một số dù thứ tự dòng khác nhau.
 */
export function allocateGreenBox(eligible: readonly GreenBoxLine[], tiers: readonly GreenBoxTier[]): GreenBoxResult {
  const items = new Set(eligible.map((l) => l.productId)).size;
  let tier: GreenBoxTier | null = null;
  let next: GreenBoxTier | null = null;
  for (const t of tiers) {
    if (t.minItems <= items) tier = t;
    else if (!next) next = t;
  }
  const perLine: Record<string, number> = {};
  let total = 0;
  if (tier) {
    for (const l of [...eligible].sort(byVariationId)) {
      const take = Math.min(l.quantity, GREEN_BOX_MAX_UNITS_PER_LINE);
      const d = Math.min(l.total, Math.max(0, Math.floor((l.total * take * tier.pct) / (l.quantity * 100))));
      if (d > 0) {
        perLine[l.variationId] = d;
        total += d;
      }
    }
  }
  return { items, tier, next, tiers: [...tiers], total, perLine };
}

/** Phần Hộp Xanh trả cho máy khách (giỏ, báo giá): đủ để vẽ tiến độ bậc mà không lộ luật tính từng dòng. */
export interface GreenBoxSummary {
  items: number;
  tier: GreenBoxTier | null;
  next: GreenBoxTier | null;
  tiers: GreenBoxTier[];
  discount: number;
}

export function greenBoxSummary(r: GreenBoxResult): GreenBoxSummary {
  return { items: r.items, tier: r.tier, next: r.next, tiers: r.tiers, discount: r.total };
}

/**
 * Gộp Hộp Xanh vào kết quả combo của cùng lần tính: dòng đủ điều kiện không có khoản combo nên chỉ là hợp hai tập, `total` cộng thẳng.
 * Cờ tắt (hoặc không có bậc) thì trả lại đúng đối tượng `combo` đã nhận, `greenBox` null: báo giá và đơn giống hệt trước.
 */
export function applyGreenBox<C extends { total: number; perLine: Record<string, number> }>(
  combo: C,
  lines: readonly GreenBoxLine[],
  settings: GreenBoxSettings,
  keyVariationIds?: ReadonlySet<string>,
): { combo: C; greenBox: GreenBoxResult | null } {
  if (!settings.enabled || settings.tiers.length === 0) return { combo, greenBox: null };
  const footprint: ComboFootprint = { perLine: combo.perLine, keyVariationIds };
  const box = allocateGreenBox(lines.filter((l) => isGreenBoxEligible(l, footprint)), settings.tiers);
  if (box.total === 0) return { combo, greenBox: box };
  return { combo: { ...combo, total: combo.total + box.total, perLine: { ...combo.perLine, ...box.perLine } }, greenBox: box };
}

/** Dòng giỏ đưa vào xét Hộp Xanh (giỏ, báo giá và đặt đơn cùng dùng): Tubu giao, không phải hàng đối tác, tồn đủ cho số lượng. */
export function greenBoxLineOf(l: {
  variationId: string;
  productId: string;
  total: number;
  quantity: number;
  isFlash: boolean;
  stock: number;
  fulfiller: { kind: string };
  partnerOwned?: boolean;
}) {
  return {
    variationId: l.variationId,
    productId: l.productId,
    total: l.total,
    quantity: l.quantity,
    isFlash: l.isFlash,
    tubu: l.fulfiller.kind === 'TUBU' && l.partnerOwned !== true,
    inStock: l.stock >= l.quantity,
  };
}

/**
 * Hộp Xanh nhường mã giảm giá của khách. Đơn tối thiểu của mã vẫn xét trên tiền hàng SAU Hộp Xanh (như combo), nhưng mã đạt trên tiền
 * hàng chưa trừ Hộp Xanh mà hụt khi đã trừ thì lần tính này bỏ Hộp Xanh: khách được đúng mã như khi cờ tắt, bật cờ không bao giờ làm
 * khách trả nhiều hơn vì mất mã. Mã hỏng vì lý do khác (hết hạn, hết lượt, hụt cả khi chưa trừ) thì giữ Hộp Xanh. Lỗi hạ tầng ném ra.
 * Giỏ, báo giá và đặt đơn cùng gọi hàm này với cùng mã nên cùng ra một kết quả.
 */
export async function yieldGreenBoxToCoupon<T>(withBox: T, withoutBox: T, validate: (base: T) => Promise<unknown>): Promise<T> {
  try {
    await validate(withBox);
    return withBox;
  } catch (err) {
    if (!(err instanceof CouponMinOrderError)) {
      if (err instanceof BadRequestException) return withBox;
      throw err;
    }
  }
  try {
    await validate(withoutBox);
    return withoutBox;
  } catch (err) {
    if (err instanceof BadRequestException) return withBox;
    throw err;
  }
}

/** Dòng khoá của các combo đã khớp (vd sản phẩm chính của "mua kèm"): thuộc bộ đang áp nên không vào Hộp Xanh. */
export function comboKeyIds(groups: readonly { keyVariationIds: readonly string[]; discount: number }[] | undefined): Set<string> {
  // ComboService cũ (hoặc stub) không trả nhóm: không có dòng khoá nào ngoài các dòng đã có khoản giảm combo.
  return new Set((groups ?? []).filter((g) => g.discount > 0).flatMap((g) => g.keyVariationIds));
}
