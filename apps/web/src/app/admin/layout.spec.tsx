import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PrivateLayout, { metadata } from './layout';

describe('admin/layout', () => {
  // Admin tự đặt nền và màu chữ gốc theo token DS v2 thay vì phó mặc nền toàn cục của khách (bảng/thẻ trắng
  // stone-0 nằm trên nền stone-50), nên đổi nền khách sau này không kéo theo màn quản trị.
  it('bọc nội dung trong khung nền stone-50 + chữ stone-900 và vẫn render đủ nội dung con', () => {
    const html = renderToStaticMarkup(
      <PrivateLayout>
        <main>Quản trị</main>
      </PrivateLayout>,
    );
    expect(html).toContain('<main>Quản trị</main>');
    expect(html).toMatch(/^<div class="[^"]*\bbg-stone-50\b[^"]*\btext-stone-900\b/);
  });

  it('chữ số đều nhau (tabular-nums) cho mọi con: bộ đếm, doanh thu, tồn kho không nhảy bề rộng khi số đổi', () => {
    const html = renderToStaticMarkup(
      <PrivateLayout>
        <main>Quản trị</main>
      </PrivateLayout>,
    );
    expect(html).toMatch(/^<div class="[^"]*\btabular-nums\b/);
  });

  // Nút/ô nhập/ô chọn đặt lại font-variant-numeric về normal (đo bằng Chromium: `button` trong khung có tabular-nums vẫn là `normal`),
  // mà bộ đếm việc và huy hiệu menu nằm ngay trong <button> — nên cần luật riêng cho từng loại.
  it.each(['button', 'input', 'select', 'textarea'])('luật tabular-nums cũng áp cho <%s> bên trong', (tag) => {
    const html = renderToStaticMarkup(
      <PrivateLayout>
        <main>Quản trị</main>
      </PrivateLayout>,
    );
    expect(html).toContain(`[&amp;_${tag}]:tabular-nums`);
  });

  it('vẫn chặn lập chỉ mục (noindex, nofollow)', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
