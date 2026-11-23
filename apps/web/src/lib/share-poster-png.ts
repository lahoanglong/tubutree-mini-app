import QRCode from 'qrcode';
import { POSTER_FONT_PROBE, POSTER_H, POSTER_W, drawPoster, posterContent, type PosterInput } from '@tubutree/app-core/commerce/share-poster';

export interface RenderedPoster {
  /** Link web công khai nằm trong QR. */
  url: string;
  /** PNG data URL; rỗng khi trình duyệt không có canvas 2D (bảng hiện QR thường). */
  png: string;
  fileName: string;
  /** Cùng ảnh dạng tệp cho `navigator.share({ files })`; null khi không có ảnh. */
  file: File | null;
}

/** data URL base64 → tệp PNG, không gọi `fetch(data:)` (CSP connect-src không cho data:). */
function pngFile(dataUrl: string, name: string): File {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: 'image/png' });
}

/**
 * Vẽ ảnh chia sẻ có QR (`commerce/share-poster.ts`) bằng canvas tại máy; QR mã hoá bằng thư viện `qrcode` sẵn có của web (mức sửa lỗi M như
 * Mini App). Nạp lười khi bảng chia sẻ mở (`components/affiliate/share-poster.tsx`). Chờ phông Inter để chữ trên ảnh cùng phông với trang.
 */
export async function renderPoster(input: PosterInput): Promise<RenderedPoster> {
  const { url, content, fileName } = posterContent(input);
  await document.fonts?.load(POSTER_FONT_PROBE).catch(() => undefined);
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_W;
  canvas.height = POSTER_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { url, png: '', fileName, file: null };
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  drawPoster(ctx, content, { size: modules.size, modules: modules.data });
  const png = canvas.toDataURL('image/png');
  return { url, png, fileName, file: pngFile(png, fileName) };
}
