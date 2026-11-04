const IMAGE_HOSTS: readonly string[] = ['res.cloudinary.com', 'content.pancake.vn'];
const RASTER_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Lọc địa chỉ ảnh do người khác nhập (ảnh chuyển lương, QR) trước khi đổ vào `<img src>`. Hàng cũ trong DB có thể còn chuỗi
 * bất kỳ dù DTO đã siết. Chỉ nhận https của host ảnh đã biết hoặc ảnh raster base64 (SVG/HTML bị loại).
 */
export function safeImageUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw !== raw.trim()) return null;
  if (raw.startsWith('data:')) return RASTER_DATA_URL_RE.test(raw) ? raw : null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === 'https:' && IMAGE_HOSTS.includes(url.hostname.toLowerCase()) ? url.href : null;
}
