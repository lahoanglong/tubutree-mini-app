import { describe, expect, it } from 'vitest';
import BarcodeFormat from '@zxing/library/esm/core/BarcodeFormat';
import Code128Reader from '@zxing/library/esm/core/oned/Code128Reader';
import QRCodeWriter from '@zxing/library/esm/core/qrcode/QRCodeWriter';
import { createLuminanceDecoder, rgbaToLuminance } from './code-scan-zxing';
import type { ScanFormat } from './code-scan';

// Bộ đọc JS cho iPhone (W45): đọc ảnh mã THẬT sinh ngay trong test (Code 128 như mã vạch SPX/J&T trên phiếu giao hàng, QR như mã trên nhãn),
// không cần trình duyệt hay canvas.

const CLAIM: readonly ScanFormat[] = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'codabar', 'itf'];
const WAYBILL = 'SPXVN0123456789';

interface Img {
  lum: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Mã vạch Code 128 (bộ B) của `text`: mỗi module `px` điểm ảnh, cao `h`, chừa lề trắng 10 module hai bên. */
function code128(text: string, px = 3, h = 80): Img {
  const patterns = (Code128Reader as unknown as { CODE_PATTERNS: Int32Array[] }).CODE_PATTERNS;
  const START_B = 104;
  const STOP = 106;
  const values = [START_B, ...Array.from(text, (ch) => ch.charCodeAt(0) - 32)];
  const check = values.reduce((sum, v, i) => sum + v * Math.max(i, 1), 0) % 103;
  const modules: boolean[] = [];
  for (const v of [...values, check, STOP]) {
    Array.from(patterns[v]!).forEach((w, i) => {
      for (let k = 0; k < w; k++) modules.push(i % 2 === 0);
    });
  }
  const quiet = 10;
  const width = (modules.length + 2 * quiet) * px;
  const height = h + 20;
  const lum = new Uint8ClampedArray(width * height).fill(255);
  for (let y = 10; y < 10 + h; y++) {
    modules.forEach((dark, m) => {
      if (!dark) return;
      for (let k = 0; k < px; k++) lum[y * width + (quiet + m) * px + k] = 0;
    });
  }
  return { lum, width, height };
}

function qr(text: string, size = 240): Img {
  const matrix = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, new Map());
  const width = matrix.getWidth();
  const height = matrix.getHeight();
  const lum = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) lum[y * width + x] = matrix.get(x, y) ? 0 : 255;
  return { lum, width, height };
}

const read = (img: Img, formats: readonly ScanFormat[] = CLAIM, tryHarder = false) => createLuminanceDecoder(formats).decode(img.lum, img.width, img.height, tryHarder);

describe('createLuminanceDecoder (ZXing, máy không có BarcodeDetector)', () => {
  it('đọc mã vạch Code 128 của mã vận đơn', () => {
    expect(read(code128(WAYBILL))).toBe(WAYBILL);
  });

  it('đọc mã QR (link quét mã có code)', () => {
    const link = `https://tubutree.com/quet-ma?code=${WAYBILL}`;
    expect(read(qr(link))).toBe(link);
  });

  it('chế độ cố hơn (ảnh chụp) vẫn đọc được, và đọc được mã vạch mảnh 2px', () => {
    expect(read(code128(WAYBILL, 2), CLAIM, true)).toBe(WAYBILL);
  });

  it('chỉ hỏi QR (quầy Đổi rác) thì không đọc mã vạch một chiều', () => {
    expect(read(code128(WAYBILL), ['qr_code'])).toBeNull();
    expect(read(qr('TR-6NY3J'), ['qr_code'])).toBe('TR-6NY3J');
  });

  it('ảnh trắng hay quá nhỏ (khung hình chưa sẵn sàng): null, không ném lỗi', () => {
    const blank = { lum: new Uint8ClampedArray(200 * 120).fill(255), width: 200, height: 120 };
    expect(read(blank)).toBeNull();
    expect(read(blank, CLAIM, true)).toBeNull();
    expect(read({ lum: new Uint8ClampedArray(30 * 30), width: 30, height: 30 })).toBeNull();
  });

  it('một bộ đọc dùng lại cho nhiều khung hình (camera gọi mỗi 250ms)', () => {
    const decoder = createLuminanceDecoder(CLAIM);
    const bar = code128(WAYBILL);
    const blank = new Uint8ClampedArray(bar.width * bar.height).fill(255);
    expect(decoder.decode(blank, bar.width, bar.height, false)).toBeNull();
    expect(decoder.decode(bar.lum, bar.width, bar.height, false)).toBe(WAYBILL);
    expect(decoder.decode(bar.lum, bar.width, bar.height, false)).toBe(WAYBILL);
  });
});

describe('rgbaToLuminance', () => {
  it('trắng 255, đen 0, bỏ kênh alpha', () => {
    expect(Array.from(rgbaToLuminance(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0]), 3, 1))).toEqual([255, 0, 0]);
  });
});
