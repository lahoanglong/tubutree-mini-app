import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HOME_SETTLING_HEIGHTS } from '@tubutree/app-core/home-layout';
import { HomeSettlingSkeleton } from './home-settling';

describe('HomeSettlingSkeleton', () => {
  it('năm ô theo chiều cao chung ở app-core (lối tắt, dải Story, Giờ vàng, danh mục, hai hàng thẻ hàng)', () => {
    render(<HomeSettlingSkeleton />);
    const heights = Array.from(screen.getByTestId('home-settling').children).map((el) => (el as HTMLElement).style.height);
    const h = HOME_SETTLING_HEIGHTS;
    expect(heights).toEqual([h.shortcuts, h.stories, h.flash, h.categories, h.products].map((n) => `${n}px`));
  });

  it('có banner (lần mở trước có): banner đứng đầu, cao đúng tỉ lệ khung banner, các ô sau giữ nguyên', () => {
    render(<HomeSettlingSkeleton banner />);
    const children = Array.from(screen.getByTestId('home-settling').children) as HTMLElement[];
    expect(children).toHaveLength(6);
    expect(children[0]).toHaveStyle({ aspectRatio: 'var(--banner-ratio)' });
    const h = HOME_SETTLING_HEIGHTS;
    expect(children.slice(1).map((el) => el.style.height)).toEqual([h.shortcuts, h.stories, h.flash, h.categories, h.products].map((n) => `${n}px`));
  });

  it('dải Story đứng đúng giữa lối tắt và Giờ vàng, cao 144 như khối thật (không nhảy khi dải hiện)', () => {
    render(<HomeSettlingSkeleton />);
    const children = Array.from(screen.getByTestId('home-settling').children) as HTMLElement[];
    expect(children[1]!.style.height).toBe('144px');
    expect(children[0]!.style.height).toBe(`${HOME_SETTLING_HEIGHTS.shortcuts}px`);
    expect(children[2]!.style.height).toBe(`${HOME_SETTLING_HEIGHTS.flash}px`);
  });

  it('không có banner (mặc định): không thêm ô nào', () => {
    render(<HomeSettlingSkeleton banner={false} />);
    expect(screen.getByTestId('home-settling').children).toHaveLength(5);
  });

  it('danh mục theo số ô nhớ: tới 5 ô một hàng (148), từ 6 ô hai hàng (248)', () => {
    const categoriesHeight = (cells?: number) => {
      const { unmount } = render(<HomeSettlingSkeleton categoryCells={cells} />);
      const h = (screen.getByTestId('home-settling').children[3] as HTMLElement).style.height;
      unmount();
      return h;
    };
    expect(categoriesHeight(4)).toBe('148px');
    expect(categoriesHeight(5)).toBe('148px');
    expect(categoriesHeight(6)).toBe('248px');
    expect(categoriesHeight(undefined)).toBe(`${HOME_SETTLING_HEIGHTS.categories}px`);
  });
});
