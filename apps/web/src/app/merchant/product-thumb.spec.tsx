// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { ProductThumb } from './product-thumb';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const mount = (product: { thumbnail?: string | null; images: string[] }) => {
  mounted = render(<ProductThumb product={product} />);
  return mounted.container;
};
const box = (root: ParentNode) => root.querySelector<HTMLElement>('[data-thumb]')!;

describe('ProductThumb', () => {
  it('khung 40px; ưu tiên thumbnail, ảnh trang trí nên alt rỗng (tên sản phẩm nằm ngay cạnh)', () => {
    const root = mount({ thumbnail: 'https://cdn.tubutree.com/t.jpg', images: ['https://cdn.tubutree.com/i.jpg'] });
    expect(box(root).className).toContain('h-10');
    expect(box(root).className).toContain('w-10');
    const img = root.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://cdn.tubutree.com/t.jpg');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('không có thumbnail thì lấy ảnh đầu tiên', () => {
    const root = mount({ thumbnail: null, images: ['https://cdn.tubutree.com/i.jpg', 'https://cdn.tubutree.com/j.jpg'] });
    expect(root.querySelector('img')!.getAttribute('src')).toBe('https://cdn.tubutree.com/i.jpg');
  });

  it('không có ảnh, hoặc ảnh không phải http(s): hiện khung trống có biểu tượng, không dựng img', () => {
    for (const product of [{ images: [] }, { thumbnail: '', images: [] }, { thumbnail: 'javascript:alert(1)', images: ['logo.png'] }]) {
      const root = mount(product);
      expect(root.querySelector('img')).toBeNull();
      expect(box(root).querySelector('svg')).not.toBeNull();
      mounted!.unmount();
      mounted = null;
    }
  });

  it('ảnh không tải được thì chuyển sang khung trống thay vì ảnh vỡ', async () => {
    const root = mount({ images: ['https://cdn.tubutree.com/hong.jpg'] });
    act(() => {
      root.querySelector('img')!.dispatchEvent(new Event('error'));
    });
    await flush(1);
    expect(root.querySelector('img')).toBeNull();
    expect(box(root).querySelector('svg')).not.toBeNull();
  });
});
