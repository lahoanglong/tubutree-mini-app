import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/**
 * Logo Trang chủ hiện ở 83×30 px (D9-08). Ảnh nguồn lớn gấp 12 lần chiều rộng hiển thị là ~50 KB tải thừa trên đường tải
 * đầu. Đọc đúng file mà home-header.tsx import và kiểm kích thước thật: đủ nét cho màn 3× (≤ 3 lần), không nhỏ hơn 2×.
 */
const headerSrc = fs.readFileSync(path.join(__dirname, 'home-header.tsx'), 'utf8');
const alias = /import tubuLogo from '@\/([^']+)'/.exec(headerSrc)?.[1] ?? '';
const file = path.resolve(__dirname, '../..', alias);
const SHOWN = /width=\{(\d+)\} height=\{(\d+)\}/.exec(headerSrc);
const LOGO_WIDTH = Number(SHOWN?.[1]);
const LOGO_HEIGHT = Number(SHOWN?.[2]);
const LOGO_MARK_WIDTH = Number(/LOGO_MARK_WIDTH = (\d+)/.exec(headerSrc)?.[1]);

function pngSize(buf: Buffer): { w: number; h: number } {
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe('logo Trang chủ đúng cỡ hiển thị (D9-08)', () => {
  it('file được import là bản nhỏ dành cho Trang chủ, tồn tại và là PNG', () => {
    expect(alias).toBe('assets/tubu-logo-home.png');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('rộng tối đa 3× cỡ hiển thị, tối thiểu 2×, cùng tỉ lệ khung', () => {
    const { w, h } = pngSize(fs.readFileSync(file));
    expect(w).toBeLessThanOrEqual(LOGO_WIDTH * 3);
    expect(w).toBeGreaterThanOrEqual(LOGO_WIDTH * 2);
    expect(Math.abs(w / h - LOGO_WIDTH / LOGO_HEIGHT)).toBeLessThan(0.1);
  });

  it('nhẹ: dưới 20 KB', () => {
    expect(fs.statSync(file).size).toBeLessThan(20 * 1024);
  });

  it('khung dấu logo cắt đúng khe trống giữa dấu và chữ: không lộ một dải chữ "T"/"S" bên phải', () => {
    const { w, cols } = alphaColumns(fs.readFileSync(file));
    const markEnd = cols.indexOf(false, cols.indexOf(true)) - 1;
    const textStart = cols.indexOf(true, markEnd + 1);
    const edge = (LOGO_MARK_WIDTH * w) / LOGO_WIDTH;
    expect(edge).toBeGreaterThan(markEnd);
    expect(edge).toBeLessThanOrEqual(textStart);
  });
});

/** Cột nào của PNG RGBA 8-bit (không xen dòng) có điểm ảnh không trong suốt; giải nén tay để test không cần thư viện ảnh. */
function alphaColumns(buf: Buffer): { w: number; cols: boolean[] } {
  let p = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      expect([data[8], data[9], data[12]]).toEqual([8, 6, 0]);
    }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const img = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? img[y * stride + x - 4] : 0;
      const up = y ? img[(y - 1) * stride + x] : 0;
      const upLeft = x >= 4 && y ? img[(y - 1) * stride + x - 4] : 0;
      let v = raw[y * (stride + 1) + 1 + x];
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
  const cols = Array.from({ length: w }, (_, x) => Array.from({ length: h }, (_, y) => img[y * stride + x * 4 + 3]).some((a) => a > 0));
  return { w, cols };
}
