// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, render, type Rendered } from '@/test-utils/dom';
import { Sheet } from './sheet';

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const key = (k: string, opts: KeyboardEventInit = {}) =>
  act(() => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));
  });

afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.style.overflow = '';
});

describe('Sheet', () => {
  it('đóng thì không có gì trong DOM', () => {
    mount(<Sheet open={false} onClose={() => {}} title="Chọn mã">nội dung</Sheet>);
    expect(dialog()).toBeNull();
  });

  it('mở: role dialog, aria-modal, tên theo tiêu đề, có nút Đóng', () => {
    const onClose = vi.fn();
    mount(<Sheet open onClose={onClose} title="Chọn mã" description="Mô tả">nội dung</Sheet>);
    const d = dialog()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    const label = document.getElementById(d.getAttribute('aria-labelledby')!);
    expect(label?.textContent).toBe('Chọn mã');
    expect(d.textContent).toContain('Mô tả');
    click(d.querySelector('button[aria-label="Đóng"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc đóng; bấm nền đóng', () => {
    const onClose = vi.fn();
    mount(<Sheet open onClose={onClose} title="T">x</Sheet>);
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    click(document.querySelector('[data-sheet-backdrop]'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('dismissible=false: không có nút Đóng, Esc và bấm nền không đóng', () => {
    const onClose = vi.fn();
    mount(<Sheet open onClose={onClose} title="T" dismissible={false}>x</Sheet>);
    expect(document.querySelector('button[aria-label="Đóng"]')).toBeNull();
    key('Escape');
    click(document.querySelector('[data-sheet-backdrop]'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('khoá cuộn nền khi mở và trả lại khi đóng', () => {
    document.body.style.overflow = 'auto';
    const r = mount(<Sheet open onClose={() => {}} title="T">x</Sheet>);
    expect(document.body.style.overflow).toBe('hidden');
    r.unmount();
    mounted = [];
    expect(document.body.style.overflow).toBe('auto');
  });

  it('focus vào trong sheet khi mở, Tab xoay vòng trong sheet, đóng thì trả focus', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const r = mount(
      <Sheet open onClose={() => {}} title="T" footer={<button id="last">Xong</button>}>
        <button id="first">Một</button>
      </Sheet>,
    );
    const d = dialog()!;
    expect(d.contains(document.activeElement)).toBe(true);
    (document.getElementById('last') as HTMLElement).focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => {
      document.activeElement!.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(d.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(d.querySelector('button[aria-label="Đóng"]'));
    r.unmount();
    mounted = [];
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
