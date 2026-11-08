// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { StickyActionBar } from './sticky-action-bar';

const PAD = 'tubu-scroll-pad-sticky-bar';
const barH = () => document.documentElement.style.getPropertyValue('--sticky-bar-h');

let live: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  live.push(r);
  return r;
};
const drop = (r: Rendered) => {
  live = live.filter((x) => x !== r);
  r.unmount();
};
const barOf = (r: Rendered) => r.container.querySelector('[data-testid="sticky-bar"]') as HTMLElement;

afterEach(() => {
  live.forEach((r) => r.unmount());
  live = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty('--sticky-bar-h');
});

describe('mini/StickyActionBar: khung và nhãn vùng', () => {
  it('dính đáy, chừa safe-area một lần và giữ data-sticky-bar cho bộ chọn có sẵn', () => {
    const r = mount(<StickyActionBar primary={<button>Mua ngay</button>} />);
    const bar = barOf(r);
    expect(bar.style.position).toBe('fixed');
    expect(bar.style.paddingBottom).toBe('calc(16px + var(--safe-bottom))');
    expect(bar.hasAttribute('data-sticky-bar')).toBe(true);
  });

  it('`dense` đệm 10px và gap 4px, không `dense` giữ 16px và 8px', () => {
    const dense = mount(<StickyActionBar dense primary={<button>x</button>} />);
    expect(barOf(dense).style.paddingBottom).toBe('calc(10px + var(--safe-bottom))');
    expect(barOf(dense).style.gap).toBe('4px');
    const normal = mount(<StickyActionBar primary={<button>y</button>} />);
    expect(barOf(normal).style.gap).toBe('8px');
  });

  it('có `label` thì phần tử gốc là region có tên, đã cắt khoảng trắng hai đầu', () => {
    const r = mount(<StickyActionBar label="  Thanh đặt hàng " primary={<button>x</button>} />);
    const bar = barOf(r);
    expect(bar.getAttribute('role')).toBe('region');
    expect(bar.getAttribute('aria-label')).toBe('Thanh đặt hàng');
    expect(r.container.querySelector('[role="region"][aria-label="Thanh đặt hàng"]')).toBe(bar);
  });

  it.each([undefined, '', '   '])('`label` = %j thì không gắn role và aria-label', (label) => {
    const r = mount(<StickyActionBar label={label} primary={<button>x</button>} />);
    expect(barOf(r).hasAttribute('role')).toBe(false);
    expect(barOf(r).hasAttribute('aria-label')).toBe(false);
  });
});

describe('mini/StickyActionBar: hàng CTA có `lead`', () => {
  it('`lead` nằm cùng hàng, bên trái nút chính', () => {
    const r = mount(<StickyActionBar primary={<button>Thanh toán</button>} lead={<span>Tạm tính 100.000đ</span>} />);
    const lead = r.container.querySelector('span')!.parentElement as HTMLElement;
    const primary = r.container.querySelector('button')!.parentElement as HTMLElement;
    expect(lead.parentElement).toBe(primary.parentElement);
    expect(lead.nextElementSibling).toBe(primary);
  });

  // 320px: khối `lead` chỉ còn ~130px, số tiền lớn không vừa thì hàng xuống dòng có chủ đích thay vì cắt chữ hay chui dưới nút.
  it('hàng flex-wrap: lead grow 1000 không bị ép min-width 0, nút basis 9.25rem grow 1 không co', () => {
    const r = mount(<StickyActionBar primary={<button>Thanh toán</button>} lead={<span>Tạm tính 100.000đ</span>} />);
    const lead = r.container.querySelector('span')!.parentElement as HTMLElement;
    const primary = r.container.querySelector('button')!.parentElement as HTMLElement;
    const row = primary.parentElement as HTMLElement;
    expect(row.style.flexWrap).toBe('wrap');
    expect(row.style.rowGap).toBe('var(--space-stack-xs)');
    expect(lead.style.flexGrow).toBe('1000');
    expect(lead.style.flexShrink).toBe('1');
    expect(lead.style.minWidth).toBe('');
    expect(primary.style.flexGrow).toBe('1');
    expect(primary.style.flexShrink).toBe('0');
    expect(primary.style.flexBasis).toBe('9.25rem');
  });

  it('không có `lead` thì nút chiếm cả hàng và hàng không xuống dòng', () => {
    const r = mount(<StickyActionBar primary={<button>Mua ngay</button>} />);
    const primary = r.container.querySelector('button')!.parentElement as HTMLElement;
    expect(primary.style.flex).toBe('1 1 0%');
    expect(primary.style.minWidth).toBe('0px');
    expect((primary.parentElement as HTMLElement).style.flexWrap).toBe('');
  });
});

