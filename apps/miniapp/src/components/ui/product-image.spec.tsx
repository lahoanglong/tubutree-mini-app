import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductImage } from './product-image';
import { ProductThumb } from './product-thumb';

const LEAF = 'M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z';

describe('ảnh thay thế thống nhất (B-23)', () => {
  it('thiếu ảnh: ô thẻ và ô vuông cùng một hình lá', () => {
    const tile = render(<div style={{ position: 'relative' }}><ProductImage src={null} brand="Tubu" /></div>).container;
    const thumb = render(<ProductThumb src={undefined} alt="" size={56} />).container;
    expect(tile.querySelector('path')!.getAttribute('d')).toBe(LEAF);
    expect(thumb.querySelector('path')!.getAttribute('d')).toBe(LEAF);
  });

  it('ảnh tải lỗi: ProductImage rơi về hình lá thay vì icon ảnh vỡ', () => {
    const { container } = render(<div style={{ position: 'relative' }}><ProductImage src="https://img.test/hong.jpg" brand="Tubu"/></div>);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="product-image-fallback"]')).not.toBeNull();
  });
});
