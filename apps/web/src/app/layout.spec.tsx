import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./providers', () => ({ Providers: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/site-header', () => ({ default: () => <header data-testid="header" /> }));
vi.mock('@/components/site-footer', () => ({ default: () => <footer data-testid="footer" /> }));
vi.mock('@/components/hide-on-portals', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/storefront-tracker', () => ({ ReferralCapture: () => null }));

import RootLayout, { metadata, viewport } from './layout';

// PC-7: ô tìm kiếm không được nháy trên host gian hàng CTV — xem tenantHostBootScript ở lib/site.ts.
describe('RootLayout — đánh dấu host gian hàng trước khi vẽ', () => {
  const html = renderToStaticMarkup(
    <RootLayout>
      <main>Nội dung</main>
    </RootLayout>,
  );

  it('có script đánh dấu host trong <head>, đứng trước <body>', () => {
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    expect(head).toContain('<script>');
    expect(head).toContain('data-tenant-host');
    expect(html.indexOf('</head>')).toBeLessThan(html.indexOf('<body'));
  });

  it('globals.css ẩn khung tìm kiếm khi <html> có data-tenant-host', () => {
    const css = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/html\[data-tenant-host\]\s+\[data-site-search\]\s*\{[^}]*display:\s*none/);
  });

  it('<html> cho phép thuộc tính do script thêm trước hydrate (suppressHydrationWarning)', () => {
    const src = readFileSync(fileURLToPath(new URL('./layout.tsx', import.meta.url)), 'utf8');
    expect(src).toMatch(/<html[^>]*suppressHydrationWarning/);
  });
});

// BUYERWEB-16: không có thư mục public nên /favicon.ico trả 404 và link chia sẻ không có ảnh mặc định.
describe('biểu tượng site và ảnh chia sẻ mặc định (BUYERWEB-16)', () => {
  const file = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)));

  it('có đủ icon.svg, apple-icon.png, favicon.ico theo quy ước thư mục app', () => {
    expect(file('icon.svg').toString()).toMatch(/^<svg[^>]+viewBox="0 0 32 32"/);
    expect(file('apple-icon.png').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const ico = file('favicon.ico');
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 1]);
    expect(ico.subarray(22, 30).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('opengraph-image.png đúng cỡ chuẩn 1200x630', () => {
    const png = file('opengraph-image.png');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it('metadata gốc khai tên site và ngôn ngữ cho og', () => {
    expect(metadata.openGraph).toMatchObject({ siteName: 'Tubu Tree', locale: 'vi_VN' });
  });
});

// env(safe-area-inset-bottom) chỉ có giá trị khi trang xin viewport-fit=cover: không có thì thanh dính đáy đè lên thanh home của iPhone.
describe('RootLayout — viewport', () => {
  it('xin viewport-fit=cover, giữ width=device-width và scale 1', () => {
    expect(viewport).toMatchObject({ viewportFit: 'cover', width: 'device-width', initialScale: 1 });
  });

  it('globals.css chừa đệm đáy theo --sticky-bar-h (thanh dính đáy tự đo), có mặc định cho lúc chưa đo', () => {
    const css = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/--sticky-bar-h:\s*calc\(6rem/);
    expect(css).toMatch(/body\.has-sticky-bar\s*\{[^}]*padding-bottom:\s*var\(--sticky-bar-h\)/);
  });

  it('body chừa inset trái/phải của tai thỏ (viewport-fit=cover), bằng 0 trên máy không có', () => {
    const css = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8');
    const body = css.match(/(?:^|\n)\s*body\s*\{[^}]*\}/)?.[0] ?? '';
    expect(body).toMatch(/padding-left:\s*env\(safe-area-inset-left,\s*0px\)/);
    expect(body).toMatch(/padding-right:\s*env\(safe-area-inset-right,\s*0px\)/);
  });
});
