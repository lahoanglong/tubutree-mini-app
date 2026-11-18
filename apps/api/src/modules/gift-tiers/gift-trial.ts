import { ConflictException } from '@nestjs/common';
import {
  GIFT_TRIAL_CHANGED,
  GIFT_TRIAL_MAX_OPTIONS,
  GIFT_TRIAL_UNAVAILABLE,
  type GiftTrialOptionDTO,
  type GiftTrialSummaryDTO,
} from '@tubutree/shared-types';
import type { SystemConfigService } from '../system-config/system-config.service';

/**
 * Quà tặng dùng thử 0đ theo mốc giỏ. Không có khoản tiền nào đổi: quà là một dòng đơn 0đ đi cùng kiện Tubu Tree, nên tạm tính, giảm giá,
 * điểm, hoa hồng và hoàn tiền của đơn giữ nguyên. Phần THUẦN ở đây (đọc cấu hình, xét mốc, chọn quà); đọc kho và ghi đơn ở
 * `gift-trial.service.ts` và `checkout.service.ts`.
 */
export const GIFT_TRIAL_ENABLED_KEY = 'commerce.gift_trial_enabled';
/** Mốc mở quà thấp nhất (luật A6, mặc định 299.000đ). Khoá này do Growth Hub sửa; mọi quà không mở dưới mốc này. */
export const GIFT_TRIAL_MIN_ORDER_KEY = 'commerce.gift_trial_min_order';
/** Danh sách quà: `[{ "variationId": "...", "minOrder": 499000 }]`; `minOrder` bỏ trống thì theo mốc chung. */
export const GIFT_TRIAL_OPTIONS_KEY = 'commerce.gift_trial_options';
export const GIFT_TRIAL_MIN_ORDER_DEFAULT = 299_000;
const GIFT_TRIAL_MIN_ORDER_MAX = 50_000_000;
/** Giá trị lưu ở `carts.giftChoice` khi khách chọn "Không nhận quà". `null` = chưa chọn (máy chủ lấy quà đầu tiên đã mở). */
export const GIFT_CHOICE_NONE = 'NONE';

export interface GiftTrialOptionConfig {
  variationId: string;
  /** Đã kẹp không thấp hơn mốc chung. */
  minOrder: number;
}

export interface GiftTrialSettings {
  enabled: boolean;
  minOrder: number;
  options: GiftTrialOptionConfig[];
}

export const GIFT_TRIAL_OFF: GiftTrialSettings = { enabled: false, minOrder: GIFT_TRIAL_MIN_ORDER_DEFAULT, options: [] };

const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= GIFT_TRIAL_MIN_ORDER_MAX;

/** Mốc chung: số nguyên đồng trong [0, 50 triệu]; sai dạng thì mặc định 299.000đ (không mở quà cho mọi đơn vì gõ nhầm). */
export function parseGiftTrialMinOrder(raw: unknown): number {
  return isMoney(raw) ? raw : GIFT_TRIAL_MIN_ORDER_DEFAULT;
}

/**
 * Đọc danh sách quà (THUẦN). Bỏ từng mục sai dạng (không phải object, thiếu `variationId`, `minOrder` không phải số nguyên hợp lệ) và mục trùng
 * biến thể (mục đầu thắng), giữ thứ tự cấu hình, tối đa `GIFT_TRIAL_MAX_OPTIONS`. `minOrder` thấp hơn mốc chung bị nâng lên mốc chung.
 */
export function parseGiftTrialOptions(raw: unknown, floor: number): GiftTrialOptionConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: GiftTrialOptionConfig[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (out.length >= GIFT_TRIAL_MAX_OPTIONS) break;
    if (!entry || typeof entry !== 'object') continue;
    const { variationId, minOrder } = entry as Record<string, unknown>;
    if (typeof variationId !== 'string' || variationId.trim() === '' || variationId.length > 64) continue;
    if (minOrder !== undefined && minOrder !== null && !isMoney(minOrder)) continue;
    const id = variationId.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ variationId: id, minOrder: Math.max(floor, typeof minOrder === 'number' ? minOrder : floor) });
  }
  return out;
}

/** Luật ghi của `commerce.gift_trial_options` (chặt hơn lúc đọc: lúc đọc bỏ mục sai, lúc ghi từ chối cả danh sách để admin thấy lỗi). */
export function giftTrialOptionsProblem(value: unknown): string | null {
  const shape = 'phải là mảng tối đa ' + GIFT_TRIAL_MAX_OPTIONS + ' quà, mỗi quà { "variationId": "...", "minOrder": 499000 } (minOrder bỏ trống = theo mốc chung)';
  if (!Array.isArray(value) || value.length > GIFT_TRIAL_MAX_OPTIONS) return shape;
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return shape;
    const { variationId, minOrder, ...rest } = entry as Record<string, unknown>;
    if (Object.keys(rest).length > 0) return `chỉ nhận "variationId" và "minOrder", có thêm ${Object.keys(rest).join(', ')}`;
    if (typeof variationId !== 'string' || variationId.trim() === '' || variationId.length > 64) return 'mỗi quà cần "variationId" là mã biến thể (tối đa 64 ký tự)';
    if (minOrder !== undefined && minOrder !== null && !isMoney(minOrder)) return '"minOrder" phải là số đồng nguyên 0–50.000.000';
    if (seen.has(variationId.trim())) return `biến thể ${variationId.trim()} lặp lại`;
    seen.add(variationId.trim());
  }
  return null;
}

