/**
 * Lỗi gửi email báo động hiện ở thẻ "Báo động qua email" đúng một lần, bằng tiếng Việt. Chuỗi gốc của nodemailer (đã che bí
 * mật ở API) là tiếng Anh kỹ thuật nên chỉ để ở phần "Chi tiết kỹ thuật" thu gọn, không là câu admin phải đọc để biết làm gì.
 */
export type SmtpFailureKind = 'AUTH' | 'PERMANENT' | 'TRANSIENT';

const AUTH_FAILED =
  'Máy chủ thư từ chối đăng nhập: sai tài khoản hoặc mật khẩu SMTP. Kiểm tra SMTP_USER và SMTP_PASS (Gmail cần mật khẩu ứng dụng).';
const REJECTED =
  'Máy chủ thư từ chối vĩnh viễn: kiểm tra OPS_ALERT_EMAIL_TO (người nhận), SMTP_FROM (người gửi) và quyền gửi của tài khoản.';
const REPLY_4XX = 'Máy chủ thư tạm từ chối hoặc đang bận. Đợi vài phút rồi bấm "Gửi email thử" lại.';
const TLS = 'Lỗi mã hoá TLS khi nối máy chủ SMTP. Kiểm tra SMTP_PORT và SMTP_SECURE (cổng 465 thường bật, cổng 587 thường tắt).';
const TIMEOUT = 'Hết thời gian chờ máy chủ SMTP (mạng chậm hoặc cổng bị chặn). Kiểm tra SMTP_HOST, SMTP_PORT và kết nối mạng của máy chủ.';
const CONNECTION = 'Không kết nối được tới máy chủ SMTP. Kiểm tra SMTP_HOST, SMTP_PORT và kết nối mạng của máy chủ.';
const GENERIC = 'Gửi email không thành công. Xem chi tiết kỹ thuật bên dưới; sửa xong bấm "Gửi email thử" lại.';

const REPLY_4XX_RE = /\b4\d\d[ -]4\.\d{1,3}\.\d{1,3}\b/;
const AUTH_RE = /\b(?:EAUTH|ENOAUTH)\b|invalid login|username and password|authentication (?:failed|credentials)/i;
const REJECTED_RE = /\b(?:EENVELOPE|EMESSAGE|EPROTOCOL)\b|recipients? (?:were )?rejected|user unknown|relay|\b5\d\d[ -]5\.\d{1,3}\.\d{1,3}\b/i;
const TLS_RE = /\bETLS\b|\b(?:SSL|TLS)\b|certificate|wrong version number/i;
const TIMEOUT_RE = /\bETIMEDOUT\b|timed? ?out|greeting never received|quá \d+ giây/i;
const CONNECTION_RE = /\b(?:ECONNECTION|ECONNREFUSED|ECONNRESET|ENOTFOUND|EDNS|ESOCKET)\b|getaddrinfo/i;

/**
 * Câu tiếng Việt cho lỗi gửi email gần nhất. API đã có lời chỉ (`hint`, cho lỗi AUTH/PERMANENT, có cả câu "hệ thống không
 * tự gửi lại") thì dùng nguyên; chưa có (lỗi tạm thời, hoặc API cũ) thì dịch theo loại lỗi nhận ra từ `kind` và chuỗi gốc.
 */
export function smtpErrorSummary({ kind, hint, raw }: { kind?: SmtpFailureKind | null; hint?: string | null; raw?: string | null }): string {
  const given = hint?.trim();
  if (given) return given;
  const text = raw ?? '';
  if (kind !== 'AUTH' && kind !== 'PERMANENT' && REPLY_4XX_RE.test(text)) return REPLY_4XX;
  if (kind === 'AUTH' || AUTH_RE.test(text)) return AUTH_FAILED;
  if (kind === 'PERMANENT' || REJECTED_RE.test(text)) return REJECTED;
  if (TLS_RE.test(text)) return TLS;
  if (TIMEOUT_RE.test(text)) return TIMEOUT;
  if (CONNECTION_RE.test(text)) return CONNECTION;
  return GENERIC;
}
