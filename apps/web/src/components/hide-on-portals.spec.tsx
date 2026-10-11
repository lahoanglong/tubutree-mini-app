import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));

import HideOnPortals from './hide-on-portals';

const out = (pathname: string) => {
  mocks.pathname = pathname;
  return renderToStaticMarkup(
    <HideOnPortals>
      <footer>chân trang</footer>
    </HideOnPortals>,
  );
};

describe('HideOnPortals', () => {
  it('hiện ở trang khách', () => {
    expect(out('/')).toBe('<footer>chân trang</footer>');
    expect(out('/san-pham/xa-phong')).toContain('chân trang');
    // /brand/[slug] là trang nhãn hàng công khai, khách vẫn cần lối liên hệ.
    expect(out('/brand/abc')).toContain('chân trang');
  });

  it('ẩn ở /admin, /merchant', () => {
    expect(out('/admin')).toBe('');
    expect(out('/merchant/doanh-thu')).toBe('');
  });
});
