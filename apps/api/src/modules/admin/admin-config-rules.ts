import { BadRequestException } from '@nestjs/common';
import { MAX_TTL_HOURS, MIN_TTL_HOURS, PENDING_PAYMENT_TTL_KEY } from '../orders/pending-payment-expiry.cron';
import { deadConfigKeyReason } from '../system-config/dead-config-keys';
import {
  CART_ABANDON_DEFAULT_MAX_HOURS,
  CART_ABANDON_DEFAULT_MIN_HOURS,
  CART_ABANDON_MAX_HOURS_KEY,
  CART_ABANDON_MIN_HOURS_KEY,
} from '../lifecycle/remarketing.service';

/**
 * Luật ghi cho những khoá có FORM riêng trong web admin (Gomdon, tích điểm). SystemConfigService.set
 * chỉ giữ đúng KIỂU dữ liệu cũ; phía đọc thì lặng lẽ quay về mặc định khi giá trị sai
 * (LoyaltyService.getCheckInPointsTable / positiveConfig, loadGomdonConfig) — admin thấy "đã lưu"
 * mà hệ thống vẫn chạy số cũ, không ai biết. Chặn ngay lúc ghi và nói rõ sai ở đâu.
 */

/** Trần 1 ô điểm danh — trùng CHECKIN_MAX_POINTS_PER_DAY ở loyalty.service.ts. */
const CHECKIN_MAX_POINTS = 100;
/** Trùng POS_ORDER_TOTAL_HARD_MAX (dto/loyalty-staff.dto.ts) và @Min(1000) của orderTotal. */
const POS_ORDER_TOTAL_MIN = 1000;
const POS_ORDER_TOTAL_MAX = 1_000_000_000;
const POS_POINTS_CAP_MAX = 10_000_000;
/** Cân nặng mặc định mỗi sản phẩm (gram) cho vận đơn Gomdon — 1g..50kg. */
const GOMDON_WEIGHT_MAX = 50_000;
const VN_PHONE = /^(0|\+84)\d{9,10}$/;

const fail = (key: string, msg: string) => new BadRequestException(`"${key}": ${msg}`);

function assertBoolean(key: string, v: unknown) {
  if (typeof v !== 'boolean') throw fail(key, 'phải là true/false.');
}

function assertIntInRange(key: string, v: unknown, min: number, max: number, unit: string) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw fail(key, `phải là số nguyên ${min.toLocaleString('vi-VN')}–${max.toLocaleString('vi-VN')} ${unit}.`);
  }
}

function assertCheckinPoints(key: string, v: unknown) {
  const valid =
    Array.isArray(v) &&
    v.length === 7 &&
    v.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= CHECKIN_MAX_POINTS);
  if (!valid) throw fail(key, `cần đúng 7 số nguyên 0–${CHECKIN_MAX_POINTS} (điểm ngày 1 → ngày 7).`);
}

const WAREHOUSE_REQUIRED = ['name', 'phone', 'address', 'ward', 'province'] as const;

function assertGomdonConfig(key: string, v: unknown) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail(key, 'phải là object.');
  const cfg = v as { defaultWarehouse?: unknown; defaultWeightFallback?: unknown };
  if (cfg.defaultWeightFallback !== undefined) {
    assertIntInRange(`${key}.defaultWeightFallback`, cfg.defaultWeightFallback, 1, GOMDON_WEIGHT_MAX, 'gram');
  }
  if (cfg.defaultWarehouse !== undefined) {
    const wh = cfg.defaultWarehouse as Record<string, unknown> | null;
    if (!wh || typeof wh !== 'object' || Array.isArray(wh)) throw fail(`${key}.defaultWarehouse`, 'phải là object.');
    for (const f of WAREHOUSE_REQUIRED) {
      const s = wh[f];
      if (typeof s !== 'string' || !s.trim()) throw fail(`${key}.defaultWarehouse.${f}`, 'không được để trống.');
      if (s.length > 255) throw fail(`${key}.defaultWarehouse.${f}`, 'tối đa 255 ký tự.');
    }
    if (wh.district !== undefined && typeof wh.district !== 'string') {
      throw fail(`${key}.defaultWarehouse.district`, 'phải là chuỗi.');
    }
    if (!VN_PHONE.test(String(wh.phone).replace(/\s/g, ''))) {
      throw fail(`${key}.defaultWarehouse.phone`, 'SĐT kho không hợp lệ.');
    }
  }
}

