import { useEffect, useState } from 'react';
import { qrMatrix, type QrMatrix } from '../utils/qr-matrix';

const MARGIN = 1;

/**
 * Điểm ảnh của ảnh QR vuông `width`, lề 1 module: đúng phép chia của `qrcode.toDataURL({ width, margin: 1 })` trước đây
 * (bước module có thể lẻ, mỗi điểm ảnh lấy module chứa nó), nên mã cũ và mới vẽ ra cùng một ảnh. 1 = điểm tối.
 */
export function qrPixels(qr: Pick<QrMatrix, 'size' | 'modules'>, width: number): { width: number; dark: Uint8Array } {
  const span = qr.size + MARGIN * 2;
  const scale = width >= span ? width / span : 4;
  const side = Math.floor(span * scale);
  const edge = MARGIN * scale;
  const dark = new Uint8Array(side * side);
  for (let i = 0; i < side; i++) {
    for (let j = 0; j < side; j++) {
      if (i < edge || j < edge || i >= side - edge || j >= side - edge) continue;
      dark[i * side + j] = qr.modules[Math.floor((i - edge) / scale) * qr.size + Math.floor((j - edge) / scale)] ?? 0;
    }
  }
  return { width: side, dark };
}

/** Ảnh PNG (data URL) đen trên trắng; '' khi trình duyệt không có canvas 2D. */
export function qrPngDataUrl(value: string, width: number): string {
  const { width: side, dark } = qrPixels(qrMatrix(value), width);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(side, side);
  dark.forEach((d, k) => {
    const v = d ? 0 : 255;
    img.data[k * 4] = v;
    img.data[k * 4 + 1] = v;
    img.data[k * 4 + 2] = v;
    img.data[k * 4 + 3] = 255;
  });
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

// Đen trên trắng cố định: tương phản tối đa cho máy quét và không đổi theo theme sáng/tối (máy quét không đọc biến CSS).
export function QrCode({ value, size = 180 }: { value: string; size?: number }) {
  const [url, setUrl] = useState<string>('');
  useEffect(() => {
    try {
      setUrl(qrPngDataUrl(value, size));
    } catch {
      setUrl('');
    }
  }, [value, size]);
  if (!url) return <div style={{ width: size, height: size, background: 'var(--color-bg-subtle)', borderRadius: 12 }} />;
  return <img src={url} alt="QR" width={size} height={size} style={{ borderRadius: 12 }} />;
}
