import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./providers', () => ({ Providers: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/site-header', () => ({ default: () => <header data-testid="header" /> }));
vi.mock('@/components/site-footer', () => ({ default: () => <footer data-testid="footer" /> }));
vi.mock('@/components/hide-on-portals', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/storefront-tracker', () => ({ ReferralCapture: () => null }));

import RootLayout from './layout';

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
