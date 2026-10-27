import { errorStatus } from '@tubutree/app-core/api/error-status';
import { actionErrorText, loadErrorText, SESSION_EXPIRED_TEXT } from './error-text';

export { SESSION_EXPIRED_TEXT };
export const NO_ACCESS_TEXT = 'Tài khoản này không có quyền xem nội dung này.';

const RAW_AUTH = /^(unauthorized|forbidden)$/i;

/** Lỗi do phiên/quyền: thử lại không thay đổi được kết quả, nên màn hình không nên mời "Thử lại". */
export function isAuthError(e: unknown): boolean {
  const s = errorStatus(e);
  if (s === 401 || s === 403) return true;
  return e instanceof Error && RAW_AUTH.test(e.message.trim());
}

function friendly(e: unknown, fallback: (e: unknown) => string): string {
  const s = errorStatus(e);
  const raw = e instanceof Error ? e.message.trim() : '';
  if (/^unauthorized$/i.test(raw)) return SESSION_EXPIRED_TEXT;
  if (s === 401) return fallback(e);
  // 403 kèm câu nghiệp vụ tiếng Việt (đường gửi kho bị khoá, chương trình tắt...) giữ nguyên như Mini App; chỉ chữ thô hoặc rỗng mới thay.
  if (/^forbidden$/i.test(raw) || (s === 403 && !raw)) return NO_ACCESS_TEXT;
  return fallback(e);
}

/** Câu tiếng Việt hiện cho khách khi tải dữ liệu (phần còn lại theo loadErrorText, cùng chữ với Mini App): 401 và message thô của Nest ("Unauthorized"/"Forbidden") không bao giờ lộ ra. */
export const friendlyError = (e: unknown): string => friendly(e, loadErrorText);

/** Như friendlyError nhưng cho nút bấm: hết thời gian nói "chưa rõ đã xong chưa" thay vì "tải chậm". */
export const friendlyActionError = (e: unknown): string => friendly(e, actionErrorText);
