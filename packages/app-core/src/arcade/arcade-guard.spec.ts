import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

/** Bỏ comment để mô tả bằng chữ trong comment không bị coi là mã. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('arcade/ nhẹ và thuần', () => {
  it('có đủ bảy module', () => {
    expect(files.sort()).toEqual(['arcade-canvas.ts', 'arcade-config.ts', 'arcade-tips.ts', 'badge.ts', 'dew-catcher.ts', 'home-quiz.ts', 'refill-rush.ts']);
  });

  it('tổng mã nguồn (không tính spec) dưới 30 KB để vào bundle đầu của Mini App', () => {
    const bytes = files.reduce((n, f) => n + statSync(join(DIR, f)).size, 0);
    expect(bytes, `${bytes} byte`).toBeLessThan(30_000);
  });

  it('không có màu viết cứng: màu đến từ theme do nơi gọi truyền vào', () => {
    for (const f of files) {
      const src = code(read(f));
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, f).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
    }
  });

  it('không dùng biến toàn cục của trình duyệt hay kiểu DOM', () => {
    const banned = /\b(?:window|document|globalThis|localStorage|sessionStorage|navigator|self|requestAnimationFrame|cancelAnimationFrame|performance|setTimeout|setInterval|clearTimeout|clearInterval|HTMLCanvasElement|CanvasRenderingContext2D|PointerEvent|KeyboardEvent|fetch)\b/;
    for (const f of files) expect(code(read(f)), f).not.toMatch(banned);
  });

  it('không nhập react, zmp hay thư viện giao diện; chỉ nhập từ app-core', () => {
    for (const f of files) {
      for (const m of read(f).matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        expect(m[1]!.startsWith('.'), `${f} nhập ${m[1]}`).toBe(true);
      }
    }
  });

  it('thời gian và ngẫu nhiên do nơi gọi đưa vào: không gọi Date.now hay new Date() trần', () => {
    for (const f of files) {
      const src = code(read(f));
      expect(src, f).not.toMatch(/Date\.now\(/);
      expect(src, f).not.toMatch(/new Date\(\)/);
    }
  });
});
