// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { RowMenu } from './row-menu';

let mounted: Rendered | null = null;
const restores: Array<() => void> = [];
// vi.spyOn trên getter của prototype DOM tự đệ quy khi khôi phục (vitest 2), nên thay getter thủ công rồi trả lại mô tả cũ.
function stubValue(target: object, prop: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, prop);
  Object.defineProperty(target, prop, { configurable: true, get: () => value });
  restores.push(() => {
    if (original) Object.defineProperty(target, prop, original);
    else delete (target as Record<string, unknown>)[prop];
  });
}
const rectOf = (top: number, bottom: number) => ({ top, bottom, left: 900, right: 944, width: 44, height: bottom - top, x: 900, y: top, toJSON: () => ({}) });

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  while (restores.length) restores.pop()!();
  vi.restoreAllMocks();
});

function mount(items: Parameters<typeof RowMenu>[0]['items'], label = 'Thao tác với Xà phòng') {
  mounted = render(
    <div>
      <p id="outside">ngoài menu</p>
      <div data-scroll style={{ overflowX: 'auto' }}>
        <RowMenu label={label} items={items} />
      </div>
    </div>,
  );
  return mounted.container;
}
const trigger = (root: ParentNode) => root.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const menu = () => document.body.querySelector<HTMLElement>('[role="menu"]');
const items = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
const key = (el: Element, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });

describe('RowMenu', () => {
  it('đóng sẵn: chỉ có nút "⋯" mang tên đầy đủ, cao 44px, aria-expanded=false', () => {
    const root = mount([{ label: 'Sửa', onSelect: vi.fn() }]);
    expect(trigger(root).getAttribute('aria-label')).toBe('Thao tác với Xà phòng');
    expect(trigger(root).getAttribute('aria-expanded')).toBe('false');
    expect(trigger(root).className).toContain('min-h-[44px]');
    expect(trigger(root).querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(menu()).toBeNull();
  });

  it('bấm nút mở menu role=menu với các mục role=menuitem cao 44px; nút trỏ tới menu bằng aria-controls', () => {
    const root = mount([
      { label: 'Sửa', onSelect: vi.fn() },
      { label: 'Ngừng bán', onSelect: vi.fn(), tone: 'danger' },
    ]);
    click(trigger(root));
    expect(trigger(root).getAttribute('aria-expanded')).toBe('true');
    expect(menu()?.getAttribute('aria-label')).toBe('Thao tác với Xà phòng');
    expect(trigger(root).getAttribute('aria-controls')).toBe(menu()!.id);
    expect(items().map((b) => b.textContent)).toEqual(['Sửa', 'Ngừng bán']);
    for (const b of items()) expect(b.className).toContain('min-h-[44px]');
    expect(items()[1]!.className).toContain('text-danger-fg');
  });

  it('menu dựng ngoài khung cuộn của bảng (portal ra body, position fixed) nên hàng cuối không bị cắt', () => {
    const root = mount([{ label: 'Sửa', onSelect: vi.fn() }]);
    click(trigger(root));
    expect(menu()!.parentElement).toBe(document.body);
    expect(menu()!.closest('[data-scroll]')).toBeNull();
    expect(root.contains(menu())).toBe(false);
    expect(menu()!.style.position).toBe('fixed');
  });

  it('đủ chỗ phía dưới: mở xuống, căn mép phải theo nút', () => {
    const root = mount([{ label: 'Sửa', onSelect: vi.fn() }]);
    stubValue(window, 'innerHeight', 800);
    stubValue(document.documentElement, 'clientWidth', 1000);
    stubValue(HTMLElement.prototype, 'offsetHeight', 90);
    vi.spyOn(trigger(root), 'getBoundingClientRect').mockReturnValue(rectOf(100, 144));
    click(trigger(root));
    expect(menu()!.style.top).toBe('148px');
    expect(menu()!.style.right).toBe('56px');
  });

  it('gần đáy màn hình: mở lên trên nút thay vì tràn khỏi màn hình', () => {
    const root = mount([{ label: 'Sửa', onSelect: vi.fn() }]);
    stubValue(window, 'innerHeight', 800);
    stubValue(HTMLElement.prototype, 'offsetHeight', 90);
    vi.spyOn(trigger(root), 'getBoundingClientRect').mockReturnValue(rectOf(740, 784));
    click(trigger(root));
    expect(menu()!.style.top).toBe('646px');
  });

  it('chọn một mục gọi onSelect đúng một lần, đóng menu và trả tiêu điểm về nút', () => {
    const edit = vi.fn();
    const stop = vi.fn();
    const root = mount([
      { label: 'Sửa', onSelect: edit },
      { label: 'Ngừng bán', onSelect: stop },
    ]);
    click(trigger(root));
    click(items()[1]!);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
    expect(trigger(root).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger(root));
  });

  it('bấm lại nút hoặc bấm ra ngoài đóng menu; bấm vào trong menu thì không đóng trước khi chọn', () => {
    const root = mount([{ label: 'Sửa', onSelect: vi.fn() }]);
    click(trigger(root));
    click(trigger(root));
    expect(menu()).toBeNull();

    click(trigger(root));
    act(() => {
      menu()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(menu()).not.toBeNull();
    act(() => {
      root.querySelector('#outside')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it('Escape đóng menu và trả tiêu điểm về nút', () => {
    const root = mount([{ label: 'Sửa', onSelect: vi.fn() }]);
    click(trigger(root));
    key(items()[0]!, 'Escape');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger(root));
  });

  it('mở bằng bàn phím: tiêu điểm vào mục đầu, mũi tên lên/xuống đi vòng, Home/End nhảy đầu/cuối, Tab đóng menu', () => {
    const root = mount([
      { label: 'Sửa', onSelect: vi.fn() },
      { label: 'Ngừng bán', onSelect: vi.fn() },
      { label: 'Xoá', onSelect: vi.fn() },
    ]);
    click(trigger(root));
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1]!, 'ArrowUp');
    key(items()[0]!, 'ArrowUp');
    expect(document.activeElement).toBe(items()[2]);
    key(items()[2]!, 'ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0]!, 'End');
    expect(document.activeElement).toBe(items()[2]);
    key(items()[2]!, 'Home');
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0]!, 'Tab');
    expect(menu()).toBeNull();
  });

  it('cuộn trang hoặc đổi cỡ cửa sổ thì đóng menu để không treo lơ lửng sai chỗ', () => {
    const root = mount([{ label: 'Sửa', onSelect: vi.fn() }]);
    click(trigger(root));
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(menu()).toBeNull();
    click(trigger(root));
    act(() => {
      root.querySelector('[data-scroll]')!.dispatchEvent(new Event('scroll'));
    });
    expect(menu()).toBeNull();
  });

  it('mục bị khoá (disabled) không gọi onSelect và bị bỏ qua khi di chuyển bằng mũi tên', () => {
    const onSelect = vi.fn();
    const root = mount([
      { label: 'Đang gỡ…', onSelect, disabled: true },
      { label: 'Sửa', onSelect: vi.fn() },
    ]);
    click(trigger(root));
    expect(items()[0]!.disabled).toBe(true);
    expect(document.activeElement).toBe(items()[1]);
    click(items()[0]!);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
