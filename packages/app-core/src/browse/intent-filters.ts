/**
 * Bộ lọc "nhu cầu rõ" của Danh mục, chung cho web và Mini App: cùng tham số URL (`onSale=1`, `hasRefill=1`), cùng tham số API
 * (`GET /products?onSale=true&hasRefill=true`), cùng nhãn chip và cùng tên sự kiện `filter_applied`. Module không nhập gì để gói Mini
 * và JS trang /san-pham chỉ thêm đúng phần này.
 */

export type IntentFilterKey = 'onSale' | 'hasRefill';

/** Phần trạng thái Browse của hai bộ lọc; vắng hay `false` đều là không lọc. */
export type IntentFilterState = Partial<Record<IntentFilterKey, boolean>>;

export interface IntentFilter {
  key: IntentFilterKey;
  /** Nhãn ở ô chọn của Bộ lọc và ở chip "đang lọc". */
  label: string;
  /** `type` của sự kiện `filter_applied`. */
  event: 'on_sale' | 'has_refill';
}

/** Thứ tự hiện trong nhóm "Tình trạng" (sau "Chỉ hiện còn hàng"), cũng là thứ tự tham số trong URL. */
export const INTENT_FILTERS: readonly IntentFilter[] = [
  { key: 'onSale', label: 'Đang ưu đãi', event: 'on_sale' },
  { key: 'hasRefill', label: 'Có bản Refill', event: 'has_refill' },
];

/** Khoá URL mà trạng thái Browse sở hữu (giữ nguyên tên khoá API để link chia sẻ đọc được). */
export const INTENT_FILTER_PARAM_KEYS: readonly IntentFilterKey[] = INTENT_FILTERS.map((f) => f.key);

/** `?onSale=1&hasRefill=1` → `{ onSale: true, hasRefill: true }`; giá trị khác "1" là không lọc, khoá không có mặt trong kết quả. */
export function parseIntentFilters(params: URLSearchParams): IntentFilterState {
  const out: IntentFilterState = {};
  for (const f of INTENT_FILTERS) if (params.get(f.key) === '1') out[f.key] = true;
  return out;
}

/** Ghi các bộ lọc đang bật vào `p` theo thứ tự cố định: một trạng thái một URL. */
export function writeIntentFilters(s: IntentFilterState, p: URLSearchParams): void {
  for (const f of INTENT_FILTERS) if (s[f.key]) p.set(f.key, '1');
}

/** Tham số `GET /products`: chỉ bộ lọc đang bật (API cũ không biết hai khoá này, gửi vắng thì không bị 400). */
export function intentFilterQuery(s: IntentFilterState): IntentFilterState {
  const out: IntentFilterState = {};
  for (const f of INTENT_FILTERS) if (s[f.key]) out[f.key] = true;
  return out;
}

/** Số bộ lọc đang bật (cộng vào badge nút "Bộ lọc"). */
export function intentFilterCount(s: IntentFilterState): number {
  return INTENT_FILTERS.filter((f) => s[f.key]).length;
}

/** Bộ lọc đổi giữa trạng thái cũ và nháp (sự kiện `filter_applied`). */
export function changedIntentFilters(before: IntentFilterState, after: IntentFilterState): IntentFilter[] {
  return INTENT_FILTERS.filter((f) => Boolean(before[f.key]) !== Boolean(after[f.key]));
}

/** Chip "đang lọc" gỡ được từng cái, theo thứ tự cố định. */
export function intentFilterChips(s: IntentFilterState): { key: IntentFilterKey; label: string; patch: IntentFilterState }[] {
  return INTENT_FILTERS.filter((f) => s[f.key]).map((f) => ({ key: f.key, label: f.label, patch: { [f.key]: false } }));
}

/**
 * Ô chọn mời ở Bộ lọc. "Có bản Refill" chỉ mời khi cờ `catalog.refill_first_enabled` bật (`refillOn`), hoặc khi link đang mang sẵn bộ lọc
 * đó: khách vẫn thấy và bỏ chọn được.
 */
export function offeredIntentFilters(refillOn: boolean, current: IntentFilterState = {}): IntentFilter[] {
  return INTENT_FILTERS.filter((f) => f.key !== 'hasRefill' || refillOn || current.hasRefill === true);
}
