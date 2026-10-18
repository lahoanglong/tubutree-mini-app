const OG_IMAGE_TYPES = ['image/png', 'image/jpeg'];

/** Host ảnh upload của gian hàng và sản phẩm; host API công khai (ảnh base64 phục vụ qua endpoint ảnh) cộng thêm lúc gọi. */
const STATIC_OG_IMAGE_HOSTS = ['res.cloudinary.com'];

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isPrivateOrReservedHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) return true;
  if (hostname.startsWith('[') || hostname.includes(':')) return true;
  const m = IPV4_RE.exec(hostname);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function allowedOgImageHosts(): string[] {
  const hosts = [...STATIC_OG_IMAGE_HOSTS];
  try {
    const apiHost = new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? '').hostname;
    if (apiHost) hosts.push(apiHost);
  } catch {
    // Không cấu hình hoặc sai định dạng: chỉ còn host upload.
  }
  return hosts;
}

/**
 * Chỉ tải ảnh qua https từ host đã biết (Cloudinary và API công khai của chính mình), không kèm user:pass và không phải địa chỉ nội
 * bộ. Thẻ chia sẻ dựng ở server nên URL ảnh do chủ gian hàng nhập mà để tải tuỳ ý thì máy chủ web bị lợi dụng gọi vào mạng nội bộ
 * (http://api:3001, 169.254.169.254).
 */
export function isSafeOgImageUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return allowedOgImageHosts().includes(host) && !isPrivateOrReservedHost(host);
}

/** Đọc thân phản hồi, dừng ngay khi vượt `maxBytes` (không dựa vào content-length vì máy chủ ảnh có thể khai sai hoặc bỏ trống). */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/**
 * Tải ảnh về dạng data URI cho bộ dựng ảnh chia sẻ (satori không đọc được webp và ném lỗi nếu ảnh không tải được, làm hỏng cả
 * ảnh OG). URL không an toàn (isSafeOgImageUrl), chuyển hướng, ảnh chậm, quá nặng, sai loại hoặc lỗi thì bỏ qua: thẻ chia sẻ vẫn ra,
 * chỉ thiếu ảnh đó.
 */
export async function fetchOgImage(url: string, { timeoutMs = 3000, maxBytes = 1_500_000 } = {}): Promise<string | null> {
  if (!isSafeOgImageUrl(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!OG_IMAGE_TYPES.includes(type)) return null;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    const bytes = await readCapped(res, maxBytes);
    if (!bytes || bytes.length === 0) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}
