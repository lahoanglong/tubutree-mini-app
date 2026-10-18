// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { LineItemSkeleton, ProductCardSkeleton, ProductGridSkeleton, Skeleton } from './skeleton';

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

describe('Skeleton', () => {
  it('ẩn khỏi trình đọc màn hình, theo kích thước, tắt animation khi giảm chuyển động', () => {
    const el = mount(<Skeleton width={56} height={12} />).container.firstElementChild as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.width).toBe('56px');
    expect(el.style.height).toBe('12px');
    expect(el.className).toContain('motion-reduce:animate-none');
  });

  it('lưới có đúng số thẻ, mặc định 6', () => {
    expect(mount(<ProductGridSkeleton />).container.querySelectorAll('[data-skeleton]').length).toBe(6 * 5);
    expect(mount(<ProductGridSkeleton count={2} />).container.querySelectorAll('[data-skeleton]').length).toBe(2 * 5);
  });

  it('thẻ sản phẩm và dòng hàng dựng được', () => {
    expect(mount(<ProductCardSkeleton />).container.querySelectorAll('[data-skeleton]').length).toBe(5);
    expect(mount(<LineItemSkeleton />).container.querySelectorAll('[data-skeleton]').length).toBe(4);
  });
});
