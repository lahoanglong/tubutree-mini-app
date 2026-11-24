import { MINI_VITAL_NAMES, VITAL_MAX, WEB_VITAL_NAMES, type VitalName } from '@tubutree/shared-types';

/** Cờ thu số đo tốc độ trên máy khách (Mini App và web), mặc định TẮT: migration 20261118211205_perf_rum_flags + seed createOnly. */
export const PERF_RUM_ENABLED_KEY = 'perf.rum_enabled';
/** Phần trăm lượt xem trang được đo (0–100); seed 100 vì lưu lượng còn thấp. */
export const PERF_RUM_SAMPLE_PCT_KEY = 'perf.rum_sample_pct';
export const PERF_RUM_SAMPLE_PCT_DEFAULT = 100;

/** Một lượt xem trang gửi tối đa 5 số đo web hoặc 3 số đo Mini; lô mang nhiều hơn là gửi lặp hay gửi giả. */
export const MAX_VITALS_PER_BATCH = 8;

/** Giá trị hỏng (không phải số 0–100) thì không đo: thà thiếu số còn hơn đo cả khi admin gõ nhầm. */
export function normalizeSamplePct(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 0;
}

/**
 * Tên sự kiện số đo tốc độ. Dùng chung cho chỗ dọn sau `PERF_VITALS_DAYS` (data-retention) và chỗ phễu mua bỏ qua chúng: thêm loại số đo
 * mà chỉ sửa một nơi thì ngày được bù sau khi dọn lại lệch số với bảng sống.
 */
export const VITAL_EVENT_NAMES = ['web_vital', 'mini_vital'] as const;

export const isVitalEventName = (name: string): name is (typeof VITAL_EVENT_NAMES)[number] =>
  (VITAL_EVENT_NAMES as readonly string[]).includes(name);

/**
 * Mẫu route, không phải URL thật: tối đa 6 đoạn, mỗi đoạn là tham số (`:slug`) hoặc chữ thường/gạch nối không có dãy 4 chữ số hay đuôi mã
 * hex 6 ký tự (slug sản phẩm, mã đơn, id). Không có `?`, `#`, host hay dấu `%`.
 */
const SEGMENT = /^(?::[A-Za-z]{1,20}|[a-z0-9][a-z0-9-]{0,39})$/;
export function isVitalRoute(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  if (v === '/') return true;
  if (!v.startsWith('/') || v.length > 120) return false;
  const segs = v.slice(1).split('/');
  if (segs.length > 6) return false;
  return segs.every((s) => SEGMENT.test(s) && (s.startsWith(':') || (!/\d{4}/.test(s) && !/-[0-9a-f]{6}$/.test(s))));
}

/** Số đo phải đúng tên của nền tảng gửi (`web_vital` chỉ từ web, `mini_vital` chỉ từ Mini App) và nằm trong khoảng hợp lý. */
export function isPlausibleVital(e: { eventName: string; platform: string; props?: Record<string, unknown> }): boolean {
  if (!isVitalEventName(e.eventName)) return true;
  const names: readonly string[] = e.eventName === 'web_vital' ? WEB_VITAL_NAMES : MINI_VITAL_NAMES;
  if (e.platform !== (e.eventName === 'web_vital' ? 'web' : 'miniapp')) return false;
  const name = e.props?.name;
  const value = e.props?.value;
  if (typeof name !== 'string' || !names.includes(name)) return false;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= VITAL_MAX[name as VitalName];
}
