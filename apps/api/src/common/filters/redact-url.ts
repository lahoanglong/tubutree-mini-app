/**
 * Che bí mật trong URL request trước khi ghi log.
 *
 * Webhook Gomdon chỉ cho nhập URL (không cấu hình được header) nên bí mật chia sẻ nằm NGAY trong
 * URL: `/api/webhooks/gomdon/<secret>` hoặc `?token=<secret>` (xem GomdonWebhookController). Log
 * nguyên `req.originalUrl` là chép bí mật đó vào log ứng dụng — ai đọc được log (xoay vòng file,
 * aggregator, ảnh chụp màn hình khi debug) đều giả mạo được webhook trạng thái vận đơn.
 *
 * Pancake/Zalo OA/cashback KHÔNG mang bí mật trong URL (token ở header `x-webhook-token` / chữ ký
 * trong body), nhưng tham số query tên token/secret/signature vẫn bị che ở MỌI route để lỡ ops cấu
 * hình kiểu `?token=` cho webhook nào cũng không lộ.
 */
const REDACTED = '[REDACTED]';

/** Tên tham số query coi là bí mật (so không phân biệt hoa thường, sau khi decode). */
const SECRET_QUERY_KEYS = new Set(['token', 'secret', 'signature', 'sig', 'access_token']);

/** Đoạn đường dẫn ngay sau /webhooks/gomdon/ là token (route `@Post(':token')`). */
const GOMDON_PATH_TOKEN = /(\/webhooks\/gomdon\/)[^/]+/i;

function decodeKey(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw; // percent-encoding lỗi → so khớp trên chuỗi thô, không được ném từ đường ghi log
  }
}

export function redactUrl(url: string): string {
  if (!url) return url;
  const hashAt = url.indexOf('#');
  const fragment = hashAt >= 0 ? url.slice(hashAt) : '';
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const qAt = beforeHash.indexOf('?');
  const path = qAt >= 0 ? beforeHash.slice(0, qAt) : beforeHash;
  const query = qAt >= 0 ? beforeHash.slice(qAt + 1) : null;

  const safePath = path.replace(GOMDON_PATH_TOKEN, `$1${REDACTED}`);
  if (query === null) return safePath + fragment;

  const safeQuery = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair; // `?token` không có giá trị → không có gì để lộ
      const key = pair.slice(0, eq);
      return SECRET_QUERY_KEYS.has(decodeKey(key).toLowerCase()) ? `${key}=${REDACTED}` : pair;
    })
    .join('&');
  return `${safePath}?${safeQuery}${fragment}`;
}