/** Cờ, mốc chung và danh sách quà. Không có `config` (test dựng tay) hoặc cờ không đúng `true` thì tắt. */
export async function loadGiftTrialSettings(config: Pick<SystemConfigService, 'get'> | undefined): Promise<GiftTrialSettings> {
  if (!config || (await config.get<unknown>(GIFT_TRIAL_ENABLED_KEY, false)) !== true) return GIFT_TRIAL_OFF;
  const [rawMin, rawOptions] = await Promise.all([
    config.get<unknown>(GIFT_TRIAL_MIN_ORDER_KEY, GIFT_TRIAL_MIN_ORDER_DEFAULT),
    config.get<unknown>(GIFT_TRIAL_OPTIONS_KEY, []),
  ]);
  const minOrder = parseGiftTrialMinOrder(rawMin);
  return { enabled: true, minOrder, options: parseGiftTrialOptions(rawOptions, minOrder) };
}

/** Thông tin hiển thị của một biến thể quà còn bán được (bán được, kho Tubu giao, còn ít nhất 1). */
export type GiftTrialStock = Omit<GiftTrialOptionDTO, 'minOrder' | 'unlocked'>;

export interface GiftTrialBaseLine {
  total: number;
  fulfiller?: { kind: string } | null;
  /** Tồn của dòng giỏ; dòng hết hàng (0) không đặt được nên không tính vào mốc, như tạm tính ở giỏ. */
  stock?: number;
  variationId?: string;
  quantity?: number;
}

/** Số lượng mỗi biến thể khách đang mua trong giỏ (quà trùng món trong giỏ phải chừa phần này khi xét còn hàng). */
export function giftTrialCartDemand(lines: ReadonlyArray<GiftTrialBaseLine>): Map<string, number> {
  const demand = new Map<string, number>();
  for (const l of lines) if (l.variationId && l.quantity) demand.set(l.variationId, (demand.get(l.variationId) ?? 0) + l.quantity);
  return demand;
}

/** Tạm tính phần hàng Tubu Tree giao: quà đi cùng kiện Tubu nên chỉ hàng Tubu còn hàng tính vào mốc. */
export function giftTrialBase(lines: ReadonlyArray<GiftTrialBaseLine>): number {
  return lines.reduce((s, l) => s + ((l.fulfiller?.kind ?? 'TUBU') === 'TUBU' && (l.stock === undefined || l.stock > 0) ? l.total : 0), 0);
}

/**
 * Khối quà cho giỏ và báo giá (THUẦN). `null` khi cờ tắt hoặc không còn quà nào bán được: app ẩn hẳn khối. Lựa chọn của khách (`choice`):
 * `null` = chưa chọn, lấy quà đầu tiên đã mở; `NONE` = không nhận quà; còn lại là biến thể quà, nếu quà đó chưa mở hoặc hết thì rơi về quà
 * đầu tiên đã mở (khách vẫn có quà khi giỏ đổi).
 */
export function giftTrialSummary(
  settings: GiftTrialSettings,
  base: number,
  stock: ReadonlyMap<string, GiftTrialStock>,
  choice: string | null,
): GiftTrialSummaryDTO | null {
  if (!settings.enabled) return null;
  const options = settings.options
    .flatMap((o, i) => {
      const info = stock.get(o.variationId);
      return info ? [{ ...info, minOrder: o.minOrder, unlocked: base >= o.minOrder, order: i }] : [];
    })
    .sort((a, b) => a.minOrder - b.minOrder || a.order - b.order)
    .map(({ order: _order, ...o }) => o);
  if (options.length === 0) return null;
  const declined = choice === GIFT_CHOICE_NONE;
  const unlocked = options.filter((o) => o.unlocked);
  const chosen = !declined && choice ? unlocked.find((o) => o.variationId === choice) : undefined;
  const selected = declined ? null : (chosen ?? unlocked[0] ?? null);
  const next = options.find((o) => !o.unlocked) ?? null;
  return {
    base,
    minOrder: options[0]!.minOrder,
    nextMinOrder: next?.minOrder ?? null,
    shortfall: next ? next.minOrder - base : 0,
    options,
    selectedVariationId: selected?.variationId ?? null,
    declined,
  };
}

export function giftTrialChangedError(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: GIFT_TRIAL_CHANGED,
    message: 'Quà tặng dùng thử của đơn vừa thay đổi. Bạn xem lại quà rồi đặt hàng nhé.',
  });
}

export function giftTrialUnavailableError(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: GIFT_TRIAL_UNAVAILABLE,
    message: 'Quà tặng dùng thử bạn chọn vừa hết. Bạn chọn quà khác hoặc đặt hàng không kèm quà nhé.',
  });
}

/**
 * Quà sẽ ghi vào đơn, quyết NGOÀI tx từ báo giá vừa tính lại (THUẦN). `requested`: `undefined` = app cũ không gửi trường này, theo lựa chọn ở
 * giỏ; `null` = khách xác nhận không kèm quà; chuỗi = quà khách thấy ở màn thanh toán, phải đang mở với phần hàng đặt lúc này, sai thì 409
 * để app tải lại thay vì âm thầm đổi quà. `strict` cho biết hết kho lúc giữ chỗ thì báo lỗi (khách đã thấy quà) hay bỏ quà (app cũ không vẽ quà).
 */
export function resolveGiftTrial(
  summary: GiftTrialSummaryDTO | null,
  requested: string | null | undefined,
): { variationId: string; strict: boolean } | null {
  if (requested === null) return null;
  if (requested === undefined) return summary?.selectedVariationId ? { variationId: summary.selectedVariationId, strict: false } : null;
  const option = summary?.options.find((o) => o.variationId === requested);
  if (!option || !option.unlocked) throw giftTrialChangedError();
  return { variationId: option.variationId, strict: true };
}
