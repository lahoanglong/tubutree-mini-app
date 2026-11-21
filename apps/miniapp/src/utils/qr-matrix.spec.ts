import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode, { type QRCodeSegment } from 'qrcode';
import { describe, expect, it } from 'vitest';
import { qrPixels } from '../components/qr-code';
import { qrMatrix, qrMode, type QrMode } from './qr-matrix';

/**
 * Bộ mã hoá riêng phải ra ĐÚNG ma trận của thư viện `qrcode` (bản Mini dùng trước đây, chỉ còn là chuẩn đối chiếu trong spec) với cùng một đoạn dữ liệu,
 * mức M: cùng phiên bản, cùng mặt nạ, cùng từng module. Quét đủ 40 phiên bản ở biên dung lượng của cả ba chế độ, nên bảng khối, Reed-Solomon,
 * xen kẽ khối, vị trí căn chỉnh, thông tin định dạng/phiên bản và điểm phạt chọn mặt nạ đều được đối chiếu.
 */

type Internal = { getCapacity: (version: number, ecl: unknown, mode: unknown) => number };
const versionLib = (await import('qrcode/lib/core/version' as string)) as Internal;
const modeLib = (await import('qrcode/lib/core/mode' as string)) as Record<string, unknown>;
const eclLib = (await import('qrcode/lib/core/error-correction-level' as string)) as { M: unknown };
const rendererLib = (await import('qrcode/lib/renderer/utils' as string)) as {
  getOptions: (o: object) => object;
  qrToImageData: (img: Uint8ClampedArray, qr: unknown, opts: object) => void;
  getImageWidth: (size: number, opts: object) => number;
};

const LIB_MODE: Record<QrMode, unknown> = { numeric: modeLib.NUMERIC, alphanumeric: modeLib.ALPHANUMERIC, byte: modeLib.BYTE };

function reference(text: string) {
  return QRCode.create([{ data: text, mode: qrMode(text) } as QRCodeSegment], { errorCorrectionLevel: 'M' });
}

function expectSame(text: string): void {
  const mine = qrMatrix(text);
  const ref = reference(text);
  expect(mine.version, `phiên bản của chuỗi dài ${text.length}`).toBe(ref.version);
  expect(mine.mask, `mặt nạ của chuỗi dài ${text.length}`).toBe(ref.maskPattern);
  expect(mine.size).toBe(ref.modules.size);
  expect(Buffer.from(mine.modules).equals(Buffer.from(ref.modules.data)), `ma trận của chuỗi dài ${text.length}`).toBe(true);
}

/** Chuỗi xác định (không ngẫu nhiên) dài `n` từ bảng ký tự. */
const filler = (alphabet: string, n: number) => Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join('');

describe('qrMode — chế độ cho cả chuỗi', () => {
  it('toàn số → numeric, toàn ký tự chữ-số QR → alphanumeric, còn lại (chữ thường, URL, tiếng Việt) → byte', () => {
    expect(qrMode('0123456789')).toBe('numeric');
    expect(qrMode('TUBU-RC 2026/11:21$*+.%')).toBe('alphanumeric');
    expect(qrMode('https://app.tubutree.com/r/AB12')).toBe('byte');
    expect(qrMode('Tubu Tree xanh')).toBe('byte');
    expect(qrMode('')).toBe('byte');
  });
});

describe('qrMatrix — trùng từng module với thư viện qrcode (mức M)', () => {
  it('chuỗi Mini App thật: link mời, mã thành viên, mã thu gom, mã quà, chữ có dấu', () => {
    for (const text of [
      'https://app.tubutree.com/r/TUBU1234?utm_source=zalo&utm_medium=share',
      'https://app.tubutree.com/product/nuoc-rua-chen-fuwa3e-500ml?ref=AB12CD',
      'TB00012345',
      'RC-20261121-0042',
      '0984606774',
      'GIFT-XANH-7Q2P',
      'Vườn xanh Tubu Tree — đổi rác lấy điểm',
      'a',
    ]) {
      expectSame(text);
    }
  });

  it.each<[QrMode, string]>([
    ['byte', 'abcdefghijklmnopqrstuvwxyz0123456789-._~:/?#@!$&()*+,;=%'],
    ['alphanumeric', '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'],
    ['numeric', '0123456789'],
  ])('%s: đủ 40 phiên bản, ngay biên dung lượng và vượt biên một ký tự', (mode, alphabet) => {
    const seen = new Set<number>();
    for (let v = 1; v <= 40; v++) {
      const cap = versionLib.getCapacity(v, eclLib.M, LIB_MODE[mode]);
      for (const n of mode === 'byte' ? [cap, cap + 1] : [cap]) {
        if (n > versionLib.getCapacity(40, eclLib.M, LIB_MODE[mode])) continue;
        const text = filler(alphabet, n);
        expect(qrMode(text)).toBe(mode);
        expectSame(text);
        seen.add(qrMatrix(text).version);
      }
    }
    expect(seen.size).toBe(40);
  });

  it('chuỗi vượt phiên bản 40 báo lỗi rõ, không trả ảnh sai', () => {
    expect(() => qrMatrix('x'.repeat(2332))).toThrow('Chuỗi quá dài cho mã QR');
  });

  it('cùng chuỗi luôn ra cùng ma trận', () => {
    const a = qrMatrix('https://app.tubutree.com/r/TUBU1234');
    const b = qrMatrix('https://app.tubutree.com/r/TUBU1234');
    expect(Buffer.from(a.modules).equals(Buffer.from(b.modules))).toBe(true);
  });
});

describe('qrPixels — cùng điểm ảnh với qrcode.toDataURL({ width, margin: 1 }) cũ', () => {
  it.each([180, 140, 20])('rộng %i px', (width) => {
    const text = 'https://app.tubutree.com/r/TUBU1234?utm_source=zalo';
    const ref = reference(text);
    const opts = rendererLib.getOptions({ width, margin: 1 });
    const side = rendererLib.getImageWidth(ref.modules.size, opts);
    const rgba = new Uint8ClampedArray(side * side * 4);
    rendererLib.qrToImageData(rgba, ref, opts);
    const mine = qrPixels(qrMatrix(text), width);
    expect(mine.width).toBe(side);
    const refDark = Uint8Array.from({ length: side * side }, (_, k) => (rgba[k * 4] === 0 ? 1 : 0));
    expect(Buffer.from(mine.dark).equals(Buffer.from(refDark))).toBe(true);
  });
});

describe('mã chạy của Mini không còn kéo thư viện qrcode', () => {
  it('không tệp nguồn nào (trừ spec) import qrcode', () => {
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.spec\.tsx?$/.test(e.name) && /from\s+['"]qrcode['"]/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(src, p));
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
