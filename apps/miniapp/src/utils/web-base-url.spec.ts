import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_BASE_URL, resolveWebBaseUrl } from './web-base-url';

// Q-20: link chia sẻ/giới thiệu từ Mini App trỏ về web ở app.tubutree.com (host đang phục vụ web trên PROD).
const source = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

describe('resolveWebBaseUrl', () => {
  it('mặc định là https://app.tubutree.com', () => {
    expect(DEFAULT_WEB_BASE_URL).toBe('https://app.tubutree.com');
    expect(resolveWebBaseUrl(undefined)).toBe('https://app.tubutree.com');
  });

  it('biến môi trường rỗng/khoảng trắng cũng rơi về mặc định (không ghép link thành "/product/...")', () => {
    expect(resolveWebBaseUrl('')).toBe('https://app.tubutree.com');
    expect(resolveWebBaseUrl('   ')).toBe('https://app.tubutree.com');
  });

  it('lấy giá trị cấu hình và bỏ dấu / ở cuối', () => {
    expect(resolveWebBaseUrl('https://staging.tubutree.com//')).toBe('https://staging.tubutree.com');
  });
});

describe('nơi dựng link chia sẻ', () => {
  // R-67: mọi link chia sẻ phát ra từ Mini App là link Mini App (zalo.me/s/<id>/...), người nhận ở lại trong Zalo.
  it.each(['components/content-kit-sheet.tsx', 'pages/product-detail.tsx', 'pages/profile.tsx'])(
    '%s dựng link bằng miniAppLink, không dùng domain web',
    (rel) => {
      const src = source(rel);
      expect(src).toContain('miniAppLink(');
      expect(src).not.toContain('WEB_BASE_URL');
      expect(src).not.toMatch(/tubutree\.com'/);
      expect(src).not.toContain('VITE_WEB_BASE_URL');
    },
  );
});
