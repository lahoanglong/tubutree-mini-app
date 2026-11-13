import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { UPLOAD_IMAGE_HOSTS } from '../../common/uploaded-image';

/**
 * Bề rộng (px) được phép: thẻ SP 160/320/480 (480 cho lưới 2 cột và rail ở màn 2,6x–3x), chi tiết 640/960 (1x và 2x), banner/hero 1280/1920 (khung rộng ở màn 2x–3x). Số khác bị từ chối để cache không
 * phình theo tham số tuỳ ý. Ảnh nguồn nhỏ hơn bề rộng xin thì giữ nguyên cỡ (sharp `withoutEnlargement`), không phóng to.
 */
export const RESIZE_WIDTHS: readonly number[] = [160, 320, 480, 640, 960, 1280, 1920];

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

/**
 * Phân giải DNS rồi mới kết nối, và từ chối địa chỉ nội bộ ngay ở đây: địa chỉ được kiểm là đúng địa chỉ sẽ được nối tới.
 * Node 20+ gọi lookup với all: true (thử nhiều địa chỉ), nên giữ riêng các địa chỉ công cộng.
 */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, options, (err, address, family) => {
    if (err) return callback(err, '', 4);
    if (Array.isArray(address)) {
      const safe = address.filter((a) => !isPrivateAddress(a.address));
      return safe.length > 0 ? callback(null, safe) : callback(new Error('blocked address') as NodeJS.ErrnoException, '', 4);
    }
    return isPrivateAddress(address) ? callback(new Error('blocked address') as NodeJS.ErrnoException, '', 4) : callback(null, address, family);
  });
};

/** Client nhận webp thì trả webp, không thì jpeg. */
export function negotiateFormat(accept: string | undefined): ResizeFormat {
  return /image\/webp/i.test(accept ?? '') ? 'webp' : 'jpeg';
}

/**
 * Phiên bản cách đổi cỡ (tham số sharp, chất lượng nén) nằm trong khoá cache: cache ở volume bền qua deploy, nên đổi cách đổi cỡ mà không tăng số này
 * thì bản cũ còn được phát tới 14 ngày. Tăng khi sửa pipeline trong ImageResizeService.produce.
 */
export const RESIZE_PIPELINE_VERSION = 1;

export function cacheKey(source: string, width: number, format: ResizeFormat, pipeline: number = RESIZE_PIPELINE_VERSION): string {
  return createHash('sha256').update(`p${pipeline}|${source}|${width}|${format}`).digest('hex').slice(0, 40);
}

export const etagOf = (key: string): string => `"${key}"`;
