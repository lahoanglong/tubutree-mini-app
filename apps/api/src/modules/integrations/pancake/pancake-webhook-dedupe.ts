import { createHash } from 'node:crypto';

export const PANCAKE_EVENT_STATUS = {
  RECEIVED: 'RECEIVED',
  PROCESSING: 'PROCESSING',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED',
  /** Chưa khớp được đơn Tubu (vd webhook tới trước khi lưu pancakeOrderId) — cron đối chiếu lại trong ít lâu. */
  UNMATCHED: 'UNMATCHED',
} as const;

/** Worker giữ claim PROCESSING lâu hơn mốc này coi như đã chết (handler thường xong trong vài giây). */
export const PANCAKE_CLAIM_STALE_MINUTES = 15;

/** Job name của queue pancake-events (giữ nguyên tên cũ để job đang chờ lúc deploy vẫn chạy). */
export const PANCAKE_JOB_EVENT = 'process';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Khoá chống lưu/xử lý trùng = eventType + băm TOÀN BỘ payload (thứ tự key không ảnh hưởng).
 * Băm cả payload thay vì (id đơn, updated_at): Pancake không công bố id sự kiện, và hai lần sửa đơn
 * khác nhau mà gộp nhầm thì mất hẳn một cập nhật (tiền/trạng thái) — chỉ gộp lần gửi lại y hệt.
 */
export function pancakeDedupeKey(eventType: string, body: unknown): string {
  const hash = createHash('sha256').update(canonicalJson(body)).digest('hex');
  return `${eventType.slice(0, 120)}|${hash}`;
}
