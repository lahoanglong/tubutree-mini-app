// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductSuggestion } from '@tubutree/app-core/api/catalog';
import { render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ flash: [] as unknown[] }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => mocks.flash }));

import { SuggestList } from './suggest-list';

const P: ProductSuggestion = { slug: 'hat-dieu', name: 'Hạt điều rang', thumbnail: null, basePrice: 180_000, salePrice: 159_000 };

let mounted: Rendered | null = null;
function mount() {
  mounted = render(
    <SuggestList
      draft="hạt"
      recent={[]}
      categories={[]}
      products={[P]}
      loading={false}
      onPickKeyword={vi.fn()}
      onPickCategory={vi.fn()}
      onPickProduct={vi.fn()}
      onClearRecent={vi.fn()}
    />,
  );
  return mounted.container;
}

beforeEach(() => {
  mocks.flash = [];
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('SuggestList: giá sản phẩm', () => {
  it('không Giờ vàng: giá đang bán', () => {
    expect(mount().textContent).toContain('159.000đ');
  });

  it('đang Giờ vàng: giá khách trả như thẻ sản phẩm', () => {
    mocks.flash = [{ itemId: 'f1', variationId: 'v1', productSlug: 'hat-dieu', flashPrice: 119_000, retailPrice: 180_000, salePrice: 159_000, soldCount: 0, quota: 5, endAt: '2099-01-01T00:00:00.000Z' }];
    const text = mount().textContent;
    expect(text).toContain('119.000đ');
    expect(text).not.toContain('159.000đ');
  });

  it('mỗi dòng gợi ý co khi nhấn (tubu-press, cùng Mini App, W41B)', () => {
    const c = mount();
    const rows = Array.from(c.querySelectorAll('button'));
    expect(rows.length).toBeGreaterThan(0);
    for (const b of rows) expect(b.className).toContain('tubu-press');
  });
});

describe('SuggestList: Tìm phổ biến', () => {
  const mountEmpty = (recent: string[], popular: string[], onPickKeyword = vi.fn()) => {
    mounted = render(
      <SuggestList
        draft=""
        recent={recent}
        popular={popular}
        categories={[]}
        products={[]}
        loading={false}
        onPickKeyword={onPickKeyword}
        onPickCategory={vi.fn()}
        onPickProduct={vi.fn()}
        onClearRecent={vi.fn()}
      />,
    );
    return mounted.container;
  };

  it('ô trống: một hàng chip dưới "Tìm gần đây", bỏ cụm trùng (so không dấu); chạm chip tìm đúng cụm đó', () => {
    const onPick = vi.fn();
    const c = mountEmpty(['nuoc giat'], ['nước giặt', 'rửa tay'], onPick);
    const row = c.querySelector<HTMLElement>('[data-testid="popular-searches"]')!;
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['rửa tay']);
    expect(row.className).toContain('scroll-x');
    expect(c.textContent!.indexOf('Tìm gần đây')).toBeLessThan(c.textContent!.indexOf('Tìm phổ biến'));
    row.querySelector('button')!.click();
    expect(onPick).toHaveBeenCalledWith('rửa tay');
  });

  it('chưa có lịch sử nhưng có cụm phổ biến: vẫn vẽ hàng chip; đang gõ thì ẩn', () => {
    expect(mountEmpty([], ['rửa tay']).querySelector('[data-testid="popular-searches"]')).not.toBeNull();
    mounted?.unmount();
    mounted = render(
      <SuggestList draft="hạt" recent={[]} popular={['rửa tay']} categories={[]} products={[P]} loading={false} onPickKeyword={vi.fn()} onPickCategory={vi.fn()} onPickProduct={vi.fn()} onClearRecent={vi.fn()} />,
    );
    expect(mounted.container.querySelector('[data-testid="popular-searches"]')).toBeNull();
  });

  it('không lịch sử, không cụm phổ biến, ô trống: không vẽ gì', () => {
    expect(mountEmpty([], []).innerHTML).toBe('');
  });
});
