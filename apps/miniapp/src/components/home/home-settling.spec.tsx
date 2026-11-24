import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HOME_SETTLING_HEIGHTS } from '@tubutree/app-core/home-layout';
import { HomeSettlingSkeleton } from './home-settling';

const heights = () => Array.from(screen.getByTestId('home-settling').children).map((el) => (el as HTMLElement).style.height);

describe('HomeSettlingSkeleton', () => {
  it('bốn ô theo thứ tự khối thật và chiều cao chung ở app-core: danh mục, kệ Bán chạy nhất, lối vào, dải Story', () => {
    render(<HomeSettlingSkeleton />);
    const h = HOME_SETTLING_HEIGHTS;
    expect(heights()).toEqual([h.categories, h.products, h.shortcuts, h.stories].map((n) => `${n}px`));
  });

  it('không còn ô banner hay Giờ vàng ở đầu khung chờ (hai khối này nằm dưới kệ đầu và tự ẩn khi không có gì)', () => {
    render(<HomeSettlingSkeleton />);
    const children = Array.from(screen.getByTestId('home-settling').children) as HTMLElement[];
    expect(children).toHaveLength(4);
    expect(children.some((el) => el.style.aspectRatio !== '')).toBe(false);
    expect(heights()).not.toContain(`${HOME_SETTLING_HEIGHTS.flash}px`);
  });

  it('dải Story ở cuối cao 144 như khối thật (không nhảy khi dải hiện)', () => {
    render(<HomeSettlingSkeleton />);
    expect(heights()[3]).toBe('144px');
  });

  it('danh mục luôn một hàng cộng thanh thương hiệu (192) dù số ô nhớ là bao nhiêu: số ô vượt 5 bị cắt về 5 như khối thật', () => {
    const categoriesHeight = (cells?: number) => {
      const { unmount } = render(<HomeSettlingSkeleton categoryCells={cells} />);
      const h = heights()[0];
      unmount();
      return h;
    };
    expect(categoriesHeight(4)).toBe('192px');
    expect(categoriesHeight(5)).toBe('192px');
    expect(categoriesHeight(6)).toBe('192px');
    expect(categoriesHeight(40)).toBe('192px');
    expect(categoriesHeight(undefined)).toBe(`${HOME_SETTLING_HEIGHTS.categories}px`);
  });
});
