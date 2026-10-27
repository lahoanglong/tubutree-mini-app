// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { mount } from '@/components/mini/harness';
import ProductGallery from './product-gallery';

const LEAF = 'M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z';

describe('ProductGallery: ảnh lỗi tải rơi về hình lá chung (B-23)', () => {
  it('ảnh lớn lỗi thì hiện LeafGlyph thay icon ảnh vỡ', () => {
    const { container } = mount(<ProductGallery images={['https://img.test/hong.jpg']} name="Tiêu đen" />);
    const img = container.querySelector('img')!;
    act(() => {
      img.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('path')!.getAttribute('d')).toBe(LEAF);
  });

  it('không có ảnh: cũng hình lá chung', () => {
    const { container } = mount(<ProductGallery images={[]} name="Tiêu đen" />);
    expect(container.querySelector('path')!.getAttribute('d')).toBe(LEAF);
  });
});
