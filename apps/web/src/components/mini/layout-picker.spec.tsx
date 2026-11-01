// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { styleOptions } from '@tubutree/app-core/commerce/storefront-builder';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { LayoutPicker } from './layout-picker';

const open = styleOptions(null);
const radios = () => Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]'));
const radio = (name: RegExp) => radios().find((r) => name.test(r.textContent ?? ''))!;
const key = (el: HTMLElement, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

describe('LayoutPicker (web)', () => {
  it('radiogroup có tên; 4 ô theo thứ tự Kệ ngang, Lưới, Danh sách, Combo', () => {
    mount(<LayoutPicker value="GRID" onChange={() => undefined} options={open} />);
    expect(document.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Kiểu hiển thị');
    expect(radios().map((r) => r.textContent)).toEqual(['Kệ ngang', 'Lưới', 'Danh sách', 'Combo']);
  });

  it('aria-checked theo value; chỉ ô đang chọn nằm trong thứ tự Tab', () => {
    mount(<LayoutPicker value="STACK" onChange={() => undefined} options={open} />);
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false']);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, -1, 0, -1]);
  });

  it('bấm ô khác gọi onChange; ô khoá có aria-disabled, không gọi, trỏ tới lời giải thích', () => {
    const onChange = vi.fn();
    mount(<LayoutPicker value="GRID" onChange={onChange} options={styleOptions({ kind: 'NORMAL' })} lockNote="Kiểu Combo chọn lúc tạo khối." />);
    click(radio(/Danh sách/));
    expect(onChange).toHaveBeenCalledWith('STACK');
    onChange.mockClear();
    const combo = radio(/Combo/);
    expect(combo.getAttribute('aria-disabled')).toBe('true');
    click(combo);
    expect(onChange).not.toHaveBeenCalled();
    const note = Array.from(document.querySelectorAll('p')).find((p) => p.textContent === 'Kiểu Combo chọn lúc tạo khối.')!;
    expect(combo.getAttribute('aria-describedby')).toBe(note.id);
  });

  it('phím mũi tên đổi ô, quay vòng và bỏ qua ô khoá', () => {
    const onChange = vi.fn();
    mount(<LayoutPicker value="STACK" onChange={onChange} options={styleOptions({ kind: 'NORMAL' })} />);
    key(radio(/Danh sách/), 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('CAROUSEL');
    key(radio(/Kệ ngang/), 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('STACK');
  });

  it('mỗi ô cao ít nhất 44 và không tràn (min-width 0)', () => {
    mount(<LayoutPicker value="GRID" onChange={() => undefined} options={open} />);
    for (const r of radios()) {
      expect(parseFloat(r.style.minHeight)).toBeGreaterThanOrEqual(44);
      expect(r.style.minWidth).toBe('0px');
    }
  });
});
