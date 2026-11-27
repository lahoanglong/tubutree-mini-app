import BinaryBitmap from '@zxing/library/esm/core/BinaryBitmap';
import DecodeHintType from '@zxing/library/esm/core/DecodeHintType';
import HybridBinarizer from '@zxing/library/esm/core/common/HybridBinarizer';
import CodaBarReader from '@zxing/library/esm/core/oned/CodaBarReader';
import Code128Reader from '@zxing/library/esm/core/oned/Code128Reader';
import Code39Reader from '@zxing/library/esm/core/oned/Code39Reader';
import EAN13Reader from '@zxing/library/esm/core/oned/EAN13Reader';
import EAN8Reader from '@zxing/library/esm/core/oned/EAN8Reader';
import ITFReader from '@zxing/library/esm/core/oned/ITFReader';
import QRCodeReader from '@zxing/library/esm/core/qrcode/QRCodeReader';
import type Reader from '@zxing/library/esm/core/Reader';
import RGBLuminanceSource from '@zxing/library/esm/core/RGBLuminanceSource';
import type { ScanFormat } from './code-scan';

/**
 * Bộ đọc mã vạch/QR bằng JS (ZXing) cho máy không có `BarcodeDetector` (mọi trình duyệt trên iPhone, gồm Safari và WebView của Zalo,
 * Facebook, TikTok) hoặc có mà không đọc ra gì. Tệp này CHỈ được nạp bằng `import()` khi khách mở khung quét hay chọn ảnh
 * (`code-scan.ts`), nên Trang chủ và Mini App không chở thêm byte nào. Nhập thẳng từng bộ đọc (không qua `@zxing/library` gốc) để gói
 * lười chỉ chứa QR và các mã vạch một chiều trên phiếu giao hàng sàn.
 */

const READERS: Record<ScanFormat, () => Reader> = {
  qr_code: () => new QRCodeReader(),
  code_128: () => new Code128Reader(),
  code_39: () => new Code39Reader(),
  ean_13: () => new EAN13Reader(),
  ean_8: () => new EAN8Reader(),
  codabar: () => new CodaBarReader(),
  itf: () => new ITFReader(),
};

/** HybridBinarizer cần ảnh tối thiểu 40×40; nhỏ hơn là khung hình chưa sẵn sàng. */
const MIN_SIDE = 40;

/** Độ sáng từng điểm ảnh (RGBA → 1 byte, hệ số Rec. 601) để đưa vào ZXing. */
export function rgbaToLuminance(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (rgba[i]! * 306 + rgba[i + 1]! * 601 + rgba[i + 2]! * 117) >> 10;
  return out;
}

export interface LuminanceDecoder {
  /** Chuỗi đọc được đầu tiên trên ảnh độ sáng `width`×`height`, hoặc null. `tryHarder`: quét nhiều hàng hơn (ảnh chụp, chậm hơn). */
  decode(luminance: Uint8ClampedArray, width: number, height: number, tryHarder: boolean): string | null;
}

/** Bộ đọc trên ảnh độ sáng, thử lần lượt từng định dạng được hỏi. Hàm thuần (không DOM) để kiểm bằng unit test. */
export function createLuminanceDecoder(formats: readonly ScanFormat[]): LuminanceDecoder {
  const readers = formats.map((f) => READERS[f]());
  const hints = new Map<DecodeHintType, unknown>();
  const hardHints = new Map<DecodeHintType, unknown>([[DecodeHintType.TRY_HARDER, true]]);
  return {
    decode(luminance, width, height, tryHarder) {
      if (width < MIN_SIDE || height < MIN_SIDE) return null;
      const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, width, height)));
      for (const reader of readers) {
        try {
          const text = reader.decode(bitmap, tryHarder ? hardHints : hints).getText();
          if (text) return text;
        } catch {
          // Không thấy mã định dạng này (NotFound/Checksum/Format): thử định dạng kế.
        } finally {
          reader.reset();
        }
      }
      return null;
    },
  };
}

export interface FrameOptions {
  /** Xoay 90°: mã vạch một chiều chỉ đọc theo hàng ngang, nhãn cầm dọc thì vạch nằm ngang. */
  rotate: boolean;
  tryHarder: boolean;
  /** Cạnh dài nhất sau khi thu nhỏ (ảnh 12MP của iPhone đọc thẳng quá chậm). */
  maxSide: number;
}

export interface CanvasDecoder {
  /** Vẽ khung hình (video, ảnh) lên canvas theo `opts` rồi đọc. Trả mảng rỗng khi không thấy mã. */
  decodeSource(source: CanvasImageSource, width: number, height: number, opts: FrameOptions): string[];
}

export function createDecoder(formats: readonly ScanFormat[]): CanvasDecoder {
  const lum = createLuminanceDecoder(formats);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    decodeSource(source, width, height, opts) {
      if (!ctx || width <= 0 || height <= 0) return [];
      const scale = Math.min(1, opts.maxSide / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      canvas.width = opts.rotate ? h : w;
      canvas.height = opts.rotate ? w : h;
      ctx.save();
      if (opts.rotate) {
        ctx.translate(h, 0);
        ctx.rotate(Math.PI / 2);
      }
      ctx.drawImage(source, 0, 0, w, h);
      ctx.restore();
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const text = lum.decode(rgbaToLuminance(data, canvas.width, canvas.height), canvas.width, canvas.height, opts.tryHarder);
      return text ? [text] : [];
    },
  };
}
