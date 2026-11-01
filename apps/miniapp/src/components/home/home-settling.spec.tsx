import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HOME_SETTLING_HEIGHTS } from '@tubutree/app-core/home-layout';
import { HomeSettlingSkeleton } from './home-settling';

describe('HomeSettlingSkeleton', () => {
  it('bốn ô theo chiều cao chung ở app-core (lối tắt, Giờ vàng, danh mục, hai hàng thẻ hàng)', () => {
    render(<HomeSettlingSkeleton />);
    const heights = Array.from(screen.getByTestId('home-settling').children).map((el) => (el as HTMLElement).style.height);
    const h = HOME_SETTLING_HEIGHTS;
    expect(heights).toEqual([h.shortcuts, h.flash, h.categories, h.products].map((n) => `${n}px`));
  });

  it('danh mục theo số ô nhớ: tới 5 ô một hàng (148), từ 6 ô hai hàng (248)', () => {
    const categoriesHeight = (cells?: number) => {
      const { unmount } = render(<HomeSettlingSkeleton categoryCells={cells} />);
      const h = (screen.getByTestId('home-settling').children[2] as HTMLElement).style.height;
      unmount();
      return h;
    };
    expect(categoriesHeight(4)).toBe('148px');
    expect(categoriesHeight(5)).toBe('148px');
    expect(categoriesHeight(6)).toBe('248px');
    expect(categoriesHeight(undefined)).toBe(`${HOME_SETTLING_HEIGHTS.categories}px`);
  });
});