describe('mini/StickyActionBar: --sticky-bar-h', () => {
  let notify: Array<() => void>;
  let options: Array<ResizeObserverOptions | undefined>;
  const heights: Record<string, number> = {};

  beforeEach(() => {
    notify = [];
    options = [];
    for (const k of Object.keys(heights)) delete heights[k];
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { notify.push(cb); }
      observe(_el: Element, o?: ResizeObserverOptions) { options.push(o); }
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: heights[this.textContent ?? ''] ?? 0 } as DOMRect;
    });
  });

  it('ghi chiều cao thật (làm tròn lên) khi gắn, đổi theo khi thanh đổi cao, xoá khi tháo', () => {
    heights['một'] = 140.2;
    const r = mount(<StickyActionBar primary={<button>một</button>} />);
    expect(barH()).toBe('141px');
    heights['một'] = 190;
    act(() => notify[0]!());
    expect(barH()).toBe('190px');
    drop(r);
    expect(barH()).toBe('');
  });

  it('theo dõi hộp border-box: xoay máy đổi vùng an toàn trong đệm mà hộp nội dung đứng yên', () => {
    mount(<StickyActionBar primary={<button>x</button>} />);
    expect(options).toEqual([{ box: 'border-box' }]);
  });

  it('trình duyệt không có ResizeObserver: không vỡ, vẫn đo một lần và vẫn xoá biến khi tháo', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    heights['một'] = 84;
    const r = mount(<StickyActionBar primary={<button>một</button>} />);
    expect(barH()).toBe('84px');
    drop(r);
    expect(barH()).toBe('');
  });

  // Chuyển trang: trang mới gắn thanh TRƯỚC, trang cũ tháo SAU. Thanh mới không đổi cỡ nên ResizeObserver không bắn lại để ghi bù.
  it('tháo thanh gắn TRƯỚC (trang cũ) thì biến giữ giá trị của thanh gắn sau (trang mới)', () => {
    heights['cũ'] = 120;
    heights['mới'] = 174;
    const old = mount(<StickyActionBar primary={<button>cũ</button>} />);
    expect(barH()).toBe('120px');
    const fresh = mount(<StickyActionBar primary={<button>mới</button>} />);
    expect(barH()).toBe('174px');
    drop(old);
    expect(barH()).toBe('174px');
    drop(fresh);
    expect(barH()).toBe('');
  });

  it('tháo thanh gắn SAU thì biến trả về giá trị của thanh còn lại, hết thanh mới xoá', () => {
    heights['cũ'] = 120;
    heights['mới'] = 174;
    const a = mount(<StickyActionBar primary={<button>cũ</button>} />);
    const b = mount(<StickyActionBar primary={<button>mới</button>} />);
    drop(b);
    expect(barH()).toBe('120px');
    drop(a);
    expect(barH()).toBe('');
  });

  it('thanh không phải thanh trên cùng đổi cỡ thì không ghi đè biến của thanh trên cùng', () => {
    heights['cũ'] = 120;
    heights['mới'] = 174;
    mount(<StickyActionBar primary={<button>cũ</button>} />);
    mount(<StickyActionBar primary={<button>mới</button>} />);
    heights['cũ'] = 200;
    act(() => notify[0]!());
    expect(barH()).toBe('174px');
    heights['mới'] = 180;
    act(() => notify[1]!());
    expect(barH()).toBe('180px');
  });
});

