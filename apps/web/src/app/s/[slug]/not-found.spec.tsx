// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, push: vi.fn() }), usePathname: () => '/s/xyz' }));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null, status: 'guest', initialized: true }) }));

import StorefrontNotFound from './not-found';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const product = (id: string) => ({ id, slug: `sp-${id}`, brand: 'Tubu', name: `Sản phẩm ${id}`, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true });

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  mocks.replace.mockReset();
  vi.unstubAllGlobals();
});

// Cùng chữ, nút và kệ gợi ý với màn không tìm thấy của `storefront-view.tsx` ở Mini App.
describe('/s/[slug] — gian hàng không có', () => {
  const mount = async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/products')) return json({ data: [product('a'), product('b')], meta: { page: 1, limit: 4, total: 2 } });
      if (u.pathname.includes('/wishlist')) return json([]);
      return json({});
    }));
    const r = render(<StorefrontNotFound />);
    mounted.push(r);
    await flush(8);
    return r.container;
  };

  it('chữ Mini: Gian hàng / Không tìm thấy / lý do / Về trang chủ, không có "Thử lại"', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Gian hàng');
    expect(c.textContent).toContain('Không tìm thấy');
    expect(c.textContent).toContain('Gian hàng này không tồn tại hoặc đã ngừng hoạt động.');
    expect(byText(c, 'button', 'Thử lại')).toBeNull();
    click(byText(c, 'button', 'Về trang chủ'));
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });

  it('có kệ "Có thể bạn thích" và đúng một h1', async () => {
    const c = await mount();
    expect(c.querySelector('section[aria-label="Có thể bạn thích"]')).not.toBeNull();
    expect(headingProblems(c)).toEqual([]);
  });
});
