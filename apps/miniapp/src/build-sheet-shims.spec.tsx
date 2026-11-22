import { act, fireEvent, render } from '@testing-library/react';
import { createRef, type Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from 'zmp-ui';
import { animated, to, useSpring, type SpringApi, type SpringValue } from './build-sheet-spring';

// Bản build thay hai gói này bằng shim chỉ cho sheet/content.js (build-vendor-shims.ts); ở đây thay cho cả zmp-ui để dựng Sheet thật trên shim.
// App không phụ thuộc trực tiếp hai gói nên phải khoá mock theo đúng tệp vitest nạp cho zmp-ui: `main` (CJS) giải từ thư mục zmp-ui.
const vendor = await vi.hoisted(async () => {
  const { createRequire } = await import('node:module');
  const { realpathSync } = await import('node:fs');
  const path = await import('node:path');
  const fromZmpUi = createRequire(path.join(realpathSync(path.resolve(process.cwd(), 'node_modules/zmp-ui')), 'esm', 'index.js'));
  return { spring: fromZmpUi.resolve('@react-spring/web'), drag: fromZmpUi.resolve('@use-gesture/react') };
});
vi.mock(vendor.spring, () => import('./build-sheet-spring'));
vi.mock(vendor.drag, () => import('./build-sheet-drag'));

const SHEET_HEIGHT = 400;
// jsdom không đo layout. `resize-observer-polyfill` (zmp-ui đo chiều cao sheet bằng nó) trả ResizeObserver gốc nếu có, nên đặt một bản báo
// chiều cao sheet ngay khi quan sát, trước khi zmp-ui được nạp.
vi.hoisted(() => {
  class FixedHeightObserver {
    constructor(private readonly cb: (entries: unknown[]) => void) {}
    observe() {
      this.cb([{ contentRect: { height: 400 } }]);
    }
    unobserve() {}
    disconnect() {}
  }
  Object.assign(globalThis, { ResizeObserver: FixedHeightObserver });
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'performance'] });
});
afterEach(() => {
  vi.useRealTimers();
});

const translateY = (el: Element) => {
  const m = (el as HTMLElement).style.transform.match(/^translateY\((-?[\d.]+)px\)$/);
  return m ? Number(m[1]) : NaN;
};

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

function renderSheet(visible: boolean, onClose = vi.fn()) {
  const ui = (v: boolean) => (
    <Sheet visible={v} title="Sửa địa chỉ" onClose={onClose}>
      <p>nội dung</p>
    </Sheet>
  );
  const view = render(ui(visible));
  const content = () => document.querySelector('.zaui-sheet-content') as HTMLElement;
  return { ...view, content, onClose, setVisible: (v: boolean) => view.rerender(ui(v)) };
}

const handle = (content: HTMLElement) => content.querySelector('.zaui-sheet-content-handler-wrapper') as HTMLElement;
const pointer = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', el: HTMLElement, y: number) =>
  act(() => void fireEvent[type](el, { pointerId: 1, button: 0, clientX: 10, clientY: y }));

