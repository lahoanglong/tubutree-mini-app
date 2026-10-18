// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type Rendered } from '@/test-utils/dom';
import { RowMenu } from './row-menu';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function mount(items: Parameters<typeof RowMenu>[0]['items'], label = 'Thao tác với Xà phòng') {
  mounted = render(
    <div>
      <p id="outside">ngoài menu</p>
      <RowMenu label={label} items={items} />
    </div>,
  );
  return mounted.container;
}
const trigger = (root: ParentNode) => root.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const items = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));

describe('RowMenu', () => {
  it('đóng sẵn: chỉ có nút "⋯" mang tên đầy đủ, cao 44px, aria-expanded=false', () => {
    const root = mount([{ label: 'Sửa', onSelect: vi.fn() }]);
    expect(trigger(root).getAttribute('aria-label')).toBe('Thao tác với Xà phòng');
    expect(trigger(root).getAttribute('aria-expanded')).toBe('false');
    expect(trigger(root).className).toContain('min-h-[44px]');
    expect(trigger(root).querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(items(root)).toHaveLength(0);
  });

  it('bấm nút mở menu role=menu với các mục role=menuitem cao 44px', () => {
    const root = mount([
      { label: 'Sửa', onSelect: vi.fn() },
      { label: 'Ngừng bán', onSelect: vi.fn(), tone: 'danger' },
    ]);
    click(trigger(root));
    expect(trigger(root).getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Thao tác với Xà phòng');
    expect(items(root).map((b) => b.textContent)).toEqual(['Sửa', 'Ngừng bán']);
    for (const b of items(root)) expect(b.className).toContain('min-h-[44px]');
    expect(items(root)[1]!.className).toContain('text-danger-fg');
  });

  it('chọn một mục gọi onSelect đúng một lần rồi đóng menu', () => {
    const edit = vi.fn();
    const stop = vi.fn();
    const root = mount([
      { label: 'Sửa', onSelect: edit },
      { label: 'Ngừng bán', onSelect: stop },
    ]);
    click(trigger(root));
    click(items(root)[1]!);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();
    expect(items(root)).toHaveLength(0);
    expect(trigger(root).getAttribute('aria-expanded')).toBe('false');
  });

  it('bấm lại nút, bấm ra ngoài hoặc nhấn Escape đều đóng menu; Escape trả tiêu điểm về nút', () => {
    const root = mount([{ label: 'Sửa', onSelect: vi.fn() }]);
    click(trigger(root));
    click(trigger(root));
    expect(items(root)).toHaveLength(0);

    click(trigger(root));
    act(() => {
      root.querySelector('#outside')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(items(root)).toHaveLength(0);

    click(trigger(root));
    expect(items(root)).toHaveLength(1);
    act(() => {
      items(root)[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(items(root)).toHaveLength(0);
    expect(document.activeElement).toBe(trigger(root));
  });

  it('mục bị khoá (disabled) không gọi onSelect', () => {
    const onSelect = vi.fn();
    const root = mount([{ label: 'Đang gỡ…', onSelect, disabled: true }]);
    click(trigger(root));
    expect(items(root)[0]!.disabled).toBe(true);
    click(items(root)[0]!);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
