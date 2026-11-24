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

const heightsOf = (root: HTMLElement) =>
  Array.from(root.querySelector('[data-testid="home-settling"]')!.children).map((el) => ((el.firstElementChild ?? el) as HTMLElement).style.height);

describe('HomeSettlingSkeleton', () => {
  it('bốn ô đúng thứ tự khối thật dưới dải ngữ cảnh: danh mục, kệ Bán chạy nhất, lối vào, dải Story; không giữ chỗ banner hay Giờ vàng', () => {
    mounted = render(<HomeSettlingSkeleton />);
    const h = HOME_SETTLING_HEIGHTS;
    expect(heightsOf(mounted.container)).toEqual([h.categories, h.products, h.shortcuts, h.stories].map((n) => `${n}px`));
  });

  it('khung chờ lối tắt hiện ở mọi khổ như Bento Hub thật (không lg:hidden) để máy tính không nhảy khi khối về', () => {
    mounted = render(<HomeSettlingSkeleton />);
    const kids = Array.from(mounted.container.querySelector('[data-testid="home-settling"]')!.children) as HTMLElement[];
    expect(kids[2]!.style.height).toBe(`${HOME_SETTLING_HEIGHTS.shortcuts}px`);
    for (const el of kids) expect(el.className).not.toContain('hidden');
  });

  it('danh mục luôn một hàng cộng thanh thương hiệu (192) dù số ô nhớ là bao nhiêu: số ô vượt 5 bị cắt về 5 như khối thật', () => {
    const categoriesHeight = (cells?: number) => {
      const r = render(<HomeSettlingSkeleton categoryCells={cells} />);
      const h = heightsOf(r.container)[0];
      r.unmount();
      return h;
    };
    expect(categoriesHeight(4)).toBe('192px');
    expect(categoriesHeight(5)).toBe('192px');
    expect(categoriesHeight(6)).toBe('192px');
    expect(categoriesHeight(40)).toBe('192px');
    expect(categoriesHeight(undefined)).toBe(`${HOME_SETTLING_HEIGHTS.categories}px`);
  });

  it('dải Story ở cuối, cao 144 như khối thật (không nhảy khi dải hiện), hiện ở mọi khổ', () => {
    mounted = render(<HomeSettlingSkeleton />);
    const kids = Array.from(mounted.container.querySelector('[data-testid="home-settling"]')!.children) as HTMLElement[];
    expect(heightsOf(mounted.container)[3]).toBe('144px');
    expect(kids[3]!.className).not.toContain('hidden');
  });
});
