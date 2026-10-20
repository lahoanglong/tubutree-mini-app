import { errorStatus } from '@tubutree/app-core/api/error-status';

export const SESSION_EXPIRED_TEXT = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
export const NO_ACCESS_TEXT = 'Tài khoản này không có quyền xem nội dung này.';
const GENERIC_TEXT = 'Đã có lỗi xảy ra — Vui lòng thử lại';

const RAW_AUTH = /^(unauthorized|forbidden)$/i;

/** Lỗi do phiên/quyền: thử lại không thay đổi được kết quả, nên màn hình không nên mời "Thử lại". */
export function isAuthError(e: unknown): boolean {
  const s = errorStatus(e);
  if (s === 401 || s === 403) return true;
  return e instanceof Error && RAW_AUTH.test(e.message.trim());
}

/** Câu tiếng Việt hiện cho khách: 401/403 và message thô của Nest ("Unauthorized"/"Forbidden") không bao giờ lộ ra. */
export function friendlyError(e: unknown): string {
  const s = errorStatus(e);
  const raw = e instanceof Error ? e.message.trim() : '';
  if (s === 401 || /^unauthorized$/i.test(raw)) return SESSION_EXPIRED_TEXT;
  if (s === 403 || /^forbidden$/i.test(raw)) return NO_ACCESS_TEXT;
  return raw || GENERIC_TEXT;
}
