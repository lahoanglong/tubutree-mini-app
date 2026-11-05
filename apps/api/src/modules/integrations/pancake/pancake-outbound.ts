import type { PancakeCreateOrderResponse, PancakeOrderDTO } from './pancake.types';
import { NOTE_ORDER_CODE } from './pancake-webhook-dedupe';
import { payloadId } from './pancake-payload';

/**
 * Lỗi gọi Pancake POS (đơn hàng). `transient`: lỗi mạng/timeout/5xx/429 — Pancake CÓ THỂ đã xử lý lệnh, thử lại
 * sau. Ngược lại là Pancake từ chối dứt khoát (4xx, `success:false`) — lệnh chắc chắn không có hiệu lực.
 */
export class PancakeApiError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly notFound = false,
    /** Mã HTTP Pancake trả (không có khi mất kết nối hay `success:false` trong HTTP 200). */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PancakeApiError';
  }
}

/**
 * Lượt này thua tranh chấp quyền đẩy: tiến trình khác (job push, job thanh toán, cron) đang giữ hoặc vừa ghi kết cục cho đơn. Là lỗi tạm
 * để BullMQ thử lại, nhưng KHÔNG được ghi lên đơn (sẽ đè loại lỗi mà tiến trình kia vừa ghi).
 */
export class PancakePushBusyError extends PancakeApiError {
  constructor(message: string) {
    super(message, true);
    this.name = 'PancakePushBusyError';
  }
}

/**
 * Lượt này không được gửi lệnh tạo đơn vì một lệnh tạo khác (chưa rõ kết quả) vừa được gửi trong cửa sổ chờ `SEND_SETTLE_MS`: Pancake có thể
 * đang tạo đơn hoặc chưa tra được theo mã. Là Busy: BullMQ thử lại, markPushFailure không ghi gì (không đốt/hoàn lượt, không đổi loại lỗi, không báo).
 */
export class PancakePushSettlingError extends PancakePushBusyError {
  constructor(message: string) {
    super(message);
    this.name = 'PancakePushSettlingError';
  }
}

/**
 * Pancake trả lời được nhưng từ chối lệnh huỷ, và lần đọc lại ngay sau đó cho thấy đơn CHƯA bàn giao vận chuyển: khác
 * hẳn lỗi mất kết nối — trạng thái Pancake đã biết chắc tại thời điểm hỏi.
 */
export class PancakeCancelRefusedError extends PancakeApiError {
  constructor(
    message: string,
    readonly pancakeStatus: number | string | null,
  ) {
    super(message, false);
    this.name = 'PancakeCancelRefusedError';
  }
}

/** Dữ liệu đơn không đủ để tạo đơn kho (thiếu người nhận...). Thử lại không giúp gì: cần người sửa. */
export class PancakeOrderDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PancakeOrderDataError';
  }
}

/**
 * Mã `status` đơn hàng Pancake POS (Open API, schema "Đơn hàng"). Từ "Đã gửi hàng" (2) trở đi là hàng đã bàn giao
 * cho đơn vị vận chuyển: Đã nhận (3), Đã thu tiền (16), Đang hoàn (4), Hoàn một phần (15), Đã hoàn (5).
 */
export const PANCAKE_ORDER_STATUS = {
  SHIPPED: 2,
  CANCELLED: 6,
  DELETED: 7,
} as const;

const HANDED_OVER: ReadonlySet<number> = new Set([2, 3, 16, 4, 15, 5]);

/** Chỉ số hoặc chuỗi số nguyên: `Number([6])` = 6 và `Number(true)` = 1 sẽ đọc mảng/boolean thành mã trạng thái ("đã huỷ" → bỏ lệnh huỷ). */
function statusNumber(status: unknown): number | null {
  if (typeof status === 'number') return Number.isInteger(status) ? status : null;
  if (typeof status === 'string' && /^\s*\d+\s*$/.test(status)) return Number(status);
  return null;
}

export function isPancakeHandedOver(status: unknown): boolean {
  const n = statusNumber(status);
  return n !== null && HANDED_OVER.has(n);
}

export function isPancakeCancelled(status: unknown): boolean {
  const n = statusNumber(status);
  return n === PANCAKE_ORDER_STATUS.CANCELLED || n === PANCAKE_ORDER_STATUS.DELETED;
}

/** id đơn Pancake trong phản hồi tạo đơn — phẳng (theo Open API) hoặc bọc `data` (bản thật). */
export function extractPancakeOrderId(res: PancakeCreateOrderResponse | null | undefined): string | null {
  // Ô đầu rỗng/rác thì thử ô sau; id không đọc được không được thành "[object Object]" rồi ghi làm mã đơn Pancake của đơn Tubu.
  return payloadId(res?.data?.id) ?? payloadId(res?.data?.order_id) ?? payloadId(res?.id) ?? payloadId(res?.order_id);
}

/** Mã của một đơn Pancake trong danh sách/tra cứu trả về; null khi thiếu hoặc không đọc được. */
export function pancakeOrderIdOf(o: PancakeOrderDTO | null | undefined): string | null {
  return o && typeof o === 'object' ? payloadId(o.id) : null;
}

/** Đơn Pancake này mang đúng mã đơn Tubu (custom_id, extension hoặc ghi chú) — không khớp theo chuỗi con. */
export function pancakeOrderHasCode(o: PancakeOrderDTO, code: string): boolean {
  if (o.custom_id === code) return true;
  if (o.extension?.external_order_id === code) return true;
  const m = typeof o.note === 'string' ? o.note.match(NOTE_ORDER_CODE) : null;
  return m?.[1] === code;
}

/** Rút gọn lỗi để lưu DB/hiện cho admin. */
export function pancakeErrorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 300 ? `${msg.slice(0, 297)}...` : msg;
}
