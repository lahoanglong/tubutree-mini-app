import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShopCategoriesTab } from './shop-categories-tab';

const col = (id: string, title: string, n: number) => ({ id, title, items: Array.from({ length: n }, (_, i) => ({ product: { thumbnail: i % 2 ? null : `https://cdn.example/${id}-${i}.jpg` } })) });

describe('ShopCategoriesTab', () => {
  it('mỗi bộ một dòng "tên · n món", bấm gọi onOpen với id', () => {
    const onOpen = vi.fn();
    render(<ShopCategoriesTab collections={[col('c1', 'Bếp xanh', 7), col('c2', 'Combo giặt', 3)]} onOpen={onOpen} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    const row = screen.getByRole('button', { name: 'Bếp xanh, 7 món' });
    expect(row).toHaveTextContent('7 món');
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith('c1');
  });

  it('dải ảnh tối đa 4, ảnh chỉ trang trí (alt rỗng)', () => {
    render(<ShopCategoriesTab collections={[col('c1', 'Bếp xanh', 9)]} onOpen={() => undefined} />);
    const imgs = document.querySelectorAll('img');
    expect(imgs.length).toBeLessThanOrEqual(4);
    imgs.forEach((i) => expect(i.getAttribute('alt')).toBe(''));
  });

  it('không có bộ nào: không vẽ gì', () => {
    const { container } = render(<ShopCategoriesTab collections={[]} onOpen={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
