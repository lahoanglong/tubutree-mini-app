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

describe('ảnh đổi cỡ (R-5)', () => {
  const PANCAKE = 'https://content.pancake.vn/2-26/s800x800/a.jpg';

  it('ảnh Pancake đi qua /img với srcset 1x/2x và có width/height giữ chỗ', () => {
    const { container } = render(<div style={{ position: 'relative' }}><ProductImage src={PANCAKE} brand="Tubu" /></div>);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toContain('/img?w=320&u=');
    expect(img.getAttribute('srcset')).toMatch(/w=320.* 1x, .*w=640.* 2x$/);
    expect(img.getAttribute('width')).toBe('170');
    expect(img.getAttribute('height')).toBe('170');
  });

  it('bản đổi cỡ lỗi thì thử ảnh gốc một lần, gốc cũng lỗi mới rơi về hình lá', () => {
    const { container } = render(<div style={{ position: 'relative' }}><ProductImage src={PANCAKE} brand="Tubu" /></div>);
    fireEvent.error(container.querySelector('img')!);
    const retry = container.querySelector('img')!;
    expect(retry.getAttribute('src')).toBe(PANCAKE);
    expect(retry.getAttribute('srcset')).toBeNull();
    fireEvent.error(retry);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="product-image-fallback"]')).not.toBeNull();
  });

  it('host lạ dùng nguyên ảnh gốc, ô nhỏ 64px dùng bản 160 không srcset', () => {
    const other = render(<div style={{ position: 'relative' }}><ProductImage src="https://img.test/a.jpg" brand="Tubu" /></div>).container.querySelector('img')!;
    expect(other.getAttribute('src')).toBe('https://img.test/a.jpg');
    const thumb = render(<ProductThumb src={PANCAKE} alt="SP" size={64} />).container.querySelector('img')!;
    expect(thumb.getAttribute('src')).toContain('w=160');
    expect(thumb.getAttribute('srcset')).toBeNull();
  });
});
