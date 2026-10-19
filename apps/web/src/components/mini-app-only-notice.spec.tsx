import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MiniAppOnlyNotice } from './mini-app-only-notice';

afterEach(() => vi.unstubAllEnvs());

describe('MiniAppOnlyNotice', () => {
  it('nói rõ cần mở trên Zalo và có nút dẫn tới đúng màn Mini App', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', '123');
    const html = renderToStaticMarkup(<MiniAppOnlyNotice path="/doi-rac/quay" />);
    expect(html).toContain('Tính năng này cần mở Tubu Tree trên Zalo.');
    expect(html).toContain('href="https://zalo.me/s/123/recycle/desk"');
    expect(html).toContain('Mở trên Zalo');
    expect(html).toContain('min-h-11');
  });

  it('đường dẫn không có màn tương ứng: mở trang chủ Mini App', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', '123');
    expect(renderToStaticMarkup(<MiniAppOnlyNotice path="/khong-co" />)).toContain('href="https://zalo.me/s/123/"');
  });

  it('miniappPath: mở thẳng đường dẫn Mini App, không tra ngược route map', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', '123');
    expect(renderToStaticMarkup(<MiniAppOnlyNotice miniappPath="/points/scan" />)).toContain('href="https://zalo.me/s/123/points/scan"');
  });

  it('chưa cấu hình app id: chỉ còn dòng giải thích, không có nút', () => {
    vi.stubEnv('NEXT_PUBLIC_ZALO_APP_ID', '');
    const html = renderToStaticMarkup(<MiniAppOnlyNotice path="/doi-rac/quay" />);
    expect(html).toContain('Tính năng này cần mở Tubu Tree trên Zalo.');
    expect(html).not.toContain('Mở trên Zalo');
    expect(html).not.toContain('<a ');
  });

  it('mặc định đệm rộng (py-16); compact đệm nhỏ cho chỗ nằm trong thẻ', () => {
    expect(renderToStaticMarkup(<MiniAppOnlyNotice path="/x" />)).toContain('py-16');
    const compact = renderToStaticMarkup(<MiniAppOnlyNotice path="/x" compact />);
    expect(compact).not.toContain('py-16');
    expect(compact).toContain('py-4');
  });
});