describe('zmp-ui Sheet trên shim spring/drag', () => {
  it('zmp-ui thật sự nạp shim chứ không phải gói gốc', async () => {
    expect(await import(/* @vite-ignore */ vendor.spring)).toHaveProperty('SpringValue');
    expect((await import(/* @vite-ignore */ vendor.drag)).useDrag.toString()).toContain('setPointerCapture');
  });

  it('mở: trượt từ dưới lên tuyến tính trong 200ms rồi đứng ở translateY(0px)', () => {
    const { content } = renderSheet(true);
    advance(0);
    const start = translateY(content());
    expect(start).toBeGreaterThan(0);
    advance(100);
    const mid = translateY(content());
    // Tuyến tính: giữa chừng còn khoảng một nửa quãng (sai số một khung 16ms).
    expect(Math.abs(mid - start / 2)).toBeLessThan(start * 0.1);
    advance(150);
    expect(content().style.transform).toBe('translateY(0px)');
  });

  it('đóng: trượt xuống đúng chiều cao sheet', () => {
    const view = renderSheet(true);
    advance(300);
    view.setVisible(false);
    advance(100);
    const mid = translateY(view.content());
    expect(mid).toBeGreaterThan(SHEET_HEIGHT * 0.4);
    expect(mid).toBeLessThan(SHEET_HEIGHT * 0.6);
    advance(150);
    expect(view.content()?.style.transform ?? `translateY(${SHEET_HEIGHT}px)`).toBe(`translateY(${SHEET_HEIGHT}px)`);
  });

  it('kéo thanh xuống quá 100px rồi thả thì gọi onClose; trong lúc kéo sheet bám theo ngón tay', () => {
    const { content, onClose } = renderSheet(true);
    advance(300);
    const bar = handle(content());
    pointer('pointerDown', bar, 100);
    pointer('pointerMove', bar, 160);
    expect(content().style.transform).toBe('translateY(60px)');
    pointer('pointerMove', bar, 250);
    expect(content().style.transform).toBe('translateY(150px)');
    expect(onClose).not.toHaveBeenCalled();
    pointer('pointerUp', bar, 250);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('kéo chưa tới 100px thì thả ra bật về chỗ cũ, không đóng', () => {
    const { content, onClose } = renderSheet(true);
    advance(300);
    const bar = handle(content());
    pointer('pointerDown', bar, 100);
    pointer('pointerMove', bar, 150);
    expect(content().style.transform).toBe('translateY(50px)');
    pointer('pointerUp', bar, 150);
    advance(300);
    expect(content().style.transform).toBe('translateY(0px)');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('chạm (dời dưới 3px) không tính là kéo', () => {
    const { content, onClose } = renderSheet(true);
    advance(300);
    const bar = handle(content());
    pointer('pointerDown', bar, 100);
    pointer('pointerMove', bar, 101);
    expect(content().style.transform).toBe('translateY(0px)');
    pointer('pointerUp', bar, 101);
    advance(300);
    expect(content().style.transform).toBe('translateY(0px)');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('build-sheet-spring', () => {
  function Probe({ onApi, divRef }: { onApi: (v: Record<string, SpringValue>, api: SpringApi) => void; divRef?: Ref<HTMLDivElement> }) {
    const [values, api] = useSpring(() => ({ a: 100, b: 0, config: { duration: 200 } }));
    onApi(values, api);
    const a = values.a as SpringValue;
    const b = values.b as SpringValue;
    return <animated.div data-testid="probe" ref={divRef} style={{ opacity: 1, transform: to([a, b], (x, y) => `translateY(${x + y}px)`) }} />;
  }

  it('start đang chạy dở thì chạy tiếp từ chỗ đang đứng; set dừng hoạt cảnh và đặt ngay; ref tới đúng div', () => {
    let api: SpringApi | undefined;
    let values: Record<string, SpringValue> = {};
    const divRef = createRef<HTMLDivElement>();
    const { getByTestId } = render(
      <Probe
        divRef={divRef}
        onApi={(v, x) => {
          values = v;
          api = x;
        }}
      />,
    );
    const el = getByTestId('probe');
    const a = () => (values.a as SpringValue).get();
    expect(divRef.current).toBe(el);
    expect(el.style.transform).toBe('translateY(100px)');
    expect(el.style.opacity).toBe('1');
    act(() => api?.start({ a: 0 }));
    advance(100);
    const mid = a();
    expect(mid).toBeGreaterThan(30);
    expect(mid).toBeLessThan(70);
    expect(el.style.transform).toBe(`translateY(${mid}px)`);
    act(() => api?.start({ a: 200 }));
    advance(40);
    expect(a()).toBeGreaterThan(mid);
    act(() => api?.set({ b: 5, a: 10 }));
    advance(500);
    expect(a()).toBe(10);
    expect(el.style.transform).toBe('translateY(15px)');
  });

  it('tháo component giữa chừng thì huỷ khung hình đang chờ', () => {
    let api: SpringApi | undefined;
    const { unmount } = render(<Probe onApi={(_v, x) => void (api = x)} />);
    act(() => api?.start({ a: 0 }));
    advance(50);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
