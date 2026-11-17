import { isIP } from 'node:net';
import { readMssEnv } from '../mss-config';

/**
 * Ảnh/video của nội dung bổ sung chỉ được nằm trên máy chủ MSS, dưới đường media công khai (hợp đồng commerce v0.9 mục 1.2 ghi
 * `/api/pub/media/`, đề xuất W08 đổi thành `/api/pub/catalog-media/`: nhận cả hai cho tới khi hai phía chốt). Nội dung theo băm, bất biến.
 */
export const MSS_MEDIA_PATH_PREFIXES: readonly string[] = ['/api/pub/catalog-media/', '/api/pub/media/'];

const MAX_URL_LENGTH = 1_000;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** Tên tệp media của MSS: băm (và cỡ) cộng phần mở rộng; không thư mục con, không `..`. */
const MEDIA_FILE_RE = /^[A-Za-z0-9_-]{8,128}\.(?:webp|jpe?g|png|avif|mp4|webm)$/;
const PREVIEW_TOKEN_RE = /^[A-Za-z0-9_.-]{16,2048}$/;

/**
 * Host media MSS cho phép: host của `MSS_BASE_URL` cộng `MSS_MEDIA_HOSTS` (danh sách phẩy, cho CDN riêng nếu MSS dùng). Thiếu
 * `MSS_BASE_URL` thì danh sách rỗng: không URL MSS nào qua được, kể cả khi dữ liệu đã lưu.
 */
export function mssMediaHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const base = readMssEnv(env).baseUrl;
  const hosts = new Set<string>();
  if (base) hosts.add(new URL(base).hostname.toLowerCase());
  for (const raw of (env.MSS_MEDIA_HOSTS ?? '').split(',')) {
    const h = raw.trim().toLowerCase();
    if (HOST_RE.test(h)) hosts.add(h);
  }
  // MSS giả lúc phát triển (`http://localhost`) không bao giờ là host media hợp lệ: media phải là https có tên miền.
  return [...hosts].filter((h) => isIP(h) === 0 && h !== 'localhost');
}

export interface MssMediaUrlOptions {
  /** Bản xem trước (mục 1.5, đề xuất W08 số 2): tệp của bản nháp mang `?token=`. Chỉ nhận đúng một tham số đó. */
  allowPreviewToken?: boolean;
}

/**
 * URL media hợp lệ: https, cổng mặc định, không user:pass, host trong danh sách, không phải IP, đường dẫn đúng tiền tố media và tên tệp
 * dạng băm. Bỏ fragment; query chỉ được là `token=` của bản xem trước. Trả URL đã chuẩn hoá hoặc null.
 */
export function parseMssMediaUrl(raw: unknown, hosts: readonly string[], opts: MssMediaUrlOptions = {}): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (isIP(host) !== 0 || host.startsWith('[') || !hosts.includes(host)) return null;
  if (url.pathname.includes('..') || url.pathname.includes('//') || url.pathname.includes('%')) return null;
  const prefix = MSS_MEDIA_PATH_PREFIXES.find((p) => url.pathname.startsWith(p));
  if (!prefix || !MEDIA_FILE_RE.test(url.pathname.slice(prefix.length))) return null;
  url.hash = '';
  if (url.search) {
    const params = [...url.searchParams.entries()];
    const tokenOnly = params.length === 1 && params[0]![0] === 'token' && PREVIEW_TOKEN_RE.test(params[0]![1]);
    if (!opts.allowPreviewToken || !tokenOnly) return null;
  }
  return url.toString();
}
