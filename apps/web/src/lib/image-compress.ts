/** Chặn ảnh gốc quá lớn TRƯỚC khi đưa vào canvas: ảnh vài chục MB (panorama, RAW) có thể treo trình duyệt khi vẽ. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Trần ký tự của ảnh base64 mà API nhận cho minh chứng đổi/trả (uploaded-image.ts DEFAULT_MAX_DATA_URL_LENGTH = 1.500.000). */
export const MAX_UPLOAD_DATA_URL_LENGTH = 1_400_000;

export const isUsableImageFile = (file: Pick<File, 'type'>): boolean => file.type.startsWith('image/');

/** Kích thước sau khi thu cạnh dài về `maxDim`, giữ tỉ lệ; ảnh đã nhỏ hơn thì giữ nguyên. */
export function fitWithin(width: number, height: number, maxDim: number): { width: number; height: number } {
  if (width <= maxDim && height <= maxDim) return { width, height };
  const scale = maxDim / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không tải được ảnh'));
    };
    img.src = url;
  });
}

function encode(img: HTMLImageElement, maxDim: number, quality: number): string {
  const { width, height } = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không xử lý được ảnh');
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Nén ảnh phía trình duyệt thành data URL JPEG nhẹ (~150-400KB) để gửi kèm yêu cầu đổi/trả — cùng cách của Mini App khi
 * chưa cấu hình Cloudinary. Nếu vẫn vượt trần của API thì nén mạnh hơn một lần; vẫn quá thì báo lỗi thay vì để API từ chối.
 */
export async function readAndCompressImage(file: File): Promise<string> {
  const img = await load(file);
  let dataUrl = encode(img, 1200, 0.82);
  if (dataUrl.length > MAX_UPLOAD_DATA_URL_LENGTH) dataUrl = encode(img, 900, 0.6);
  if (dataUrl.length > MAX_UPLOAD_DATA_URL_LENGTH) throw new Error('Ảnh quá nặng sau khi nén');
  return dataUrl;
}
