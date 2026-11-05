/** Loại ảnh raster base64 duy nhất được phục vụ qua endpoint ảnh (đã chặn SVG/HTML từ lúc nhận ở IsUploadedImage). Nguồn duy nhất: regex và tiền tố đều dựng từ đây. */
export const SERVED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'] as const;

const SERVED_DATA_URL_RE = new RegExp(`^data:(${SERVED_IMAGE_MIMES.join('|').replace(/\//g, '\\/')});base64,([A-Za-z0-9+/]+={0,2})$`);

export const servedImagePrefix = (mime: (typeof SERVED_IMAGE_MIMES)[number]) => `data:${mime};base64,`;

/** Chuỗi (có thể chỉ là đầu của ảnh) mở đầu bằng một tiền tố ảnh raster được phục vụ. Không xét phần thân base64. */
export const hasServedImagePrefix = (head: string) => SERVED_IMAGE_MIMES.some((m) => head.startsWith(servedImagePrefix(m)));

/** Giải mã data URL raster thành byte + loại ảnh; null khi không phải ảnh raster base64 hợp lệ. */
export function decodeServedImage(image: string | null | undefined): { mime: string; data: Buffer } | null {
  const match = image ? SERVED_DATA_URL_RE.exec(image) : null;
  return match ? { mime: match[1]!, data: Buffer.from(match[2]!, 'base64') } : null;
}
