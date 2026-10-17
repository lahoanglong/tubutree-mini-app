// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { StickyActionBar } from './sticky-action-bar';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('StickyActionBar', () => {
  it('là vùng có tên, chỉ hiện dưới màn md, dính đáy và chừa safe-area', () => {
    const r = render(<StickyActionBar label="Mua hàng">nội dung</StickyActionBar>);
    mounted.push(r);
    const bar = r.container.querySelector('[data-testid="sticky-bar"]') as HTMLElement;
    expect(bar.getAttribute('role')).toBe('region');
    expect(bar.getAttribute('aria-label')).toBe('Mua hàng');
    expect(bar.className).toMatch(/\bfixed\b/);
    expect(bar.className).toMatch(/\bbottom-0\b/);
    expect(bar.className).toMatch(/\bmd:hidden\b/);
    expect(bar.style.paddingBottom).toContain('safe-area-inset-bottom');
    expect(bar.textContent).toBe('nội dung');
  });

  it('đánh dấu <body> trong lúc hiện để chân trang không bị thanh che, và gỡ khi rời trang', () => {
    const r = render(<StickyActionBar label="Mua hàng">x</StickyActionBar>);
    expect(document.body.classList.contains('has-sticky-bar')).toBe(true);
    r.unmount();
    expect(document.body.classList.contains('has-sticky-bar')).toBe(false);
  });
});

// Dòng báo vì sao nút khoá làm thanh cao hơn 6rem cố định: đệm đáy của trang phải theo chiều cao đo được.
describe('StickyActionBar — đệm đáy theo chiều cao thật', () => {
  const observers: { cb: () => void; observed: Element[]; disconnect: ReturnType<typeof vi.fn> }[] = [];
  let height = 84;
  const cssVar = () => document.documentElement.style.getPropertyValue('--sticky-bar-h');

  beforeEach(() => {
    observers.length = 0;
    height = 84;
    class FakeResizeObserver {
      observed: Element[] = [];
      disconnect = vi.fn();
      constructor(public cb: () => void) {
        observers.push(this);
      }
      observe(el: Element) {
        this.observed.push(el);
      }
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height }) as DOMRect);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty('--sticky-bar-h');
  });

  it('đo thanh ngay khi hiện và đặt vào biến --sticky-bar-h', () => {
    const r = render(<StickyActionBar label="Mua hàng">x</StickyActionBar>);
    mounted.push(r);
    expect(cssVar()).toBe('84px');
    expect(observers[0]!.observed[0]).toBe(r.container.querySelector('[data-testid="sticky-bar"]'));
  });

  it('thanh cao thêm (hiện dòng báo lỗi) thì biến đổi theo, thanh thấp lại thì hạ xuống', () => {
    mounted.push(render(<StickyActionBar label="Mua hàng">x</StickyActionBar>));
    height = 124;
    act(() => observers[0]!.cb());
    expect(cssVar()).toBe('124px');
    height = 84;
    act(() => observers[0]!.cb());
    expect(cssVar()).toBe('84px');
  });

  it('rời trang: ngừng theo dõi và gỡ biến, không để đệm đáy của trang kế tiếp bị ảnh hưởng', () => {
    const r = render(<StickyActionBar label="Mua hàng">x</StickyActionBar>);
    expect(cssVar()).toBe('84px');
    r.unmount();
    expect(observers[0]!.disconnect).toHaveBeenCalled();
    expect(cssVar()).toBe('');
  });

  it('trình duyệt không có ResizeObserver: không vỡ, vẫn đo một lần, vẫn gỡ biến khi rời', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const r = render(<StickyActionBar label="Mua hàng">x</StickyActionBar>);
    expect(cssVar()).toBe('84px');
    r.unmount();
    expect(cssVar()).toBe('');
  });
});