// Root riêng, không qua `render()` của harness: harness bọc QueryClientProvider, dựng lại cây bằng root.render sẽ đổi kiểu gốc nên React gỡ
// cả DOM thay vì chỉ gỡ thanh vừa ẩn, và test thành vô nghĩa. Ở đây các lần render lại giữ nguyên cây, chỉ đổi thanh nào còn hiện.
describe('mini/StickyActionBar: lớp chừa chỗ trên khung .zaui-page', () => {
  let roots: Array<{ root: Root; host: HTMLElement }> = [];
  afterEach(() => {
    roots.forEach(({ root, host }) => {
      act(() => root.unmount());
      host.remove();
    });
    roots = [];
  });
  const mountFrame = (ui: ReactElement) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(ui));
    const handle = { root, host };
    roots.push(handle);
    return handle;
  };
  const frame = (showA: boolean, showB: boolean) => (
    <div className="zaui-page" data-testid="pg">
      {showA && <StickyActionBar primary={<button>a</button>} />}
      {showB && <StickyActionBar primary={<button>b</button>} />}
    </div>
  );
  const page = (h: { host: HTMLElement }) => h.host.querySelector('[data-testid="pg"]') as HTMLElement;
  const show = (h: { root: Root }, showA: boolean, showB: boolean) => act(() => h.root.render(frame(showA, showB)));

  it('đánh dấu khung cuộn gần nhất khi gắn và gỡ khi thanh duy nhất tháo', () => {
    const h = mountFrame(frame(true, false));
    const pg = page(h);
    expect(pg.classList.contains(PAD)).toBe(true);
    show(h, false, false);
    expect(page(h)).toBe(pg);
    expect(pg.classList.contains(PAD)).toBe(false);
  });

  it('giữ lớp khi còn thanh trong cùng khung, chỉ gỡ khi thanh cuối tháo', () => {
    const h = mountFrame(frame(true, true));
    const pg = page(h);
    show(h, false, true);
    expect(page(h)).toBe(pg);
    expect(pg.classList.contains(PAD)).toBe(true);
    show(h, false, false);
    expect(pg.classList.contains(PAD)).toBe(false);
  });

  it('giữ lớp khi tháo thanh gắn sau, chỉ gỡ khi thanh gắn trước cũng tháo', () => {
    const h = mountFrame(frame(true, true));
    const pg = page(h);
    show(h, true, false);
    expect(page(h)).toBe(pg);
    expect(pg.classList.contains(PAD)).toBe(true);
    show(h, false, false);
    expect(pg.classList.contains(PAD)).toBe(false);
  });

  it('hai khung khác nhau: tháo thanh của khung này không gỡ lớp của khung kia', () => {
    const two = (showFirst: boolean) => (
      <>
        <div className="zaui-page" data-testid="p1">{showFirst && <StickyActionBar primary={<button>a</button>} />}</div>
        <div className="zaui-page" data-testid="p2"><StickyActionBar primary={<button>b</button>} /></div>
      </>
    );
    const h = mountFrame(two(true));
    const p1 = h.host.querySelector('[data-testid="p1"]') as HTMLElement;
    const p2 = h.host.querySelector('[data-testid="p2"]') as HTMLElement;
    expect(p1.classList.contains(PAD)).toBe(true);
    expect(p2.classList.contains(PAD)).toBe(true);
    act(() => h.root.render(two(false)));
    expect(h.host.querySelector('[data-testid="p2"]')).toBe(p2);
    expect(p1.classList.contains(PAD)).toBe(false);
    expect(p2.classList.contains(PAD)).toBe(true);
  });

  it('không có khung .zaui-page (web thường): không vỡ và không gắn lớp ở đâu', () => {
    const r = mount(<StickyActionBar primary={<button>x</button>} />);
    expect(document.querySelector(`.${PAD}`)).toBeNull();
    drop(r);
  });
});
