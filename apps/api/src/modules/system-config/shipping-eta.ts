export interface ShippingEta {
  minDays: number;
  maxDays: number;
}

/** Khoảng ngày giao dự kiến (spec §2: cố định từ SystemConfig, chưa theo tỉnh). Cấu hình thiếu
 * hoặc sai → null để FE ẩn hẳn dòng này thay vì hứa một con số chủ shop chưa đặt. */
export function toShippingEta(min: unknown, max: unknown): ShippingEta | null {
  if (!Number.isInteger(min) || !Number.isInteger(max)) return null;
  const lo = min as number;
  const hi = max as number;
  if (lo < 0 || hi < lo || hi > 60) return null;
  return { minDays: lo, maxDays: hi };
}

/** Lịch kho cho ngày nhận dự kiến (tubu-w6-02, A6): đọc khi bật `shipping.pdp_eta_enabled`. */
export const WAREHOUSE_SCHEDULE_KEY = 'shipping.warehouse_schedule';

/** Cùng dạng với `DeliverySchedule` của app-core (`packages/app-core/src/api/config.ts`). */
export interface WarehouseSchedule {
  /** Giờ cắt đơn theo giờ Việt Nam, "HH:mm". */
  cutoff: string;
  /** Ngày kho làm theo `getUTCDay` của giờ VN: 0 = Chủ nhật … 6 = Thứ 7. */
  workDays: number[];
  /** Ngày nghỉ lễ "YYYY-MM-DD" (giờ VN): không xuất kho, không tính là ngày giao. */
  holidays: string[];
  /** [ít nhất, nhiều nhất] ngày làm việc từ ngày xuất kho tới khi khách ở TP.HCM / tỉnh khác nhận. */
  hcmDays: [number, number];
  provinceDays: [number, number];
}

/** Lịch chuẩn PO duyệt 19/11: Thứ 2 – Thứ 7, cắt đơn 15:00, nghỉ Chủ nhật; TP.HCM 1–2, tỉnh khác 2–4 ngày làm việc. */
export const DEFAULT_WAREHOUSE_SCHEDULE: WarehouseSchedule = {
  cutoff: '15:00',
  workDays: [1, 2, 3, 4, 5, 6],
  holidays: [],
  hcmDays: [1, 2],
  provinceDays: [2, 4],
};

const CUTOFF_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HOLIDAYS = 60;
const MAX_TRANSIT_DAYS = 30;

const isDay = (d: unknown): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6;
const isDate = (d: unknown): d is string => {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};

function rangeOf(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [lo, hi] = v as unknown[];
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
  const [a, b] = [lo as number, hi as number];
  return a < 0 || b < a || b > MAX_TRANSIT_DAYS ? null : [a, b];
}

/**
 * Lịch kho từ giá trị đã lưu, từng trường hỏng thì về trường mặc định (không bỏ cả lịch), ngày lễ sai thì chỉ bỏ ngày đó: dòng ngày
 * nhận vẫn hiện theo lịch chuẩn thay vì biến mất vì một ngày lễ gõ sai. Luật ghi `warehouseScheduleProblem` chặn giá trị sai ngay lúc admin lưu.
 */
export function toWarehouseSchedule(raw: unknown): WarehouseSchedule {
  const d = DEFAULT_WAREHOUSE_SCHEDULE;
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const days = r.workDays;
  const holidays = r.holidays;
  return {
    cutoff: typeof r.cutoff === 'string' && CUTOFF_RE.test(r.cutoff) ? r.cutoff : d.cutoff,
    workDays: Array.isArray(days) && days.length > 0 && days.every(isDay) ? [...new Set(days)].sort((a, b) => a - b) : [...d.workDays],
    holidays: Array.isArray(holidays) ? holidays.filter(isDate).slice(0, MAX_HOLIDAYS) : [],
    hcmDays: rangeOf(r.hcmDays) ?? [...d.hcmDays],
    provinceDays: rangeOf(r.provinceDays) ?? [...d.provinceDays],
  };
}

/** Luật ghi của `shipping.warehouse_schedule` (SystemConfigService.JSON_RULES): null = hợp lệ. */
export function warehouseScheduleProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'phải là object {cutoff, workDays, holidays, hcmDays, provinceDays}';
  const v = value as Record<string, unknown>;
  if (typeof v.cutoff !== 'string' || !CUTOFF_RE.test(v.cutoff)) return 'cutoff phải là giờ "HH:mm" (vd "15:00")';
  if (!Array.isArray(v.workDays) || v.workDays.length === 0 || !v.workDays.every(isDay)) return 'workDays phải là mảng ngày 0–6 (0 = Chủ nhật), ít nhất một ngày';
  if (!Array.isArray(v.holidays) || v.holidays.length > MAX_HOLIDAYS || !v.holidays.every(isDate)) return `holidays phải là mảng tối đa ${MAX_HOLIDAYS} ngày "YYYY-MM-DD"`;
  for (const k of ['hcmDays', 'provinceDays'] as const) {
    if (!rangeOf(v[k])) return `${k} phải là [ít nhất, nhiều nhất] số ngày nguyên 0–${MAX_TRANSIT_DAYS}, ít nhất không lớn hơn nhiều nhất`;
  }
  return null;
}
