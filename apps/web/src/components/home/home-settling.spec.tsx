// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { HOME_SETTLING_HEIGHTS } from '@tubutree/app-core/home-layout';
import { render, type Rendered } from '@/test-utils/dom';
import { HomeSettlingSkeleton } from './home-settling';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('HomeSettlingSkeleton', () => {
  it('bốn ô theo chiều cao chung ở app-core, giống Mini App (lối tắt, Giờ vàng, danh mục, hai hàng thẻ hàng)', () => {
    mounted = render(<HomeSettlingSkeleton />);
    const heights = Array.from(mounted.container.querySelector('[data-testid="home-settling"]')!.children).map((el) => (el as HTMLElement).style.height);
    const h = HOME_SETTLING_HEIGHTS;
    expect(heights).toEqual([h.shortcuts, h.flash, h.categories, h.products].map((n) => `${n}px`));
  });

  it('danh mục theo số ô: tới 5 ô một hàng (148), từ 6 ô hai hàng (248)', () => {
    const categoriesHeight = (cells?: number) => {
      const r = render(<HomeSettlingSkeleton categoryCells={cells} />);
      const h = (r.container.querySelector('[data-testid="home-settling"]')!.children[2] as HTMLElement).style.height;
      r.unmount();
      return h;
    };
    expect(categoriesHeight(4)).toBe('148px');
    expect(categoriesHeight(5)).toBe('148px');
    expect(categoriesHeight(6)).toBe('248px');
    expect(categoriesHeight(undefined)).toBe(`${HOME_SETTLING_HEIGHTS.categories}px`);
  });
});
