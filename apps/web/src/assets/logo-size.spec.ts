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
  it('tubu-logo.png: hiện 99×36 (header) và 110×40 (chân trang): rộng ≥ 3× cỡ lớn nhất (nét ở máy 3x) và không quá 4×, nhẹ dưới 12 KB', () => {
    const { bytes, w, h } = png('tubu-logo.png');
    expect(w).toBeGreaterThanOrEqual(110 * 3);
    expect(w).toBeLessThanOrEqual(110 * 4);
    expect(Math.abs(w / h - 1059 / 384)).toBeLessThan(0.02);
    expect(bytes).toBeLessThan(12 * 1024);
  });

  it('logo /dang-nhap hiện 160×58: bản 2x (320) cho máy 2x và bản 3x (480) chỉ trong srcset, cùng tỉ lệ logo, mỗi bản nhẹ dưới 12 KB', () => {
    for (const [name, scale] of [['tubu-logo-login-2x.png', 2], ['tubu-logo-login.png', 3]] as const) {
      const { bytes, w, h } = png(name);
      expect(w).toBe(160 * scale);
      expect(Math.abs(w / h - 1059 / 384)).toBeLessThan(0.02);
      expect(bytes).toBeLessThan(12 * 1024);
    }
    expect(png('tubu-logo-login-2x.png').bytes).toBeLessThan(png('tubu-logo-login.png').bytes);
  });

  it('tubu-logo-mark.png (ô biểu tượng app của dải mời Zalo, W46): dấu logo 60×90 hiện 16×24 nên đủ nét ở máy 3x, nhẹ dưới 4 KB, trùng byte bản của Mini App', () => {
    const { bytes, w, h } = png('tubu-logo-mark.png');
    expect([w, h]).toEqual([60, 90]);
    expect(w).toBeGreaterThanOrEqual(16 * 3);
    expect(bytes).toBeLessThan(4 * 1024);
    const mini = fs.readFileSync(path.join(__dirname, '../../../miniapp/src/assets/tubu-logo-mark.png'));
    expect(fs.readFileSync(path.join(__dirname, 'tubu-logo-mark.png')).equals(mini)).toBe(true);
  });

  it('tubu-logo-home.png (3x) và tubu-logo-home-2x.png: nhẹ dưới 12 KB', () => {
    expect(png('tubu-logo-home.png').bytes).toBeLessThan(12 * 1024);
    expect(png('tubu-logo-home-2x.png').bytes).toBeLessThan(12 * 1024);
  });
});
