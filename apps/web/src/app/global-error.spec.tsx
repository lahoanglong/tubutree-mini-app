import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/error-report', () => ({ reportError: vi.fn() }));

import GlobalError from './global-error';

describe('GlobalError (A11Y-22)', () => {
  it('nạp globals.css: layout gốc không chạy nên nếu thiếu thì trang lỗi không có Tailwind/token', () => {
    const src = readFileSync(fileURLToPath(new URL('./global-error.tsx', import.meta.url)), 'utf8');
    expect(src).toMatch(/^import '\.\/globals\.css';$/m);
  });

  it('tự vẽ <html lang="vi"> với h1, nút "Thử lại" dùng kiểu nút chính', () => {
    const html = renderToStaticMarkup(<GlobalError error={new Error('x')} reset={() => {}} />);
    expect(html).toContain('<html lang="vi">');
    expect(html).toContain('<h1');
    expect(html).toMatch(/<button[^>]*class="[^"]*bg-forest-600[^"]*"[^>]*>Thử lại<\/button>/);
  });
});