const MILESTONES_MAX_COUNT = 10;
const MILESTONE_SPEND_MAX = 1_000_000_000;
const MILESTONE_REWARD_MAX = 10_000_000;

/** Khoảng của từng khoá voucher.* do SystemConfigService.RANGES giữ; ở đây chỉ chặn số lẻ (đồng/ngày là số nguyên). */
function assertInteger(key: string, v: unknown) {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw fail(key, 'phải là số nguyên.');
}

/**
 * Cron milestoneVouchers chọn mốc CAO NHẤT đạt được: spend trùng nhau làm mốc nào thắng phụ thuộc thứ tự sort,
 * reward 0 vẫn tạo mã 0đ + thông báo, mảng sai cấu trúc thì cron ném lỗi và bị nuốt (cả đợt không cấp mã nào).
 */
function assertMilestones(key: string, v: unknown) {
  if (!Array.isArray(v)) throw fail(key, 'phải là mảng các mốc {"spend": đồng chi tiêu, "reward": đồng thưởng}.');
  if (v.length > MILESTONES_MAX_COUNT) throw fail(key, `tối đa ${MILESTONES_MAX_COUNT} mốc.`);
  const seen = new Set<number>();
  v.forEach((m, i) => {
    const at = `${key}[${i}]`;
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw fail(at, 'phải là object {"spend", "reward"}.');
    const { spend, reward } = m as { spend?: unknown; reward?: unknown };
    assertIntInRange(`${at}.spend`, spend, 1, MILESTONE_SPEND_MAX, 'đ');
    assertIntInRange(`${at}.reward`, reward, 1, MILESTONE_REWARD_MAX, 'đ');
    if ((reward as number) > (spend as number)) throw fail(at, 'thưởng không được lớn hơn mốc chi tiêu.');
    if (seen.has(spend as number)) throw fail(`${at}.spend`, 'trùng với một mốc khác.');
    seen.add(spend as number);
  });
}

/**
 * Cặp khoá min/max mà phía đọc lặng lẽ bỏ qua khi khoảng rỗng, nên admin thấy "đã lưu" mà hệ thống không chạy:
 * - ETA giao hàng: toShippingEta ẩn dòng "Giao dự kiến" khi max < min. Khoá đối ứng chưa đặt (null) thì chưa có gì để so.
 * - Nhắc giỏ bỏ quên: cron mỗi giờ lấy giỏ có updatedAt trong [now − max, now − min]; min ≥ max là khoảng rỗng, không giỏ
 *   nào được nhắc. Khoá đối ứng chưa có dòng thì cron đang chạy theo mặc định của nó, nên so với mặc định đó.
 */
const ETA_MIN_KEY = 'shipping.eta_min_days';
const ETA_MAX_KEY = 'shipping.eta_max_days';

type RangePair = {
  min: string;
  max: string;
  /** Đơn vị trong thông báo lỗi. */
  unit: string;
  /** max phải lớn hơn hẳn min (khoảng [min, max] không được chỉ là một điểm). */
  strict: boolean;
  /** null = "chưa đặt" là giá trị hợp lệ của khoá. */
  nullable: boolean;
  /** Giá trị phía đọc dùng khi khoá đối ứng chưa có dòng; không có = khi đó không so. */
  defaults?: { min: number; max: number };
};

const RANGE_PAIRS: RangePair[] = [
  { min: ETA_MIN_KEY, max: ETA_MAX_KEY, unit: 'số ngày', strict: false, nullable: true },
  {
    min: CART_ABANDON_MIN_HOURS_KEY,
    max: CART_ABANDON_MAX_HOURS_KEY,
    unit: 'số giờ',
    strict: true,
    nullable: false,
    defaults: { min: CART_ABANDON_DEFAULT_MIN_HOURS, max: CART_ABANDON_DEFAULT_MAX_HOURS },
  },
];

