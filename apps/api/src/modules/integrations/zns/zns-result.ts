import { isAxiosError } from 'axios';

/**
 * Kết quả một lần gọi ZNS. Zalo trả HTTP 200 kèm `{ error, message }` cho cả lỗi nghiệp vụ (mẫu chưa duyệt,
 * số không dùng Zalo, hết hạn mức...), nên thành công chỉ khi `error === 0` chứ không phải "axios không ném".
 */
export type ZnsSendResult =
  | { ok: true }
  | { ok: false; retryable: boolean; code: number | null; reason: string };

export type ZnsFailure = Extract<ZnsSendResult, { ok: false }>;

/**
 * Mã lỗi đáng thử lại: lỗi hệ thống phía Zalo và access token không hợp lệ/hết hạn (cron làm mới token hoặc admin
 * cập nhật token trong vòng một đợt thử lại thì tin vẫn đi được). Mọi mã khác 0 còn lại (số điện thoại, tài khoản
 * người nhận, mẫu/quyền, tham số, hạn mức, ví ZBS) gửi lại nguyên văn vẫn lỗi như cũ nên ghi FAILED ngay để admin
 * thấy lý do. Bảng mã chính thức của Zalo chỉ đọc được trên trang đã đăng nhập, nên danh sách này là phần xác nhận
 * được từ tài liệu công khai của các đối tác tích hợp ZNS; mã lạ rơi về "vĩnh viễn".
 */
const RETRYABLE_ZNS_CODES: ReadonlySet<number> = new Set([-100, -124, -216]);

const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 425, 429]);

export function znsFailure(retryable: boolean, code: number | null, reason: string): ZnsFailure {
  return { ok: false, retryable, code, reason };
}

/** Chuỗi lưu vào NotificationLog.error: admin đọc được cả mã lẫn lời Zalo. */
export function znsFailureText(f: ZnsFailure): string {
  const text = f.code === null ? f.reason : `ZNS lỗi ${f.code}: ${f.reason}`;
  return text.slice(0, 500);
}

function codeOf(body: unknown): { code: number; message: string } | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { error?: unknown }).error;
  const code = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof code !== 'number' || !Number.isFinite(code)) return null;
  const message = (body as { message?: unknown }).message;
  return { code, message: typeof message === 'string' && message ? message : 'không có thông điệp' };
}

export function interpretZnsBody(body: unknown): ZnsSendResult {
  const parsed = codeOf(body);
  if (!parsed) return znsFailure(true, null, 'Phản hồi ZNS không có mã kết quả (error).');
  if (parsed.code === 0) return { ok: true };
  return znsFailure(RETRYABLE_ZNS_CODES.has(parsed.code), parsed.code, parsed.message);
}

export function interpretZnsException(err: unknown): ZnsFailure {
  if (!isAxiosError(err) || !err.response) {
    return znsFailure(true, null, `Không gọi được ZNS: ${err instanceof Error ? err.message : String(err)}`);
  }
  const { status, data } = err.response;
  const parsed = codeOf(data);
  if (parsed && parsed.code !== 0) {
    return znsFailure(RETRYABLE_ZNS_CODES.has(parsed.code), parsed.code, parsed.message);
  }
  return znsFailure(status >= 500 || RETRYABLE_HTTP_STATUSES.has(status), null, `ZNS trả HTTP ${status}.`);
}
