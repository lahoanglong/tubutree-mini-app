// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
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

  it('màu và bóng theo token semantic như bản Mini (không bảng màu thô stone-*)', () => {
    const r = render(<StickyActionBar label="Mua hàng">x</StickyActionBar>);
    mounted.push(r);
    const bar = r.container.querySelector('[data-testid="sticky-bar"]') as HTMLElement;
    expect(bar.className).toContain('bg-[var(--color-bg-surface)]');
    expect(bar.className).toContain('[box-shadow:var(--elevation-3)]');
    expect(bar.className).not.toMatch(/\b(?:bg|border|text)-stone-\d+\b/);
  });

  it('chừa inset trái/phải của tai thỏ khi xoay ngang (không nhỏ hơn lề 1rem sẵn có)', () => {
    const r = render(<StickyActionBar label="Mua hàng">x</StickyActionBar>);
    mounted.push(r);
    const bar = r.container.querySelector('[data-testid="sticky-bar"]') as HTMLElement;
    expect(bar.style.paddingLeft).toBe('max(1rem, env(safe-area-inset-left, 0px))');
    expect(bar.style.paddingRight).toBe('max(1rem, env(safe-area-inset-right, 0px))');
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
  const observers: { cb: () => void; observed: Element[]; options: ResizeObserverOptions[]; disconnect: ReturnType<typeof vi.fn> }[] = [];
  let height = 84;
  const cssVar = () => document.documentElement.style.getPropertyValue('--sticky-bar-h');

  beforeEach(() => {
    observers.length = 0;
    height = 84;
    class FakeResizeObserver {
      observed: Element[] = [];
      options: ResizeObserverOptions[] = [];
      disconnect = vi.fn();
      constructor(public cb: () => void) {
        observers.push(this);
      }
      observe(el: Element, options?: ResizeObserverOptions) {
        this.observed.push(el);
        this.options.push(options ?? {});
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

  it('theo dõi hộp border-box: vùng an toàn đáy nằm trong đệm, xoay máy đổi nó mà hộp nội dung đứng yên', () => {
    mounted.push(render(<StickyActionBar label="Mua hàng">x</StickyActionBar>));
    expect(observers[0]!.options).toEqual([{ box: 'border-box' }]);
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

describe('StickyActionBar — hideFrom="lg" (giỏ, thanh toán)', () => {
  it('giữ thanh tới hết khổ md và đánh dấu body để chừa đáy trang ở 768–1023px', () => {
    const r = render(
      <StickyActionBar label="Đặt hàng" hideFrom="lg">
        x
      </StickyActionBar>,
    );
    mounted.push(r);
    const bar = r.container.querySelector('[data-testid="sticky-bar"]') as HTMLElement;
    expect(bar.className).toMatch(/\blg:hidden\b/);
    expect(bar.className).not.toMatch(/\bmd:hidden\b/);
    expect(document.body.classList.contains('has-sticky-bar-lg')).toBe(true);
    r.unmount();
    expect(document.body.classList.contains('has-sticky-bar-lg')).toBe(false);
  });
});

// Chuyển trang hoặc mở lớp phủ: thanh của trang mới gắn TRƯỚC, thanh cũ tháo SAU. Tháo thanh cũ không được xoá biến và lớp của thanh mới,
// vì thanh mới không đổi cỡ nên ResizeObserver không bắn lại để ghi bù.
describe('StickyActionBar — hai thanh cùng gắn', () => {
  const cssVar = () => document.documentElement.style.getPropertyValue('--sticky-bar-h');
  const hasClass = (name: string) => document.body.classList.contains(name);
  const heights: Record<string, number> = {};
  let notify: Array<() => void> = [];
  let live: Rendered[] = [];

  const bar = (text: string, hideFrom?: 'md' | 'lg') => {
    const r = render(
      <StickyActionBar label={text} hideFrom={hideFrom}>
        {text}
      </StickyActionBar>,
    );
    live.push(r);
    return r;
  };
  const drop = (r: Rendered) => {
    live = live.filter((x) => x !== r);
    r.unmount();
  };

  beforeEach(() => {
    notify = [];
    for (const k of Object.keys(heights)) delete heights[k];
    heights['A'] = 120;
    heights['B'] = 174;
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { notify.push(cb); }
      observe() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: heights[this.textContent ?? ''] ?? 0 } as DOMRect;
    });
  });
  afterEach(() => {
    live.forEach((r) => r.unmount());
    live = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty('--sticky-bar-h');
    document.body.classList.remove('has-sticky-bar', 'has-sticky-bar-lg');
  });

  it('A (lg) gắn trước, B (md) gắn sau, tháo A: body giữ has-sticky-bar, biến theo B, has-sticky-bar-lg gỡ vì hết thanh lg', () => {
    const a = bar('A', 'lg');
    expect(cssVar()).toBe('120px');
    expect(hasClass('has-sticky-bar-lg')).toBe(true);
    const b = bar('B', 'md');
    expect(cssVar()).toBe('174px');
    expect(hasClass('has-sticky-bar-lg')).toBe(true);
    drop(a);
    expect(hasClass('has-sticky-bar')).toBe(true);
    expect(cssVar()).toBe('174px');
    expect(hasClass('has-sticky-bar-lg')).toBe(false);
    drop(b);
    expect(cssVar()).toBe('');
    expect(hasClass('has-sticky-bar')).toBe(false);
  });

  it('tháo thanh gắn SAU thì biến trả về thanh còn lại và has-sticky-bar-lg còn theo thanh lg, hết thanh mới xoá hết', () => {
    const a = bar('A', 'lg');
    const b = bar('B', 'md');
    drop(b);
    expect(hasClass('has-sticky-bar')).toBe(true);
    expect(cssVar()).toBe('120px');
    expect(hasClass('has-sticky-bar-lg')).toBe(true);
    drop(a);
    expect(cssVar()).toBe('');
    expect(hasClass('has-sticky-bar')).toBe(false);
    expect(hasClass('has-sticky-bar-lg')).toBe(false);
  });

  it('thanh không phải thanh trên cùng đổi cỡ thì không ghi đè biến; thanh trên cùng đổi cỡ thì biến đổi theo', () => {
    bar('A');
    bar('B');
    heights['A'] = 200;
    act(() => notify[0]!());
    expect(cssVar()).toBe('174px');
    heights['B'] = 190;
    act(() => notify[1]!());
    expect(cssVar()).toBe('190px');
  });

  // Root riêng: render lại qua harness (bọc QueryClientProvider) đổi kiểu gốc nên React gỡ và dựng lại thanh, không phải cập nhật tại chỗ.
  it('thanh duy nhất đổi hideFrom từ lg sang md tại chỗ: gỡ has-sticky-bar-lg, giữ has-sticky-bar và biến', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const el = (hideFrom: 'md' | 'lg') => (
      <StickyActionBar label="A" hideFrom={hideFrom}>
        A
      </StickyActionBar>
    );
    try {
      act(() => root.render(el('lg')));
      const node = host.querySelector('[data-testid="sticky-bar"]');
      expect(hasClass('has-sticky-bar-lg')).toBe(true);
      act(() => root.render(el('md')));
      expect(host.querySelector('[data-testid="sticky-bar"]')).toBe(node);
      expect(hasClass('has-sticky-bar-lg')).toBe(false);
      expect(hasClass('has-sticky-bar')).toBe(true);
      expect(cssVar()).toBe('120px');
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
