import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PrivateLayout, { metadata } from './layout';

describe('merchant/layout', () => {
  // Cổng đối tác dùng cùng khung nền với khu quản trị: thẻ trắng stone-0 nằm trên nền stone-50, chữ gốc stone-900,
  // không phụ thuộc nền toàn cục của web khách.
  it('bọc nội dung trong khung nền stone-50 + chữ stone-900 và vẫn render đủ nội dung con', () => {
    const html = renderToStaticMarkup(
      <PrivateLayout>
        <main>Đối tác</main>
      </PrivateLayout>,
    );
    expect(html).toContain('<main>Đối tác</main>');
    expect(html).toMatch(/^<div class="[^"]*\bbg-stone-50\b[^"]*\btext-stone-900\b/);
  });

  it('vẫn chặn lập chỉ mục (noindex, nofollow)', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
