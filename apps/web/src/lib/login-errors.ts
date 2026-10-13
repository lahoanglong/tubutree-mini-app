import { ApiError, NetworkError } from './client-api';

// Có dấu tiếng Việt → chuỗi đã được viết cho khách (lời nhắn của API/của chính web); không dấu → mã/thông báo kỹ
// thuật tiếng Anh ("invalid_grant", "Failed to fetch") không nên in ra cho khách.
const VIETNAMESE_CHARS =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

const GENERIC = 'Không đăng nhập được lúc này. Vui lòng thử lại; nếu vẫn lỗi, hãy liên hệ hotline để được hỗ trợ.';

/** Lỗi Zalo trả về qua ?error=… ở trang callback. */
export function oauthErrorMessage(code: string | null | undefined): string {
  switch ((code ?? '').toLowerCase()) {
    case 'access_denied':
      return 'Bạn đã từ chối cấp quyền trên Zalo nên Tubu Tree chưa thể đăng nhập cho bạn. Hãy đăng nhập lại và bấm “Cho phép”.';
    case 'invalid_request':
    case 'invalid_scope':
    case 'unauthorized_client':
    case 'redirect_uri_mismatch':
      return 'Đăng nhập bằng Zalo đang gặp sự cố cấu hình. Vui lòng thử lại sau hoặc liên hệ hotline để được hỗ trợ.';
    case 'temporarily_unavailable':
    case 'server_error':
      return 'Zalo đang bận. Vui lòng đợi một lúc rồi đăng nhập lại.';
    default:
      return 'Zalo chưa hoàn tất việc đăng nhập. Vui lòng thử lại.';
  }
}

/** Lỗi khi đổi mã Zalo lấy phiên đăng nhập (handleCallback). */
export function loginFailureMessage(e: unknown): string {
  if (e instanceof NetworkError) return e.message;
  if (e instanceof ApiError && e.status === 429) return 'Bạn thử đăng nhập quá nhiều lần. Vui lòng đợi ít phút rồi thử lại.';
  const message = e instanceof Error ? e.message.trim() : '';
  return message && VIETNAMESE_CHARS.test(message) ? message : GENERIC;
}
