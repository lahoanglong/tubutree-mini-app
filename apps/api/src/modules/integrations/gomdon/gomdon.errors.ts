import axios from 'axios';

/**
 * Gomdon CHẮC CHẮN chưa tạo gì (từ chối rõ ràng, lỗi đăng nhập, request chưa tới được server).
 * Retry tạo đơn là an toàn.
 */
export class GomdonRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GomdonRejectedError';
  }
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
 * Phân loại lỗi HTTP khi TẠO đơn Gomdon (401 được xử lý riêng ở client — đăng nhập lại).
 *  - 4xx (trừ 401), 503: Gomdon từ chối/không nhận xử lý → Rejected (retry an toàn).
 *  - 5xx khác: có thể đã xử lý xong rồi mới lỗi → Ambiguous.
 *  - Không có response: chỉ Rejected khi chắc chắn chưa gửi (ECONNREFUSED/ENOTFOUND…);
 *    timeout/ECONNRESET/socket hang up → Ambiguous.
 */
export function classifyGomdonCreateError(err: unknown, prefix: string): Error {
  if (err instanceof GomdonRejectedError || err instanceof GomdonAmbiguousError) return err;
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const msg = `${prefix} (HTTP ${status ?? err.code ?? 'ERR'}): ${detail(err)}`;
    if (status !== undefined) {
      if (status < 500 || status === 503) return new GomdonRejectedError(msg);
      return new GomdonAmbiguousError(msg);
    }
    if (err.code && NOT_SENT_CODES.has(err.code)) return new GomdonRejectedError(msg);
    return new GomdonAmbiguousError(msg);
  }
  // Lỗi không phải HTTP (bug, lỗi build FormData...) phát sinh TRONG lúc gửi → không chắc.
  return new GomdonAmbiguousError(`${prefix}: ${detail(err)}`);
}

/** Gomdon trả HTTP 200 + result:false kèm thông điệp token hết hạn (không phải 401). */
export function looksLikeAuthFailure(message: string | undefined): boolean {
  return !!message && /token|unauthori[sz]ed|unauthenticated|hết hạn|het han|đăng nhập lại/i.test(message);
}
