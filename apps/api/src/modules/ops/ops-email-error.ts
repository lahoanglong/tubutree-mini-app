/**
 * Phân loại lỗi gửi email để biết có nên tự gửi lại không. Gửi lại mãi một lỗi vĩnh viễn (sai mật khẩu, địa chỉ nhận không
 * có thật, máy chủ cấm relay) không bao giờ thành công mà còn đập vào máy chủ thư: Gmail/Workspace khoá tài khoản gửi sau
 * nhiều lần đăng nhập sai.
 *
 *  - AUTH: xác thực hỏng (EAUTH, đáp 535/534/530/538) — sai tài khoản/mật khẩu, cần người sửa cấu hình.
 *  - PERMANENT: máy chủ từ chối vĩnh viễn (đáp 5xx khác: địa chỉ nhận không tồn tại, cấm relay, thư bị từ chối...).
 *  - TRANSIENT: còn lại — quá hạn, ECONNECTION/ESOCKET, DNS, TLS, mọi đáp 4xx (kể cả 4xx của bước xác thực như "thử đăng
 *    nhập quá nhiều, đợi chút"). Tự gửi lại ở lượt kiểm sau.
 */
export type SmtpFailureKind = 'AUTH' | 'PERMANENT' | 'TRANSIENT';

const AUTH_ERROR_CODES: ReadonlySet<string> = new Set(['EAUTH', 'ENOAUTH']);
/** 530 cần xác thực, 534 cơ chế quá yếu, 535 sai thông tin đăng nhập, 538 bắt buộc mã hoá cho cơ chế này. */
const AUTH_REPLY_CODES: ReadonlySet<number> = new Set([530, 534, 535, 538]);

/** Mã đáp SMTP của lỗi: `responseCode` do nodemailer gắn, không có thì đọc 3 chữ số đầu của chuỗi `response`. */
function smtpReplyCode(e: { responseCode?: unknown; response?: unknown }): number | null {
  if (typeof e.responseCode === 'number' && Number.isInteger(e.responseCode) && e.responseCode >= 100 && e.responseCode <= 599) return e.responseCode;
  if (typeof e.response === 'string') {
    const m = /^\s*([1-5]\d\d)(?!\d)/.exec(e.response);
    if (m) return Number(m[1]);
  }
  return null;
}

export function classifySmtpError(e: unknown): SmtpFailureKind {
  const err = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; responseCode?: unknown; response?: unknown };
  const code = typeof err.code === 'string' ? err.code : '';
  const reply = smtpReplyCode(err);
  if (reply !== null && reply >= 400 && reply < 500) return 'TRANSIENT';
  if (reply !== null && reply >= 500) return AUTH_REPLY_CODES.has(reply) || AUTH_ERROR_CODES.has(code) ? 'AUTH' : 'PERMANENT';
  return AUTH_ERROR_CODES.has(code) ? 'AUTH' : 'TRANSIENT';
}

const RETRY_STOPPED = 'Hệ thống không tự gửi lại liên tục (tránh khoá tài khoản gửi): sửa cấu hình rồi bấm "Gửi email thử".';

/** Câu hướng dẫn cho lỗi không tự khỏi; TRANSIENT không cần vì hệ thống tự gửi lại. Không chứa giá trị cấu hình nào. */
export function smtpFailureHint(kind: SmtpFailureKind | null | undefined): string | null {
  if (kind === 'AUTH') return `Lỗi xác thực SMTP — kiểm tra SMTP_USER/SMTP_PASS. ${RETRY_STOPPED}`;
  if (kind === 'PERMANENT') {
    return `Máy chủ SMTP từ chối vĩnh viễn — kiểm tra OPS_ALERT_EMAIL_TO, SMTP_FROM và quyền gửi của tài khoản. ${RETRY_STOPPED}`;
  }
  return null;
}

export function isSmtpFailureKind(v: unknown): v is SmtpFailureKind {
  return v === 'AUTH' || v === 'PERMANENT' || v === 'TRANSIENT';
}
