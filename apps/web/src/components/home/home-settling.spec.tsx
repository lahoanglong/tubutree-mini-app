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
    const heights = Array.from(mounted.container.querySelector('[data-testid="home-settling"]')!.children).map((el) => ((el.firstElementChild ?? el) as HTMLElement).style.height);
    const h = HOME_SETTLING_HEIGHTS;
    expect(heights).toEqual([h.shortcuts, h.flash, h.categories, h.products].map((n) => `${n}px`));
  });

  it('khung chờ lối tắt ẩn từ lg như ShortcutGrid thật: không giữ ~100px mà khối thật không dùng, nên máy tính không nhảy lên khi khối về', () => {
    mounted = render(<HomeSettlingSkeleton />);
    const first = mounted.container.querySelector('[data-testid="home-settling"]')!.children[0] as HTMLElement;
    expect(first.className).toContain('lg:hidden');
    expect((first.firstElementChild as HTMLElement).style.height).toBe(`${HOME_SETTLING_HEIGHTS.shortcuts}px`);
    // Ba khung còn lại luôn hiện: chỉ khung lối tắt theo điểm gãy của lưới thật.
    const rest = Array.from(mounted.container.querySelector('[data-testid="home-settling"]')!.children).slice(1);
    for (const el of rest) expect((el as HTMLElement).className).not.toContain('lg:hidden');
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

  it('banner=true (lần mở trước máy này có banner): thêm khung đầu tiên đúng tỉ lệ banner, chiều cao theo bề rộng; từ lg ẩn như lối tắt vì banner thật nằm cạnh thẻ thành viên', () => {
    mounted = render(<HomeSettlingSkeleton banner />);
    const kids = Array.from(mounted.container.querySelector('[data-testid="home-settling"]')!.children) as HTMLElement[];
    expect(kids).toHaveLength(5);
    expect(kids[0]!.className).toContain('lg:hidden');
    expect((kids[0]!.firstElementChild as HTMLElement).style.aspectRatio).toBe('var(--banner-ratio)');
    expect((kids[0]!.firstElementChild as HTMLElement).style.height).toBe('auto');
  });

  it('không có banner thì không giữ chỗ (mặc định): trang không có chiến dịch không thừa khoảng trống', () => {
    mounted = render(<HomeSettlingSkeleton />);
    expect(mounted.container.querySelector('[data-testid="home-settling"]')!.children).toHaveLength(4);
  });
});
