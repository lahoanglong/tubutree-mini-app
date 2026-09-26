/**
 * Màn thu ngân tích Điểm Xanh tại quầy (POS) — helper THUẦN (kiểm tra input trước khi gọi API, diễn giải
 * lỗi). Luật khớp DTO phía BE: apps/api/src/modules/loyalty/dto/loyalty-staff.dto.ts.
 */
import { ApiError } from './client-api';

export const RECEIPT_ID_RE = /^[A-Za-z0-9._\-/#]+$/;
export const RECEIPT_ID_MIN = 3;
export const RECEIPT_ID_MAX = 64;
export const MEMBER_CODE_RE = /^[A-Za-z0-9+\-. ]+$/;
export const ORDER_TOTAL_MIN = 1000;
export const ORDER_TOTAL_MAX = 1_000_000_000;

/** null = hợp lệ; ngược lại là câu báo lỗi tiếng Việt. */
export function memberCodeError(raw: string): string | null {
  const s = raw.trim();
  if (!s) return 'Quét mã QR trên thẻ thành viên hoặc nhập mã TUBU… / SĐT của khách.';
  if (s.length < 6 || s.length > 40) return 'Mã thành viên phải dài 6–40 ký tự.';
  if (!MEMBER_CODE_RE.test(s)) return 'Mã thành viên chỉ gồm chữ, số (hoặc SĐT).';
  return null;
}

export function receiptIdError(raw: string): string | null {
  const s = raw.trim();
  if (!s) return 'Nhập mã hoá đơn POS (in trên hoá đơn) — mỗi hoá đơn chỉ tích điểm 1 lần.';
  if (s.length < RECEIPT_ID_MIN || s.length > RECEIPT_ID_MAX) {
    return `Mã hoá đơn phải dài ${RECEIPT_ID_MIN}–${RECEIPT_ID_MAX} ký tự.`;
  }
  if (!RECEIPT_ID_RE.test(s)) return 'Mã hoá đơn chỉ gồm chữ, số và . _ - / #';
  return null;
}

/** "1.250.000", "1,250,000đ", "1250000" → 1250000. Không có chữ số → null. */
export function parseVndInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

export function orderTotalError(n: number | null): string | null {
  if (n == null) return 'Nhập tổng tiền hoá đơn.';
  if (n < ORDER_TOTAL_MIN) return `Hoá đơn tối thiểu ${ORDER_TOTAL_MIN.toLocaleString('vi-VN')}đ.`;
  if (n > ORDER_TOTAL_MAX) return 'Tổng tiền hoá đơn quá lớn.';
  return null;
}

export type PosErrorKind = 'disabled' | 'not-found' | 'ambiguous' | 'duplicate-receipt' | 'forbidden' | 'rate-limited' | 'other';

export interface PosErrorView {
  kind: PosErrorKind;
  message: string;
}

/**
 * Diễn giải lỗi API cho thu ngân. Message của BE đã là tiếng Việt, cụ thể (trần ngày, hoá đơn trùng,
 * khoá tài khoản…) nên HIỆN NGUYÊN VĂN; chỉ phân loại để UI tô màu/gợi ý bước tiếp theo.
 */
export function posErrorView(err: unknown): PosErrorView {
  const message = err instanceof Error && err.message ? err.message : 'Có lỗi xảy ra. Vui lòng thử lại.';
  const status = err instanceof ApiError ? err.status : 0;
  if (status === 403 && /đang tắt/i.test(message)) {
    return {
      kind: 'disabled',
      message: 'Tích điểm tại quầy đang TẮT (loyalty.pos_credit_enabled). Quản trị viên bật trong Quản trị → Cấu hình → Tích điểm.',
    };
  }
  if (status === 403) return { kind: 'forbidden', message };
  if (status === 404) return { kind: 'not-found', message };
  if (status === 409 && /hoá đơn/i.test(message)) return { kind: 'duplicate-receipt', message };
  if (status === 409) return { kind: 'ambiguous', message };
  if (status === 429) return { kind: 'rate-limited', message: 'Thao tác quá nhanh — đợi khoảng 1 phút rồi thử lại.' };
  return { kind: 'other', message };
}

/** Ngày 'YYYY-MM-DD' theo giờ Việt Nam — khớp pos_point_credits.dayKey phía BE. */
export function vnDayKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
