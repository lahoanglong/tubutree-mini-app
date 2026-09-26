/**
 * Form cấu hình riêng (thay ô JSON thô) cho Gomdon và tích điểm — helper THUẦN đọc/ghi giá trị
 * SystemConfig. Luật trùng BE (apps/api/src/modules/admin/admin-config-rules.ts); BE vẫn kiểm lại.
 */
import type { ConfigRow } from './admin-client';

export const GOMDON_CONFIG_KEY = 'shipping.gomdon.config';
export const GOMDON_TOGGLE_KEY = 'shipping.gomdon.recycling_enabled';
export const LOYALTY_KEYS = {
  checkinPoints: 'loyalty.checkin_points',
  posEnabled: 'loyalty.pos_credit_enabled',
  posMaxOrderTotal: 'loyalty.pos_max_order_total',
  posStaffDailyCap: 'loyalty.pos_staff_daily_points_cap',
  posMemberDailyCap: 'loyalty.pos_member_daily_points_cap',
} as const;

/** Mặc định trùng BE (loyalty.service.ts DEFAULT_CHECKIN_POINTS / POS_DEFAULTS) khi khoá chưa seed. */
export const LOYALTY_DEFAULTS = {
  checkinPoints: [1, 1, 1, 1, 1, 1, 2],
  posEnabled: false,
  posMaxOrderTotal: 5_000_000,
  posStaffDailyCap: 3_000,
  posMemberDailyCap: 1_000,
};

export function configValue<T>(rows: ConfigRow[] | undefined, key: string, fallback: T): T {
  const row = rows?.find((r) => r.key === key);
  return row === undefined ? fallback : (row.value as T);
}

// ── Gomdon ──

export interface WarehouseForm {
  name: string;
  phone: string;
  address: string;
  ward: string;
  district: string;
  province: string;
}

export const EMPTY_WAREHOUSE: WarehouseForm = { name: '', phone: '', address: '', ward: '', district: '', province: '' };
const WAREHOUSE_FIELDS = Object.keys(EMPTY_WAREHOUSE) as (keyof WarehouseForm)[];

export function readGomdonForm(value: unknown): { warehouse: WarehouseForm; weight: string } {
  const v = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as {
    defaultWarehouse?: Partial<Record<keyof WarehouseForm, unknown>>;
    defaultWeightFallback?: unknown;
  };
  const wh = v.defaultWarehouse ?? {};
  const warehouse = { ...EMPTY_WAREHOUSE };
  for (const f of WAREHOUSE_FIELDS) warehouse[f] = typeof wh[f] === 'string' ? (wh[f] as string) : '';
  const w = Number(v.defaultWeightFallback);
  return { warehouse, weight: Number.isFinite(w) && w > 0 ? String(w) : '500' };
}

/**
 * Giá trị mới cho shipping.gomdon.config: CHỈ thay defaultWarehouse + defaultWeightFallback, giữ nguyên
 * mọi field khác đang có (kể cả chỗ bị che "••••" — BE tự khôi phục giá trị thật khi lưu).
 */
export function buildGomdonConfigValue(
  current: unknown,
  warehouse: WarehouseForm,
  weight: string,
): { value?: Record<string, unknown>; error?: string } {
  const trimmed = Object.fromEntries(WAREHOUSE_FIELDS.map((f) => [f, warehouse[f].trim()])) as unknown as WarehouseForm;
  for (const f of ['name', 'phone', 'address', 'ward', 'province'] as const) {
    if (!trimmed[f]) return { error: `Vui lòng nhập ${WAREHOUSE_LABEL[f].toLowerCase()} của kho.` };
  }
  if (!/^(0|\+84)\d{9,10}$/.test(trimmed.phone.replace(/\s/g, ''))) return { error: 'SĐT kho không hợp lệ.' };
  const grams = Number(weight);
  if (!Number.isInteger(grams) || grams < 1 || grams > 50_000) {
    return { error: 'Cân nặng mặc định phải là số nguyên 1–50.000 gram.' };
  }
  const base = current && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
  return { value: { ...base, defaultWarehouse: trimmed, defaultWeightFallback: grams } };
}

export const WAREHOUSE_LABEL: Record<keyof WarehouseForm, string> = {
  name: 'Tên kho / người gửi',
  phone: 'SĐT',
  address: 'Địa chỉ',
  ward: 'Phường/xã',
  district: 'Quận/huyện (nếu có)',
  province: 'Tỉnh/thành',
};

// ── Tích điểm ──

/** 7 ô nhập → mảng 7 số nguyên 0..100, hoặc câu lỗi. */
export function parseCheckinPoints(inputs: string[]): { value?: number[]; error?: string } {
  if (inputs.length !== 7) return { error: 'Cần đúng 7 ô điểm (ngày 1 → ngày 7).' };
  const out: number[] = [];
  for (let i = 0; i < 7; i++) {
    const raw = inputs[i]!.trim();
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < 0 || n > 100) {
      return { error: `Ngày ${i + 1}: nhập số nguyên 0–100.` };
    }
    out.push(n);
  }
  return { value: out };
}

/** Số nguyên dương trong biên (nhận "5.000.000"). */
export function parseIntInRange(raw: string, min: number, max: number, label: string): { value?: number; error?: string } {
  const digits = raw.replace(/[.\s,đ]/g, '');
  const n = Number(digits);
  if (!digits || !Number.isInteger(n) || n < min || n > max) {
    return { error: `${label}: nhập số nguyên ${min.toLocaleString('vi-VN')}–${max.toLocaleString('vi-VN')}.` };
  }
  return { value: n };
}
