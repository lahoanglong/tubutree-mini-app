// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, render, type Rendered } from '@/test-utils/dom';
import { createRoot } from 'react-dom/client';
import { Sheet } from './sheet';
import { ConfirmDialog } from '../admin/confirm-dialog';

// render() của test-utils bọc QueryClientProvider nên root.render lại sẽ remount; ở đây cần cùng cây để thử đổi prop.
function mountPlain(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  mounted.push({ container, root, unmount: () => { act(() => root.unmount()); container.remove(); } });
  return root;
}

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

  it('hai sheet chồng nhau: Tab xoay trong sheet trên cùng, Esc chỉ đóng sheet trên cùng', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    const ui = (inner: boolean) => (
      <Sheet open onClose={outerClose} title="Ngoài">
        <button>ngoai-1</button>
        <Sheet open={inner} onClose={innerClose} title="Trong">
          <button>trong-1</button>
        </Sheet>
      </Sheet>
    );
    const root = mountPlain(ui(false));
    act(() => root.render(ui(true)));
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const innerDialog = dialogs[dialogs.length - 1]!;
    expect(innerDialog.contains(document.activeElement)).toBe(true);
    key('Tab');
    expect(innerDialog.contains(document.activeElement)).toBe(true);
    key('Tab');
    expect(innerDialog.contains(document.activeElement)).toBe(true);
    key('Escape');
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it('ConfirmDialog mở chồng lên Sheet: Esc chỉ trả lời hộp xác nhận, Tab xoay vòng trong hộp', () => {
    const outerClose = vi.fn();
    const onAnswer = vi.fn();
    mount(
      <>
        <Sheet open onClose={outerClose} title="Rút tiền">x</Sheet>
        <ConfirmDialog options={{ title: 'Xác nhận rút', message: 'Chắc chưa?' }} onAnswer={onAnswer} />
      </>,
    );
    const confirm = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(confirm.contains(document.activeElement)).toBe(true);
    const labels = () => (document.activeElement as HTMLElement).textContent;
    const start = labels();
    key('Tab');
    const second = labels();
    expect(second).not.toBe(start);
    expect(confirm.contains(document.activeElement)).toBe(true);
    key('Tab');
    expect(labels()).toBe(start);
    key('Escape');
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it('đổi dismissible khi đang mở không làm focus nhảy', () => {
    const ui = (d: boolean) => (
      <Sheet open onClose={() => {}} dismissible={d} footer={<button>go</button>}>
        <input aria-label="first" />
      </Sheet>
    );
    const root = mountPlain(ui(true));
    const go = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'go')!;
    go.focus();
    act(() => root.render(ui(false)));
    expect(document.activeElement).toBe(go);
  });

  it('chừa safe-area đáy cho footer', () => {
    mount(<Sheet open onClose={() => {}} footer={<button>go</button>}>x</Sheet>);
    const footer = document.querySelector<HTMLElement>('[data-sheet-footer]')!;
    expect(footer.style.paddingBottom).toContain('safe-area-inset-bottom');
  });
});
