/**
 * URL webhook Gomdon có thể mang secret ở cuối đường dẫn (`/api/webhooks/gomdon/<secret>`) hoặc trong query
 * (`?token=`): mọi log/thông báo lỗi chỉ được dùng dạng đã che này, không bao giờ in nguyên URL.
 */
const PLAIN_LAST_SEGMENT = 'gomdon';

function lastSecretSegment(url: URL): string | null {
  const segs = url.pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1];
  return last && last !== PLAIN_LAST_SEGMENT ? last : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function maskWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return '(URL không hợp lệ)';
  }
  const segs = url.pathname.split('/').filter(Boolean);
  if (segs.length > 0 && segs[segs.length - 1] !== PLAIN_LAST_SEGMENT) segs[segs.length - 1] = '***';
  return `${url.protocol}//${url.host}/${segs.join('/')}${url.search ? '?***' : ''}`;
}

/** Che URL (và phần secret của nó) nếu Gomdon/axios lỡ lặp lại trong thông điệp lỗi. */
export function scrubWebhookUrl(text: string, raw: string): string {
  let out = text.split(raw).join(maskWebhookUrl(raw));
  try {
    const url = new URL(raw);
    const secrets = [lastSecretSegment(url), ...[...url.searchParams.values()]].filter(
      (s): s is string => typeof s === 'string' && s.length >= 6,
    );
    for (const secret of secrets) {
      for (const variant of new Set([secret, safeDecode(secret), encodeURIComponent(safeDecode(secret))])) {
        out = out.split(variant).join('***');
      }
    }
  } catch {
    /* URL không đọc được: chỉ che nguyên văn ở trên */
  }
  return out;
}
