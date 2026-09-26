import { BadRequestException } from '@nestjs/common';

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

const RULES: Record<string, (key: string, v: unknown) => void> = {
  'shipping.gomdon.recycling_enabled': assertBoolean,
  'shipping.gomdon.config': assertGomdonConfig,
  'loyalty.pos_credit_enabled': assertBoolean,
  'loyalty.checkin_points': assertCheckinPoints,
  'loyalty.pos_max_order_total': (k, v) => assertIntInRange(k, v, POS_ORDER_TOTAL_MIN, POS_ORDER_TOTAL_MAX, 'đ'),
  'loyalty.pos_staff_daily_points_cap': (k, v) => assertIntInRange(k, v, 1, POS_POINTS_CAP_MAX, 'điểm'),
  'loyalty.pos_member_daily_points_cap': (k, v) => assertIntInRange(k, v, 1, POS_POINTS_CAP_MAX, 'điểm'),
};

/** Ném BadRequest nếu `value` sai luật của khoá; khoá không có luật riêng → bỏ qua. */
export function validateAdminConfigValue(key: string, value: unknown): void {
  RULES[key]?.(key, value);
}
