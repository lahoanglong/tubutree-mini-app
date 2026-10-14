import type { PancakeCreateOrderResponse, PancakeOrderDTO } from './pancake.types';

/**
 * Lỗi gọi Pancake POS (đơn hàng). `transient`: lỗi mạng/timeout/5xx/429 — Pancake CÓ THỂ đã xử lý lệnh, thử lại
 * sau. Ngược lại là Pancake từ chối dứt khoát (4xx, `success:false`) — lệnh chắc chắn không có hiệu lực.
 */
export class PancakeApiError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly notFound = false,
  ) {
    super(message);
    this.name = 'PancakeApiError';
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

function statusNumber(status: unknown): number | null {
  if (status === null || status === undefined || status === '') return null;
  const n = Number(status);
  return Number.isInteger(n) ? n : null;
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
  const raw = res?.data?.id ?? res?.data?.order_id ?? res?.id ?? res?.order_id;
  return raw === null || raw === undefined || raw === '' ? null : String(raw);
}

/** Ghi chú kho luôn mở đầu bằng "Order code: <mã>" — webhook và tra cứu đơn đọc mã từ đây. */
const NOTE_ORDER_CODE = /Order code:\s*([A-Z]+\d+)/;

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
