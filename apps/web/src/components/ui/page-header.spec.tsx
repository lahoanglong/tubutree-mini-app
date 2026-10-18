// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
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
});
