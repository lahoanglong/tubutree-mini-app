// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { click, render } from '@/test-utils/dom';
import { ShopCategoriesTab } from './shop-categories-tab';

const col = (id: string, title: string, n: number) => ({ id, title, items: Array.from({ length: n }, () => ({ product: { thumbnail: null } })) });

describe('ShopCategoriesTab (web)', () => {
  it('mỗi bộ một dòng có tên đọc đủ "<tên>, <n> món"; tối đa 4 ảnh', () => {
    const r = render(<ShopCategoriesTab collections={[col('a', 'Bếp xanh', 7), col('b', 'Làm đẹp', 2)]} onOpen={() => undefined} />);
    const rows = Array.from(r.container.querySelectorAll('button'));
    expect(rows.map((b) => b.getAttribute('aria-label'))).toEqual(['Bếp xanh, 7 món', 'Làm đẹp, 2 món']);
    expect(rows[0]!.querySelector('[aria-hidden="true"]')!.children).toHaveLength(4);
    r.unmount();
  });

  it('bấm một dòng mở bộ đó; rỗng thì không vẽ gì', () => {
    const onOpen = vi.fn();
    const r = render(<ShopCategoriesTab collections={[col('a', 'Bếp xanh', 3)]} onOpen={onOpen} />);
    click(r.container.querySelector('button'));
    expect(onOpen).toHaveBeenCalledWith('a');
    r.unmount();
    const e = render(<ShopCategoriesTab collections={[]} onOpen={onOpen} />);
    expect(e.container.innerHTML).toBe('');
    e.unmount();
  });
});
