import fs from 'node:fs';
import path from 'node:path';
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
});
