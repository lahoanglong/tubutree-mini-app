import { ApiError, NetworkError } from './client-api';

// Có dấu tiếng Việt → chuỗi đã được viết cho khách (lời nhắn của API/của chính web); không dấu → mã/thông báo kỹ
// thuật tiếng Anh ("invalid_grant", "Failed to fetch") không nên in ra cho khách.
const VIETNAMESE_CHARS =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

// API cũ ghép nguyên lời của Zalo vào sau tiền tố tiếng Việt ("Zalo OAuth thất bại: invalid code"): có dấu nên lọt bộ lọc
// trên nhưng vẫn là chuỗi kỹ thuật. Nay API trả câu sạch; web vẫn chặn để bản API cũ không làm lộ chuỗi thô.
const UPSTREAM_ZALO_FAILURE = /^Zalo (?:OAuth|verify) thất bại/i;
const CODE_REJECTED = 'Mã đăng nhập Zalo không hợp lệ hoặc đã hết hạn. Đăng nhập lại để tiếp tục.';

const GENERIC = 'Không đăng nhập được lúc này. Thử lại sau ít phút; nếu vẫn lỗi, liên hệ hotline để được hỗ trợ.';

/** Lỗi Zalo trả về qua ?error=… ở trang callback. */
export function oauthErrorMessage(code: string | null | undefined): string {
  switch ((code ?? '').toLowerCase()) {
    case 'access_denied':
      return 'Bạn đã từ chối cấp quyền trên Zalo nên Tubu Tree chưa thể đăng nhập cho bạn. Hãy đăng nhập lại và bấm “Cho phép”.';
    case 'invalid_request':
    case 'invalid_scope':
    case 'unauthorized_client':
    case 'redirect_uri_mismatch':
      return 'Đăng nhập bằng Zalo đang gặp sự cố cấu hình. Thử lại sau hoặc liên hệ hotline để được hỗ trợ.';
    case 'temporarily_unavailable':
    case 'server_error':
      return 'Zalo đang bận. Đợi một lúc rồi đăng nhập lại.';
    default:
      return 'Zalo chưa hoàn tất việc đăng nhập. Thử đăng nhập lại.';
  }
}

/** Lỗi khi đổi mã Zalo lấy phiên đăng nhập (handleCallback). */
export function loginFailureMessage(e: unknown): string {
  if (e instanceof NetworkError) return e.message;
  if (e instanceof ApiError && e.status === 429) return 'Bạn thử đăng nhập quá nhiều lần. Đợi ít phút rồi thử lại.';
  const message = e instanceof Error ? e.message.trim() : '';
  if (UPSTREAM_ZALO_FAILURE.test(message)) return CODE_REJECTED;
  return message && VIETNAMESE_CHARS.test(message) ? message : GENERIC;
}

/** Lỗi tạm (mất mạng, Zalo/API bận, quá nhiều lần thử): lần đăng nhập kế tiếp nhiều khả năng thành công nên nút hiện "Thử lại". */
export function isTransientLoginFailure(e: unknown): boolean {
  if (e instanceof NetworkError) return true;
  return e instanceof ApiError && (e.status === 429 || e.status >= 500);
}

/** Lời báo trên /dang-nhap?zalo_unavailable=1: ứng dụng Zalo chưa được duyệt nên khách ngoài danh sách thử gặp lỗi -14029. */
export const ZALO_UNAVAILABLE_NOTICE = 'Đăng nhập Zalo đang chờ duyệt — bạn đăng nhập nhanh bằng Email bên dưới nhé.';
const ZALO_NOT_APPROVED = /-?14029|not approved/i;
const ZALO_ERROR_PARAMS = ['error', 'error_code', 'error_description', 'error_name', 'message'] as const;

/** Zalo báo ứng dụng chưa được duyệt: API đổi mã trả ZALO_APP_NOT_APPROVED. */
export function isZaloNotApproved(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'ZALO_APP_NOT_APPROVED';
}

/** Như trên, nhưng Zalo nói thẳng qua tham số khi chuyển về trang callback (mã -14029 hoặc "application is not approved"). */
export function zaloParamsNotApproved(params: URLSearchParams): boolean {
  return ZALO_ERROR_PARAMS.some((k) => ZALO_NOT_APPROVED.test(params.get(k) ?? ''));
}

/** Lỗi khi xin mã, nhập mã email hoặc đổi mã Google: API viết sẵn câu tiếng Việt kèm mã EMAIL_* / GOOGLE_*; còn lại như lỗi đăng nhập chung. */
export function webLoginErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.code && /^(?:EMAIL|GOOGLE)_/.test(e.code) && VIETNAMESE_CHARS.test(e.message)) return e.message;
  return loginFailureMessage(e);
}

/** Số giây còn phải chờ khi API từ chối gửi mã (429), để nút "Gửi lại mã" đếm đúng với máy chủ. */
export function retryAfterSec(e: unknown): number | null {
  if (!(e instanceof ApiError) || e.status !== 429) return null;
  const v = (e.body as { retryAfterSec?: unknown } | null)?.retryAfterSec;
  return typeof v === 'number' && v > 0 ? Math.ceil(v) : null;
}

/** Lỗi Google trả về qua ?error=… ở trang /dang-nhap/google (`google_unavailable` do API đặt khi chưa có khoá Google). */
export function googleErrorMessage(code: string | null | undefined): string {
  switch ((code ?? '').toLowerCase()) {
    case 'access_denied':
      return 'Bạn đã huỷ đăng nhập Google. Bạn thử lại hoặc đăng nhập bằng Email nhé.';
    case 'google_unavailable':
      return 'Đăng nhập Google chưa được bật. Bạn đăng nhập bằng Email nhé.';
    case 'temporarily_unavailable':
    case 'server_error':
      return 'Google đang bận. Đợi một lúc rồi đăng nhập lại.';
    default:
      return 'Google chưa hoàn tất việc đăng nhập. Thử đăng nhập lại.';
  }
}
