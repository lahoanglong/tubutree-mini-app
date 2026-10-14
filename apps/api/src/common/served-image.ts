/** Ảnh raster base64 duy nhất được phục vụ qua endpoint ảnh (đã chặn SVG/HTML từ lúc nhận ở IsUploadedImage). */
const SERVED_DATA_URL_RE = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Giải mã data URL raster thành byte + loại ảnh; null khi không phải ảnh raster base64 hợp lệ. */
export function decodeServedImage(image: string | null | undefined): { mime: string; data: Buffer } | null {
  const match = image ? SERVED_DATA_URL_RE.exec(image) : null;
  return match ? { mime: match[1]!, data: Buffer.from(match[2]!, 'base64') } : null;
}
