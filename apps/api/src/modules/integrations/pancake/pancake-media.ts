import { payloadTextList } from './pancake-payload';

/** Số video tối đa lưu cho một sản phẩm: PDP chỉ cần vài clip, và chặn payload Pancake bất thường làm phình hàng. */
export const PANCAKE_VIDEOS_MAX = 6;
const VIDEO_URL_MAX = 2000;

/**
 * URL video đọc được từ một phần tử `videos` của biến thể Pancake: chuỗi, hoặc object có `url`. Chỉ http(s), không kèm user:pass, đủ ngắn;
 * mọi thứ khác (javascript:, data:, đường dẫn tương đối, rỗng) là không đọc được.
 */
function videoUrlOf(item: unknown): string | null {
  const raw = typeof item === 'string' ? item : item !== null && typeof item === 'object' ? (item as { url?: unknown }).url : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '' || text.length > VIDEO_URL_MAX) return null;
  try {
    const u = new URL(text);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
    return text;
  } catch {
    return null;
  }
}

/**
 * Video của sản phẩm từ `variations[].videos`. `reported` = ít nhất một biến thể có trường `videos` (kể cả rỗng): Pancake có nói về video,
 * nên danh sách rỗng nghĩa là "đã xoá hết"; không biến thể nào có trường này thì Pancake không nói gì và đồng bộ giữ nguyên video đang lưu.
 */
export function pancakeVideos(variations: ReadonlyArray<{ videos?: unknown }>): { videos: string[]; reported: boolean } {
  const reported = variations.some((v) => Array.isArray(v.videos) || typeof v.videos === 'string');
  const out = new Set<string>();
  for (const v of variations) {
    const items = Array.isArray(v.videos) ? v.videos : typeof v.videos === 'string' ? [v.videos] : [];
    for (const item of items) {
      const url = videoUrlOf(item);
      if (url) out.add(url);
      if (out.size >= PANCAKE_VIDEOS_MAX) return { videos: [...out], reported };
    }
  }
  return { videos: [...out], reported };
}

/** Ảnh Pancake của sản phẩm theo thứ tự ưu tiên: ảnh sản phẩm, ảnh đại diện, rồi ảnh từng biến thể; bỏ trùng. */
export function pancakeImageList(p: { images?: unknown; image?: unknown }, variations: ReadonlyArray<{ images?: unknown }>): string[] {
  return [...new Set([...payloadTextList(p.images), ...payloadTextList(p.image), ...variations.flatMap((v) => payloadTextList(v.images))])];
}

/**
 * Ảnh lưu ở máy chủ ảnh của Pancake (`pancake.vn`, `*.pancake.vn`). Admin tải lên Tubu Tree đi qua kho ảnh khác (Cloudinary, data URL, `/public-image`),
 * nên ảnh ở đây là ảnh Pancake kể cả khi cột `pancakeImages` chưa có (hàng sinh ra trước khi có cột đó).
 */
export function isPancakeHostedImage(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'pancake.vn' || host.endsWith('.pancake.vn');
  } catch {
    return false;
  }
}

/**
 * Gộp ảnh, không ghi đè: ảnh Pancake đi trước theo thứ tự Pancake, sau đó là ảnh đang lưu mà Pancake không có và cũng không phải ảnh Pancake
 * (từng gửi: `previous`, hoặc nằm ở máy chủ ảnh Pancake) — tức ảnh admin thêm trên Tubu Tree. Ảnh Pancake mà nay Pancake không gửi nữa thì bị gỡ.
 * `adminKept` là số ảnh admin được giữ lại.
 */
export function mergePancakeImages(
  incoming: readonly string[],
  previous: readonly string[],
  current: readonly string[],
): { images: string[]; adminKept: number } {
  const fromPancake = new Set(incoming);
  const wasPancake = new Set(previous);
  const admin: string[] = [];
  for (const img of current) {
    if (img && !fromPancake.has(img) && !wasPancake.has(img) && !isPancakeHostedImage(img) && !admin.includes(img)) admin.push(img);
  }
  return { images: [...incoming, ...admin], adminKept: admin.length };
}
