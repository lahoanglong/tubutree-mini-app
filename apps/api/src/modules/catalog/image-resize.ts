import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { UPLOAD_IMAGE_HOSTS } from '../../common/uploaded-image';

/** Bề rộng (px) được phép: thẻ SP 160/320, chi tiết 640/960 (1x và 2x). Số khác bị từ chối để cache không phình theo tham số tuỳ ý. */
export const RESIZE_WIDTHS: readonly number[] = [160, 320, 640, 960];

/** Host nguồn tin cậy: CDN ảnh Pancake và Cloudinary (cùng danh sách host upload). Thêm host qua IMAGE_RESIZE_EXTRA_HOSTS. */
export const PANCAKE_IMAGE_HOSTS: readonly string[] = ['content.pancake.vn'];

export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_SOURCE_PIXELS = 16_000_000;
export const FETCH_TIMEOUT_MS = 6_000;
export const FETCH_TOTAL_MS = 10_000;
const MAX_URL_LENGTH = 1_000;

export type ResizeFormat = 'webp' | 'jpeg';

export const isAllowedWidth = (w: number): boolean => RESIZE_WIDTHS.includes(w);

export function allowedHosts(extra: string | undefined = process.env.IMAGE_RESIZE_EXTRA_HOSTS): string[] {
  const more = (extra ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return [...PANCAKE_IMAGE_HOSTS, ...UPLOAD_IMAGE_HOSTS, ...more];
}

/** Nguồn ảnh hợp lệ: https, đúng host trong danh sách, cổng mặc định, không user:pass, không phải địa chỉ IP. Trả URL đã chuẩn hoá hoặc null. */
export function parseRemoteSource(raw: unknown, hosts: readonly string[] = allowedHosts()): URL | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (isIP(host) !== 0 || host.startsWith('[')) return null;
  if (!hosts.includes(host)) return null;
  if (host === 'res.cloudinary.com') {
    // Chỉ ảnh đã tải lên (`/<cloud>/image/upload/...`): loại `image/fetch`, `image/url`... vốn bắt Cloudinary đi lấy URL tuỳ ý rồi trả qua API của mình.
    if (!/^\/[A-Za-z0-9_-]+\/image\/upload\//.test(url.pathname)) return null;
    url.search = '';
  }
  url.hash = '';
  return url;
}

/** Nguồn là ảnh của chính API (`/public-image/<loại>/<id>/<ô>`): đọc thẳng từ DB, không tải qua mạng. */
export function parseOwnImagePath(raw: unknown): { kind: string; id: string; slot: string; version: string | undefined } | null {
  if (typeof raw !== 'string' || raw.length > MAX_URL_LENGTH) return null;
  const m = /^\/public-image\/([a-z]+)\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9]{1,8})(?:\?v=([A-Za-z0-9]{1,32}))?$/.exec(raw);
  return m ? { kind: m[1]!, id: m[2]!, slot: m[3]!, version: m[4] } : null;
}

/** Địa chỉ nội bộ/đặc biệt không bao giờ được tải từ đó (chống SSRF khi DNS của host tin cậy bị trỏ vào mạng trong). */
export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (v === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return lower === '::' || lower === '::1' || lower.startsWith('64:ff9b:') || lower.startsWith('2002:') || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff');
  }
  return true;
}

/** Client nhận webp thì trả webp, không thì jpeg. */
export function negotiateFormat(accept: string | undefined): ResizeFormat {
  return /image\/webp/i.test(accept ?? '') ? 'webp' : 'jpeg';
}

export function cacheKey(source: string, width: number, format: ResizeFormat): string {
  return createHash('sha256').update(`${source}|${width}|${format}`).digest('hex').slice(0, 40);
}

export const etagOf = (key: string): string => `"${key}"`;
