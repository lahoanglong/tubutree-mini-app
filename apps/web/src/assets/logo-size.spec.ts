import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** `images.unoptimized: true` (next.config.mjs): logo được phục vụ nguyên file nên file phải sát cỡ hiển thị, không phải ảnh thiết kế gốc. */
const png = (name: string) => {
  const buf = fs.readFileSync(path.join(__dirname, name));
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { bytes: buf.length, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};

describe('logo nhẹ và sát cỡ hiển thị (Pa6)', () => {
  it('tubu-logo.png: hiện 99×36 (header) và 110×40 (chân trang), 160×58 (đăng nhập): rộng ≤ 3× cỡ lớn nhất, nhẹ dưới 12 KB', () => {
    const { bytes, w, h } = png('tubu-logo.png');
    expect(w).toBeLessThanOrEqual(160 * 3);
    expect(w).toBeGreaterThanOrEqual(160 * 2);
    expect(Math.abs(w / h - 1059 / 384)).toBeLessThan(0.02);
    expect(bytes).toBeLessThan(12 * 1024);
  });

  it('tubu-logo-home.png: nhẹ dưới 12 KB', () => {
    expect(png('tubu-logo-home.png').bytes).toBeLessThan(12 * 1024);
  });
});
