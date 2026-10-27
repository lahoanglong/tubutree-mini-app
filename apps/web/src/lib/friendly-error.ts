import { errorStatus } from '@tubutree/app-core/api/error-status';
import { loadErrorText } from './error-text';

export const SESSION_EXPIRED_TEXT = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
export const NO_ACCESS_TEXT = 'Tài khoản này không có quyền xem nội dung này.';

const RAW_AUTH = /^(unauthorized|forbidden)$/i;

/** Lỗi do phiên/quyền: thử lại không thay đổi được kết quả, nên màn hình không nên mời "Thử lại". */
export function isAuthError(e: unknown): boolean {
  const s = errorStatus(e);
  if (s === 401 || s === 403) return true;
  return e instanceof Error && RAW_AUTH.test(e.message.trim());
}

/** Câu tiếng Việt hiện cho khách (phần còn lại theo loadErrorText, cùng chữ với Mini App): 401 và message thô của Nest ("Unauthorized"/"Forbidden") không bao giờ lộ ra. */
export function friendlyError(e: unknown): string {
  const s = errorStatus(e);
  const raw = e instanceof Error ? e.message.trim() : '';
  if (s === 401 || /^unauthorized$/i.test(raw)) return SESSION_EXPIRED_TEXT;
  // 403 kèm câu nghiệp vụ tiếng Việt (đường gửi kho bị khoá, chương trình tắt...) giữ nguyên như Mini App; chỉ chữ thô hoặc rỗng mới thay.
  if (/^forbidden$/i.test(raw) || (s === 403 && !raw)) return NO_ACCESS_TEXT;
  return loadErrorText(e);
}
