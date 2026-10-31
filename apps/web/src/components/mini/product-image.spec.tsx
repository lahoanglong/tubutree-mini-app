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
    const originals = {
      complete: Object.getOwnPropertyDescriptor(proto, 'complete'),
      naturalWidth: Object.getOwnPropertyDescriptor(proto, 'naturalWidth'),
    };
    afterEach(() => {
      for (const key of ['complete', 'naturalWidth'] as const) {
        const original = originals[key];
        if (original) Object.defineProperty(proto, key, original);
        else delete (proto as unknown as Record<string, unknown>)[key];
      }
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

describe('ảnh đổi cỡ (R-5)', () => {
  const PANCAKE = 'https://content.pancake.vn/2-26/s800x800/a.jpg';

  it('ảnh Pancake đi qua /img với srcset 1x/2x', () => {
    const { container } = mount(<div style={{ position: 'relative' }}><ProductImage src={PANCAKE} brand="Tubu" /></div>);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toContain('/img?w=320&u=');
    expect(img.getAttribute('srcset')).toMatch(/w=320.* 1x, .*w=640.* 2x$/);
  });

  it('bản đổi cỡ lỗi thì thử ảnh gốc một lần, gốc cũng lỗi mới rơi về hình lá', () => {
    const { container } = mount(<div style={{ position: 'relative' }}><ProductImage src={PANCAKE} brand="Tubu" /></div>);
    act(() => {
      container.querySelector('img')!.dispatchEvent(new Event('error'));
    });
    const retry = container.querySelector('img')!;
    expect(retry.getAttribute('src')).toBe(PANCAKE);
    act(() => {
      retry.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="product-image-fallback"]')).not.toBeNull();
  });
});

describe('ảnh hiện dần, viền trung tính, ô thay thế không nhuộm màu nhãn (PL-15)', () => {
  const proto = HTMLImageElement.prototype;
  const setComplete = (complete: boolean) => {
    Object.defineProperty(proto, 'complete', { configurable: true, get: () => complete });
    Object.defineProperty(proto, 'naturalWidth', { configurable: true, get: () => (complete ? 400 : 0) });
  };
  const originals = { complete: Object.getOwnPropertyDescriptor(proto, 'complete'), naturalWidth: Object.getOwnPropertyDescriptor(proto, 'naturalWidth') };
  afterEach(() => {
    for (const key of ['complete', 'naturalWidth'] as const) {
      const original = originals[key];
      if (original) Object.defineProperty(proto, key, original);
      else delete (proto as unknown as Record<string, unknown>)[key];
    }
  });

  it('ảnh còn đang tải: trong suốt, tải xong thì hiện dần trong 200ms', () => {
    setComplete(false);
    const { container } = mount(<div style={{ position: 'relative' }}><ProductImage src="https://img.test/a.jpg" brand="Tubu" /></div>);
    const img = container.querySelector('img')!;
    expect(img.style.opacity).toBe('0');
    expect(img.style.transition).toContain('opacity 200ms');
    act(() => {
      img.dispatchEvent(new Event('load'));
    });
    expect(container.querySelector('img')!.style.opacity).toBe('1');
  });

  it('ảnh đã tải xong trước khi gắn sự kiện (bộ nhớ đệm, HTML dựng sẵn): hiện ngay', () => {
    setComplete(true);
    const { container } = mount(<div style={{ position: 'relative' }}><ProductImage src="https://img.test/a.jpg" brand="Tubu" /></div>);
    expect(container.querySelector('img')!.style.opacity).toBe('1');
  });

  it('viền trong 1px trung tính để ảnh nền trắng không hoà vào thân thẻ', () => {
    setComplete(true);
    const { container } = mount(<div style={{ position: 'relative' }}><ProductImage src="https://img.test/a.jpg" brand="Tubu" /></div>);
    const img = container.querySelector('img')!;
    expect(img.style.outline).toBe('1px solid var(--color-media-outline)');
    expect(img.style.outlineOffset).toBe('-1px');
  });

  it('ô thay thế chỉ có lá xanh trên nền khung ảnh: không tên nhãn, không nền ngả màu nhãn', () => {
    const { container } = mount(<div style={{ position: 'relative' }}><ProductImage src={null} brand="Polang" /></div>);
    const fallback = container.querySelector('[data-testid="product-image-fallback"]') as HTMLElement;
    expect(fallback.textContent).toBe('');
    expect(fallback.querySelector('div')).toBeNull();
  });
});
