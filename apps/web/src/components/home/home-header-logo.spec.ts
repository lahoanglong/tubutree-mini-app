import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/**
 * Logo Trang chủ hiện ở 83×30 px (D9-08). Ảnh nguồn lớn gấp 12 lần chiều rộng hiển thị là ~50 KB tải thừa trên đường tải
 * đầu. Đọc đúng hai file mà home-header.tsx import (bản 2x cho máy 2x, bản 3x cho máy 3x qua `<source srcSet>`) và kiểm kích thước thật:
 * mỗi máy tải bản đúng mật độ điểm ảnh của mình, không bản nào gấp ba cỡ hiển thị trên máy 2x.
 */
const headerSrc = fs.readFileSync(path.join(__dirname, 'home-header.tsx'), 'utf8');
const aliasOf = (name: string) => new RegExp(`import ${name} from '@/([^']+)'`).exec(headerSrc)?.[1] ?? '';
const FILES = { 2: aliasOf('tubuLogo2x'), 3: aliasOf('tubuLogo3x') } as const;
const fileOf = (alias: string) => path.resolve(__dirname, '../..', alias);
const SHOWN = /width=\{(\d+)\} height=\{(\d+)\}/.exec(headerSrc);
const LOGO_WIDTH = Number(SHOWN?.[1]);
const LOGO_HEIGHT = Number(SHOWN?.[2]);
const LOGO_MARK_WIDTH = Number(/LOGO_MARK_WIDTH = (\d+)/.exec(headerSrc)?.[1]);

function pngSize(buf: Buffer): { w: number; h: number } {
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe('logo Trang chủ đúng cỡ hiển thị (D9-08)', () => {
  it('hai file được import là bản nhỏ dành cho Trang chủ, tồn tại và là PNG; ảnh mặc định là bản 2x, bản 3x chỉ nằm trong srcset', () => {
    expect(FILES).toEqual({ 2: 'assets/tubu-logo-home-2x.png', 3: 'assets/tubu-logo-home.png' });
    for (const alias of Object.values(FILES)) expect(fs.existsSync(fileOf(alias))).toBe(true);
    expect(headerSrc).toMatch(/<source srcSet=\{`\$\{tubuLogo2x\.src\} 2x, \$\{tubuLogo3x\.src\} 3x`\} \/>/);
    expect(headerSrc).toMatch(/<Image src=\{tubuLogo2x\}/);
  });

  it.each([2, 3] as const)('bản %ix rộng đúng %i lần cỡ hiển thị, cùng tỉ lệ khung', (scale) => {
    const { w, h } = pngSize(fs.readFileSync(fileOf(FILES[scale])));
    expect(w).toBe(LOGO_WIDTH * scale);
    expect(Math.abs(w / h - LOGO_WIDTH / LOGO_HEIGHT)).toBeLessThan(0.1);
  });

  it('nhẹ: mỗi bản dưới 20 KB, bản 2x nhẹ hơn bản 3x', () => {
    const size = (scale: 2 | 3) => fs.statSync(fileOf(FILES[scale])).size;
    expect(size(3)).toBeLessThan(20 * 1024);
    expect(size(2)).toBeLessThan(size(3));
  });

  it.each([2, 3] as const)('bản %ix: khung dấu logo cắt đúng khe trống giữa dấu và chữ, không lộ một dải chữ "T"/"S" bên phải', (scale) => {
    const { w, cols } = alphaColumns(fs.readFileSync(fileOf(FILES[scale])));
    const markEnd = cols.indexOf(false, cols.indexOf(true)) - 1;
    const textStart = cols.indexOf(true, markEnd + 1);
    const edge = (LOGO_MARK_WIDTH * w) / LOGO_WIDTH;
    expect(edge).toBeGreaterThan(markEnd);
    expect(edge).toBeLessThanOrEqual(textStart);
  });
});

/**
 * Cột nào của PNG 8-bit (không xen dòng) có điểm ảnh không trong suốt: RGBA (kiểu 6) đọc kênh alpha, bảng màu (kiểu 3) đọc alpha của từng
 * màu ở khối tRNS (màu ngoài khối là đục). Giải nén tay để test không cần thư viện ảnh.
 */
function alphaColumns(buf: Buffer): { w: number; cols: boolean[] } {
  let p = 8;
  let w = 0;
  let h = 0;
  let colorType = 0;
  let trns: Buffer = Buffer.alloc(0);
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      colorType = data[9] ?? 0;
      expect(data[8]).toBe(8);
      expect([6, 3]).toContain(colorType);
      expect(data[12]).toBe(0);
    }
    if (type === 'tRNS') trns = Buffer.from(data);
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const img = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? (img[y * stride + x - bpp] ?? 0) : 0;
      const up = y ? (img[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = x >= bpp && y ? (img[(y - 1) * stride + x - bpp] ?? 0) : 0;
      let v = raw[y * (stride + 1) + 1 + x] ?? 0;
      if (filter === 1) v += left;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (left + up) >> 1;
      else if (filter === 4) {
        const base = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(base - left), Math.abs(base - up), Math.abs(base - upLeft)];
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      img[y * stride + x] = v & 255;
    }
  }
  const alpha = (x: number, y: number) => (colorType === 6 ? (img[y * stride + x * 4 + 3] ?? 0) : (trns[img[y * stride + x] ?? 0] ?? 255));
  const cols = Array.from({ length: w }, (_, x) => Array.from({ length: h }, (_, y) => alpha(x, y)).some((a) => a > 0));
  return { w, cols };
}
