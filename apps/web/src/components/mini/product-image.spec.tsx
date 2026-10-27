// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from './harness';
import { ProductImage } from './product-image';
import { ProductThumb } from './product-thumb';

const LEAF = 'M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z';

describe('ảnh thay thế thống nhất (B-23)', () => {
  it('thiếu ảnh: ô thẻ và ô vuông cùng một hình lá', () => {
    const tile = mount(<div style={{ position: 'relative' }}><ProductImage src={null} brand="Tubu" /></div>).container;
    const thumb = mount(<ProductThumb src={undefined} alt="" size={56} />).container;
    expect(tile.querySelector('path')!.getAttribute('d')).toBe(LEAF);
    expect(thumb.querySelector('path')!.getAttribute('d')).toBe(LEAF);
  });

  it('ảnh tải lỗi: ProductImage rơi về hình lá thay vì icon ảnh vỡ', () => {
    const { container } = mount(<div style={{ position: 'relative' }}><ProductImage src="https://img.test/hong.jpg" brand="Tubu" alt="Tiêu" /></div>);
    const img = container.querySelector('img')!;
    act(() => {
      img.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="product-image-fallback"]')).not.toBeNull();
  });

  describe('B-133: ảnh đã lỗi trước khi hydrate', () => {
    const proto = HTMLImageElement.prototype;
    const setLoadState = (complete: boolean, naturalWidth: number) => {
      Object.defineProperty(proto, 'complete', { configurable: true, get: () => complete });
      Object.defineProperty(proto, 'naturalWidth', { configurable: true, get: () => naturalWidth });
    };
    afterEach(() => {
      delete (proto as unknown as Record<string, unknown>).complete;
      delete (proto as unknown as Record<string, unknown>).naturalWidth;
    });

    it('lúc mount ảnh đã xong mà không có điểm ảnh: rơi về hình lá không cần sự kiện lỗi', () => {
      setLoadState(true, 0);
      const { container } = mount(<div style={{ position: 'relative' }}><ProductImage src="https://img.test/hong.jpg" brand="Tubu" /></div>);
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('[data-testid="product-image-fallback"]')).not.toBeNull();
    });

    it('ảnh đã tải xong bình thường, hoặc còn đang tải: giữ ảnh', () => {
      setLoadState(true, 400);
      expect(mount(<div style={{ position: 'relative' }}><ProductImage src="https://img.test/ok.jpg" brand="Tubu" /></div>).container.querySelector('img')).not.toBeNull();
      setLoadState(false, 0);
      expect(mount(<div style={{ position: 'relative' }}><ProductImage src="https://img.test/cho.jpg" brand="Tubu" /></div>).container.querySelector('img')).not.toBeNull();
    });
  });
});
