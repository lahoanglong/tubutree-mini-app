import { createHash } from 'node:crypto';

export const PANCAKE_EVENT_STATUS = {
  RECEIVED: 'RECEIVED',
  PROCESSING: 'PROCESSING',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED',
  /** Chưa khớp được đơn Tubu (vd webhook tới trước khi lưu pancakeOrderId) — cron đối chiếu lại trong ít lâu. */
  UNMATCHED: 'UNMATCHED',
  /** Cố ý không áp (lý do ở `error`): mã đơn của đơn đối tác tự giao, số tồn kho cũ hơn số đã áp. Đã xong, không chạy lại. */
  IGNORED: 'IGNORED',
} as const;

/** Sự kiện đã có kết cục cuối — worker, Pancake gửi lại và cron cứu đều không chạy lại. */
export const PANCAKE_EVENT_DONE: readonly string[] = [PANCAKE_EVENT_STATUS.PROCESSED, PANCAKE_EVENT_STATUS.IGNORED];

/** Worker giữ claim PROCESSING lâu hơn mốc này coi như đã chết (handler thường xong trong vài giây). */
export const PANCAKE_CLAIM_STALE_MINUTES = 15;

/** Tồn kho tuyệt đối tại thời điểm gửi: áp muộn sẽ đè số mới hơn, nên không bao giờ chạy lại (cron lẫn tay). */
export const PANCAKE_STOCK_EVENT = 'variation.stock_changed';

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

/** Mã đơn Tubu do pushOrder ghi vào note ("Order code: <mã>") — mọi tiền tố (TUBU, TUBUSUB, DLR). */
const NOTE_ORDER_CODE = /Order code:\s*([A-Z]+\d+)/;

/** Pancake POS gửi nguyên object đơn ở top-level; luồng cũ bọc trong {event, data}. */
export function pancakeEventData(rawPayload: unknown): Record<string, unknown> {
  const payload = (rawPayload && typeof rawPayload === 'object' ? rawPayload : {}) as Record<string, unknown>;
  const data = payload['data'];
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : payload;
}

/** Mã đơn Tubu mà đơn Pancake mang (extension.external_order_id, hoặc "Order code: …" trong note). */
export function pancakeEventOrderCode(data: Record<string, unknown>): string | null {
  const ext = data['extension'] as { external_order_id?: string } | undefined;
  if (ext?.external_order_id) return ext.external_order_id;
  const note = typeof data['note'] === 'string' ? data['note'] : '';
  const m = note.match(NOTE_ORDER_CODE);
  return m ? m[1]! : null;
}

/** Nhãn để người vận hành tìm ra việc: mã đơn Tubu, không có thì #id đơn Pancake; null khi payload không có cả hai. */
export function pancakeEventRef(rawPayload: unknown): string | null {
  const data = pancakeEventData(rawPayload);
  const code = pancakeEventOrderCode(data);
  if (code) return code;
  const id = data['id'] ?? data['order_id'];
  return id === null || id === undefined || id === '' ? null : `#${String(id)}`;
}