const PAIR_OF: Record<string, RangePair> = Object.fromEntries(RANGE_PAIRS.flatMap((p) => [[p.min, p], [p.max, p]]));

/** Khoá mà luật ghi cần đọc thêm giá trị hiện có của một khoá khác (xem validateAdminConfigValue). */
export function configPartnerKey(key: string): string | undefined {
  const pair = PAIR_OF[key];
  if (!pair) return undefined;
  return key === pair.min ? pair.max : pair.min;
}

function assertAgainstPartner(pair: RangePair, key: string, v: unknown, stored: unknown) {
  if (v === null && pair.nullable) return; // đặt lại "chưa đặt" = ẩn dòng giao dự kiến
  assertInteger(key, v);
  const isMax = key === pair.max;
  const partner = typeof stored === 'number' ? stored : isMax ? pair.defaults?.min : pair.defaults?.max;
  if (typeof partner !== 'number') return;
  const value = v as number;
  const now = typeof stored === 'number' ? 'hiện tại' : 'mặc định';
  if (isMax && (pair.strict ? value <= partner : value < partner)) {
    throw fail(
      key,
      `${pair.strict ? 'phải lớn hơn' : 'không được nhỏ hơn'} "${pair.min}" ${now} (${partner}). ` +
        `Hạ "${pair.min}" trước nếu muốn giảm ${pair.unit} tối đa.`,
    );
  }
  if (!isMax && (pair.strict ? value >= partner : value > partner)) {
    throw fail(
      key,
      `${pair.strict ? 'phải nhỏ hơn' : 'không được lớn hơn'} "${pair.max}" ${now} (${partner}). ` +
        `Tăng "${pair.max}" trước nếu muốn tăng ${pair.unit} tối thiểu.`,
    );
  }
}

const RULES: Record<string, (key: string, v: unknown) => void> = {
  'voucher.welcome_amount': assertInteger,
  'voucher.welcome_min_order': assertInteger,
  'voucher.birthday_amount': assertInteger,
  'voucher.winback_amount': assertInteger,
  'voucher.winback_days': assertInteger,
  'voucher.milestones': assertMilestones,
  'shipping.gomdon.recycling_enabled': assertBoolean,
  'shipping.gomdon.config': assertGomdonConfig,
  'loyalty.pos_credit_enabled': assertBoolean,
  'loyalty.checkin_points': assertCheckinPoints,
  'loyalty.pos_max_order_total': (k, v) => assertIntInRange(k, v, POS_ORDER_TOTAL_MIN, POS_ORDER_TOTAL_MAX, 'đ'),
  'loyalty.pos_staff_daily_points_cap': (k, v) => assertIntInRange(k, v, 1, POS_POINTS_CAP_MAX, 'điểm'),
  'loyalty.pos_member_daily_points_cap': (k, v) => assertIntInRange(k, v, 1, POS_POINTS_CAP_MAX, 'điểm'),
  [PENDING_PAYMENT_TTL_KEY]: (k, v) => assertIntInRange(k, v, MIN_TTL_HOURS, MAX_TTL_HOURS, 'giờ'),
};

/** Khoá có luật ghi ở đây (form riêng trong web admin): được ghi kể cả khi DB chưa có dòng. */
export function hasAdminConfigRule(key: string): boolean {
  return key in RULES || key in PAIR_OF;
}

/**
 * Ném BadRequest nếu `value` sai luật của khoá; khoá không có luật riêng → bỏ qua. `partnerValue` là giá trị hiện lưu
 * của khoá đối ứng (configPartnerKey) cho luật so chéo; không truyền hoặc null/undefined = chưa có gì để so.
 */
export function validateAdminConfigValue(key: string, value: unknown, partnerValue?: unknown): void {
  const deadReason = deadConfigKeyReason(key);
  if (deadReason) {
    throw fail(key, `khoá này không còn được hệ thống đọc nên sửa sẽ không có tác dụng. ${deadReason}`);
  }
  const pair = PAIR_OF[key];
  if (pair) assertAgainstPartner(pair, key, value, partnerValue);
  else RULES[key]?.(key, value);
}
