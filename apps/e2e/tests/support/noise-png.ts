import { deflateSync, crc32 } from 'zlib';

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  head.copy(out, 4);
  out.writeUInt32BE(crc32(head), 8 + data.length);
  return out;
}

function pngOf(width: number, height: number, fill: (x: number, y: number, c: number) => number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width * 3; x++) raw[y * row + 1 + x] = fill(Math.floor(x / 3), y, x % 3);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

/** PNG RGB nhiễu 160×160 (~75 KB): đủ entropy để Chrome tính vào LCP dù ảnh được kéo giãn ra khung 343×137. */
export function noisePng(size = 160): Buffer {
  let seed = 7;
  return pngOf(size, size, () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed >> 16;
  });
}

/** PNG một màu (vài trăm byte): ảnh banner mẫu mà API chịu phục vụ (chỉ raster, không SVG). */
export function solidPng(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  return pngOf(width, height, (_x, _y, c) => rgb[c]!);
}
export const NOISE = noisePng();
