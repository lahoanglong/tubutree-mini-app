import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPublicSupport: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: mocks.getPublicSupport,
}));

import SiteFooter from './site-footer';
import { StickyActionBar } from './sticky-action-bar';
import { StickyActionBar as MiniStickyActionBar } from './mini/sticky-action-bar';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('chân trang gọn ẩn khi có thanh dính đáy', () => {
  it('globals.css ẩn chân trang gọn chỉ dưới md khi trang có [data-sticky-bar]', () => {
    const css = src('app/globals.css');
    expect(css).toMatch(
      /@media \(max-width: 767\.98px\)\s*\{\s*body:has\(\[data-sticky-bar\]\)\s+footer\[data-compact-footer\]\s*\{\s*display:\s*none;?\s*\}/,
    );
  });

  it('chân trang gọn có data-compact-footer, chân trang đầy đủ thì không', async () => {
    mocks.getPublicSupport.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
    const out = renderToStaticMarkup(await SiteFooter());
    expect(out.match(/data-compact-footer/g)).toHaveLength(1);
    expect(out).toMatch(/<footer[^>]*aria-label="Hỗ trợ và chính sách"[^>]*data-compact-footer|<footer[^>]*data-compact-footer[^>]*aria-label="Hỗ trợ và chính sách"/);
  });

  it('StickyActionBar của web và của Mini App đều đánh dấu data-sticky-bar', () => {
    expect(renderToStaticMarkup(<StickyActionBar label="Thanh toán">x</StickyActionBar>)).toContain('data-sticky-bar');
    expect(renderToStaticMarkup(<MiniStickyActionBar primary="x" />)).toContain('data-sticky-bar');
  });

  it.each([
    'app/tai-khoan/don-hang/[code]/order-actions.tsx',
    'app/brand/[slug]/brand-actions.tsx',
    'app/cong-dong/[id]/page.tsx',
    'app/tu-van/page.tsx',
    'components/affiliate/storefront-owner.tsx',
  ])('thanh fixed tự vẽ ở %s có data-sticky-bar', (file) => {
    expect(src(file)).toContain('data-sticky-bar');
  });

  it('thanh đáy điều hướng không đánh dấu data-sticky-bar', () => {
    expect(src('components/bottom-nav.tsx')).not.toContain('data-sticky-bar');
  });
});
