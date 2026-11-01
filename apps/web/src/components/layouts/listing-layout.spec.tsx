// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { ListingBreadcrumb, ListingLayout } from './listing-layout';

let mounted: Rendered | null = null;
const mount = (ui: React.ReactElement) => {
  mounted?.unmount();
  mounted = render(ui);
  return mounted.container;
};
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('ListingLayout', () => {
  it('có sidebar: lưới 200px + nội dung từ lg; aside là phần tử thường (không dính, không giới hạn cao, không cuộn riêng)', () => {
    const c = mount(
      <ListingLayout title="Danh mục" sidebar={<aside data-testid="side">lọc</aside>}>
        <p data-testid="body">nội dung</p>
      </ListingLayout>,
    );
    const side = c.querySelector('[data-testid="side"]')!;
    const grid = side.parentElement!;
    expect(grid.className).toContain('lg:grid-cols-[200px_minmax(0,1fr)]');
    expect(grid.className).toContain('lg:gap-6');
    expect(grid.className).toContain('lg:items-start');
    for (const el of [grid, side as HTMLElement]) expect(el.className).not.toMatch(/\bsticky\b|lg:sticky|max-h-|overflow/);
    expect(side.nextElementSibling!.contains(c.querySelector('[data-testid="body"]'))).toBe(true);
    expect(side.nextElementSibling!.className).toContain('min-w-0');
  });

  it('không sidebar: không có cột nào, nội dung hiện nguyên', () => {
    const c = mount(
      <ListingLayout title="Danh mục">
        <p data-testid="body">nội dung</p>
      </ListingLayout>,
    );
    expect(c.innerHTML).not.toContain('lg:grid-cols');
    expect(c.querySelector('[data-testid="body"]')).not.toBeNull();
  });

  it('h1 chỉ cho trình đọc màn hình ở điện thoại (Mini App không có tiêu đề trang), hiện từ md; caption ẩn ở điện thoại', () => {
    const c = mount(
      <ListingLayout title="Tất cả sản phẩm" caption="12 sản phẩm">
        <span />
      </ListingLayout>,
    );
    const h1 = c.querySelector('h1')!;
    expect(h1.textContent).toBe('Tất cả sản phẩm');
    expect(h1.className).toContain('max-md:sr-only');
    expect(c.querySelector('p')!.className).toContain('max-md:hidden');
  });

  it('thứ tự tài liệu: breadcrumb, h1, thanh công cụ (ô tìm), rồi cột lọc và nội dung', () => {
    const c = mount(
      <ListingLayout title="T" breadcrumb={<nav data-testid="bc" />} toolbar={<form data-testid="tb" />} sidebar={<aside data-testid="sd" />}>
        <p data-testid="bd" />
      </ListingLayout>,
    );
    const order = ['bc', 'h1', 'tb', 'sd', 'bd'].map((k) => c.querySelector(k === 'h1' ? 'h1' : `[data-testid="${k}"]`)!);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('ListingBreadcrumb', () => {
  const trail = [{ label: 'Trang chủ', href: '/' }, { label: 'Danh mục', href: '/san-pham' }, { label: 'Chăm sóc da', href: '/san-pham?category=c-da' }, { label: 'Chống nắng' }];

  it('nav "Breadcrumb": mục có đường dẫn là liên kết, mục cuối là trang hiện tại (không liên kết), ẩn ở điện thoại', () => {
    const c = mount(<ListingBreadcrumb trail={trail} />);
    const nav = c.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Breadcrumb');
    expect(nav.className).toContain('hidden');
    expect(nav.className).toContain('md:block');
    expect([...nav.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Trang chủ', '/'], ['Danh mục', '/san-pham'], ['Chăm sóc da', '/san-pham?category=c-da'],
    ]);
    const current = nav.querySelector('[aria-current="page"]')!;
    expect(current.textContent).toBe('Chống nắng');
    expect(current.tagName).not.toBe('A');
    expect([...nav.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Trang chủ', 'Danh mục', 'Chăm sóc da', 'Chống nắng']);
  });

  it('dấu ngăn chỉ để trang trí; danh sách rỗng thì không vẽ gì', () => {
    const c = mount(<ListingBreadcrumb trail={trail} />);
    expect(c.querySelectorAll('li svg[aria-hidden="true"]').length).toBe(3);
    expect(mount(<ListingBreadcrumb trail={[]} />).innerHTML).toBe('');
  });
});
