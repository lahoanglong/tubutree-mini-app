import { POSTER_FONT_PROBE, POSTER_H, POSTER_W, drawPoster, posterContent, type PosterInput } from '@tubutree/app-core/commerce/share-poster';
import { qrMatrix } from './qr-matrix';

/**
 * Vẽ ảnh chia sẻ có QR (`commerce/share-poster.ts`) thành PNG data URL. Nạp lười khi bảng chia sẻ mở (`components/share-poster.tsx`), nên
 * gói đầu không mang bộ vẽ. Chờ phông Inter trước khi vẽ để chữ trên ảnh cùng phông với app; không tải được phông thì vẽ bằng phông dự phòng.
 * `png` rỗng khi webview không có canvas 2D: bảng hiện QR thường thay ảnh.
 */
export async function renderPoster(input: PosterInput): Promise<{ url: string; png: string }> {
  const { url, content } = posterContent(input);
  await document.fonts?.load(POSTER_FONT_PROBE).catch(() => undefined);
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_W;
  canvas.height = POSTER_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { url, png: '' };
  drawPoster(ctx, content, qrMatrix(url));
  return { url, png: canvas.toDataURL('image/png') };
}
