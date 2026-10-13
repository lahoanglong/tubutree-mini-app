import axios from 'axios';

/**
 * Gomdon CHẮC CHẮN chưa tạo gì (từ chối rõ ràng, lỗi đăng nhập, request chưa tới được server).
 * Retry tạo đơn là an toàn.
 *
 * `transient`: lỗi TẠM (Gomdon quá tải 503/429, mạng chưa tới server, đăng nhập lỗi) — thử lại sau vài phút
 * nhiều khả năng được, nên được thử lại lâu (cửa sổ cứu hộ) trước khi báo kho tạo vận đơn tay. Ngược lại là
 * lỗi DỨT KHOÁT (validate dữ liệu, 4xx): thử lại vài lần là đủ, rồi báo người xử lý ngay.
 */
export class GomdonRejectedError extends Error {
  readonly transient: boolean;

  constructor(message: string, opts: { transient?: boolean } = {}) {
    super(message);
    this.name = 'GomdonRejectedError';
    this.transient = opts.transient ?? false;
  }
}

export function isTransientGomdonRejection(err: unknown): boolean {
  return err instanceof GomdonRejectedError && err.transient;
}

/**
 * KHÔNG biết Gomdon đã tạo vận đơn hay chưa (timeout sau khi gửi, rớt kết nối giữa chừng, 5xx,
 * result:true nhưng thiếu mã…). TUYỆT ĐỐI không gọi tạo lại — mỗi lần gọi lại là thêm một vận đơn
 * BestExpress thật (bưu tá tới kho, nhãn COD thu tiền). Chuyển kiểm tra tay.
 */
export class GomdonAmbiguousError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GomdonAmbiguousError';
  }
}

/**
 * Gomdon từ chối tạo vì `order_customer_id` (mã đơn của ta) ĐÃ CÓ đơn bên Gomdon — tài liệu ghi trường
 * này "dùng để check unique". Nghĩa là vận đơn cho đơn này đã tồn tại (lần tạo trước bị timeout/mất
 * response, hoặc vận đơn cũ đã huỷ vẫn giữ mã). KHÔNG retry (retry cũng bị từ chối y hệt) và KHÔNG được
 * coi là "chắc chắn chưa tạo" → hết lượt sẽ thành FAILED + "tạo vận đơn tay" = giao trùng. Kế thừa
 * GomdonAmbiguousError để mọi nơi xử lý "không retry, kiểm tra tay" tự áp dụng.
 */
export class GomdonDuplicateOrderError extends GomdonAmbiguousError {
  constructor(message: string) {
    super(message);
    this.name = 'GomdonDuplicateOrderError';
  }
}

/** Mã lỗi mạng mà request CHẮC CHẮN chưa tới server (DNS/kết nối bị từ chối). */
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_INVALID_URL']);

function detail(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string } | undefined;
    return data?.message ?? (err.response?.data ? JSON.stringify(err.response.data) : err.message);
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Thông điệp Gomdon báo `order_customer_id` đã có đơn. Tài liệu không in mẫu lỗi này; lỗi validate trong
 * tài liệu là thông điệp mặc định của Laravel ("The source province field is required.") nên luật unique
 * mặc định sẽ ra "The order customer id has already been taken." — nhận thêm vài cách viết tiếng Việt.
 * Cố ý KHÔNG bắt chữ "trùng" đứng riêng ("không trùng khớp" là lỗi địa chỉ, không phải trùng mã).
 */
export function looksLikeDuplicateOrder(message: string | undefined | null): boolean {
  if (!message) return false;
  return /already been taken|already exists?|đã tồn tại|da ton tai|đã được sử dụng|bị trùng|trùng lặp|trùng mã|duplicate/i.test(
    message.normalize('NFC'),
  );
}

/** Gomdon tạm không nhận xử lý (quá tải / giới hạn tần suất) — chắc chắn chưa tạo, thử lại sau là được. */
const TRANSIENT_HTTP = new Set([429, 503]);

/**
 * Phân loại lỗi HTTP khi TẠO đơn Gomdon (401 được xử lý riêng ở client — đăng nhập lại).
 *  - 4xx kèm thông điệp trùng mã đơn → Duplicate (đã có đơn bên Gomdon — KHÔNG retry, kiểm tra tay).
 *  - 429, 503: Gomdon tạm không nhận → Rejected TẠM (retry lâu).
 *  - 4xx khác (trừ 401): Gomdon từ chối dữ liệu → Rejected dứt khoát.
 *  - 5xx khác: có thể đã xử lý xong rồi mới lỗi → Ambiguous.
 *  - Không có response: chỉ Rejected (TẠM) khi chắc chắn chưa gửi (ECONNREFUSED/ENOTFOUND…);
 *    timeout/ECONNRESET/socket hang up → Ambiguous.
 */
export function classifyGomdonCreateError(err: unknown, prefix: string): Error {
  if (err instanceof GomdonRejectedError || err instanceof GomdonAmbiguousError) return err;
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const msg = `${prefix} (HTTP ${status ?? err.code ?? 'ERR'}): ${detail(err)}`;
    if (status !== undefined) {
      if (status < 500 && looksLikeDuplicateOrder(detail(err))) return new GomdonDuplicateOrderError(msg);
      if (TRANSIENT_HTTP.has(status)) return new GomdonRejectedError(msg, { transient: true });
      if (status < 500) return new GomdonRejectedError(msg);
      return new GomdonAmbiguousError(msg);
    }
    if (err.code && NOT_SENT_CODES.has(err.code)) return new GomdonRejectedError(msg, { transient: true });
    return new GomdonAmbiguousError(msg);
  }
  // Lỗi không phải HTTP (bug, lỗi build FormData...) phát sinh TRONG lúc gửi → không chắc.
  return new GomdonAmbiguousError(`${prefix}: ${detail(err)}`);
}

/** Gomdon trả HTTP 200 + result:false kèm thông điệp token hết hạn (không phải 401). */
export function looksLikeAuthFailure(message: string | undefined): boolean {
  return !!message && /token|unauthori[sz]ed|unauthenticated|hết hạn|het han|đăng nhập lại/i.test(message);
}
