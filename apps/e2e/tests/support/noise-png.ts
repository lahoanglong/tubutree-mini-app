import { deflateSync, crc32 } from 'zlib';

/** PNG RGB nhiễu 160×160 (~75 KB): đủ entropy để Chrome tính vào LCP dù ảnh được kéo giãn ra khung 343×137. */
export function noisePng(size = 160): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    head.copy(out, 4);
    out.writeUInt32BE(crc32(head), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  let seed = 7;
  for (let y = 0; y < size; y++) {
    for (let x = 1; x < row; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      raw[y * row + x] = seed >> 16;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const NOISE = noisePng();
