// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
const nav = vi.hoisted(() => ({ pathname: '/doi-rac/tao' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

import { PageHeader } from './page-header';

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('PageHeader', () => {
  it('một h1 với tiêu đề, phụ đề và phần hành động', () => {
    const { container } = mount(<PageHeader title="Giỏ hàng" subtitle="3 sản phẩm" actions={<button>Xoá</button>} />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('h1')!.textContent).toBe('Giỏ hàng');
    expect(container.textContent).toContain('3 sản phẩm');
    expect(container.querySelector('button')!.textContent).toBe('Xoá');
  });

  it('có backHref: link quay lại có tên truy cập, vùng chạm 44px; không có thì không hiện', () => {
    const a = mount(<PageHeader title="X" backHref="/tai-khoan" />);
    const link = a.container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/tai-khoan');
    expect(link.getAttribute('aria-label')).toBe('Quay lại');
    expect(link.className).toContain('min-h-11');
    expect(mount(<PageHeader title="X" />).container.querySelector('a')).toBeNull();
  });

  describe('thanh tiêu đề điện thoại (một bản dùng chung)', () => {
    it('dải trắng tràn ngang mọi cha, đệm 12/16 cộng safe-top, bỏ đệm 48px của body (data-page-bleed)', () => {
      const h = mount(<PageHeader title="X" />).container.querySelector('header')!;
      expect(h.hasAttribute('data-page-bleed')).toBe(true);
      for (const c of ['max-md:mx-[calc(50%-50vw)]', 'max-md:bg-[var(--color-bg-surface)]', 'max-md:px-4', 'max-md:pb-3', 'max-md:pt-[calc(12px+var(--safe-top))]']) {
        expect(h.className).toContain(c);
      }
    });

    it('trang con chừa 48px cho nút lùi nổi dù không có backHref; trang gốc của thanh đáy thì không chừa', () => {
      nav.pathname = '/doi-rac/tao';
      const child = mount(<PageHeader title="X" />).container.querySelector('h1')!.parentElement!;
      expect(child.className).toContain('max-md:pl-12');
      nav.pathname = '/tai-khoan/don-hang';
      const root = mount(<PageHeader title="X" backHref="/tai-khoan" />).container.querySelector('h1')!.parentElement!;
      expect(root.className).not.toContain('max-md:pl-12');
    });

    it('phụ đề cỡ caption màu tertiary ở điện thoại; className và subtitleClassName được áp', () => {
      const c = mount(<PageHeader title="X" subtitle="Phụ" className="md:mt-1" subtitleClassName="md:text-sm" />).container;
      expect(c.querySelector('header')!.className).toContain('md:mt-1');
      const sub = c.querySelector('h1')!.nextElementSibling!;
      expect(sub.className).toContain('max-md:text-[color:var(--color-text-tertiary)]');
      expect(sub.className).toContain('md:text-sm');
    });

    it('hero: nền inverse chữ inverse ở điện thoại, giữ thẻ rừng từ md', () => {
      const c = mount(<PageHeader title="X" subtitle="Phụ" variant="hero" />).container;
      const h = c.querySelector('header')!;
      expect(h.className).toContain('max-md:bg-[var(--color-bg-inverse)]');
      expect(h.className).toContain('md:rounded-card');
      expect(c.querySelector('h1')!.className).toContain('max-md:text-[color:var(--color-text-inverse)]');
    });

    it('dải luôn ngang hàng nút lùi nổi (data-page-bleed bỏ đệm 48px của body), kể cả màn chuyển khoản như Mini App', () => {
      const h = mount(<PageHeader title="X" />).container.querySelector('header')!;
      expect(h.hasAttribute('data-page-bleed')).toBe(true);
    });

    it('backHref khai báo trang cha cho nút lùi nổi (data-back-href)', () => {
      const h = mount(<PageHeader title="X" backHref="/tai-khoan" />).container.querySelector('header')!;
      expect(h.getAttribute('data-back-href')).toBe('/tai-khoan');
    });
  });
});
