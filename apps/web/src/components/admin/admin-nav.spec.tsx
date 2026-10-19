// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { AdminNav, type NavGroup } from './admin-nav';
import { click, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.restoreAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

type K = 'orders' | 'reviews' | 'config';
const GROUPS: NavGroup<K>[] = [
  { label: 'Đơn hàng', items: [{ k: 'orders', label: 'Đơn hàng' }] },
  {
    label: 'Hệ thống',
    items: [
      { k: 'reviews', label: 'Đánh giá' },
      { k: 'config', label: 'Cấu hình' },
    ],
  },
];

/** Dựng đúng bố cục của trang admin: AdminNav rồi tới vùng nội dung là phần tử anh em kế tiếp. */
const mount = (active: K) => {
  const r = render(
    <div className="lg:flex">
      <AdminNav groups={GROUPS} active={active} onSelect={() => {}} />
      <div data-testid="content">
        <h2>Nội dung tab</h2>
        <button type="button">Hành động đầu tiên</button>
      </div>
    </div>,
  );
  mounted.push(r);
  return r.container;
};

// D7-20: người dùng bàn phím phải Tab qua 41 mục menu mới tới nội dung.
describe('AdminNav — "Bỏ qua tới nội dung" (D7-20)', () => {
  it('có link bỏ qua đứng trước menu trong thứ tự Tab', () => {
    const c = mount('orders');
    const first = c.querySelector<HTMLElement>('a, button')!;
    expect(first.tagName).toBe('A');
    expect(first.textContent).toBe('Bỏ qua tới nội dung');
    expect(first.getAttribute('href')).toBe('#admin-main');
    expect(first.className).toContain('sr-only');
    expect(first.className).toContain('focus:not-sr-only');
  });

  it('bấm Enter/click vào link thì tiêu điểm vào vùng nội dung, không phải menu', () => {
    const c = mount('orders');
    const content = c.querySelector<HTMLElement>('[data-testid="content"]')!;
    click(c.querySelector('a[href="#admin-main"]'));
    expect(content.id).toBe('admin-main');
    expect(content.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(content);
  });

  it('trang đã đặt id="admin-main" cho vùng nội dung thì dùng đúng phần tử đó dù có phần tử khác chen giữa', () => {
    const r = render(
      <div className="lg:flex">
        <AdminNav groups={GROUPS} active="orders" onSelect={() => {}} />
        <div data-testid="banner">Thông báo chen giữa</div>
        <div id="admin-main" data-testid="content">
          <h2>Nội dung tab</h2>
        </div>
      </div>,
    );
    mounted.push(r);
    const content = r.container.querySelector<HTMLElement>('[data-testid="content"]')!;
    click(r.container.querySelector('a[href="#admin-main"]'));
    expect(document.activeElement).toBe(content);
  });
});

// D7-21: mở thẳng tab cuối menu thì mục đang chọn nằm ngoài khung cuộn nên không thấy mình đang ở đâu.
// jsdom không có bố cục nên dựng kích thước giả: khung menu cao 400, mục đang chọn nằm ở 900-936.
describe('AdminNav — cuộn tới mục đang chọn (D7-21)', () => {
  const metrics = (itemTop: number) => {
    const scrolls = new WeakMap<Element, number>();
    Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get() { return scrolls.get(this) ?? 0; }, set(v: number) { scrolls.set(this, v); } });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 36; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) { return this.getAttribute('aria-current') === 'page' ? itemTop : 0; },
    });
    return scrolls;
  };
  afterEach(() => {
    for (const [proto, k] of [[Element.prototype, 'scrollTop'], [HTMLElement.prototype, 'clientHeight'], [HTMLElement.prototype, 'offsetHeight'], [HTMLElement.prototype, 'offsetTop']] as const) {
      delete (proto as unknown as Record<string, unknown>)[k];
    }
  });

  it('mục đang chọn nằm dưới khung nhìn: cuộn khung menu để mục nằm giữa khung, không gọi scrollIntoView (sẽ cuộn cả cửa sổ)', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const scrolls = metrics(900);
    const c = mount('reviews');
    const list = c.querySelector('nav > div')!;
    expect(c.querySelector('nav button[aria-current="page"]')?.textContent).toBe('Đánh giá');
    expect(scrolls.get(list)).toBe(900 - (400 - 36) / 2);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('mục đang chọn đã nằm trong khung nhìn thì không cuộn gì', () => {
    const scrolls = metrics(100);
    const c = mount('orders');
    expect(scrolls.get(c.querySelector('nav > div')!)).toBeUndefined();
  });

  it('đổi mục đang chọn thì cuộn lại tới mục mới', () => {
    const scrolls = metrics(900);
    const r = render(<AdminNav groups={GROUPS} active="orders" onSelect={() => {}} />);
    mounted.push(r);
    const list = r.container.querySelector('nav > div')!;
    act(() => r.root.render(<AdminNav groups={GROUPS} active="config" onSelect={() => {}} />));
    expect(scrolls.get(list)).toBe(900 - (400 - 36) / 2);
  });
});
